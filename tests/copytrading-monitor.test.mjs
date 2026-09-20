import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url),exports={};
const code=ts.transpileModule(readFileSync(new URL('../components/copytrading-monitor.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{exports,require,Date});
const metrics={balance:1200,currency:'USD',floatingPnl:-12.5,realizedDay:30.25,dealsDay:2,day:'2026-09-20',receivedAt:Date.now()};
const master={id:'m',label:'Source',account:'101',server:'Demo',mode:'demo',online:true,lastSeen:Date.now(),equity:1187.5,metrics,positions:[],hasTraded:true};
const render=(props={})=>renderToStaticMarkup(React.createElement(exports.CopyTradingMonitor,{master,slaves:[],disconnected:false,...props}));
test('monitor distinguishes realized, floating and total with explicit period and currency',()=>{
 assert.equal(exports.totalPnl(metrics),17.75);assert.equal(exports.totalPnl({...metrics,realizedDay:null}),null);
 const html=render();assert.match(html,/17,75 USD/);assert.match(html,/-12,50 USD/);assert.match(html,/30,25 USD/);
 assert.match(html,/2026-09-20/);assert.match(html,/En direct/);
 const next=render({master:{...master,metrics:{...metrics,floatingPnl:4}}});assert.match(next,/34,25 USD/);
});
test('old terminals, stale connections and failed polling are never presented as live zero-profit accounts',()=>{
 const legacy=render({master:{...master,metrics:null}});assert.match(legacy,/EA 1.02/);assert.ok(!legacy.includes('0,00 USD'));
 for(const props of [{disconnected:true},{master:{...master,online:false}},{master:{...master,lastSeen:Date.now()-20000}}]){
  const html=render(props);assert.match(html,/Données anciennes/);assert.ok(!html.includes('En direct'));
 }
});
test('follower table keeps previous traders and separates copies, manual trades and currencies',()=>{
 const position={id:'22',symbol:'EURUSD',side:'BUY',volume:.2,sl:0,tp:0,magic:1,copied:true,details:{openPrice:1.1,currentPrice:1.2,profit:5,swap:-1}};
 const slaves=[{...master,id:'s1',label:'Trader EUR',metrics:{...metrics,currency:'EUR'},positions:[position]},{...master,id:'s2',label:'Déjà clôturé',positions:[]},{...master,id:'s3',label:'Jamais tradé',hasTraded:false,positions:[]}];
 const html=render({slaves});assert.match(html,/Trader EUR/);assert.match(html,/Déjà clôturé/);assert.ok(!html.includes('Jamais tradé'));
 assert.match(html,/17,75 EUR/);assert.match(html,/4,00 EUR/);assert.match(html,/Copie master/);assert.match(html,/2 \/ 3/);
});
