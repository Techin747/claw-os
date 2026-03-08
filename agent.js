import { askLLM } from "./llm.js"
import { saveMemory } from "./memory.js"
import { createEvent,listEvents } from "./calendar.js"

export async function agentProcess(userId,message){

 const ai=await askLLM(message)

 const data=JSON.parse(ai)

 if(data.intent==="calendar_create"){

  await createEvent(data.title,data.date)
  return "เพิ่มในปฏิทินแล้ว"

 }

 if(data.intent==="calendar_list"){

  const events=await listEvents()
  return events.join("\n")

 }

 if(data.intent==="memory_save"){

  await saveMemory(userId,data.key,data.value)
  return "จำไว้แล้ว"

 }

 return data.reply

}
