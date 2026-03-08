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
  displayName: { type: String, default: 'เตชินท์' },
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
    generationConfig: { responseMimeType: "application/json" } // บังคับให้ตอบเป็น JSON เท่านั้น
});

// 🔔 ฟังก์ชันแจ้งเกิดระบบ (Startup Notification)
async function sendStartupNotification() {
    try {
        const user = await User.findOne();
        if (user && user.lineId) {
            await client.pushMessage(user.lineId, {
                type: 'text',
                text: `🚀 Claw OS รายงานตัว! ระบบอัปเกรดความแม่นยำเสร็จสิ้นและพร้อมรับใช้คุณ ${user.displayName} แล้วครับ`
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

// 4. สมองส่วนหน้า: วิเคราะห์และจัดการ (Strict Mode)
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const lineId = event.source.userId;
  const userText = event.message.text;

  let user = await User.findOne({ lineId });
  if (!user) { user = new User({ lineId }); await user.save(); }

  try {
    // 🧠 ปรับ Prompt ให้เข้มงวด ห้ามมโน!
    const analysisPrompt = `คุณคือ Claw OS เลขาส่วนตัวของคุณ ${user.displayName}
    วิเคราะห์ประโยคจากผู้ใช้: "${userText}"
    และตอบกลับเป็น JSON เท่านั้นตามรูปแบบนี้:
    {
      "intent": "add_task" หรือ "list_tasks" หรือ "complete_task" หรือ "chat",
      "data": "ถ้า intent คือ add_task ให้สรุปเนื้อหางานสั้นๆ (ถ้าไม่ใช่ให้ใส่สตริงว่าง)",
      "taskIndex": 0,
      "aiReply": "คำตอบโต้กลับแบบเป็นกันเอง"
    }
    
    กฎการเลือก intent (ต้องทำตามอย่างเคร่งครัด):
    1. "add_task" = เมื่อบอกให้จด, บอกว่ามีนัด, หรือบอกสิ่งที่ต้องทำ (เช่น "มีรายงานต้องส่งวันเสาร์", "จดงานว่า...")
    2. "list_tasks" = เมื่อถามว่ามีงานอะไรบ้าง, ขอดูงาน, งานค้าง (เช่น "มีงานค้างอะไรบ้าง", "มีงานไหม")
    3. "complete_task" = เมื่อบอกว่าทำเสร็จแล้ว, เรียบร้อย, ลบงานข้อ...
    4. "chat" = พูดคุยทั่วไป (คำเตือน: ห้ามตอบว่าบันทึกงานแล้วใน aiReply เด็ดขาด ถ้า intent คือ chat)`;

    const result = await model.generateContent(analysisPrompt);
    const textResponse = result.response.text();
    
    // พิมพ์ Log ไว้ดูเบื้องหลังในเว็บ Render
    console.log("User:", userText);
    console.log("AI Analysis:", textResponse); 

    const analysis = JSON.parse(textResponse);
    let finalResponse = analysis.aiReply;

    // ⚡️ ดำเนินการตามเจตนา (Database Execution)
    if (analysis.intent === "add_task" && analysis.data) {
        await new Task({ userId: lineId, task: analysis.data }).save();
        // 🚨 บังคับตอบด้วยระบบเอง เพื่อยืนยันว่าเข้า Database จริงๆ
        finalResponse = `✅ บันทึกงาน "${analysis.data}" ลงฐานข้อมูลเรียบร้อยครับ!`; 
    } 
    else if (analysis.intent === "list_tasks") {
        const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
        if (tasks.length === 0) {
            finalResponse = `ตอนนี้ไม่มีงานค้างเลยครับคุณ ${user.displayName} พักผ่อนได้เต็มที่ครับ!`;
        } else {
            const list = tasks.map((t, i) => `📌 ${i + 1}. ${t.task}`).join('\n');
            finalResponse = `รายการงานของคุณครับ:\n\n${list}\n\n${analysis.aiReply}`;
        }
    } 
    else if (analysis.intent === "complete_task") {
        const tasks = await Task.find({ userId: lineId, status: 'pending' }).sort({ createdAt: 1 });
        let target = (analysis.taskIndex > 0) ? tasks[analysis.taskIndex - 1] : tasks.find(t => userText.includes(t.task.substring(0, 3)));

        if (target) {
            target.status = 'completed';
            await target.save();
            finalResponse = `✅ รับทราบครับ! ผมปิดงาน "${target.task}" ให้เรียบร้อยแล้ว`;
        } else {
            finalResponse = `❌ หาไม่เจอครับว่าต้องปิดงานไหน รบกวนระบุเลขข้อได้ไหมครับ?`;
        }
    }

    return client.replyMessage(event.replyToken, { type: 'text', text: finalResponse });

  } catch (error) {
    console.error("System Error:", error);
    return client.replyMessage(event.replyToken, { type: 'text', text: "ขออภัยครับ สมองส่วนหน้าขัดข้อง รบกวนลองใหม่อีกครั้งนะครับ" });
  }
}

app.listen(port, () => {
  console.log(`🚀 Claw OS พร้อมทำงานที่พอร์ต ${port}`);
});
