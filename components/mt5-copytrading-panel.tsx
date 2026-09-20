"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Account = { id:string;label:string;role:"master"|"slave";account:string;server:string;mode:string;online:boolean;enabled:boolean;equity:number;positionCount:number;managedCopies:number;error:string;pending:{id:string;symbol:string;volume:number}|null;settings:{multiplier:number;maxLot:number;maxTotalLots:number;lossLimitPct:number;reverse:boolean;symbols:Record<string,string>} };
type Snapshot = {enabled:boolean;limit:number;agents:Account[];logs:{at:number;agent:string;message:string}[];storage:{provider:"file"|"mysql";persistent:boolean;configured:boolean}};
const defaults={multiplier:1,maxLot:1,maxTotalLots:5,lossLimitPct:10,reverse:false,symbols:{}};
export function Mt5CopyTradingPanel({onActive}:{onActive:(active:boolean)=>void}) {
 const [adminKey,setAdminKey]=useState("");const keyRef=useRef("");
 const [data,setData]=useState<Snapshot|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
 const [issued,setIssued]=useState<{id:string;token:string}|null>(null);
 const [copyNotice,setCopyNotice]=useState("");
 async function copyCredential(name:"AgentId"|"AgentKey",value:string){
  try{await navigator.clipboard.writeText(value);setCopyNotice(`${name} copié : collez-le dans le champ ${name} de MT5.`);}
  catch{setCopyNotice("Copie impossible : sélectionnez et copiez la valeur du champ correspondant.");}
 }
 const [form,setForm]=useState({label:"",account:"",server:"",role:"slave",mode:"demo"});
 const [settings,setSettings]=useState(defaults);const [symbols,setSymbols]=useState("{}");const [editing,setEditing]=useState<string|null>(null);
 const actionQueue=useRef<Promise<unknown>>(Promise.resolve());const queued=useRef(0);
 const [copyExisting,setCopyExisting]=useState(false);const pollBusy=useRef(false);const version=useRef(0);
 const accept=useCallback((next:Snapshot)=>{setData(next);onActive(next.enabled);},[onActive]);
 const refresh=useCallback(async()=>{
  if(!keyRef.current||pollBusy.current||queued.current)return;
  pollBusy.current=true;const epoch=version.current;
  try{const response=await fetch("/api/copytrading/admin",{headers:{"x-copy-admin-key":keyRef.current},cache:"no-store"});const result=await response.json();
   if(!response.ok)throw new Error(result.error||"Connexion refusée");if(epoch===version.current){accept(result);setError("");}
  }catch(e){if(epoch===version.current){setError(e instanceof Error?e.message:"Serveur indisponible");onActive(false);}}
  finally{pollBusy.current=false;}
 },[accept,onActive]);
 async function mutate(input:Record<string,unknown>, urgent=false):Promise<boolean>{
  if(queued.current&&!urgent)return false;
  queued.current++;setBusy(true);version.current++;
  const task=actionQueue.current.then(async()=>{
   try{const response=await fetch("/api/copytrading/admin",{method:"POST",headers:{"Content-Type":"application/json","x-copy-admin-key":keyRef.current},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok)throw new Error(result.error||"Action refusée");
    accept(result);setError("");if(result.result?.token){setIssued(result.result);setCopyNotice("");}return true;
   }catch(e){setError(e instanceof Error?e.message:"Action non confirmée");return false;}
   finally{queued.current--;version.current++;setBusy(queued.current>0);}
  });
  actionQueue.current=task;return task;
 }
 useEffect(()=>{const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer);},[refresh]);
 useEffect(()=>{const stop=()=>{if(keyRef.current)void mutate({action:"switch",enabled:false},true);else setError("Connectez le module avec la clé administrateur pour suspendre la copie.");};window.addEventListener("copytrading-emergency-stop",stop);return()=>window.removeEventListener("copytrading-emergency-stop",stop);});
 const master=data?.agents.find(a=>a.role==="master");const slaves=data?.agents.filter(a=>a.role==="slave")??[];
 return <section className="view-stack copy-live">
  <div className="view-heading"><div><p className="eyebrow">RÉPLICATION MT5</p><h2>1 master · jusqu’à 50 suiveurs</h2></div><span className={`connection-chip ${data?.enabled&&!error?"online":""}`}><i/>{error?"Connexion à vérifier":data?.enabled?"Nouvelles copies actives":"Nouvelles copies en pause"}</span></div>
  <section className="panel"><h3>Connexion administrateur</h3><p>La clé reste en mémoire dans cette page. Les mots de passe MT5 restent dans les terminaux.</p><form className="copy-admin-login" onSubmit={e=>{e.preventDefault();keyRef.current=adminKey;version.current++;setData(null);void refresh();}}>
   <label>Clé administrateur<input aria-label="Clé administrateur copytrading" type="password" autoComplete="off" value={adminKey} onChange={e=>setAdminKey(e.target.value)} required/></label><button disabled={busy}>Connecter le module</button>
  </form><p role="alert">{error}</p><small>Serveur : configurer COPYTRADING_ADMIN_KEY (32 caractères minimum). <a href="/INSTALLATION-COPYTRADING-MT5.md" download>Guide d’installation</a> · <a href="/DerivCopyTradingEA.mq5" download>Télécharger l’EA master / suiveur</a></small></section>
  {data&&<>
   {data.storage.provider==="mysql"&&<div className="panel"><p>Stockage MySQL connecté. Les comptes et le suivi des commandes sont conservés dans la base.</p></div>}
   {!data.storage.persistent&&<div className="panel info-panel warning"><p>Stockage local non déclaré persistant. Sur Render Free, un redéploiement peut effacer les comptes et le suivi. Configurez le stockage persistant avant les comptes réels.</p></div>}
   <section className="panel"><div className="panel-head"><h3>Master : {master?.label??"à enregistrer"}</h3><b>{master?(master.online?"EN LIGNE":"HORS LIGNE"):"NON CONFIGURÉ"}</b></div>
    {master&&<p>{master.account} · {master.server} · {master.mode} · {master.positionCount} position(s)</p>}
    <label className="copy-check"><input type="checkbox" disabled={busy||data.enabled} checked={copyExisting} onChange={e=>setCopyExisting(e.target.checked)}/>Copier aussi les positions déjà ouvertes lors du démarrage</label>
    <div className="copy-actions">{master&&<button disabled={busy||data.enabled||slaves.some(a=>a.managedCopies>0||a.pending)} onClick={()=>void mutate({action:"remove",id:master.id})}>Révoquer le master</button>}<button disabled={busy||!master?.online||data.enabled} onClick={()=>void mutate({action:"switch",enabled:true,copyExisting})}>Démarrer la copie</button><button disabled={busy||!data.enabled} onClick={()=>void mutate({action:"switch",enabled:false})}>Pause des nouvelles copies</button></div>
    <small>La pause bloque les nouvelles expositions. Les fermetures et réductions des copies existantes restent suivies. Une commande déjà exécutée n’est pas annulée. La copie continue lorsque vous quittez cette page.</small>
   </section>
   {issued&&<section className="panel copy-issued"><h3>Identifiants du terminal — affichés une seule fois</h3><p>Copiez chaque valeur séparément dans le champ du même nom dans MT5. Ne collez pas les deux identifiants dans un seul champ.</p><label>AgentId · 36 caractères<input readOnly value={issued.id} onFocus={e=>e.target.select()}/></label><button onClick={()=>void copyCredential("AgentId",issued.id)}>Copier AgentId</button><label>AgentKey · 64 caractères<input readOnly type="password" value={issued.token} onFocus={e=>e.target.select()}/></label><button onClick={()=>void copyCredential("AgentKey",issued.token)}>Copier AgentKey</button><p role="status">{copyNotice}</p><button onClick={()=>{setIssued(null);setCopyNotice("");}}>J’ai enregistré ces identifiants</button></section>}
   <section className="panel"><h3>{editing?"Paramètres du suiveur":"Enregistrer un terminal"}</h3><form className="copy-registration" onSubmit={async e=>{e.preventDefault();let mapping;try{mapping=JSON.parse(symbols);}catch{setError("Le mapping de symboles doit être un objet JSON.");return;}
    const ok=await mutate(editing?{action:"settings",id:editing,settings:{...settings,symbols:mapping}}:{action:"register",...form,settings:{...settings,symbols:mapping}});if(ok){setEditing(null);setForm({...form,label:"",account:""});setSettings(defaults);setSymbols("{}");}
   }}>
    {!editing&&<><label>Nom<input required value={form.label} maxLength={60} onChange={e=>setForm({...form,label:e.target.value})}/></label><label>Rôle<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="master" disabled={!!master}>Master</option><option value="slave" disabled={slaves.length>=50}>Suiveur ({slaves.length}/50)</option></select></label><label>Login MT5<input required inputMode="numeric" pattern="[0-9]+" value={form.account} onChange={e=>setForm({...form,account:e.target.value})}/></label><label>Serveur MT5 exact<input required value={form.server} onChange={e=>setForm({...form,server:e.target.value})}/></label><label>Compte<select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}><option value="demo">Démo</option><option value="real">Réel</option></select></label></>}
    {(editing||form.role==="slave")&&<><label>Multiplicateur de lots<input type="number" min="0.01" max="100" step="0.01" value={settings.multiplier} onChange={e=>setSettings({...settings,multiplier:Number(e.target.value)})}/></label><label>Maximum par copie (lots)<input type="number" min="0.001" max="1000" step="0.001" value={settings.maxLot} onChange={e=>setSettings({...settings,maxLot:Number(e.target.value)})}/></label><label>Maximum total du compte (lots)<input type="number" min="0.001" max="10000" step="0.001" value={settings.maxTotalLots} onChange={e=>setSettings({...settings,maxTotalLots:Number(e.target.value)})}/></label><label>Perte max session (% equity)<input type="number" min="0.1" max="100" step="0.1" value={settings.lossLimitPct} onChange={e=>setSettings({...settings,lossLimitPct:Number(e.target.value)})}/></label><label className="copy-check"><input type="checkbox" checked={settings.reverse} onChange={e=>setSettings({...settings,reverse:e.target.checked})}/>Inverser BUY / SELL</label><label className="copy-map">Correspondance de symboles (JSON)<textarea aria-label="Correspondance des symboles" value={symbols} onChange={e=>setSymbols(e.target.value)}/><small>Exemple : {'{"EURUSD":"EURUSD.a"}'}. Utiliser uniquement des instruments équivalents.</small></label></>}
    <button disabled={busy}>{editing?"Enregistrer les paramètres":"Créer les identifiants"}</button>{editing&&<button type="button" onClick={()=>setEditing(null)}>Annuler</button>}
   </form></section>
   <section className="panel"><h3>Comptes suiveurs · {slaves.length}/50</h3><div className="copy-live-table"><table><thead><tr><th>Compte</th><th>Connexion</th><th>Lots × / max</th><th>Copies</th><th>État / commandes</th><th>Actions</th></tr></thead><tbody>{slaves.map(a=><tr key={a.id}><td><b>{a.label}</b><br/>{a.account} · {a.mode}<br/>{a.server}</td><td>{a.online?"En ligne":"Hors ligne"}</td><td>{a.settings.multiplier} / {a.settings.maxLot}</td><td>{a.managedCopies}</td><td>{a.error|| (a.pending?`${a.pending.symbol} : cible ${a.pending.volume} lot(s)` : a.enabled?"Prêt":"En pause")}</td><td><div className="copy-account-actions"><button disabled={busy||(!a.enabled&&(!a.online||!!a.pending))} onClick={()=>void mutate({action:"enable",id:a.id,enabled:!a.enabled})}>{a.enabled?"Pause":"Activer"}</button><button disabled={busy||a.enabled||!!a.pending} onClick={()=>{setEditing(a.id);setSettings(a.settings);setSymbols(JSON.stringify(a.settings.symbols,null,2));}}>Paramètres</button><button disabled={busy||a.enabled||!!a.pending} onClick={()=>void mutate({action:"retry",id:a.id})}>Réessayer après vérification</button><button disabled={busy||a.managedCopies>0||!!a.pending} onClick={()=>void mutate({action:"remove",id:a.id})}>Révoquer</button></div></td></tr>)}</tbody></table></div>{!slaves.length&&<p>Enregistrez vos suiveurs puis connectez un EA sur chacun de leurs terminaux MT5.</p>}</section>
   <section className="panel"><h3>Journal des copies</h3><div className="copy-live-log">{data.logs.map((log,i)=><p key={`${log.at}-${i}`}><time>{new Date(log.at).toLocaleTimeString("fr-FR")}</time> <b>{data.agents.find(a=>a.id===log.agent)?.label??"Système"}</b> · {log.message}</p>)}</div></section>
  </>}
 </section>;
}
