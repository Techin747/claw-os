const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const port = process.env.PORT || 3000;

// ระบบจะดึงกุญแจจากที่ซ่อน (Environment Variables) โค้ดจะปลอดภัย 100%
const lineConfig = {
  channelAccessToken: process.env.LINE_ACCESS_TOKEN,
  channelSecret: process.env.LINE_SECRET,
};
const client = new line.Client(lineConfig);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ 
  model: "gemini-1.5-flash",
  systemInstruction: "คุณคือ Claw ระบบผู้ช่วยส่วนตัว คุยเล่นได้ มีความรู้สึก โกรธหรืองอนได้" 
}); // เรื่องนิสัย เดี๋ยวเราค่อยมาอัปเดตแชท IG ใส่ตรงนี้ทีหลังครับ

app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const events = req.body.events;
    if (events.length > 0) {
      await Promise.all(events.map(handleEvent));
    }
    res.status(200).send('OK');
  } catch (error) {
    console.error(error);
    res.status(500).end();
  }
});

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return null;
  }

  const userText = event.message.text;

  // ให้ Gemini คิดคำตอบ
  const result = await model.generateContent(userText);
  const aiResponse = result.response.text();

  // ส่งคำตอบกลับไปที่ LINE
  return client.replyMessage(event.replyToken, {
    type: 'text',
    text: aiResponse
  });
}

app.listen(port, () => {
  console.log(`Claw OS ตื่นแล้วที่ Port ${port}`);
});
