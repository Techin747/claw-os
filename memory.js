import mongoose from "mongoose"

mongoose.connect(process.env.MONGO_URI)

const schema=new mongoose.Schema({

 userId:String,
 key:String,
 value:String,
 createdAt:Date

})

export const Memory=mongoose.model("Memory",schema)

export async function saveMemory(userId,key,value){

 await Memory.create({
  userId,
  key,
  value,
  createdAt:new Date()
 })

}
