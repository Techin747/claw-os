const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose'); // เรียกใช้เครื่องมือสมุดจด

const app = express();
const port = process.env.PORT || 3000;

// 1. เชื่อมต่อสมุดจด (MongoDB)
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Claw เชื่อมต่อความจำสำเร็จ!'))
  .catch(err => console.error('ความจำมีปัญหา:', err));

// 2. ออกแบบหน้าสมุดจด (เก็บชื่อและประวัติ)
const UserSchema = new mongoose.Schema({
  lineId: String,
  displayName: String,
  memories: String, // เก็บข้อมูลสำคัญ เช่น "ชอบกินเผ็ด"
  lastChat: Date
});
const User = mongoose.model('User', UserSchema);

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

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const lineId = event.source.userId;
  const userText = event.message.text;

  // 3. ไปค้นหาว่ารู้จักคนคนนี้ไหม
  let user = await User.findOne({ lineId });
  if (!user) {
    // ถ้าไม่รู้จัก ให้สร้างประวัติใหม่
    user = new User({ lineId, displayName: 'เพื่อนใหม่', memories: 'ยังไม่มีข้อมูล' });
    await user.save();
  }

  try {
    // 4. ส่งบริบทความจำไปให้ Gemini ด้วย
    const prompt = `คุณคือ Claw Personal OS ของคุณ ${user.displayName}
    ข้อมูลที่คุณจำได้เกี่ยวกับเขา: ${user.memories}
    คำถามจากผู้ใช้: ${userText}
    (ถ้าเขาสั่งให้จำอะไรใหม่ ให้ตอบรับและบอกว่าบันทึกแล้ว)`;

    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text();

    // 5. ถ้าในคำตอบมีคำว่า "บันทึก" เราจะสั่งให้ AI สรุปความจำใหม่ (เดี๋ยวทำใน Phase ถัดไป)
    user.lastChat = new Date();
    await user.save();

    return client.replyMessage(event.replyToken, { type: 'text', text: aiResponse });
  } catch (error) {
    return client.replyMessage(event.replyToken, { type: 'text', text: 'มึนหัวจังครับ...' });
  }
}

app.listen(port);
