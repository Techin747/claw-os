const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// 1. เชื่อมต่อฐานข้อมูล
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Claw Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB Connection Error:', err));

// 2. ออกแบบผังข้อมูล
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
  createdAt: { type: Date, default: Date.now }
});
const Note = mongoose.model('Note', NoteSchema);

// 3. ตั้งค่า LINE และ Gemini
const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};
const client = new line.Client(lineConfig);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (error) {
    res.status(500).end();
  }
});

// 4. ฟังก์ชันหลักในการประมวลผล
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const lineId = event.source.userId;
  const userText = event.message.text;

  let user = await User.findOne({ lineId });
  if (!user) { user = new User({ lineId }); await user.save(); }

  // ⚡️ ส่วนที่ 1: ระบบจัดการคำสั่งโดยตรง (Hard Logic)
  
  // ตรวจจับคำสั่งขอดูรายการงาน (เพิ่มคีย์เวิร์ดให้แม่นขึ้น)
  const isAskingForTasks = ["งานอะไรบ้าง", "รายการงาน", "ลิสต์งาน", "ตารางงาน", "มีงานไหม"].some(word => userText.includes(word));
  
  if (isAskingForTasks) {
      const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: -1 });
      if (tasks.length === 0) {
          return client.replyMessage(event.replyToken, { type: 'text', text: `ตอนนี้คุณ ${user.displayName} ยังไม่มีรายการงานค้างครับ!` });
      }
      const taskList = tasks.map((t, i) => `📌 ${i + 1}. ${t.task}`).join('\n');
      return client.replyMessage(event.replyToken, { type: 'text', text: `รายการงานที่บันทึกไว้ครับ:\n\n${taskList}` });
  }

  // ส่วนที่ 2: ระบบบันทึกข้อมูล (ลง Database)
  if (userText.includes("จดงาน") || userText.includes("ต้องทำ") || userText.includes("งานคือ")) {
      const cleanTask = userText.replace(/จดงานว่า|ต้องทำว่า|จดงาน|ต้องทำ|งานคือ/g, "").trim();
      if(cleanTask) {
          const newTask = new Task({ userId: lineId, task: cleanTask });
          await newTask.save();
      }
  } else if (userText.includes("บันทึกว่า") || userText.includes("โน้ตว่า")) {
      const cleanNote = userText.replace(/บันทึกว่า|โน้ตว่า/g, "").trim();
      if(cleanNote) {
          const newNote = new Note({ userId: lineId, content: cleanNote });
          await newNote.save();
      }
  }

  // ส่วนที่ 3: ส่งให้ AI คิดคำตอบที่เหมาะสม
  try {
    const systemPrompt = `คุณคือ Claw Personal OS เลขาส่วนตัวของคุณ ${user.displayName}
    ข้อมูลความจำ: ${user.memories}
    
    บริบท:
    - ถ้าผู้ใช้สั่งงาน/บันทึก คุณได้ทำการเซฟลงฐานข้อมูลแล้ว ให้ตอบรับอย่างสุภาพและยืนยันสิ่งที่จด
    - ถ้าผู้ใช้คุยทั่วไป ให้ตอบแบบ AI เลขาที่ฉลาดและเป็นกันเอง
    
    ข้อความ: "${userText}"`;

    const result = await model.generateContent(systemPrompt);
    const aiResponse = result.response.text();

    user.lastChat = new Date();
    await user.save();

    return client.replyMessage(event.replyToken, { type: 'text', text: aiResponse });
  } catch (error) {
    return client.replyMessage(event.replyToken, { type: 'text', text: 'ขออภัยครับ ข้อมูลเยอะจนมึนหัว ขอลองใหม่อีกทีนะครับ' });
  }
}

app.listen(port);
