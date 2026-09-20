import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, mkdtempSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function moduleAt(file,imports={}){
 const code=ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
 const exports={};const ctx={exports,require:id=>imports[id]??require(id),Buffer,structuredClone,process,Date,Response,Request,URL};
 vm.runInNewContext(code,ctx);return {exports,ctx};
}
const model=moduleAt('lib/copytrading/engine.ts').exports;
const {CopyEngine}=model;
function harness(n=1,existing=[]){
 let now=1000000,seq=new Map();const e=new CopyEngine(undefined,()=>now);
 function register(role,i=0,settings={}){const auth=e.register({role,label:role+i,account:String(i+1),server:'Demo Server',mode:'demo',settings});return {...auth,a:e.state.agents.find(a=>a.id===auth.id)};}
 const master=register('master');const slaves=Array.from({length:n},(_,i)=>register('slave',i+1));
 function hb(who,positions=who.a.positions,extra={}){const next=(seq.get(who.id)??0)+1;seq.set(who.id,next);return e.heartbeat(e.authenticate(who.id,who.token),{role:who.a.role,account:who.a.account,server:who.a.server,mode:'demo',session:'terminal',seq:next,hedging:true,equity:1000,positions,...extra});}
 hb(master,existing);for(const s of slaves){hb(s,[]);e.admin({action:'enable',id:s.id,enabled:true});}e.admin({action:'switch',enabled:true});
 return {e,master,slaves,hb,register,tick:ms=>{now+=ms;},ack(s,c,positions,status='done'){return hb(s,positions,{ack:{id:c.id,status,message:'broker result'}});}};
}
const pos=(id='101',volume=.5,extra={})=>({id,symbol:'EURUSD',side:'BUY',volume,sl:1.05,tp:1.2,magic:0,...extra});
const copied=(c,volume=c.volume,extra={})=>pos('9001',volume,{symbol:c.symbol,side:c.side,sl:c.sl,tp:c.tp,magic:c.magic,...extra});

test('one master and 50 separately authenticated followers; reject duplicate accounts and follower 51',()=>{
 const h=harness(50);assert.equal(h.e.state.agents.length,51);
 assert.throws(()=>h.register('slave',51),/50/);assert.throws(()=>h.register('master',99),/seul master/);
 assert.throws(()=>h.e.register({role:'slave',account:'2',server:'Demo Server',mode:'demo',label:'duplicate'}));
 assert.throws(()=>h.e.authenticate(h.slaves[0].id,h.slaves[1].token),/authentifié/);
 assert.ok(!JSON.stringify(h.e.snapshot()).includes('tokenHash'));assert.ok(!JSON.stringify(h.e.state).includes(h.master.token));
 h.hb(h.master,[pos()]);const commands=h.slaves.map(s=>h.hb(s).command);
 assert.equal(new Set(commands.map(c=>c.id)).size,50);assert.equal(new Set(commands.map(c=>c.magic)).size,50);
 for(let i=0;i<50;i++){assert.equal(commands[i].account,h.slaves[i].a.account);assert.equal(h.hb(h.slaves[i]).command.id,commands[i].id);}
});
test('existing positions require explicit opt-in and cannot replay on repeated start',()=>{
 const h=harness(1,[pos()]),s=h.slaves[0];assert.equal(h.hb(s).command,null);
 h.e.admin({action:'switch',enabled:false});h.e.admin({action:'switch',enabled:true,copyExisting:true});
 const c=h.hb(s).command;assert.equal(c.volume,.5);
 h.e.admin({action:'switch',enabled:true,copyExisting:true});assert.equal(h.e.state.bindings.length,1);
});
test('open, SL/TP, increase, partial close and full close use same binding',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);let c=h.hb(s).command;
 assert.equal(c.fromVolume,0);assert.equal(h.ack(s,c,[copied(c)]).command,null);
 h.hb(h.master,[pos('101',.5,{sl:1.07,tp:1.3})]);c=h.hb(s).command;assert.equal(c.fromVolume,.5);assert.equal(c.sl,1.07);assert.equal(c.tp,1.3);
 h.ack(s,c,[copied(c)]);
 for(const volume of [.8,.2]){h.hb(h.master,[pos('101',volume,{sl:1.07,tp:1.3})]);c=h.hb(s).command;assert.equal(c.volume,volume);h.ack(s,c,[copied(c)]);}
 h.hb(h.master,[]);c=h.hb(s).command;assert.equal(c.volume,0);assert.equal(h.ack(s,c,[]).command,null);
 assert.equal(h.e.state.bindings[0].closed,true);
});
test('an unacknowledged command is redelivered, an acknowledged command is not duplicated',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
 assert.equal(h.hb(s).command.id,c.id);assert.equal(h.ack(s,c,[copied(c)]).command,null);
 assert.equal(h.ack(s,c,[copied(c)]).command,null);assert.equal(h.hb(s).command,null);
 h.hb(h.master,[pos('101',.8)]);const next=h.hb(s).command;assert.notEqual(next.id,c.id);
 assert.equal(h.ack(s,c,[copied(c)]).command.id,next.id,'lost ack response with old ack retains the newer command');
});
test('new desired state waits for acknowledgement of the previous command',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
 h.hb(h.master,[pos('101',.8)]);assert.equal(h.hb(s).command.id,c.id);
 assert.equal(h.ack(s,c,[copied(c)]).command.volume,.8);
});
test('pause stops exposure increases but still propagates closes and reductions',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;h.ack(s,c,[copied(c)]);
 h.e.admin({action:'switch',enabled:false});h.hb(h.master,[pos('101',.8),pos('102')]);assert.equal(h.hb(s).command,null);
 h.hb(h.master,[pos('101',.2)]);const reduction=h.hb(s).command;assert.equal(reduction.volume,.2);assert.equal(reduction.expiresAt,0);h.ack(s,reduction,[copied(reduction)]);
 h.hb(h.master,[]);assert.equal(h.hb(s).command.volume,0);
});
test('pause or vanished source expires an undelivered opening; transient positions do not open later',()=>{
 for(const action of ['pause','close']){
  const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
  if(action==='pause')h.e.admin({action:'switch',enabled:false});else h.hb(h.master,[]);
  assert.ok(h.hb(s).command.expiresAt<1000000);assert.equal(h.hb(s).command.id,c.id);
 }
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);h.hb(h.master,[]);assert.equal(h.hb(s).command,null);
});
test('manual/SL closure is never reopened and rounded broker volumes/stops do not cause repeated orders',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',.123,{sl:1.050004})]);const c=h.hb(s).command;
 assert.equal(h.ack(s,c,[copied(c,.12,{sl:1.05})]).command,null);assert.equal(h.hb(s).command,null);
 assert.equal(h.hb(s,[]).command,null);h.hb(h.master,[pos('101',.3)]);assert.equal(h.hb(s,[]).command,null);
});
test('loss threshold and total lots prevent exposure including manually opened positions',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);assert.equal(h.hb(s,[],{equity:899}).command,null);assert.equal(s.a.enabled,false);assert.match(s.a.error,/perte/);
 const g=harness(),t=g.slaves[0];g.hb(g.master,[pos()]);assert.equal(g.hb(t,[pos('700',5,{magic:99})]).command,null);
 assert.equal(g.e.state.bindings[0].blocked,true);
});
test('identity, role, hedging, complete snapshots and monotonic sequence are enforced',()=>{
 const h=harness(),s=h.slaves[0];
 for(const extra of [{account:'999'},{server:'Other'},{mode:'real'},{role:'master'},{hedging:false},{positions:null},{positions:[pos(),pos()]},{equity:NaN}])assert.throws(()=>h.hb(s,[],extra));
 assert.throws(()=>h.hb(s,[],{session:'another terminal'}),/autre EA/);
 h.hb(h.master,[pos()]);const c=h.hb(s).command;assert.equal(h.hb(s,[],{seq:1}).command.id,c.id);
 h.tick(16000);assert.doesNotThrow(()=>h.hb(s,[],{session:'restarted terminal'}));
});
test('offline master prevents opening; stale pending and failed acknowledgements stop follower',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);h.tick(16000);assert.equal(h.hb(s).command,null);
 h.hb(h.master,[pos()]);const c=h.hb(s).command;h.tick(31000);assert.equal(h.hb(s).command.id,c.id);assert.equal(s.a.enabled,false);
 assert.equal(h.ack(s,c,[],'uncertain').command,null);assert.equal(h.e.state.bindings[0].blocked,true);assert.equal(h.hb(s).command,null);
 assert.throws(()=>h.e.admin({action:'remove',id:s.id}),/réconciliez/);
 h.e.admin({action:'retry',id:s.id});h.hb(h.master,[pos()]);h.e.admin({action:'enable',id:s.id,enabled:true});assert.ok(h.hb(s).command);
});
test('reverse, symbol mapping and multiplier apply per follower and do not alter unrelated positions',()=>{
 const h=harness(),s=h.slaves[0];h.e.admin({action:'enable',id:s.id,enabled:false});h.e.admin({action:'settings',id:s.id,settings:{multiplier:2,maxLot:.7,reverse:true,symbols:{EURUSD:'EURUSD.a'}}});h.e.admin({action:'enable',id:s.id,enabled:true});
 h.hb(h.master,[pos()]);const c=h.hb(s,[pos('300',.1,{magic:888})]).command;
 assert.equal(c.side,'SELL');assert.equal(c.symbol,'EURUSD.a');assert.equal(c.volume,.7);assert.equal(c.sl,1.2);assert.equal(c.tp,1.05);assert.notEqual(c.magic,888);
});
test('master reversal closes the prior side and creates a separate copy for the opposite side',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const open=h.hb(s).command;h.ack(s,open,[copied(open)]);
 h.hb(h.master,[pos('101',.2,{side:'SELL',sl:1.3,tp:1.05})]);const close=h.hb(s).command;assert.equal(close.volume,0);
 const reverse=h.ack(s,close,[]).command;assert.equal(reverse.side,'SELL');assert.notEqual(reverse.magic,open.magic);assert.equal(reverse.volume,.2);
});
test('full journal blocks new exposure without blocking existing close reconciliation',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;h.ack(s,c,[copied(c)]);
 while(h.e.state.bindings.length<15000)h.e.state.bindings.push({...h.e.state.bindings[0],source:'old-'+h.e.state.bindings.length,closed:true});
 h.hb(h.master,[pos('102')]);assert.equal(s.a.enabled,false);assert.match(s.a.error,/Capacité/);assert.equal(h.hb(s).command.volume,0);
});
test('replacing an empty master does not reuse closed bindings from its predecessor',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;h.ack(s,c,[copied(c)]);h.hb(h.master,[]);h.ack(s,h.hb(s).command,[]);
 h.e.admin({action:'remove',id:h.master.id});assert.equal(h.e.state.bindings.length,0);
 const replacement=h.register('master',99);h.hb(replacement,[]);h.e.admin({action:'switch',enabled:true});h.hb(replacement,[pos()]);assert.ok(h.hb(s).command);
});
test('durable transactions rollback invalid input, survive restart paused, and never reset corrupted state',()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'copy-store-'));const original=process.env.COPYTRADING_DATA_DIR;process.env.COPYTRADING_DATA_DIR=folder;
 try{
  let store=moduleAt('lib/copytrading/file-store.ts',{'./engine':model}).exports;
  const reg=store.copyTransaction(e=>e.register({role:'master',label:'Master',account:'1',server:'Demo',mode:'demo'}));
  assert.ok(existsSync(path.join(folder,'state.json')));assert.equal(store.copySnapshot().agents.length,1);
  assert.throws(()=>store.copyTransaction(e=>{e.state.agents=[];throw new Error('rollback');}));assert.equal(store.copySnapshot().agents.length,1);
  store.copyTransaction(e=>{e.state.enabled=true;e.state.agents[0].enabled=true;e.state.agents[0].lastSeen=Date.now();});
  store=moduleAt('lib/copytrading/file-store.ts',{'./engine':model}).exports;assert.equal(store.copySnapshot().enabled,false);assert.equal(store.copySnapshot().agents[0].online,false);
  assert.ok(!JSON.stringify(store.copySnapshot()).includes(reg.token));
  require('node:fs').writeFileSync(path.join(folder,'state.json'),'broken');
  const broken=moduleAt('lib/copytrading/file-store.ts',{'./engine':model}).exports;assert.throws(()=>broken.copySnapshot());
 }finally{if(original===undefined)delete process.env.COPYTRADING_DATA_DIR;else process.env.COPYTRADING_DATA_DIR=original;rmSync(folder,{recursive:true,force:true});}
});
test('API authentication, real storage requirement, account isolation and disk failure block delivery',async()=>{
 const e=new CopyEngine();let failDisk=false;
 const store={copyTransaction:async fn=>{await Promise.resolve();const draft=new CopyEngine(structuredClone(e.state));const result=fn(draft);if(failDisk)throw Object.assign(new Error('disk'),{code:'EIO'});e.state=draft.state;return result;},copySnapshot:async()=>e.snapshot(),copyStorageInfo:()=>({persistent:false,configured:false})};
 const imports={'@/lib/copytrading/store':store,'@/lib/copytrading/engine':model};
 const admin=moduleAt('app/api/copytrading/admin/route.ts',imports).exports,agent=moduleAt('app/api/copytrading/agent/route.ts',imports).exports;
 const original=process.env.COPYTRADING_ADMIN_KEY;process.env.COPYTRADING_ADMIN_KEY='a'.repeat(64);
 const request=(body,headers={})=>new Request('https://example.test/api/copytrading/admin',{method:'POST',headers,body:JSON.stringify(body)});
 try{
  assert.equal((await admin.POST(request({action:'switch',enabled:true}))).status,401);
  const headers={'x-copy-admin-key':process.env.COPYTRADING_ADMIN_KEY};
  assert.equal((await admin.POST(request({action:'switch',enabled:false},{...headers,origin:'https://foreign.test'}))).status,403);
  const input={action:'register',role:'master',label:'Master',account:'1',server:'Demo',mode:'real'};
  assert.equal((await admin.POST(request(input,headers))).status,409);input.mode='demo';
  const reg=await (await admin.POST(request(input,headers))).json();assert.ok(reg.result.token);
  const valid={'x-copy-agent-id':reg.result.id,'x-copy-agent-key':reg.result.token};
  const hb={role:'master',account:'1',server:'Demo',mode:'demo',session:'a',seq:1,equity:1000,positions:[]};
  assert.equal((await agent.POST(request(hb,{'x-copy-agent-id':reg.result.id,'x-copy-agent-key':'b'.repeat(64)}))).status,409);
  failDisk=true;assert.equal((await agent.POST(request(hb,valid))).status,409);assert.equal(e.state.baseline,null);
  failDisk=false;assert.equal((await agent.POST(request(hb,valid))).status,200);
 }finally{if(original===undefined)delete process.env.COPYTRADING_ADMIN_KEY;else process.env.COPYTRADING_ADMIN_KEY=original;}
});

test('admin registration accepts Render HTTPS origin behind HTTP and rejects forged origins',async()=>{
 const names=['COPYTRADING_ADMIN_KEY','COPYTRADING_PUBLIC_URL','RENDER_EXTERNAL_URL'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
 const e=new CopyEngine();let writes=0;
 const store={copyTransaction:async fn=>{writes++;return fn(e);},copySnapshot:async()=>e.snapshot(),copyStorageInfo:()=>({provider:'mysql',persistent:true,configured:true})};
 const admin=moduleAt('app/api/copytrading/admin/route.ts',{'@/lib/copytrading/store':store,'@/lib/copytrading/engine':model}).exports;
 const publicUrl='https://derivbot-qnwz.onrender.com';
 const input={action:'register',role:'master',label:'Master',account:'123',server:'Demo',mode:'demo'};
 const request=(origin,extra={},body=input)=>new Request('http://localhost:10000/api/copytrading/admin',{method:'POST',headers:{'x-copy-admin-key':process.env.COPYTRADING_ADMIN_KEY,origin,...extra},body:JSON.stringify(body)});
 try{
  process.env.COPYTRADING_ADMIN_KEY='k'.repeat(64);process.env.RENDER_EXTERNAL_URL=publicUrl;delete process.env.COPYTRADING_PUBLIC_URL;
  for(const origin of ['https://foreign.test',publicUrl+'.evil.test','http://derivbot-qnwz.onrender.com','null','http://localhost:10000']){
   assert.equal((await admin.POST(request(origin,{'x-forwarded-host':new URL(publicUrl).host,'x-forwarded-proto':'https'}))).status,403);
  }
  assert.equal((await admin.POST(request(publicUrl,{'x-copy-admin-key':'wrong'}))).status,401);
  assert.equal(writes,0);
  const response=await admin.POST(request(publicUrl));assert.equal(response.status,200);
  const result=await response.json();assert.match(result.result.id,/^[a-f0-9-]{36}$/);assert.match(result.result.token,/^[a-f0-9]{64}$/);
  assert.equal(e.state.agents.length,1);assert.equal(e.state.enabled,false);
  process.env.COPYTRADING_PUBLIC_URL='https://copy.example.test';
  assert.equal((await admin.POST(request(publicUrl))).status,403);
  assert.equal((await admin.POST(request('https://copy.example.test',{}, {action:'switch',enabled:false}))).status,200);
  process.env.COPYTRADING_PUBLIC_URL='invalid-url';
  assert.equal((await admin.POST(request(publicUrl))).status,503);
  delete process.env.COPYTRADING_PUBLIC_URL;delete process.env.RENDER_EXTERNAL_URL;
  assert.equal((await admin.POST(request('https://foreign.test',{'x-forwarded-host':'foreign.test','x-forwarded-proto':'https'}))).status,403);
  assert.equal((await admin.POST(request('http://localhost:10000',{}, {action:'switch',enabled:false}))).status,200);
 }finally{for(const k of names){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}
});
