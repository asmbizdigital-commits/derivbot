import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url);
// Render the actual panel with an issued identity, then exercise its clipboard buttons.
function panel(writeText){
 const issued={id:'12345678-1234-1234-1234-123456789abc',token:'ab'.repeat(32)};
 const data={enabled:false,limit:50,agents:[],logs:[],storage:{provider:'mysql',persistent:true,configured:true}};
 const state=['',data,'',false,issued,''];let index=0;const notices=[];
 const react={useState(initial){const slot=index++;return [slot<state.length?state[slot]:initial,value=>{if(slot===5)notices.push(value);}];},useRef:value=>({current:value}),useCallback:fn=>fn,useEffect(){}};
 const code=ts.transpileModule(readFileSync(new URL('../components/mt5-copytrading-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,require:id=>id==='react'?react:require(id),navigator:{clipboard:{writeText}}});
 const root=exports.Mt5CopyTradingPanel({onActive(){}});
 function find(node,label){
  if(!node)return null;if(Array.isArray(node)){for(const child of node){const hit=find(child,label);if(hit)return hit;}return null;}
  if(node.type==='button'&&node.props.children===label)return node;
  return find(node.props?.children,label);
 }
 return {issued,notices,click(label){const button=find(root,label);assert.ok(button,`Missing ${label}`);button.props.onClick();}};
}
test('MT5 copy buttons put only the corresponding raw value on the clipboard',async()=>{
 const writes=[];const view=panel(async value=>{writes.push(value);});
 view.click('Copier AgentId');await new Promise(resolve=>setImmediate(resolve));
 view.click('Copier AgentKey');await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(writes,[view.issued.id,view.issued.token]);
 assert.equal(writes[0].length,36);assert.equal(writes[1].length,64);
 assert.match(view.notices[0],/AgentId copié/);assert.match(view.notices[1],/AgentKey copié/);
 assert.ok(!view.notices.join('').includes(view.issued.token));
});
test('clipboard rejection provides a manual copy instruction without exposing the key',async()=>{
 const view=panel(async()=>{throw new Error('Permission denied');});
 view.click('Copier AgentKey');await new Promise(resolve=>setImmediate(resolve));
 assert.match(view.notices[0],/Copie impossible/);
 assert.ok(!view.notices[0].includes(view.issued.token));
});
