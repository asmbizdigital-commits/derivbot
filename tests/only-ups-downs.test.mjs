import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const page=readFileSync(new URL('../app/page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',page,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const functions=new Map(), variables=new Map();
function visit(node){
 if(ts.isFunctionDeclaration(node)&&node.name)functions.set(node.name.text,node.getText(ast));
 if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name))variables.set(node.name.text,node.initializer?.getText(ast));
 ts.forEachChild(node,visit);
}visit(ast);
function run(code,ctx={}){const context=vm.createContext(ctx);vm.runInContext(ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React}}).outputText,context);return context;}
const model=readFileSync(new URL('../lib/rise-fall-prediction.ts',import.meta.url),'utf8').replaceAll('export ','');
const runSource=readFileSync(new URL('../lib/only-ups-downs.ts',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replaceAll('export ','');
const runApi=run(model+runSource+'\nglobalThis.api={RUN_STRATEGIES,evaluateRunEntry,parseRunStrategyMarkdown};').api;
const {RUN_STRATEGIES,evaluateRunEntry,parseRunStrategyMarkdown}=runApi;
const names=['getContractCategory','parseDerivContractCode','needsDigitBarrier','needsTouchBarrier','formatDerivContract','chooseDerivContractDuration','buildDerivProposalRequest'];
const helper=run(`const derivContractLabels=${variables.get('derivContractLabels')};\n`+names.map(x=>functions.get(x)).join('\n')+`\nglobalThis.api={${names.join(',')}};`).api;

test('Only Ups and Only Downs retain their category and labels in quotes, portfolio and history',()=>{
 const categories=run(`globalThis.categories=${variables.get('derivContractCategories')};`).categories;
 assert.deepEqual(Array.from(categories.only_ups_downs.options),['RUNHIGH','RUNLOW']);
 for(const [type,label] of [['RUNHIGH','Only Ups'],['RUNLOW','Only Downs']]){
  assert.equal(helper.parseDerivContractCode(type),type);
  assert.equal(helper.getContractCategory(type),'only_ups_downs');
  assert.equal(helper.formatDerivContract(type,null),label);
  assert.equal(helper.needsDigitBarrier(type),false);assert.equal(helper.needsTouchBarrier(type),false);
 }
});

test('wire requests use RUNHIGH/RUNLOW and 2-5 ticks without adding a digit or touch barrier',()=>{
 for(const contractType of ['RUNHIGH','RUNLOW'])for(const duration of [2,3,4,5]){
  const request=helper.buildDerivProposalRequest({contractType,duration,barrier:7,stake:1,symbol:'R_100',currency:'USD'});
  assert.equal(request.contract_type,contractType);assert.equal(request.duration,duration);assert.equal(request.duration_unit,'t');assert.equal('barrier' in request,false);
 }
 for(const duration of [0,1,6,1.5,NaN,Infinity]) assert.throws(()=>helper.buildDerivProposalRequest({contractType:'RUNHIGH',duration}));
});

function auto(type,direction){
 const begin=page.indexOf('const priceSignal =');
 const end=page.indexOf('\n  function requestDerivOverUnderQuoteScan(',begin);
 const orders=[],statuses=[];
 const ctx={
  currentContractType:type,isRunContract:true,digitSignal:null,currentTicks:direction==='CALL'?[100,101,102]:direction==='PUT'?[102,101,100]:[100],stake:1,fixedDigitBarrier:null,currentMatchStrategy:{rules:{}},socket:{},
  derivRunDurationRef:{current:4},derivStrategyRef:{current:'trend'},derivMarketRef:{current:'R_100'},
  derivHalfBalanceRiskEnabledRef:{current:false},derivMultiplePositionsEnabledRef:{current:false},derivMartingaleEnabledRef:{current:false},
  buildRiseFallSignal:()=>{throw new Error('Reactive runs must not call the multi-horizon model');},
  evaluateRunEntry,runStrategyRef:{current:RUN_STRATEGIES.reactive},
  needsTouchBarrier:helper.needsTouchBarrier,needsDigitBarrier:helper.needsDigitBarrier,
  getContractCategory:helper.getContractCategory,formatDerivContract:helper.formatDerivContract,
  derivContractLabels:{RUNHIGH:'Only Ups',RUNLOW:'Only Downs'},derivStrategies:{trend:{name:'Tendance'}},
  setDerivAutoStatus:s=>statuses.push(s),setDerivMessage(){},setDerivContractCategory(){},setDerivContractType(){},registerDerivSessionSignal(){},
  requestDerivAutoPosition:(_,order)=>orders.push(order),
 };
 run('function execute(){'+page.slice(begin,end)+'\nexecute();',ctx);
 return {orders,statuses};
}
test('automatic mode preserves selected direction and duration, waits on missing/opposite signals',()=>{
 for(const [type,direction,opposite] of [['RUNHIGH','CALL','PUT'],['RUNLOW','PUT','CALL']]){
  const {orders,statuses}=auto(type,direction);
  assert.equal(orders.length,1);assert.equal(orders[0].contractType,type);assert.equal(orders[0].duration,4);assert.equal(orders[0].barrier,null);
  assert.equal(orders[0].riseFallSignal,undefined,'Rise/Fall probability must not be used to price a successive-tick contract');
  assert.ok(statuses.every(s=>!s.includes('confiance')));
  assert.equal(auto(type,opposite).orders.length,0);assert.equal(auto(type,null).orders.length,0);
 }
});

test('run quote validation cancels stale quotes, changed directions, settings and invalid prices',()=>{
 const begin=page.indexOf('            if (autoQuote.contractType === "RUNHIGH"');
 const end=page.indexOf('            if (autoQuote.dbxLastDigit)',begin);
 for(const scenario of ['valid','old','future','missingTime','opposite','market','type','duration','strategy','price']){
  const profile=RUN_STRATEGIES.reactive;
  const ctx={runStrategyRef:{current:profile},autoQuote:{runStrategy:profile,contractType:'RUNHIGH',symbol:'R_100',duration:2,stake:1,runRequestedAt:1000},
   Date:{now:()=>2000},derivTicksRef:{current:[]},derivStrategyRef:{current:'trend'},derivMarketRef:{current:'R_100'},derivContractTypeRef:{current:'RUNHIGH'},derivRunDurationRef:{current:2},derivBalanceRef:{current:10},proposal:{ask_price:1,payout:3.82},
   evaluateRunEntry:()=>({ready:scenario!=='opposite'}),validDbxQuote:()=>scenario!=='price',setDerivAutoStatus(){}};
  if(scenario==='old')ctx.autoQuote.runRequestedAt=-2000;
  if(scenario==='future')ctx.autoQuote.runRequestedAt=3000;
  if(scenario==='missingTime')delete ctx.autoQuote.runRequestedAt;
  if(scenario==='market')ctx.derivMarketRef.current='R_50';
  if(scenario==='type')ctx.derivContractTypeRef.current='RUNLOW';
  if(scenario==='duration')ctx.derivRunDurationRef.current=5;
  if(scenario==='strategy')ctx.runStrategyRef.current=RUN_STRATEGIES.confirmed;
  const result=run('function check(){'+page.slice(begin,end)+'return true;}globalThis.accepted=check()===true;',ctx);
  assert.equal(result.accepted,scenario==='valid',scenario);
 }
});

test('manual duration UI offers 2-5 ticks and updates refs, clearing the previous quote',()=>{
 const html=renderToStaticMarkup(React.createElement(run(`globalThis.Control=()=>(${variables.get('runDurationControl')});`,{React,derivRunDuration:3,derivAutoRunning:false,derivDeals:[],changeDerivRunDuration(){}}).Control));
 assert.match(html,/Durée Only Ups \/ Only Downs en ticks/);
 assert.equal((html.match(/<option /g)||[]).length,4);assert.match(html,/value="3" selected/);
 for(const scenario of ['valid','running','open','buy','quote','invalid']){
  let value=null,cleared=false;
  const ctx={runImportIdRef:{current:0},runStrategyRef:{current:RUN_STRATEGIES.reactive},setRunStrategy(){},derivRunDurationRef:{current:2},derivAutoRunningRef:{current:scenario==='running'},derivOpenContractsRef:{current:new Set(scenario==='open'?[1]:[])},derivPendingBuysRef:{current:new Map(scenario==='buy'?[[1,{}]]:[])},derivAutoQuoteRef:{current:new Map(scenario==='quote'?[[1,{}]]:[])},setDerivRunDuration:v=>value=v,setDerivProposal:()=>cleared=true};
  run(functions.get('changeDerivRunDuration')+`\nchangeDerivRunDuration(${scenario==='invalid'?6:3});`,ctx);
  assert.equal(value,scenario==='valid'?3:null);assert.equal(cleared,scenario==='valid');
 }
});

test('reactive trigger uses price moves, resets on equality/opposition and confirms either direction',()=>{
 const profile=RUN_STRATEGIES.reactive;
 assert.equal(evaluateRunEntry([100,101,102],'RUNHIGH',profile).ready,true);
 assert.equal(evaluateRunEntry([102,101,100],'RUNLOW',profile).ready,true);
 for(const prices of [[100],[100,101],[100,100,101],[100,101,101],[100,102,101],[NaN,101,102],[100,Infinity,102]]){
  assert.equal(evaluateRunEntry(prices,'RUNHIGH',profile).ready,false,JSON.stringify(prices));
 }
 assert.equal(evaluateRunEntry([100,101,102],'RUNHIGH',RUN_STRATEGIES.confirmed).ready,false);
 assert.equal(evaluateRunEntry([100,101,102,103],'RUNHIGH',RUN_STRATEGIES.confirmed).ready,true);
 assert.match(evaluateRunEntry(Array(100).fill(100),'RUNHIGH',RUN_STRATEGIES.trend).reason,/attente du filtre directionnel/);
 assert.match(evaluateRunEntry([100],'RUNHIGH',RUN_STRATEGIES.trend).reason,/1\/80/);
});

const md=(changes={})=>'```json\n'+JSON.stringify({strategy:'only_ups_downs',version:1,...RUN_STRATEGIES.reactive,...changes})+'\n```';
test('MD imports strict declarative profiles and shipped examples; rejects malformed/incompatible values',()=>{
 for(const file of ['only-ups-downs-reactif.md','only-ups-downs-confirme.md']){
  const p=parseRunStrategyMarkdown(readFileSync(new URL('../strategies/'+file,import.meta.url),'utf8'));
  assert.equal(p.entryMode,'consecutive');assert.equal(p.durationTicks,2);
 }
 const custom=parseRunStrategyMarkdown(md({name:'Mon profil',contractType:'RUNLOW',stake:2,durationTicks:5,confirmationMoves:1}));
 assert.equal(custom.contractType,'RUNLOW');assert.equal(custom.stake,2);assert.equal(custom.durationTicks,5);
 for(const changes of [{strategy:'advanced_matches'},{version:2},{name:''},{durationTicks:1},{durationTicks:6},{durationTicks:2.5},{durationTicks:'3'},{confirmationMoves:0},{confirmationMoves:6},{confirmationMoves:2.5},{entryMode:'script'},{contractType:'CALL'},{stake:'2'},{stake:0},{stake:10001},{unknown:1}]) assert.throws(()=>parseRunStrategyMarkdown(md(changes)),JSON.stringify(changes));
 for(const text of ['plain markdown','```json\nnull\n```','```json\n[]\n```',md()+md(),'x'.repeat(65537)])assert.throws(()=>parseRunStrategyMarkdown(text));
 for(const mode of ['trend','momentum','reversal'])assert.equal(parseRunStrategyMarkdown(md({entryMode:mode})).entryMode,mode);
});

function selectionHarness(){
 const state={};
 const refs={derivAutoRunningRef:false,derivOpenContractsRef:new Set(),derivPendingBuysRef:new Map(),derivAutoQuoteRef:new Map(),runImportIdRef:0,derivContractTypeRef:'RUNLOW',derivModeRef:'manual',runStrategyRef:RUN_STRATEGIES.reactive,derivRunDurationRef:2,derivStakeRef:1};
 const ctx={RUN_STRATEGIES,parseRunStrategyMarkdown,importedRunStrategy:null,...Object.fromEntries(Object.entries(refs).map(([k,current])=>[k,{current}]))};
 for(const key of ['RunImportStatus','RunStrategy','RunStrategySelection','DerivRunDuration','DerivContractType','DerivContractCategory','DerivMode','DerivStake','DerivProposal','DerivAutoStatus','ImportedRunStrategy'])ctx['set'+key]=value=>{state[key]=value;};
 const context=run(['runStrategyLocked','selectRunStrategy','importRunStrategyFile'].map(n=>functions.get(n)).join('\n'),ctx);
 return {ctx:context,state};
}
test('selector/import apply direction, stake and duration without starting the bot, and lock on pending work',async()=>{
 const h=selectionHarness();
 assert.equal(h.ctx.selectRunStrategy('confirmed'),true);
 assert.equal(h.ctx.derivContractTypeRef.current,'RUNLOW','preset keeps selected side');
 assert.equal(h.state.RunStrategy.confirmationMoves,3);
 await h.ctx.importRunStrategyFile({target:{value:'file',files:[{size:200,text:async()=>md({contractType:'RUNHIGH',durationTicks:5,stake:3})}]}});
 assert.equal(h.ctx.derivContractTypeRef.current,'RUNHIGH');assert.equal(h.ctx.derivRunDurationRef.current,5);assert.equal(h.ctx.derivStakeRef.current,3);
 assert.equal(h.state.RunStrategySelection,'imported');assert.equal(h.ctx.derivAutoRunningRef.current,false);
 assert.equal(h.state.DerivProposal,null);assert.ok(h.state.ImportedRunStrategy);
 for(const key of ['derivAutoRunningRef','derivOpenContractsRef','derivPendingBuysRef','derivAutoQuoteRef']){
  const h=selectionHarness();
  h.ctx[key].current=key==='derivAutoRunningRef'?true:key==='derivOpenContractsRef'?new Set([1]):new Map([[1,{}]]);
  assert.equal(h.ctx.selectRunStrategy('confirmed'),false);assert.equal(h.state.RunStrategy,undefined);
 }
});

test('file reading race cannot overwrite a running session, switched contract or newer choice',async()=>{
 for(const scenario of ['running','switched','newer','invalid']){
  const h=selectionHarness();let resolve;
  const text=new Promise(r=>resolve=r);
  const task=h.ctx.importRunStrategyFile({target:{value:'file',files:[{size:200,text:()=>text}]}});
  if(scenario==='running')h.ctx.derivAutoRunningRef.current=true;
  if(scenario==='switched')h.ctx.derivContractTypeRef.current='CALL';
  if(scenario==='newer')h.ctx.selectRunStrategy('confirmed');
  resolve(scenario==='invalid'?'no json':md());await task;
  assert.equal(h.state.ImportedRunStrategy,undefined);
  if(scenario==='newer')assert.equal(h.state.RunStrategy.confirmationMoves,3);
  else assert.equal(h.state.RunStrategy,undefined);
 }
});

test('strategy panel renders presets, imported profile, import control and explicit non-autostart text',()=>{
 const source=readFileSync(new URL('../components/run-strategy-panel.tsx',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export function','function');
 const Component=run(source+'\nglobalThis.Component=RunStrategyPanel;',{React,RUN_STRATEGIES}).Component;
 const html=renderToStaticMarkup(React.createElement(Component,{strategy:RUN_STRATEGIES.reactive,selection:'reactive',imported:{...RUN_STRATEGIES.confirmed,name:'Ma série'},disabled:true,status:'',onSelect(){},onImport(){}}));
 assert.equal((html.match(/<option /g)||[]).length,6);assert.match(html,/Ma série \(importée\)/);
 assert.match(html,/Importer une stratégie Only Ups \/ Only Downs/);assert.match(html,/L’import ne lance aucun achat/);
 assert.equal((html.match(/disabled=""/g)||[]).length,2);
});
