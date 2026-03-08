import express from "express"
import { agentProcess } from "./agent.js"

const app = express()

app.use(express.json())

app.get("/",(req,res)=>{
 res.send("Claw OS Running")
})

app.post("/webhook",async(req,res)=>{

 const events=req.body.events

 for(const event of events){

  const userId=event.source.userId
  const message=event.message.text

  const reply=await agentProcess(userId,message)

  console.log(reply)

 }

 res.sendStatus(200)

})

app.listen(3000)
