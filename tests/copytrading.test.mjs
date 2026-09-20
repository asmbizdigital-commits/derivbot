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
 function hb(who,positions=who.a.positions,extra={}){const next=(seq.get(who.id)??0)+1;seq.set(who.id,next);return e.heartbeat(e.authenticate(who.id,who.token),{role:who.a.role,account:who.a.account,server:who.a.server,mode:who.a.mode,session:'terminal',seq:next,hedging:true,broker:'Test Broker',copyProtocol:2,equity:1000,positions,...extra});}
 hb(master,existing);for(const s of slaves){hb(s,[]);e.admin({action:'enable',id:s.id,enabled:true});}e.admin({action:'switch',enabled:true});
 return {e,master,slaves,hb,register,tick:ms=>{now+=ms;},ack(s,c,positions,status='done'){return hb(s,positions,{ack:{id:c.id,status,message:'broker result'}});}};
}
const pos=(id='101',volume=.5,extra={})=>({id,symbol:'EURUSD',side:'BUY',volume,sl:1.05,tp:1.2,magic:0,...extra});
const copied=(c,volume=c.volume,extra={})=>pos('9001',volume,{symbol:c.symbol,side:c.side,sl:c.sl,tp:c.tp,magic:c.magic,...extra});
const telemetry=(extra={})=>({balance:1200,currency:'USD',floatingPnl:-12.5,realizedDay:30.25,dealsDay:2,day:'2026-09-20',...extra});

test('account metrics and live position details are authenticated, persisted and replaced on each heartbeat',()=>{
 const h=harness(),details={openPrice:1.12,currentPrice:1.11,profit:-10,swap:-2.5};
 h.hb(h.master,[pos('101',.5,{details})],{equity:1187.5,metrics:telemetry()});
 let master=h.e.snapshot().agents.find(a=>a.id===h.master.id);
 assert.equal(master.metrics.balance,1200);assert.equal(master.metrics.floatingPnl,-12.5);assert.equal(master.metrics.receivedAt,1000000);
 assert.equal(master.positions[0].details.profit,-10);assert.equal(master.hasTraded,true);
 assert.ok(!JSON.stringify(master).includes(h.master.token));assert.ok(!('tokenHash' in master));
 h.tick(2000);h.hb(h.master,[],{equity:1235,metrics:telemetry({balance:1235,floatingPnl:0,realizedDay:35})});
 master=h.e.snapshot().agents.find(a=>a.id===h.master.id);
 assert.equal(master.positions.length,0);assert.equal(master.metrics.realizedDay,35);assert.equal(master.hasTraded,true);
 const restored=new CopyEngine(JSON.parse(JSON.stringify(h.e.state)),()=>1018000).snapshot().agents.find(a=>a.id===h.master.id);
 assert.equal(restored.metrics.balance,1235);assert.equal(restored.metrics.receivedAt,1002000);assert.equal(restored.online,false);
});
test('legacy EAs and unavailable history are distinct from a genuine zero result',()=>{
 const h=harness();assert.equal(h.e.snapshot().agents[0].metrics,null);
 h.hb(h.master,[],{metrics:telemetry({realizedDay:null,dealsDay:null})});
 assert.equal(h.e.snapshot().agents[0].metrics.realizedDay,null);
 h.hb(h.master,[],{metrics:telemetry({floatingPnl:0,realizedDay:0,dealsDay:0})});
 assert.equal(h.e.snapshot().agents[0].metrics.realizedDay,0);
 h.hb(h.master,[]);assert.equal(h.e.snapshot().agents[0].metrics,null,'an older EA must not refresh stale financial values');
});
test('bad telemetry is rejected before changing balances, snapshots or heartbeat sequence',()=>{
 for(const metrics of [telemetry({balance:Infinity}),telemetry({realizedDay:'12'}),telemetry({currency:''}),telemetry({day:'invalid'}),telemetry({dealsDay:1.5}),telemetry({realizedDay:null}),[]]){
  const h=harness();const before=JSON.stringify(h.e.state);
  assert.throws(()=>h.hb(h.master,[],{metrics}));assert.equal(JSON.stringify(h.e.state),before);
 }
 const h=harness();assert.throws(()=>h.hb(h.master,[pos('101',.5,{details:{openPrice:1,currentPrice:1,profit:NaN,swap:0}})]),/Profit/);
});
test('slave monitor distinguishes actual copies from manual positions and retains traders after closing',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
 h.ack(s,c,[copied(c),pos('222',.1)]);
 h.hb(s,[copied(c),pos('222',.1)],{metrics:telemetry({currency:'EUR'})});
 let snap=h.e.snapshot().agents.find(a=>a.id===s.id);
 assert.equal(snap.positions[0].copied,true);assert.equal(snap.positions[1].copied,false);assert.equal(snap.metrics.currency,'EUR');
 h.hb(s,[],{metrics:telemetry({dealsDay:0,floatingPnl:0})});
 snap=h.e.snapshot().agents.find(a=>a.id===s.id);assert.equal(snap.hasTraded,true);assert.equal(snap.positions.length,0);
 const noPositions=harness();noPositions.hb(noPositions.master,[],{metrics:telemetry({dealsDay:1})});
 assert.equal(noPositions.e.snapshot().agents[0].hasTraded,true,'history reports trades that closed between snapshots');
});
test('replayed telemetry cannot overwrite a newer result or trigger duplicate orders',()=>{
 const h=harness();h.hb(h.master,[],{metrics:telemetry()});const before=JSON.stringify(h.e.state);
 h.hb(h.master,[],{seq:h.master.a.seq,metrics:telemetry({balance:99999})});
 assert.equal(JSON.stringify(h.e.state),before);
});

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
test('existing positions are copied automatically and cannot replay on repeated start',()=>{
 const h=harness(1,[pos()]),s=h.slaves[0];assert.equal(h.e.state.bindings.length,1);
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
test('manual/SL closure is never reopened without a new source position',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
 h.ack(s,c,[copied(c)]);assert.equal(h.hb(s,[]).command,null);
 h.hb(h.master,[pos('101',.3)]);assert.equal(h.hb(s,[]).command,null);
});
test('exact copy has no loss threshold or total lot ceiling, including manual exposure',()=>{
 const h=harness(),s=h.slaves[0];s.a.settings={multiplier:.01,maxLot:.01,maxTotalLots:1,lossLimitPct:1,reverse:true,symbols:{EURUSD:'Other'}};
 h.hb(h.master,[pos('101',20)]);const c=h.hb(s,[pos('700',50,{magic:99})],{equity:1}).command;
 assert.equal(c.volume,20);assert.equal(c.symbol,'EURUSD');assert.equal(c.side,'BUY');assert.equal(s.a.enabled,true);
 assert.equal(c.copyProtocol,2);assert.equal(c.broker,'Test Broker');assert.equal(c.maxTotalLots,undefined);assert.equal(c.lossFloor,undefined);
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
test('twelve master positions on two symbols are copied without a four-position ceiling',()=>{
 const h=harness(),s=h.slaves[0];
 const sources=Array.from({length:12},(_,i)=>pos(String(100+i),.1,{symbol:i%2?'Second index':'Volatility 75 Index'}));
 h.hb(h.master,sources);let c=h.hb(s).command;const actual=[];
 for(let i=0;i<12;i++){
  assert.ok(c);assert.equal(c.volume,.1);actual.push(copied(c,c.volume,{id:String(9000+i)}));
  c=h.ack(s,c,actual).command;
 }
 assert.equal(c,null);assert.equal(s.a.enabled,true);assert.equal(actual.length,12);assert.equal(new Set(actual.map(p=>p.symbol)).size,2);
 assert.equal(h.e.snapshot().agents.find(a=>a.id===s.id).queuedCopies,0);
});
test('an initial below-minimum refusal blocks only that copy and continues the other symbol',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',.01,{symbol:'Index with higher minimum'}),pos('102',.01,{symbol:'Volatility 75 Index'})]);
 const refused=h.hb(s).command;
 const ack={id:refused.id,status:'skipped',code:'volume_below_minimum',message:'Demandé 0.01, minimum 0.1, pas 0.1'};
 const next=h.hb(s,[],{ack}).command;
 assert.equal(s.a.enabled,true);assert.equal(next.symbol,'Volatility 75 Index');assert.equal(next.volume,.01);
 const snap=h.e.snapshot().agents.find(a=>a.id===s.id);
 assert.equal(snap.copyIssues.length,1);assert.match(snap.copyIssues[0].message,/minimum 0.1/);assert.equal(snap.queuedCopies,1);
 assert.equal(h.hb(s,[],{ack}).command.id,next.id,'lost acknowledgement does not duplicate or discard the next order');
 assert.equal(h.ack(s,next,[copied(next)]).command,null);
 h.hb(h.master,[pos('101',.01,{symbol:'Index with higher minimum'}),pos('102',.01,{symbol:'Volatility 75 Index'}),pos('103',.01,{symbol:'Volatility 75 Index'})]);
 assert.equal(h.hb(s).command.symbol,'Volatility 75 Index');
});
test('isolated refusals require an allowed preflight reason and no existing exposure',()=>{
 for(const code of ['symbol_unavailable','symbol_specs_unavailable']){
  const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
  h.hb(s,[],{ack:{id:c.id,status:'skipped',code,message:'Instrument indisponible'}});assert.equal(s.a.enabled,true);
 }
 for(const code of ['loss_limit','margin','timeout','unknown',undefined]){
  const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
  assert.throws(()=>h.hb(s,[],{ack:{id:c.id,status:'skipped',code,message:'Refus'}}),/Refus local/);
 }
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);let c=h.hb(s).command;
 assert.throws(()=>h.hb(s,[copied(c)],{ack:{id:c.id,status:'skipped',code:'volume_below_minimum',message:'Refus'}}),/Refus local/);
 h.ack(s,c,[copied(c)]);h.hb(h.master,[pos('101',.2)]);c=h.hb(s).command;
 assert.throws(()=>h.hb(s,[],{ack:{id:c.id,status:'skipped',code:'volume_below_minimum',message:'Refus'}}),/Refus local/);
});
test('broker failures and uncertain outcomes still pause the whole follower',()=>{
 for(const status of ['failed','uncertain']){
  const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101'),pos('102')]);const c=h.hb(s).command;
  assert.equal(h.ack(s,c,[],status).command,null);assert.equal(s.a.enabled,false);
  assert.equal(h.e.snapshot().agents.find(a=>a.id===s.id).copyIssues.length,1);
 }
});
test('personalized settings cannot be reintroduced through registration or admin API',()=>{
 const h=harness(),s=h.slaves[0];h.e.admin({action:'enable',id:s.id,enabled:false});
 assert.throws(()=>h.e.admin({action:'settings',id:s.id,settings:{multiplier:2}}),/aucun paramètre/);
 const fresh=h.register('slave',9,{multiplier:2,maxLot:.7,reverse:true,symbols:{EURUSD:'EURUSD.a'}});
 assert.equal(fresh.a.settings.multiplier,1);assert.equal(fresh.a.settings.reverse,false);assert.equal(Object.keys(fresh.a.settings.symbols).length,0);
});
test('master reversal closes the prior side and creates a separate copy for the opposite side',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const open=h.hb(s).command;h.ack(s,open,[copied(open)]);
 h.hb(h.master,[pos('101',.2,{side:'SELL',sl:1.3,tp:1.05})]);const close=h.hb(s).command;assert.equal(close.volume,0);
 const reverse=h.ack(s,close,[]).command;assert.equal(reverse.side,'SELL');assert.notEqual(reverse.magic,open.magic);assert.equal(reverse.volume,.2);
});
test('more than 300 master positions are accepted without truncation',()=>{
 const h=harness(),s=h.slaves[0],positions=Array.from({length:301},(_,i)=>pos(String(1000+i),2));
 h.hb(h.master,positions);assert.equal(h.e.state.bindings.length,301);assert.equal(h.hb(s).command.volume,2);
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

test('different brokers, servers and demo/real modes accept exact copies through the full lifecycle',()=>{
 for(const [broker,server,mode] of [
  ['Other Broker','Demo Server','demo'],
  ['Test Broker','Other Server','demo'],
  ['Other Broker','Other Server','demo'],
  ['Other Broker','Live Server','real'],
 ]){
  const h=harness(),s=h.slaves[0];s.a.server=server;s.a.mode=mode;
  const hb=(positions=s.a.positions,extra={})=>h.hb(s,positions,{broker,...extra});
  const ack=(c,positions)=>hb(positions,{ack:{id:c.id,status:'done',message:'broker result'}});
  h.hb(h.master,[pos('101',15)]);let c=hb().command;
  assert.ok(c);assert.equal(c.volume,15);assert.equal(c.symbol,'EURUSD');assert.equal(c.side,'BUY');
  assert.equal(c.account,s.a.account);assert.equal(c.server,server);assert.equal(c.broker,broker);assert.equal(c.mode,mode);
  assert.equal(h.e.snapshot().agents.find(a=>a.id===s.id).error,'');
  assert.equal(hb().command.id,c.id);assert.equal(ack(c,[copied(c)]).command,null);
  h.hb(h.master,[pos('101',20,{sl:1.06,tp:1.3})]);c=hb().command;
  assert.equal(c.volume,20);assert.equal(c.sl,1.06);assert.equal(c.tp,1.3);ack(c,[copied(c)]);
  h.hb(h.master,[pos('101',5)]);c=hb().command;assert.equal(c.volume,5);ack(c,[copied(c)]);
  h.hb(h.master,[]);c=hb().command;assert.equal(c.volume,0);assert.equal(ack(c,[]).command,null);
 }
});
test('legacy EAs still require the exact-copy protocol regardless of broker or server',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);
 assert.equal(h.hb(s,[],{copyProtocol:undefined,broker:undefined}).command,null);
 assert.match(h.e.snapshot().agents.find(a=>a.id===s.id).error,/EA 1.04/);
 h.hb(h.master,[pos()],{copyProtocol:undefined,broker:undefined});assert.equal(h.hb(s).command,null);
 h.hb(h.master,[pos()]);assert.equal(h.hb(s).command.volume,.5);
});
test('positions missed offline or while paused are copied on reconnection or activation',()=>{
 const h=harness(),s=h.slaves[0];h.tick(16000);h.hb(h.master,[pos('101',4)]);
 assert.equal(h.e.state.bindings.length,0);let c=h.hb(s).command;assert.equal(c.volume,4);h.ack(s,c,[copied(c)]);
 h.e.admin({action:'enable',id:s.id,enabled:false});h.hb(h.master,[pos('101',4),pos('102',12,{symbol:'Step Index'})]);
 h.e.admin({action:'enable',id:s.id,enabled:true});c=h.hb(s).command;
 assert.equal(c.symbol,'Step Index');assert.equal(c.volume,12);
});
test('persisted capped copies migrate to exact volumes using the original magic',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',15,{symbol:'Step Index'})]);
 const b=h.e.state.bindings[0];delete b.exact;b.volume=1;b.multiplier=.1;b.opened=true;b.appliedVolume=1;
 const old=pos('9001',1,{symbol:b.symbol,magic:b.magic});
 const restored=new CopyEngine(JSON.parse(JSON.stringify(h.e.state)),()=>1000000);
 const slave=restored.state.agents.find(a=>a.id===s.id);
 const c=restored.heartbeat(slave,{role:'slave',account:slave.account,server:slave.server,mode:'demo',session:slave.session,seq:slave.seq+1,hedging:true,broker:'Test Broker',copyProtocol:2,equity:1,positions:[old]}).command;
 assert.equal(c.magic,b.magic);assert.equal(c.volume,15);assert.equal(c.fromVolume,1);
});
test('legacy cap refusals are cleared but uncertain results remain blocked',()=>{
 for(const [lastError,shouldRetry] of [['Volume inférieur au minimum broker après arrondi',true],['Limite totale de 5 lot(s) atteinte',true],['Résultat inconnu',false],[undefined,false]]){
  const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',15)]);
  const b=h.e.state.bindings[0];delete b.exact;b.volume=1;b.blocked=true;b.lastError=lastError;
  const c=h.hb(s).command;assert.equal(!!c,shouldRetry);if(c)assert.equal(c.volume,15);
 }
});
test('legacy reversed or mapped copies close before replacement with the exact source',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',3)]);
 const b=h.e.state.bindings[0];delete b.exact;b.symbol='EURUSD.a';b.side='SELL';b.volume=.7;b.opened=true;
 const old=pos('9001',.7,{symbol:b.symbol,side:b.side,magic:b.magic});
 const close=h.hb(s,[old]).command;assert.equal(close.volume,0);assert.equal(close.magic,b.magic);
 const next=h.ack(s,close,[]).command;
 assert.equal(next.symbol,'EURUSD');assert.equal(next.side,'BUY');assert.equal(next.volume,3);assert.notEqual(next.magic,b.magic);
});
test('migration waits for legacy command acknowledgement before changing its target',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',3)]);const c=h.hb(s).command;
 delete c.copyProtocol;delete c.broker;c.volume=1;delete h.e.state.bindings[0].exact;
 assert.equal(h.hb(s).command.id,c.id);assert.equal(h.hb(s).command.volume,1);
 const next=h.ack(s,c,[copied(c)]).command;assert.equal(next.volume,3);assert.equal(next.fromVolume,1);
});
test('exact acknowledgements never silently accept rounded lots or changed stops',()=>{
 for(const overrides of [{volume:.12},{sl:1.06},{tp:1.3}]){
  const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',.123)]);const c=h.hb(s).command;
  assert.equal(h.ack(s,c,[copied(c,c.volume,overrides)]).command,null);
  assert.equal(s.a.enabled,false);assert.match(s.a.error,/valeurs exactes/);
 }
});
test('a confirmed initial broker refusal preserves its details and does not stop other copies',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',2),pos('102',10,{symbol:'Step Index'})]);const c=h.hb(s).command;
 const ack={id:c.id,status:'skipped',code:'broker_rejected',message:'EURUSD : broker 10019 — No money (lot master 2)'};
 const next=h.hb(s,[],{ack}).command;assert.equal(next.symbol,'Step Index');assert.equal(next.volume,10);assert.equal(s.a.enabled,true);
 assert.match(h.e.snapshot().agents.find(a=>a.id===s.id).copyIssues[0].message,/10019/);
 assert.equal(h.hb(s,[],{ack}).command.id,next.id);
});

test('an EA downgrade never receives a pending exact-copy command',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',15)]);const c=h.hb(s).command;
 assert.equal(h.hb(s,[],{copyProtocol:undefined,broker:undefined}).command,null);
 assert.equal(h.hb(s,[],{copyProtocol:undefined,broker:undefined,seq:1}).command,null);
 assert.equal(h.hb(s).command.id,c.id);
});
test('an inconsistent existing copy cannot allow another queued opening in the same heartbeat',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos('101',1),pos('102',2)]);const c=h.hb(s).command;
 h.ack(s,c,[copied(c)]);const next=s.a.pending;h.ack(s,next,[copied(c),copied(next,next.volume,{id:'9002'})]);
 h.hb(h.master,[pos('101',1),pos('102',2),pos('103',3)]);
 const result=h.hb(s,[copied(c,c.volume,{symbol:'Wrong'}),copied(next,next.volume,{id:'9002'})]);
 assert.equal(result.command,null);assert.equal(s.a.enabled,false);
});

const replacementInput=(h,extra={})=>({action:'replace_master',id:h.master.id,label:'Master réel',role:'master',account:'987654',server:'Live Server',mode:'real',...extra});
test('replacing a master creates a fresh real identity and preserves slaves and manual trades paused',()=>{
 const h=harness(2),s=h.slaves[0];h.hb(s,[pos('700',2,{magic:777})]);
 const beforeSlaves=h.slaves.map(s=>({id:s.id,tokenHash:s.a.tokenHash,positions:JSON.stringify(s.a.positions)}));
 const result=h.e.admin(replacementInput(h));
 const next=h.e.authenticate(result.id,result.token);assert.equal(next.role,'master');assert.equal(next.mode,'real');assert.equal(next.account,'987654');assert.equal(next.server,'Live Server');
 assert.equal(next.lastSeen,0);assert.equal(next.positions.length,0);assert.equal(h.e.state.baseline,null);assert.equal(h.e.state.enabled,false);
 assert.throws(()=>h.e.authenticate(h.master.id,h.master.token),/authentifié/);
 for(const old of beforeSlaves){const slave=h.e.state.agents.find(a=>a.id===old.id);assert.equal(slave.tokenHash,old.tokenHash);assert.equal(slave.enabled,false);assert.equal(JSON.stringify(slave.positions),old.positions);}
 assert.throws(()=>h.e.admin({action:'switch',enabled:true}),/Connectez le master/);
 const newMaster={id:result.id,token:result.token,a:next};h.hb(newMaster,[pos()]);
 const slave={...s,a:h.e.state.agents.find(a=>a.id===s.id)};h.e.admin({action:'enable',id:slave.id,enabled:true});
 h.e.admin({action:'switch',enabled:true});assert.equal(h.hb(slave).command.volume,.5);
});
test('master replacement clears never-opened refusals after a fresh empty follower snapshot',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
 h.hb(s,[],{ack:{id:c.id,status:'skipped',code:'broker_rejected',message:'No money'}});
 assert.equal(h.e.snapshot().masterReplacementError,'');
 const result=h.e.admin(replacementInput(h));assert.ok(result.token);assert.equal(h.e.state.bindings.length,0);
 assert.equal(h.e.snapshot().agents.find(a=>a.id===s.id).copyIssues.length,0);
});
test('master replacement refuses pending orders, stale copy snapshots and open copied positions without mutation',()=>{
 for(const scenario of ['pending','open','stale']){
  const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
  if(scenario==='open')h.ack(s,c,[copied(c)]);
  if(scenario==='stale'){h.ack(s,c,[],'uncertain');h.tick(16000);}
  const before=JSON.stringify(h.e.state);assert.ok(h.e.snapshot().masterReplacementError);
  assert.throws(()=>h.e.admin(replacementInput(h)),/acquittement|Clôturez|Reconnectez/);assert.equal(JSON.stringify(h.e.state),before);
 }
});
test('invalid replacement fields, existing slave identity and stale master selection leave all identities unchanged',()=>{
 for(const extra of [{label:''},{account:'invalid'},{server:''},{mode:'wrong'},{account:'2',server:'Demo Server'},{id:'old-id'}]){
  const h=harness(),before=JSON.stringify(h.e.state);assert.throws(()=>h.e.admin(replacementInput(h,extra)));assert.equal(JSON.stringify(h.e.state),before);
  assert.equal(h.e.authenticate(h.master.id,h.master.token).id,h.master.id);
 }
 const h=harness(),before=JSON.stringify(h.e.state);assert.throws(()=>h.e.admin(replacementInput(h,{id:h.slaves[0].id})),/master/);assert.equal(JSON.stringify(h.e.state),before);
});
test('file storage commits the replacement state, revocation and paused slaves together',()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'copy-replace-'));const original=process.env.COPYTRADING_DATA_DIR;process.env.COPYTRADING_DATA_DIR=folder;
 try{
  const store=moduleAt('lib/copytrading/file-store.ts',{'./engine':model}).exports;
  const old=store.copyTransaction(e=>e.register({role:'master',label:'Old',account:'1',server:'Demo',mode:'demo'}));
  const slave=store.copyTransaction(e=>e.register({role:'slave',label:'Slave',account:'2',server:'Demo',mode:'demo'}));
  const fresh=store.copyTransaction(e=>e.admin({action:'replace_master',id:old.id,label:'Real',account:'10',server:'Live',mode:'real'}));
  const saved=JSON.parse(readFileSync(path.join(folder,'state.json'),'utf8'));
  assert.equal(saved.enabled,false);assert.equal(saved.agents.find(a=>a.role==='master').id,fresh.id);assert.equal(saved.agents.some(a=>a.id===old.id),false);assert.ok(saved.agents.some(a=>a.id===slave.id));
 }finally{if(original===undefined)delete process.env.COPYTRADING_DATA_DIR;else process.env.COPYTRADING_DATA_DIR=original;rmSync(folder,{recursive:true,force:true});}
});
test('real master replacement API requires persistent storage and commits only after successful storage',async()=>{
 const h=harness();let persistent=false,fail=false;
 const store={copyTransaction:async fn=>{const draft=new CopyEngine(structuredClone(h.e.state),()=>1000000);const result=fn(draft);if(fail)throw Object.assign(new Error('disk'),{code:'EIO'});h.e.state=draft.state;return result;},copyStorageInfo:()=>({persistent,configured:persistent})};
 const api=moduleAt('app/api/copytrading/admin/route.ts',{'@/lib/copytrading/store':store,'@/lib/copytrading/engine':model}).exports;
 const original=process.env.COPYTRADING_ADMIN_KEY;process.env.COPYTRADING_ADMIN_KEY='r'.repeat(64);
 const request=()=>new Request('https://example.test/api/copytrading/admin',{method:'POST',headers:{'x-copy-admin-key':process.env.COPYTRADING_ADMIN_KEY},body:JSON.stringify(replacementInput(h))});
 try{
  const before=JSON.stringify(h.e.state);assert.equal((await api.POST(request())).status,409);assert.equal(JSON.stringify(h.e.state),before);
  persistent=true;fail=true;assert.equal((await api.POST(request())).status,422);assert.equal(JSON.stringify(h.e.state),before);
  fail=false;const response=await api.POST(request());assert.equal(response.status,200);const saved=await response.json();assert.ok(saved.result.token);assert.equal(saved.enabled,false);assert.equal(saved.agents.find(a=>a.role==='master').mode,'real');
 }finally{if(original===undefined)delete process.env.COPYTRADING_ADMIN_KEY;else process.env.COPYTRADING_ADMIN_KEY=original;}
});

test('confirmed unopened copies do not require an offline follower to reconnect for replacement',()=>{
 for(const scenario of ['queued','refused']){
  const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);
  if(scenario==='refused'){const c=h.hb(s).command;h.hb(s,[],{ack:{id:c.id,status:'skipped',code:'volume_below_minimum',message:'Below minimum'}});}
  h.tick(16000);assert.equal(h.e.snapshot().masterReplacementError,'');assert.ok(h.e.admin(replacementInput(h)).token);
 }
});
test('legacy unknown outcomes and retried refused orders still require reconciliation',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
 h.hb(s,[],{ack:{id:c.id,status:'skipped',code:'symbol_unavailable',message:'Absent'}});delete h.e.state.bindings[0].execution;
 h.tick(16000);assert.match(h.e.snapshot().masterReplacementError,/Reconnectez/);
 h.hb(h.master,[pos()]);h.hb(s);h.e.admin({action:'enable',id:s.id,enabled:false});h.e.admin({action:'retry',id:s.id});h.e.admin({action:'enable',id:s.id,enabled:true});
 assert.ok(h.hb(s).command);assert.equal(h.e.state.bindings[0].execution,'unknown');assert.match(h.e.snapshot().masterReplacementError,/acquittement/);
});
const archiveDeleted=s=>({action:'archive_deleted_slave',id:s.id,account:s.a.account,server:s.a.server});
test('declaring a deleted offline account archives legacy bindings and revokes its identity without affecting other slaves',()=>{
 const h=harness(2),s=h.slaves[0],other=h.slaves[1];s.a.label='Jordy demo';h.hb(h.master,[pos()]);
 const c=h.hb(s).command;h.ack(s,c,[],'uncertain');delete h.e.state.bindings[0].execution;
 h.tick(16000);assert.match(h.e.snapshot().masterReplacementError,/Jordy demo/);
 const otherBefore=JSON.stringify(other.a);const sourceBefore=JSON.stringify(h.master.a);
 h.e.admin(archiveDeleted(s));assert.equal(h.e.state.agents.some(a=>a.id===s.id),false);assert.equal(h.e.state.bindings.some(b=>b.slave===s.id),false);
 assert.equal(JSON.stringify(other.a),otherBefore);assert.equal(JSON.stringify(h.master.a),sourceBefore);
 assert.throws(()=>h.e.authenticate(s.id,s.token),/authentifié/);
 const archived=h.e.state.archivedFollowers[0];assert.equal(archived.agent.label,'Jordy demo');assert.equal(archived.bindings.length,1);assert.equal(archived.agent.enabled,false);assert.equal('tokenHash' in archived.agent,false);
 assert.equal('archivedFollowers' in h.e.snapshot(),false);assert.equal(h.e.snapshot().masterReplacementError,'');
 const replacement=h.e.admin(replacementInput(h));assert.ok(replacement.token);assert.equal(h.e.state.archivedFollowers.length,1);
});
test('archiving an explicitly deleted offline account retains outstanding commands and observed positions only in audit history',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const c=h.hb(s).command;
 h.ack(s,c,[copied(c)]);h.hb(h.master,[pos('101',.8)]);const outstanding=h.hb(s).command;
 h.tick(16000);h.e.admin(archiveDeleted(s));
 const archived=h.e.state.archivedFollowers[0];assert.equal(archived.agent.pending.id,outstanding.id);assert.equal(archived.agent.positions[0].volume,.5);
 assert.equal(h.e.state.agents.some(a=>a.pending),false);assert.equal(h.e.snapshot().masterReplacementError,'');
 h.hb(h.master,[]);assert.equal(h.e.state.bindings.length,0);
});
test('declared deleted account must match its identity and be an offline slave',()=>{
 for(const scenario of ['online','master','wrong-account','wrong-server']){
  const h=harness(),s=h.slaves[0];if(scenario!=='online')h.tick(16000);
  const input=scenario==='master'?archiveDeleted(h.master):archiveDeleted(s);
  if(scenario==='wrong-account')input.account='999';if(scenario==='wrong-server')input.server='Other';
  const before=JSON.stringify(h.e.state);assert.throws(()=>h.e.admin(input));assert.equal(JSON.stringify(h.e.state),before);
 }
});
test('archived deleted account and preserved history survive file-store reload',()=>{
 const folder=mkdtempSync(path.join(tmpdir(),'copy-archive-'));const original=process.env.COPYTRADING_DATA_DIR;process.env.COPYTRADING_DATA_DIR=folder;
 try{
  const store=moduleAt('lib/copytrading/file-store.ts',{'./engine':model}).exports;
  const old=store.copyTransaction(e=>e.register({role:'slave',label:'Deleted',account:'2',server:'Demo',mode:'demo'}));
  store.copyTransaction(e=>e.admin({action:'archive_deleted_slave',id:old.id,account:'2',server:'Demo'}));
  const saved=JSON.parse(readFileSync(path.join(folder,'state.json'),'utf8'));assert.equal(saved.agents.length,0);assert.equal(saved.archivedFollowers[0].agent.id,old.id);
  const restored=moduleAt('lib/copytrading/file-store.ts',{'./engine':model}).exports;assert.equal(restored.copySnapshot().agents.length,0);
  assert.throws(()=>restored.copyTransaction(e=>e.authenticate(old.id,old.token)),/authentifié/);
 }finally{if(original===undefined)delete process.env.COPYTRADING_DATA_DIR;else process.env.COPYTRADING_DATA_DIR=original;rmSync(folder,{recursive:true,force:true});}
});

test('a newly registered master server can be corrected without replacing credentials or account identity',()=>{
 const e=new CopyEngine(),auth=e.register({role:'master',label:'New real master',account:'101',server:'101',mode:'real'});
 const before=e.authenticate(auth.id,auth.token);assert.equal(e.snapshot().agents[0].canEditServer,true);
 const originalHash=before.tokenHash;
 e.admin({action:'update_master_server',id:auth.id,server:'  Broker-Live-02  '});
 const a=e.authenticate(auth.id,auth.token);assert.equal(a.server,'Broker-Live-02');assert.equal(a.account,'101');assert.equal(a.mode,'real');assert.equal(a.tokenHash,originalHash);assert.equal(e.state.enabled,false);
 const heartbeat={role:'master',account:'101',server:'Broker-Live-02',mode:'real',broker:'Test Broker',copyProtocol:2,session:'new',seq:1,equity:1000,positions:[],metrics:telemetry()};
 assert.equal(e.heartbeat(a,heartbeat).command,null);assert.equal(e.snapshot().agents[0].metrics.balance,1200);assert.equal(e.snapshot().agents[0].canEditServer,false);
});
test('server correction rejects established accounts, duplicate registrations and invalid values without mutation',()=>{
 const h=harness();for(const who of [h.master,h.slaves[0]]){const before=JSON.stringify(h.e.state);assert.throws(()=>h.e.admin({action:'update_master_server',id:who.id,server:'Other'}),/première connexion/);assert.equal(JSON.stringify(h.e.state),before);}
 const e=new CopyEngine(),m=e.register({role:'master',label:'New master',account:'101',server:'101',mode:'real'});
 e.register({role:'slave',label:'Existing',account:'101',server:'Taken',mode:'real'});
 for(const server of ['',null,'Taken']){const before=JSON.stringify(e.state);assert.throws(()=>e.admin({action:'update_master_server',id:m.id,server}));assert.equal(JSON.stringify(e.state),before);}
});

test('a new or disconnected master does not incorrectly require reinstalling follower EAs',()=>{
 const h=harness(),s=h.slaves[0];
 const replacement=h.e.admin(replacementInput(h));
 let follower=h.e.snapshot().agents.find(a=>a.id===s.id);
 assert.match(follower.error,/première connexion du master/);assert.doesNotMatch(follower.error,/Installer/);
 const master={...replacement,a:h.e.state.agents.find(a=>a.id===replacement.id)};
 h.hb(master,[]);assert.equal(h.e.snapshot().agents.find(a=>a.id===s.id).error,'');
 h.tick(16000);assert.match(h.e.snapshot().agents.find(a=>a.id===s.id).error,/Master hors ligne/);
 h.hb(master,[],{copyProtocol:undefined});assert.match(h.e.snapshot().agents.find(a=>a.id===s.id).error,/sur le master/);
 h.hb(master,[]);h.hb(s,[],{copyProtocol:undefined});assert.match(h.e.snapshot().agents.find(a=>a.id===s.id).error,/sur ce suiveur/);
});

test('authenticated HTTP 409 diagnostics reach the dashboard without accepting a rejected snapshot',async()=>{
 const h=harness();
 const store={copyTransaction:async fn=>{const draft=new CopyEngine(structuredClone(h.e.state),()=>1000000);const result=fn(draft);h.e.state=draft.state;return result;},copyStorageInfo:()=>({persistent:true,configured:true})};
 const api=moduleAt('app/api/copytrading/agent/route.ts',{'@/lib/copytrading/store':store}).exports;
 const body={role:'master',account:h.master.a.account,server:'Wrong server',mode:'demo',session:'terminal',seq:2,equity:999,positions:[pos()]};
 const request=(token=h.master.token)=>new Request('https://example.test/api/copytrading/agent',{method:'POST',headers:{'x-copy-agent-id':h.master.id,'x-copy-agent-key':token},body:JSON.stringify(body)});
 const before=JSON.stringify(h.e.state);
 assert.equal((await api.POST(request('f'.repeat(64)))).status,409);assert.equal(JSON.stringify(h.e.state),before,'unauthenticated callers cannot change account diagnostics');
 let response=await api.POST(request());assert.equal(response.status,409);assert.match((await response.json()).error,/Serveur MT5 différent/);
 let master=h.e.snapshot().agents.find(a=>a.id===h.master.id);
 assert.match(master.connectionError,/Demo Server/);assert.equal(master.lastSeen,1000000);assert.equal(master.positionCount,0);assert.equal(master.equity,1000);
 assert.match(h.e.snapshot().agents.find(a=>a.role==='slave').error,/Transmission du master refusée/);
 const logs=h.e.state.logs.length;await api.POST(request());assert.equal(h.e.state.logs.length,logs,'identical refusals do not flood the journal');
 body.server=h.master.a.server;response=await api.POST(request());assert.equal(response.status,200);
 master=h.e.snapshot().agents.find(a=>a.id===h.master.id);assert.equal(master.connectionError,'');assert.equal(master.positionCount,1);assert.equal(master.equity,999);
});

test('refused acknowledgements preserve pending commands, positions and bindings while exposing the reason',()=>{
 const h=harness(),s=h.slaves[0];h.hb(h.master,[pos()]);const command=h.hb(s).command;
 const before=structuredClone(h.e.state);
 const result=h.e.receiveHeartbeat(s.a,{role:'slave',account:s.a.account,server:s.a.server,mode:'demo',hedging:true,session:'terminal',seq:s.a.seq+1,equity:1,positions:[copied(command)],ack:{id:'unknown',status:'done'}});
 assert.match(result.error,/Acquittement inconnu/);
 assert.equal(JSON.stringify(h.e.state.bindings),JSON.stringify(before.bindings));
 const agent=h.e.state.agents.find(a=>a.id===s.id),old=before.agents.find(a=>a.id===s.id);
 assert.equal(JSON.stringify({...agent,connectionError:undefined}),JSON.stringify({...old,connectionError:undefined}));
});

test('regenerating an unconnected real master key revokes the old key and preserves follower identities',()=>{
 const h=harness();const replacement=h.e.admin(replacementInput(h));
 const master=h.e.state.agents.find(a=>a.id===replacement.id),slaves=JSON.stringify(h.e.state.agents.filter(a=>a.role==='slave'));
 assert.equal(h.e.snapshot().agents.find(a=>a.id===master.id).canResetCredentials,true);
 const reset=h.e.admin({action:'reset_master_credentials',id:master.id});
 assert.equal(reset.id,replacement.id);assert.equal(reset.token.length,64);assert.notEqual(reset.token,replacement.token);
 assert.throws(()=>h.e.authenticate(reset.id,replacement.token),/non authentifié/);
 assert.equal(h.e.authenticate(reset.id,reset.token).account,master.account);
 assert.equal(JSON.stringify(h.e.state.agents.filter(a=>a.role==='slave')),slaves);
 assert.equal(h.e.state.enabled,false);assert.equal(h.e.state.baseline,null);
 assert.ok(!JSON.stringify(h.e.snapshot()).includes(reset.token));assert.ok(!JSON.stringify(h.e.state).includes(reset.token));
 h.hb({id:reset.id,token:reset.token,a:master},[pos()]);
 assert.equal(h.e.snapshot().agents.find(a=>a.id===master.id).positionCount,1);
 assert.equal(h.e.snapshot().agents.find(a=>a.id===master.id).canResetCredentials,false);
 const before=JSON.stringify(h.e.state);
 assert.throws(()=>h.e.admin({action:'reset_master_credentials',id:master.id}),/première connexion/);
 assert.throws(()=>h.e.admin({action:'reset_master_credentials',id:h.slaves[0].id}),/première connexion/);
 assert.equal(JSON.stringify(h.e.state),before);
});
