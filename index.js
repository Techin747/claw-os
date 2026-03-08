const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// 1. Database Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Claw Intelligence System: Online'))
  .catch(err => console.error('❌ Connection Error:', err));

// 2. Data Schemas
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

// 3. AI & Line Config
const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};
const client = new line.Client(lineConfig);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash",
    generationConfig: { responseMimeType: "application/json" } // บังคับ Output เป็น JSON จากตัวโมเดลเลย
});

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (error) { res.status(500).end(); }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const lineId = event.source.userId;
  const userText = event.message.text;

  let user = await User.findOne({ lineId });
  if (!user) { user = new User({ lineId }); await user.save(); }

  try {
    // 🧠 วิเคราะห์เจตนาด้วย AI (Intent Analysis)
    const analysisPrompt = `คุณคือ Claw OS เลขาส่วนตัวของคุณ ${user.displayName}
    วิเคราะห์ประโยค: "${userText}"
    ตอบเป็น JSON เท่านั้น:
    {
      "intent": "add_task" | "list_tasks" | "complete_task" | "chat",
      "data": "เนื้อหาสำคัญที่ต้องจด",
      "taskIndex": 0,
      "aiReply": "คำตอบโต้กับผู้ใช้"
    }
    
    กฎ:
    - ถ้าเป็นสิ่งที่ต้องทำ/นัดหมายในอนาคต = add_task
    - ถ้าถามว่ามีงานอะไร/มีอะไรต้องทำบ้าง = list_tasks
    - ถ้าบอกว่าทำเสร็จแล้ว/เรียบร้อยแล้ว/ให้ลบออก = complete_task
    - นอกนั้น = chat`;

    const result = await model.generateContent(analysisPrompt);
    const analysis = JSON.parse(result.response.text());

    let finalResponse = analysis.aiReply;

    // ⚡️ จัดการฐานข้อมูลตาม Intent
    if (analysis.intent === "add_task" && analysis.data) {
        await new Task({ userId: lineId, task: analysis.data }).save();
    } 
    else if (analysis.intent === "list_tasks") {
        const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
        if (tasks.length === 0) {
            finalResponse = `คุณ ${user.displayName} ไม่มีงานค้างเลยครับ! สบายใจได้`;
        } else {
            const list = tasks.map((t, i) => `📌 ${i + 1}. ${t.task}`).join('\n');
            finalResponse = `รายการงานของคุณครับ:\n\n${list}\n\n${analysis.aiReply}`;
        }
    } 
    else if (analysis.intent === "complete_task") {
        const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
        let target = null;
        if (analysis.taskIndex > 0) target = tasks[analysis.taskIndex - 1];
        else target = tasks.find(t => userText.includes(t.task.substring(0, 4)));

        if (target) {
            target.status = 'completed';
            await target.save();
            finalResponse = `✅ เรียบร้อย! ผมปิดงาน "${target.task}" ให้แล้วครับ`;
        }
    }

    return client.replyMessage(event.replyToken, { type: 'text', text: finalResponse });

  } catch (error) {
    console.error("Claw Error:", error);
    // กรณี AI เพี้ยน ให้ตอบกลับแบบปกติไปก่อน
    return client.replyMessage(event.replyToken, { type: 'text', text: "ขออภัยครับ ผมขอเรียบเรียงข้อมูลสักครู่ ลองพิมพ์ใหม่อีกทีนะครับ" });
  }
}

app.listen(port);
