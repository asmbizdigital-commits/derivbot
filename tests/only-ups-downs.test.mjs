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
  currentContractType:type,isRunContract:true,digitSignal:null,currentTicks:[100,101],stake:1,fixedDigitBarrier:null,currentMatchStrategy:{rules:{}},socket:{},
  derivRunDurationRef:{current:4},derivStrategyRef:{current:'trend'},derivMarketRef:{current:'R_100'},
  derivHalfBalanceRiskEnabledRef:{current:false},derivMultiplePositionsEnabledRef:{current:false},derivMartingaleEnabledRef:{current:false},
  buildRiseFallSignal:()=>direction?{direction,duration:2,confidence:80,reason:'test'}:null,
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
 for(const scenario of ['valid','old','future','missingTime','opposite','market','type','duration','price']){
  const ctx={autoQuote:{contractType:'RUNHIGH',symbol:'R_100',duration:2,stake:1,runRequestedAt:1000},
   Date:{now:()=>2000},derivTicksRef:{current:[]},derivStrategyRef:{current:'trend'},derivMarketRef:{current:'R_100'},derivContractTypeRef:{current:'RUNHIGH'},derivRunDurationRef:{current:2},derivBalanceRef:{current:10},proposal:{ask_price:1,payout:3.82},
   buildRiseFallSignal:()=>({direction:scenario==='opposite'?'PUT':'CALL'}),validDbxQuote:()=>scenario!=='price',setDerivAutoStatus(){}};
  if(scenario==='old')ctx.autoQuote.runRequestedAt=-2000;
  if(scenario==='future')ctx.autoQuote.runRequestedAt=3000;
  if(scenario==='missingTime')delete ctx.autoQuote.runRequestedAt;
  if(scenario==='market')ctx.derivMarketRef.current='R_50';
  if(scenario==='type')ctx.derivContractTypeRef.current='RUNLOW';
  if(scenario==='duration')ctx.derivRunDurationRef.current=5;
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
  const ctx={derivRunDurationRef:{current:2},derivAutoRunningRef:{current:scenario==='running'},derivOpenContractsRef:{current:new Set(scenario==='open'?[1]:[])},derivPendingBuysRef:{current:new Map(scenario==='buy'?[[1,{}]]:[])},derivAutoQuoteRef:{current:new Map(scenario==='quote'?[[1,{}]]:[])},setDerivRunDuration:v=>value=v,setDerivProposal:()=>cleared=true};
  run(functions.get('changeDerivRunDuration')+`\nchangeDerivRunDuration(${scenario==='invalid'?6:3});`,ctx);
  assert.equal(value,scenario==='valid'?3:null);assert.equal(cleared,scenario==='valid');
 }
});
