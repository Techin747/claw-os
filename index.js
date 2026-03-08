const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// 1. เชื่อมต่อฐานข้อมูล MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
      console.log('✅ Claw Database: Online');
      sendStartupNotification(); // สั่งให้แจ้งเตือนเมื่อระบบพร้อม
  })
  .catch(err => console.error('❌ Database Error:', err));

// 2. ผังข้อมูล (Schemas)
const UserSchema = new mongoose.Schema({
  lineId: { type: String, unique: true },
  displayName: { type: String, default: 'เตชินท์' }, // ตั้งค่าเริ่มต้นเป็นชื่อคุณ
  memories: { type: String, default: 'เป็นเจ้าของระบบ Claw OS' }
});
const User = mongoose.model('User', UserSchema);

const TaskSchema = new mongoose.Schema({
  userId: String,
  task: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now }
});
const Task = mongoose.model('Task', TaskSchema);

// 3. ตั้งค่า LINE และ AI
const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};
const client = new line.Client(lineConfig);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash",
    generationConfig: { responseMimeType: "application/json" }
});

// 🔔 ฟังก์ชันแจ้งเกิดระบบ (Startup Notification)
async function sendStartupNotification() {
    try {
        // ดึงข้อมูล User คนแรก (คุณเตชินท์) มาทักทาย
        const user = await User.findOne();
        if (user && user.lineId) {
            await client.pushMessage(user.lineId, {
                type: 'text',
                text: `🚀 Claw OS รายงานตัว! ระบบอัปเกรดเสร็จสิ้นและพร้อมรับใช้คุณ ${user.displayName} แล้วครับ มีอะไรให้ผมช่วยจัดการไหมครับ?`
            });
            console.log('🔔 Startup notification sent!');
        }
    } catch (error) {
        console.error('⚠️ Could not send startup notification:', error);
    }
}

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (error) { res.status(500).end(); }
});

// 4. สมองส่วนวิเคราะห์ภาษาธรรมชาติ
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const lineId = event.source.userId;
  const userText = event.message.text;

  let user = await User.findOne({ lineId });
  if (!user) { user = new User({ lineId }); await user.save(); }

  try {
    const analysisPrompt = `คุณคือ Claw OS เลขาส่วนตัวที่ฉลาดที่สุดของคุณ ${user.displayName}
    วิเคราะห์เจตนาจากประโยค: "${userText}"
    ตอบกลับเป็น JSON เท่านั้น:
    {
      "intent": "add_task" | "list_tasks" | "complete_task" | "chat",
      "data": "สรุปเนื้อหางานสั้นๆ",
      "taskIndex": 0,
      "aiReply": "คำตอบที่ดูเป็นธรรมชาติและเป็นกันเอง"
    }
    
    กฎ:
    - ถ้าผู้ใช้บอกนัดหมาย/สิ่งที่ต้องทำ = add_task
    - ถ้าถามถึงงานค้าง/รายการงาน = list_tasks
    - ถ้าบอกว่าทำเสร็จแล้ว/ขีดฆ่าออก/ลบงาน = complete_task
    - นอกนั้น = chat`;

    const result = await model.generateContent(analysisPrompt);
    const analysis = JSON.parse(result.response.text());

    let finalResponse = analysis.aiReply;

    // ⚡️ ดำเนินการตามเจตนา (Logic Execution)
    if (analysis.intent === "add_task" && analysis.data) {
        await new Task({ userId: lineId, task: analysis.data }).save();
    } 
    else if (analysis.intent === "list_tasks") {
        const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
        if (tasks.length === 0) {
            finalResponse = `ตอนนี้ไม่มีงานค้างเลยครับคุณ ${user.displayName} พักผ่อนได้เต็มที่ครับ!`;
        } else {
            const list = tasks.map((t, i) => `📌 ${i + 1}. ${t.task}`).join('\n');
            finalResponse = `รายการงานที่ผมบันทึกไว้ครับ:\n\n${list}\n\n${analysis.aiReply}`;
        }
    } 
    else if (analysis.intent === "complete_task") {
        const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
        let target = (analysis.taskIndex > 0) ? tasks[analysis.taskIndex - 1] : tasks.find(t => userText.includes(t.task.substring(0, 3)));

        if (target) {
            target.status = 'completed';
            await target.save();
            finalResponse = `✅ รับทราบครับ! ผมปิดงาน "${target.task}" ให้เรียบร้อยแล้ว ยอดเยี่ยมมากครับ!`;
        }
    }

    return client.replyMessage(event.replyToken, { type: 'text', text: finalResponse });

  } catch (error) {
    return client.replyMessage(event.replyToken, { type: 'text', text: "ขออภัยครับคุณเตชินท์ ผมขอจัดระเบียบความคิดสักครู่ รบกวนลองใหม่อีกครั้งนะครับ" });
  }
}

app.listen(port);
