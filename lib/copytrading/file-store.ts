import fs from "node:fs";
import path from "node:path";
import { CopyEngine, freshCopyState, type CopyState } from "./engine";

const runtime = globalThis as typeof globalThis & { __copyStore?: { file:string; state:CopyState } };
export function copyStorageInfo() { return { persistent:process.env.COPYTRADING_PERSISTENT_STORAGE==="true", configured:!!process.env.COPYTRADING_DATA_DIR }; }
function load() {
  const folder=process.env.COPYTRADING_DATA_DIR || path.join(process.cwd(),".copytrading-data");
  const file=path.join(folder,"state.json");
  if(runtime.__copyStore?.file===file)return runtime.__copyStore;
  const state:CopyState=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,"utf8")):freshCopyState();
  if(state.version!==1||!Array.isArray(state.agents)||!Array.isArray(state.bindings)||!Array.isArray(state.logs))throw new Error("Stockage copytrading invalide : restauration requise");
  state.enabled=false;
  for(const a of state.agents){a.lastSeen=0;a.enabled=false;if(a.pending?.expiresAt)a.pending.expiresAt=Date.now()-1;}
  runtime.__copyStore={file,state};return runtime.__copyStore;
}
export function copyTransaction<T>(operation:(engine:CopyEngine)=>T):T {
  const store=load();
  const next=structuredClone(store.state);
  const result=operation(new CopyEngine(next));
  fs.mkdirSync(path.dirname(store.file),{recursive:true,mode:0o700});
  const temp=store.file+".tmp";
  const fd=fs.openSync(temp,"w",0o600);
  try{fs.writeFileSync(fd,JSON.stringify(next));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,store.file);
  store.state=next; // Once renamed, never continue from the previous in-memory journal.
  const directory=fs.openSync(path.dirname(store.file),"r");try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  return result;
}
export function copySnapshot(){return new CopyEngine(load().state).snapshot();}
