import { copyTransaction, copyStorageInfo } from "@/lib/copytrading/store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request){
  const id=request.headers.get("x-copy-agent-id")||"",token=request.headers.get("x-copy-agent-key")||"";
  if(!id||token.length!==64)return Response.json({error:"Identité terminal requise"},{status:401});
  try{
    const raw=await request.text();if(raw.length>262144)return Response.json({error:"Snapshot trop volumineux"},{status:413});
    const input=JSON.parse(raw);if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Snapshot invalide");
    const result=await copyTransaction(engine=>{
      const account=engine.authenticate(id,token);
      if(account.mode==="real"&&(!copyStorageInfo().persistent||!copyStorageInfo().configured))throw new Error("Stockage persistant requis pour un terminal réel");
      return engine.heartbeat(account,input);
    });
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(error){return Response.json({error:error instanceof Error&&!("code" in error)?error.message:"Stockage indisponible, aucune commande délivrée"},{status:409,headers:{"Cache-Control":"no-store"}});}
}
