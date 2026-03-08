import axios from "axios"
import { SYSTEM_PROMPT } from "./prompt.js"

export async function askLLM(message){

 const res=await axios.post(
 "https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=API_KEY",
 {
  contents:[
   {
    role:"user",
    parts:[
     {text:SYSTEM_PROMPT+"\nUser:"+message}
    ]
   }
  ]
 }
 )

 return res.data.candidates[0].content.parts[0].text

}
