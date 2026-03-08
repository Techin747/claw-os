const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');

const app = express();
const port = process.env.PORT || 3000;

// 1. เชื่อมต่อสมุดจด (MongoDB) โดยใช้กุญแจ MONGODB_URI จาก Render
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Claw เชื่อมต่อฐานข้อมูลความจำสำเร็จ!'))
  .catch(err => console.error('❌ ความจำมีปัญหา:', err));

// 2. ออกแบบโครงสร้างการเก็บข้อมูลผู้ใช้ (Schema)
const UserSchema = new mongoose.Schema({
  lineId: { type: String, unique: true },
  displayName: { type: String, default: 'เพื่อนใหม่' },
  memories: { type: String, default: 'ยังไม่มีข้อมูลส่วนตัว' },
  lastChat: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// 3. ตั้งค่า LINE และ Gemini
const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};
const client = new line.Client(lineConfig);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// 4. Webhook สำหรับรับข้อความจาก LINE
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    await Promise.all(events.map(handleEvent));
    res.status(200).send('OK');
  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).end();
  }
});

// 5. ฟังก์ชันหลักในการคิดและจำ
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const lineId = event.source.userId;
  const userText = event.message.text;

  // ค้นหาข้อมูลผู้ใช้จากฐานข้อมูล
  let user = await User.findOne({ lineId });
  if (!user) {
    user = new User({ lineId });
    await user.save();
  }

  // ✨ ระบบตรวจจับการสั่งจำชื่อ (Manual Override)
  const nameTriggers = ["ชื่อ", "จำว่า"];
  if (nameTriggers.some(word => userText.includes(word)) && (userText.includes("ฉัน") || userText.includes("ผม"))) {
      const detectedName = userText.replace(/จำว่า|ฉันชื่อ|ผมชื่อ|คือชื่อของฉัน|คือชื่อของผม/g, "").trim();
      if (detectedName && detectedName.length < 20) {
          user.displayName = detectedName;
          user.memories = `ผู้ใช้คนนี้ชื่อ ${detectedName}`;
          await user.save();
          return client.replyMessage(event.replyToken, { 
              type: 'text', 
              text: `รับทราบครับคุณ ${detectedName}! ผมบันทึกชื่อคุณลงฐานข้อมูลถาวรเรียบร้อยแล้ว คราวหน้าถามผมได้เลยว่าคุณชื่ออะไร 😊` 
          });
      }
  }

  try {
    // ส่งข้อมูลความจำ (Context) ไปให้ AI เพื่อให้มันรู้จักเรา
    const prompt = `คุณคือ Claw Personal OS ผู้ช่วยส่วนตัวที่ฉลาดและเป็นกันเอง
    ข้อมูลที่คุณจำได้เกี่ยวกับผู้ใช้คนนี้: ${user.memories}
    ชื่อของผู้ใช้ที่บันทึกไว้: ${user.displayName}
    
    คำถามหรือข้อความจากผู้ใช้: "${userText}"
    
    (คำแนะนำ: ถ้าเขาสั่งให้คุณจำอะไรเพิ่มเติม ให้คุณตอบรับและบอกเขาว่าคุณจะบันทึกไว้ในระบบความจำ)`;

    const result = await model.generateContent(prompt);
    const aiResponse = result.response.text();

    // อัปเดตเวลาที่คุยล่าสุด
    user.lastChat = new Date();
    await user.save();

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: aiResponse
    });
  } catch (error) {
    console.error("Gemini Error:", error);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: 'ขออภัยครับ สมองส่วนประมวลผลขัดข้องนิดหน่อย ลองพิมพ์อีกครั้งได้ไหมครับ?'
    });
  }
}

app.listen(port, () => {
  console.log(`🚀 Claw OS Phase 2 รันอยู่ที่พอร์ต ${port}`);
});
