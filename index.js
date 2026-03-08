const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// 1. เชื่อมต่อ MongoDB Atlas (ความจำถาวร)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Claw Memory & Database Connected!'))
  .catch(err => console.error('❌ Connection Error:', err));

// 2. ออกแบบผังข้อมูล (Schemas)
const UserSchema = new mongoose.Schema({
  lineId: { type: String, unique: true },
  displayName: { type: String, default: 'เพื่อนใหม่' },
  memories: { type: String, default: 'ยังไม่มีข้อมูลส่วนตัว' },
  lastChat: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

const TaskSchema = new mongoose.Schema({
  userId: String,
  task: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const Task = mongoose.model('Task', TaskSchema);

const NoteSchema = new mongoose.Schema({
  userId: String,
  content: String,
  category: { type: String, default: 'general' },
  createdAt: { type: Date, default: Date.now }
});
const Note = mongoose.model('Note', NoteSchema);

// 3. ตั้งค่า LINE และ Gemini API
const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};
const client = new line.Client(lineConfig);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 4. Webhook สำหรับรับข้อความ
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).end();
  }
});

// 5. ฟังก์ชันหลัก (สมองเลขา)
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const lineId = event.source.userId;
  const userText = event.message.text;

  // ดึงข้อมูลผู้ใช้
  let user = await User.findOne({ lineId });
  if (!user) {
    user = new User({ lineId });
    await user.save();
  }

  // --- ระบบตรวจจับคำสั่ง (Logic) ---
  
  // A. สั่งจำชื่อ
  if (userText.includes("ชื่อ") && (userText.includes("ฉัน") || userText.includes("ผม"))) {
      const detectedName = userText.replace(/จำว่า|ฉันชื่อ|ผมชื่อ|คือชื่อของฉัน|คือชื่อของผม/g, "").trim();
      if (detectedName) {
          user.displayName = detectedName;
          user.memories = `ผู้ใช้คนนี้ชื่อ ${detectedName}`;
          await user.save();
          return client.replyMessage(event.replyToken, { type: 'text', text: `รับทราบครับคุณ ${detectedName}! บันทึกชื่อเรียบร้อยครับ` });
      }
  }

  // B. ดูรายการงาน (Task List)
  if (userText.includes("รายการงาน") || userText.includes("มีงานอะไรบ้าง") || userText.includes("ลิสต์งาน")) {
      const tasks = await Task.find({ userId: lineId, status: 'pending' });
      if (tasks.length === 0) {
          return client.replyMessage(event.replyToken, { type: 'text', text: "ตอนนี้ยังไม่มีงานค้างครับ สบายใจได้!" });
      }
      const taskList = tasks.map((t, i) => `${i + 1}. ${t.task}`).join('\n');
      return client.replyMessage(event.replyToken, { type: 'text', text: `รายการงานของคุณครับ:\n${taskList}` });
  }

  // --- การประมวลผลด้วย AI ---
  try {
    const systemPrompt = `คุณคือ Claw Personal OS เลขาส่วนตัวของคุณ ${user.displayName}
    ข้อมูลที่คุณจำได้เกี่ยวกับเขา: ${user.memories}
    
    หน้าที่ปัจจุบัน:
    - ถ้าเขาสั่งงาน (เช่น "จดงานว่า...", "ต้องทำ...") ให้ตอบรับสั้นๆ ว่าบันทึกงานแล้ว
    - ถ้าให้จดบันทึก (เช่น "บันทึกว่า...", "โน้ตว่า...") ให้ตอบรับว่าบันทึกโน้ตแล้ว
    - ถ้าคุยเล่นทั่วไป ให้ตอบอย่างเป็นกันเองและชาญฉลาด
    
    ข้อความจากผู้ใช้: "${userText}"`;

    const result = await model.generateContent(systemPrompt);
    const aiResponse = result.response.text();

    // ⚡️ บันทึกลง Database ตามคำสั่ง
    if (userText.includes("จดงาน") || userText.includes("ต้องทำ")) {
        const newTask = new Task({ userId: lineId, task: userText.replace(/จดงานว่า|ต้องทำ|จดงาน/g, "").trim() });
        await newTask.save();
    } else if (userText.includes("บันทึกว่า") || userText.includes("โน้ตว่า")) {
        const newNote = new Note({ userId: lineId, content: userText.replace(/บันทึกว่า|โน้ตว่า/g, "").trim() });
        await newNote.save();
    }

    user.lastChat = new Date();
    await user.save();

    return client.replyMessage(event.replyToken, { type: 'text', text: aiResponse });
  } catch (error) {
    return client.replyMessage(event.replyToken, { type: 'text', text: 'ขออภัยครับ ระบบประมวลผลขัดข้อง' });
  }
}

app.listen(port, () => {
  console.log(`🚀 Claw OS Phase 3 (Secretary) Live on port ${port}`);
});
