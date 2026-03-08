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
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

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
    // 🧠 ส่วนที่สำคัญที่สุด: ให้ AI วิเคราะห์เจตนา (Intent Extraction)
    const analysisPrompt = `คุณคือสมองส่วนกลางของ Claw OS
    จงวิเคราะห์ประโยค: "${userText}" 
    แล้วตอบกลับเป็นรูปแบบ JSON เท่านั้น ห้ามตอบเป็นคำบรรยาย:
    {
      "intent": "add_task" | "list_tasks" | "complete_task" | "chat",
      "data": "เนื้อหางานที่ต้องการบันทึก (ถ้ามี)",
      "taskIndex": "เลขข้อที่ต้องการปิด (ถ้ามี)",
      "aiReply": "คำตอบที่สุภาพและเป็นกันเองในฐานะเลขา"
    }
    
    กฎ:
    - ถ้าผู้ใช้บอกเล่าเหตุการณ์ที่ต้องทำในอนาคต = add_task
    - ถ้าผู้ใช้ขอดูรายการงานหรือถามว่ามีอะไรต้องทำบ้าง = list_tasks
    - ถ้าผู้ใช้บอกว่าทำอะไรเสร็จแล้ว หรือให้ลบงาน = complete_task
    - นอกนั้น = chat`;

    const analysisResult = await model.generateContent(analysisPrompt);
    const analysis = JSON.parse(analysisResult.response.text().replace(/```json|```/g, ""));

    // ⚡️ Execution Logic ตามผลวิเคราะห์ของ AI
    
    // 1. เพิ่มงานใหม่ (Natural Language Add)
    if (analysis.intent === "add_task" && analysis.data) {
        const newTask = new Task({ userId: lineId, task: analysis.data });
        await newTask.save();
    }

    // 2. แสดงรายการงาน (Smart List)
    if (analysis.intent === "list_tasks") {
        const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
        if (tasks.length === 0) {
            return client.replyMessage(event.replyToken, { type: 'text', text: `คุณ ${user.displayName} ไม่มีงานค้างเลยครับ วันนี้ยอดเยี่ยมมาก!` });
        }
        const taskList = tasks.map((t, i) => `📌 ${i + 1}. ${t.task}`).join('\n');
        return client.replyMessage(event.replyToken, { type: 'text', text: `รายการงานของคุณครับ:\n\n${taskList}\n\n${analysis.aiReply}` });
    }

    // 3. ปิดงาน (Natural Language Complete)
    if (analysis.intent === "complete_task") {
        const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
        let target = null;
        
        if (analysis.taskIndex) {
            target = tasks[parseInt(analysis.taskIndex) - 1];
        } else {
            // ค้นหางานที่ข้อความตรงกันที่สุด
            target = tasks.find(t => userText.includes(t.task.substring(0, 5)));
        }

        if (target) {
            target.status = 'completed';
            await target.save();
        }
    }

    // 4. ตอบกลับด้วย AI
    return client.replyMessage(event.replyToken, { type: 'text', text: analysis.aiReply });

  } catch (error) {
    console.error(error);
    return client.replyMessage(event.replyToken, { type: 'text', text: "ขออภัยครับ สมองส่วนหน้าของผมขัดข้องนิดหน่อย" });
  }
}

app.listen(port);
