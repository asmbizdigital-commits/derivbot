import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url);
// Render the actual panel with an issued identity, then exercise its clipboard buttons.
function panel(writeText,options={}){
 const issued={id:'12345678-1234-1234-1234-123456789abc',token:'ab'.repeat(32)};
 const data=options.data??{enabled:false,limit:50,agents:[],logs:[],storage:{provider:'mysql',persistent:true,configured:true}};
 const state=['',data,'',false,options.data?null:issued,''];let index=0;const notices=[];
 const react={useState(initial){const slot=index++;if(slot>=state.length)state[slot]=initial;return [state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;if(slot===5)notices.push(value);}];},useRef:value=>({current:value}),useCallback:fn=>fn,useEffect(){}};
 const code=ts.transpileModule(readFileSync(new URL('../components/mt5-copytrading-panel.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};vm.runInNewContext(code,{exports,require:id=>id==='react'?react:id==='./copytrading-monitor'?{CopyTradingMonitor:()=>null}:require(id),navigator:{clipboard:{writeText}},fetch:options.fetch,AbortSignal});
 let root;function render(){index=0;root=exports.Mt5CopyTradingPanel({onActive(){}});}render();
 function find(node,label){
  if(!node)return null;if(Array.isArray(node)){for(const child of node){const hit=find(child,label);if(hit)return hit;}return null;}
  if(node.type==='button'&&node.props.children===label)return node;
  return find(node.props?.children,label);
 }
 function nodes(node){if(!node)return [];if(Array.isArray(node))return node.flatMap(n=>nodes(n));return [node,...nodes(node.props?.children)];}
 return {issued,notices,render,button:label=>find(root,label),nodes:()=>nodes(root),click(label){const button=find(root,label);assert.ok(button,`Missing ${label}`);button.props.onClick();}};
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

const masterSnapshot={enabled:true,limit:50,agents:[{id:'old-master',label:'Demo source',role:'master',account:'1',server:'Demo Server',mode:'demo',online:true,positionCount:0}],logs:[],storage:{provider:'mysql',persistent:true,configured:true},masterReplacementError:''};
test('change-master form defaults to real, keeps the master role and submits a replacement',async()=>{
 const requests=[];const view=panel(async()=>{}, {data:masterSnapshot,fetch:async(url,input)=>{requests.push(JSON.parse(input.body));return {ok:true,json:async()=>({...masterSnapshot,enabled:false,result:{id:'new-master',token:'a'.repeat(64)}})};}});
 view.click('Changer de master');view.render();
 const role=view.nodes().find(n=>n.type==='select'&&n.props.value==='master');assert.ok(role);assert.equal(role.props.disabled,true);
 assert.ok(view.nodes().some(n=>n.type==='select'&&n.props.value==='real'));
 for(const [label,value] of [['Login MT5','987654'],['Serveur MT5 exact','Live Server']]){
  const node=view.nodes().find(n=>n.type==='label'&&n.props.children[0]===label);
  node.props.children[1].props.onChange({target:{value}});view.render();
 }
 assert.equal(view.button('Remplacer le master').props.disabled,false);
 await view.nodes().find(n=>n.type==='form'&&n.props.className==='copy-registration').props.onSubmit({preventDefault(){}});view.render();
 assert.deepEqual(requests,[{action:'replace_master',label:'Master réel',account:'987654',server:'Live Server',role:'master',mode:'real',id:'old-master'}]);
 assert.ok(view.button('Copier AgentId'));assert.ok(view.button('Copier AgentKey'));
});
test('change-master form explains pending copies and prevents submitting while unresolved',()=>{
 const message='Clôturez les copies de l’ancien master sur Slave, puis attendez leur synchronisation.';
 const view=panel(async()=>{}, {data:{...masterSnapshot,masterReplacementError:message}});
 view.click('Changer de master');view.render();assert.equal(view.button('Remplacer le master').props.disabled,true);
 assert.ok(view.nodes().some(n=>n.props?.role==='status'&&n.props.children===message));
});
test('replacement API failures stay in the form without losing the real account selection',async()=>{
 const view=panel(async()=>{}, {data:masterSnapshot,fetch:async()=>({ok:false,json:async()=>({error:'Compte déjà enregistré'})})});
 view.click('Changer de master');view.render();await view.nodes().find(n=>n.type==='form'&&n.props.className==='copy-registration').props.onSubmit({preventDefault(){}});view.render();
 assert.ok(view.nodes().some(n=>n.props?.className==='copy-form-error'&&n.props.children==='Compte déjà enregistré'));
 assert.ok(view.nodes().some(n=>n.type==='select'&&n.props.value==='real'));assert.ok(view.button('Remplacer le master'));
});

const follower=(i,extra={})=>({id:'slave-'+i,label:'Compte '+i,role:'slave',account:String(i+100),server:'Demo',mode:'demo',enabled:false,online:true,positions:[],managedCopies:0,pending:null,error:'',...extra});
const followerRows=view=>Array.from(view.nodes().find(n=>n.type==='tbody').props.children);
test('follower pagination sorts the complete list by active status before slicing and preserves stable ties',()=>{
 const followers=Array.from({length:23},(_,i)=>follower(i));followers[1].online=false;followers[21].enabled=true;followers[21].online=false;followers[22].enabled=true;
 const original=followers.map(a=>a.id),view=panel(async()=>{}, {data:{...masterSnapshot,agents:[...masterSnapshot.agents,...followers]}});
 assert.deepEqual(followerRows(view).slice(0,4).map(row=>row.key),['slave-22','slave-21','slave-0','slave-2']);
 assert.equal(followerRows(view).length,10);assert.equal(view.button('Précédent').props.disabled,true);
 const seen=followerRows(view).map(row=>row.key);
 view.click('Suivant');view.render();seen.push(...followerRows(view).map(row=>row.key));assert.equal(followerRows(view).length,10);
 view.click('Suivant');view.render();seen.push(...followerRows(view).map(row=>row.key));assert.equal(followerRows(view).length,3);assert.equal(view.button('Suivant').props.disabled,true);
 assert.equal(new Set(seen).size,23);assert.deepEqual(followers.map(a=>a.id),original);
 const size=view.nodes().find(n=>n.type==='select'&&n.props.value===10);size.props.onChange({target:{value:'20'}});view.render();
 assert.equal(followerRows(view).length,20);assert.equal(followerRows(view)[0].key,'slave-22');assert.equal(view.button('Précédent').props.disabled,true);
});
test('deleting the last follower on a page returns to the last valid page and keeps actions bound to the visible account',async()=>{
 const followers=Array.from({length:21},(_,i)=>follower(i)),requests=[];
 const view=panel(async()=>{}, {data:{...masterSnapshot,agents:followers},fetch:async(url,input)=>{requests.push(JSON.parse(input.body));return {ok:true,json:async()=>({...masterSnapshot,agents:followers.slice(0,20)})};}});
 view.click('Suivant');view.render();view.click('Suivant');view.render();assert.equal(followerRows(view)[0].key,'slave-20');
 view.click('Révoquer');await new Promise(resolve=>setImmediate(resolve));view.render();
 assert.deepEqual(requests,[{action:'remove',id:'slave-20'}]);assert.equal(followerRows(view).length,10);assert.equal(followerRows(view)[0].key,'slave-10');assert.equal(view.button('Suivant').props.disabled,true);
 view.click('Précédent');view.render();assert.equal(followerRows(view)[0].key,'slave-0');
});
test('activating a follower automatically moves it ahead of paused accounts on refresh',async()=>{
 const followers=[follower(0,{online:false}),follower(1),follower(2)],requests=[];
 const view=panel(async()=>{}, {data:{...masterSnapshot,agents:followers},fetch:async(url,input)=>{requests.push(JSON.parse(input.body));return {ok:true,json:async()=>({...masterSnapshot,agents:followers.map(a=>({...a,enabled:a.id==='slave-2'}))})};}});
 assert.deepEqual(followerRows(view).map(row=>row.key),['slave-1','slave-2','slave-0']);
 const row=followerRows(view)[1];row.props.children.at(-1).props.children.props.children[0].props.onClick();
 await new Promise(resolve=>setImmediate(resolve));view.render();assert.equal(followerRows(view)[0].key,'slave-2');assert.deepEqual(requests,[{action:'enable',id:'slave-2',enabled:true}]);
});
test('an empty follower table keeps its empty state without misleading pagination',()=>{
 const view=panel(async()=>{}, {data:masterSnapshot});assert.equal(followerRows(view).length,0);assert.equal(view.button('Suivant'),null);
});
