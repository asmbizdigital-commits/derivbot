import { secretEqual } from "@/lib/copytrading/engine";
import { copyTransaction, copySnapshot, copyStorageInfo } from "@/lib/copytrading/store";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
function authorize(request:Request){
  const expected=process.env.COPYTRADING_ADMIN_KEY;
  if(!expected||expected.length<32)return reply({error:"Configurer COPYTRADING_ADMIN_KEY (au moins 32 caractères) sur le serveur."},503);
  if(!secretEqual(request.headers.get("x-copy-admin-key")||"",expected))return reply({error:"Clé administrateur invalide"},401);
  const origin=request.headers.get("origin");
  if(origin){
    // Render terminates HTTPS before vinext: request.url can contain internal HTTP.
    // Trust the server-configured public URL, never client-supplied proxy headers.
    const publicUrl=process.env.COPYTRADING_PUBLIC_URL||process.env.RENDER_EXTERNAL_URL;
    let allowedOrigin:string;
    try{
      const url=new URL(publicUrl||request.url);
      if(!["https:","http:"].includes(url.protocol)||url.username||url.password)throw new Error("URL invalide");
      allowedOrigin=url.origin;
    }catch{return reply({error:"URL publique copytrading invalide sur le serveur."},503);}
    if(origin!==allowedOrigin)return reply({error:"Origine refusée"},403);
  }
  return null;
}
export async function GET(request:Request){
  const error=authorize(request);if(error)return error;
  try{return reply({...await copySnapshot(),storage:copyStorageInfo()});}catch{return reply({error:"Stockage indisponible, aucune commande délivrée"},503);}
}
export async function POST(request:Request){
  const error=authorize(request);if(error)return error;
  try{
    const raw=await request.text();if(raw.length>32768)return reply({error:"Requête trop volumineuse"},413);
    const input=JSON.parse(raw);
    if(!input||typeof input!=="object"||Array.isArray(input))return reply({error:"Requête invalide"},422);
    if(input.action==="register"&&input.mode==="real"&&(!copyStorageInfo().persistent||!copyStorageInfo().configured))return reply({error:"Configurer un stockage persistant avant d’enregistrer un compte réel."},409);
    const saved=await copyTransaction(engine=>({result:engine.admin(input),...engine.snapshot()}));
    return reply({...saved,storage:copyStorageInfo()});
  }catch(error){return reply({error:error instanceof Error&&!("code" in error)?error.message:"Stockage indisponible, modification non confirmée"},422);}
}
