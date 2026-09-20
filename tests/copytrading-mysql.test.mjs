import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import mysql from 'mysql2/promise';
const require=createRequire(import.meta.url);
function load(name,imports={}){
 const source=readFileSync(new URL('../lib/copytrading/'+name+'.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,require:id=>imports[id]??require(id),Buffer,structuredClone,process,Date});return exports;
}
const engine=load('engine');
const adapter=load('mysql-store',{'./engine':engine});
const {mysqlOptions,MysqlCopyStore}=adapter;
const config={MYSQL_HOST:'mysql-example',MYSQL_DATABASE:'copy',MYSQL_USER:'copy_user',MYSQL_PASSWORD:'  a secret with spaces  '};

test('MySQL configuration validates required fields and keeps passwords out of the status',()=>{
 const options=mysqlOptions(config);assert.equal(options.host,'mysql-example');assert.equal(options.port,3306);assert.equal(options.password,config.MYSQL_PASSWORD);assert.equal(options.multipleStatements,false);
 for(const field of Object.keys(config))assert.throws(()=>mysqlOptions({...config,[field]:''}));
 for(const host of ['mysql://host','host:3306','host/path','bad host'])assert.throws(()=>mysqlOptions({...config,MYSQL_HOST:host}));
 for(const port of ['0','70000','abc','3.5'])assert.throws(()=>mysqlOptions({...config,MYSQL_PORT:port}));
 assert.equal(mysqlOptions({...config,MYSQL_SSL:'true'}).ssl.rejectUnauthorized,true);
 assert.throws(()=>mysqlOptions({...config,MYSQL_SSL:'insecure'}));
});

test('MySQL selection never falls back to files, including missing credentials or a connection failure',async()=>{
 const prior=process.env.COPYTRADING_STORAGE;let fileCalls=0;
 const store=load('store',{
  './file-store':{
   copyStorageInfo:()=>({persistent:false,configured:false}),
   copyTransaction:()=>{fileCalls++;},copySnapshot:()=>{fileCalls++;},
  },
  './mysql-store':{
   mysqlOptions:()=>{throw new Error('missing config');},
   mysqlStore:()=>({
    transaction:async()=>{throw new Error('database unavailable');},
    snapshot:async()=>{throw new Error('database unavailable');},
   }),
  },
 });
 try {
  process.env.COPYTRADING_STORAGE='mysql';const info=store.copyStorageInfo();assert.equal(info.provider,'mysql');assert.equal(info.configured,false);assert.equal(info.persistent,false);
  await assert.rejects(store.copyTransaction(()=>({command:'must not return'})),/unavailable/);await assert.rejects(store.copySnapshot(),/unavailable/);assert.equal(fileCalls,0);
  process.env.COPYTRADING_STORAGE='typo';await assert.rejects(store.copySnapshot(),/COPYTRADING_STORAGE/);
 }finally{if(prior===undefined)delete process.env.COPYTRADING_STORAGE;else process.env.COPYTRADING_STORAGE=prior;}
});

// Opt-in only; an isolated mysqld must be started with --skip-networking in /tmp.
const socket=process.env.COPY_MYSQL_TEST_SOCKET;
test('real MySQL transactions: concurrency, isolation, rollback, restart and lost commit response', {skip:!socket},async t=>{
 assert.match(socket,/^\/tmp\/copy-mysql-test-[^/]+\/mysql\.sock$/);
 const root=await mysql.createConnection({socketPath:socket,user:'root'});
 const database=`copy_test_${process.pid}_${Date.now()}`;
 await root.query(`CREATE DATABASE ${database}`);
 const pool=mysql.createPool({socketPath:socket,user:'root',database,connectionLimit:5});
 try {
  const store=new MysqlCopyStore(pool);
  let master,slaves=[],commands=[];
  const registration=(role,i)=>({role,label:role+i,account:String(1000+i),server:'TEST ONLY',mode:'demo'});
  const beat=(auth,seq,positions=[],ack)=>store.transaction(e=>{
   const a=e.authenticate(auth.id,auth.token);
   return e.heartbeat(a,{role:a.role,account:a.account,server:a.server,mode:a.mode,session:'integration',seq,positions,equity:1000,hedging:true,...(ack?{ack}: {})});
  });
  await t.test('initialization is concurrent and 50 registrations are not lost',async()=>{
   await Promise.all(Array.from({length:10},()=>store.snapshot()));
   master=await store.transaction(e=>e.register(registration('master',0)));
   slaves=await Promise.all(Array.from({length:50},(_,i)=>store.transaction(e=>e.register(registration('slave',i+1)))));
   assert.equal((await store.snapshot()).agents.length,51);
   await assert.rejects(store.transaction(e=>e.register(registration('slave',51))),/50/);
   assert.equal((await store.snapshot()).agents.length,51);
  });
  await t.test('50 followers receive separate durable commands and concurrent reads reuse the same ID',async()=>{
   await beat(master,1);await Promise.all(slaves.map(a=>beat(a,1)));
   await store.transaction(e=>{for(const a of slaves)e.admin({action:'enable',id:a.id,enabled:true});e.admin({action:'switch',enabled:true});});
   await beat(master,2,[{id:'77',symbol:'EURUSD',side:'BUY',volume:.1,sl:0,tp:0,magic:0}]);
   commands=await Promise.all(slaves.map(a=>beat(a,2)));
   assert.equal(new Set(commands.map(r=>r.command.id)).size,50);
   const replay=await Promise.all(Array.from({length:15},()=>beat(slaves[0],2)));
   assert.ok(replay.every(r=>r.command.id===commands[0].command.id));
   const [rows]=await root.query(`SELECT state FROM ${database}.copytrading_state WHERE id=1`);
   assert.equal(rows[0].state.agents.find(a=>a.id===slaves[0].id).pending.id,commands[0].command.id);
  });
  await t.test('rollback discards all changes after a rejected operation',async()=>{
   await assert.rejects(store.transaction(e=>{e.state.agents=[];throw new Error('invalid operation');}),/invalid operation/);
   assert.equal((await store.snapshot()).agents.length,51);
  });
  await t.test('restarting preserves credentials and pending IDs, pauses openings, and accepts acknowledgements',async()=>{
   const restarted=new MysqlCopyStore(pool);const snapshot=await restarted.snapshot();
   assert.equal(snapshot.enabled,false);assert.ok(snapshot.agents.every(a=>!a.enabled&&!a.online));
   const first=snapshot.agents.find(a=>a.id===slaves[0].id);assert.equal(first.pending.id,commands[0].command.id);assert.ok(first.pending.expiresAt<Date.now());
   await restarted.transaction(e=>{const a=e.authenticate(slaves[0].id,slaves[0].token);assert.equal(a.pending.id,commands[0].command.id);});
   const c=commands[0].command;
   await beat(slaves[0],3,[{id:'999',symbol:c.symbol,side:c.side,volume:c.volume,sl:c.sl,tp:c.tp,magic:c.magic}],{id:c.id,status:'done',message:'simulation'});
   assert.equal((await restarted.snapshot()).agents.find(a=>a.id===slaves[0].id).pending,null);
  });
  await t.test('a COMMIT response failure returns no command and does not retry the operation',async()=>{
   let fail=false,executions=0;
   const wrapped={query:(...args)=>pool.query(...args),execute:(...args)=>pool.execute(...args),async getConnection(){const c=await pool.getConnection();return {query:(...a)=>c.query(...a),execute:(...a)=>c.execute(...a),beginTransaction:()=>c.beginTransaction(),rollback:()=>c.rollback(),release:()=>c.release(),destroy:()=>c.destroy(),async commit(){await c.commit();if(fail){fail=false;throw Object.assign(new Error('response lost'),{code:'ECONNRESET'});}}};}};
   const uncertain=new MysqlCopyStore(wrapped);await uncertain.snapshot();fail=true;
   await assert.rejects(uncertain.transaction(e=>{executions++;e.log('system','committed despite lost response');return {command:e.state.agents.find(a=>a.id===slaves[1].id).pending};}),/response lost/);
   assert.equal(executions,1);const snapshot=await store.snapshot();assert.equal(snapshot.logs[0].message,'committed despite lost response');assert.equal(snapshot.agents.find(a=>a.id===slaves[1].id).pending.id,commands[1].command.id);
  });
  await t.test('invalid persisted state is rejected rather than overwritten',async()=>{
   await pool.execute('UPDATE copytrading_state SET state=? WHERE id=1',[JSON.stringify({version:99})]);
   await assert.rejects(new MysqlCopyStore(pool).snapshot(),/invalide/);
   const [rows]=await pool.query('SELECT state FROM copytrading_state WHERE id=1');assert.equal(rows[0].state.version,99);
  });
 }finally{await pool.end();await root.query(`DROP DATABASE ${database}`);await root.end();}
});
