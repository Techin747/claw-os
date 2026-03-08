const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// 1. เชื่อมต่อ MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Claw Database Ready!'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// 2. ผังข้อมูล (Schemas)
const UserSchema = new mongoose.Schema({
  lineId: { type: String, unique: true },
  displayName: { type: String, default: 'เพื่อนใหม่' },
  memories: { type: String, default: 'ยังไม่มีข้อมูลส่วนตัว' }
});
const User = mongoose.model('User', UserSchema);

const TaskSchema = new mongoose.Schema({
  userId: String,
  task: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const Task = mongoose.model('Task', TaskSchema);

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

// 4. ฟังก์ชันประมวลผลคำสั่ง
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const lineId = event.source.userId;
  const userText = event.message.text;

  let user = await User.findOne({ lineId });
  if (!user) { user = new User({ lineId }); await user.save(); }

  // ⚡️ [A] ระบบดึงรายการงาน (List Tasks)
  const isAskingForTasks = ["งานอะไรบ้าง", "รายการงาน", "ลิสต์งาน", "มีงานไหม"].some(word => userText.includes(word));
  if (isAskingForTasks) {
      const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
      if (tasks.length === 0) {
          return client.replyMessage(event.replyToken, { type: 'text', text: `ตอนนี้คุณ ${user.displayName} ไม่มีงานค้างเลยครับ!` });
      }
      const taskList = tasks.map((t, i) => `📌 ${i + 1}. ${t.task}`).join('\n');
      return client.replyMessage(event.replyToken, { type: 'text', text: `รายการงานของคุณครับ:\n\n${taskList}\n\n(ถ้าทำเสร็จแล้ว พิมพ์ว่า "ทำเสร็จแล้วข้อ [เลข]" ได้เลยครับ)` });
  }

  // ⚡️ [B] ระบบปิดงาน (Complete Task)
  if (userText.includes("ทำเสร็จแล้ว") || userText.includes("ทำแล้ว") || userText.includes("เสร็จแล้ว")) {
      const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
      let targetTask = null;

      // พยายามหาเลขข้อจากข้อความ (เช่น "เสร็จแล้วข้อ 1")
      const match = userText.match(/\d+/);
      if (match) {
          const index = parseInt(match[0]) - 1;
          if (tasks[index]) targetTask = tasks[index];
      } else if (tasks.length > 0) {
          // ถ้าไม่ระบุเลข แต่มีงานเดียว ให้เลือกงานนั้นเลย
          targetTask = tasks[0];
      }

      if (targetTask) {
          targetTask.status = 'completed';
          await targetTask.save();
          return client.replyMessage(event.replyToken, { type: 'text', text: `ยอดเยี่ยมครับคุณ ${user.displayName}! ผมติ๊กเครื่องหมายเสร็จเรียบร้อยสำหรับงาน: "${targetTask.task}"` });
      }
  }

  // ⚡️ [C] ระบบบันทึกงานใหม่
  if (userText.includes("จดงาน") || userText.includes("ต้องทำ")) {
      const cleanTask = userText.replace(/จดงานว่า|ต้องทำว่า|จดงาน|ต้องทำ/g, "").trim();
      if(cleanTask) {
          const newTask = new Task({ userId: lineId, task: cleanTask });
          await newTask.save();
      }
  }

  // 🤖 [D] ให้ AI ตอบโต้ทั่วไป
  try {
    const systemPrompt = `คุณคือ Claw Personal OS ของคุณ ${user.displayName}
    หน้าที่: เป็นเลขาส่วนตัวที่ช่วยบันทึกและจัดการงาน
    ข้อความจากผู้ใช้: "${userText}"`;

    const result = await model.generateContent(systemPrompt);
    const aiResponse = result.response.text();

    return client.replyMessage(event.replyToken, { type: 'text', text: aiResponse });
  } catch (error) {
    return client.replyMessage(event.replyToken, { type: 'text', text: 'มึนหัวจังครับ ขอลองใหม่อีกที' });
  }
}

app.listen(port);
