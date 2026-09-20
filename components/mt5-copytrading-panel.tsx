"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { CopyTradingMonitor, type MonitorAccount } from "./copytrading-monitor";

type Account = MonitorAccount & { id:string;label:string;role:"master"|"slave";account:string;server:string;mode:string;online:boolean;enabled:boolean;equity:number;positionCount:number;managedCopies:number;queuedCopies?:number;copyIssues?:{source:string;symbol:string;message:string}[];error:string;pending:{id:string;symbol:string;volume:number}|null };
type Snapshot = {masterReplacementError?:string;enabled:boolean;limit:number;agents:Account[];logs:{at:number;agent:string;message:string}[];storage:{provider:"file"|"mysql";persistent:boolean;configured:boolean}};
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
 const [formOpen,setFormOpen]=useState(false);const [formError,setFormError]=useState("");
 const [replacingMasterId,setReplacingMasterId]=useState<string|null>(null);
 const [slavePage,setSlavePage]=useState(1);const [slavePageSize,setSlavePageSize]=useState(10);
 const actionQueue=useRef<Promise<unknown>>(Promise.resolve());const queued=useRef(0);
 const pollBusy=useRef(false);const version=useRef(0);
 const accept=useCallback((next:Snapshot)=>{setData(next);setSlavePage(page=>Math.min(page,Math.max(1,Math.ceil(next.agents.filter(a=>a.role==="slave").length/slavePageSize))));onActive(next.enabled);},[onActive,slavePageSize]);
 const refresh=useCallback(async()=>{
  if(!keyRef.current||pollBusy.current||queued.current)return;
  pollBusy.current=true;const epoch=version.current;
  try{const response=await fetch("/api/copytrading/admin",{headers:{"x-copy-admin-key":keyRef.current},cache:"no-store",signal:AbortSignal.timeout(10000)});const result=await response.json();
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
   }catch(e){const message=e instanceof Error?e.message:"Action non confirmée";setError(message);if(input.action==="register"||input.action==="replace_master"||input.action==="archive_deleted_slave"||input.action==="settings")setFormError(message);return false;}
   finally{queued.current--;version.current++;setBusy(queued.current>0);}
  });
  actionQueue.current=task;return task;
 }
 useEffect(()=>{const timer=setInterval(()=>void refresh(),3000);return()=>clearInterval(timer);},[refresh]);
 useEffect(()=>{const stop=()=>{if(keyRef.current)void mutate({action:"switch",enabled:false},true);else setError("Connectez le module avec la clé administrateur pour suspendre la copie.");};window.addEventListener("copytrading-emergency-stop",stop);return()=>window.removeEventListener("copytrading-emergency-stop",stop);});
 const master=data?.agents.find(a=>a.role==="master");const slaves=data?.agents.filter(a=>a.role==="slave")??[];
 const sortedSlaves=[...slaves].sort((a,b)=>Number(b.enabled)-Number(a.enabled)||Number(b.online)-Number(a.online));
 const slavePageCount=Math.max(1,Math.ceil(slaves.length/slavePageSize));
 const currentSlavePage=Math.min(slavePage,slavePageCount);
 const slavePageStart=(currentSlavePage-1)*slavePageSize;
 const visibleSlaves=sortedSlaves.slice(slavePageStart,slavePageStart+slavePageSize);
 return <section className="view-stack copy-live">
  <div className="view-heading"><div><p className="eyebrow">RÉPLICATION MT5</p><h2>1 master · jusqu’à 50 suiveurs</h2></div><span className={`connection-chip ${data?.enabled&&!error?"online":""}`}><i/>{error?"Connexion à vérifier":data?.enabled?"Nouvelles copies actives":"Nouvelles copies en pause"}</span></div>
  <section className="panel"><h3>Connexion administrateur</h3><p>La clé reste en mémoire dans cette page. Les mots de passe MT5 restent dans les terminaux.</p><form className="copy-admin-login" onSubmit={e=>{e.preventDefault();keyRef.current=adminKey;version.current++;setData(null);setSlavePage(1);void refresh();}}>
   <label>Clé administrateur<input aria-label="Clé administrateur copytrading" type="password" autoComplete="off" value={adminKey} onChange={e=>setAdminKey(e.target.value)} required/></label><button disabled={busy}>Connecter le module</button>
  </form><p role="alert">{error}</p><small>Serveur : configurer COPYTRADING_ADMIN_KEY (32 caractères minimum). <a href="/INSTALLATION-COPYTRADING-MT5.md" download>Guide d’installation</a> · <a href="/DerivCopyTradingEA.mq5" download>Télécharger l’EA master / suiveur</a></small></section>
  {data&&<>
   {data.storage.provider==="mysql"&&<div className="panel"><p>Stockage MySQL connecté. Les comptes et le suivi des commandes sont conservés dans la base.</p></div>}
   {!data.storage.persistent&&<div className="panel info-panel warning"><p>Stockage local non déclaré persistant. Sur Render Free, un redéploiement peut effacer les comptes et le suivi. Configurez le stockage persistant avant les comptes réels.</p></div>}
   <section className="panel"><div className="panel-head"><h3>Master : {master?.label??"à enregistrer"}</h3><b>{master?(master.online?"EN LIGNE":"HORS LIGNE"):"NON CONFIGURÉ"}</b></div>
    {master&&<p>{master.account} · {master.server} · {master.mode} · {master.positionCount} position(s)</p>}
    <p>Copie identique 1:1 : toutes les positions ouvertes du master, mêmes symboles, BUY/SELL, lots et SL/TP. Brokers et serveurs différents acceptés. Les positions présentes au démarrage et à la reconnexion sont incluses.</p>
    <div className="copy-actions">{master&&<button disabled={busy||!!issued} onClick={()=>{setReplacingMasterId(master.id);setForm({label:"Master réel",account:"",server:"",role:"master",mode:"real"});setFormError("");setFormOpen(true);}}>Changer de master</button>}{master&&<button disabled={busy||data.enabled||slaves.some(a=>a.managedCopies>0||a.pending)} onClick={()=>void mutate({action:"remove",id:master.id})}>Révoquer le master</button>}<button disabled={busy||!master?.online||data.enabled} onClick={()=>void mutate({action:"switch",enabled:true})}>Démarrer la copie</button><button disabled={busy||!data.enabled} onClick={()=>void mutate({action:"switch",enabled:false})}>Pause des nouvelles copies</button></div>
    <small>La pause bloque les nouvelles expositions. Les fermetures et réductions des copies existantes restent suivies. Une commande déjà exécutée n’est pas annulée. La copie continue lorsque vous quittez cette page.</small>
   </section>
   <CopyTradingMonitor master={master} slaves={slaves} disconnected={!!error}/>
   {issued&&<section className="panel copy-issued"><h3>Identifiants du terminal — affichés une seule fois</h3><p>Copiez chaque valeur séparément dans le champ du même nom dans MT5. Ne collez pas les deux identifiants dans un seul champ.</p><label>AgentId · 36 caractères<input readOnly value={issued.id} onFocus={e=>e.target.select()}/></label><button onClick={()=>void copyCredential("AgentId",issued.id)}>Copier AgentId</button><label>AgentKey · 64 caractères<input readOnly type="password" value={issued.token} onFocus={e=>e.target.select()}/></label><button onClick={()=>void copyCredential("AgentKey",issued.token)}>Copier AgentKey</button><p role="status">{copyNotice}</p><button onClick={()=>{setIssued(null);setCopyNotice("");}}>J’ai enregistré ces identifiants</button></section>}
   <Dialog.Root open={formOpen} onOpenChange={open=>{if(!busy)setFormOpen(open);}}>
    <div className="copy-register-bar"><div><h3>Terminaux MT5</h3><p>{master?"Master enregistré":"Master à enregistrer"} · {slaves.length}/50 suiveurs</p></div><Dialog.Trigger asChild><button disabled={busy||!!issued||(!!master&&slaves.length>=50)} onClick={()=>{setReplacingMasterId(null);setForm({...form,role:master?"slave":"master",server:master?.server??form.server,label:"",account:""});setFormError("");}}>Ajouter un terminal</button></Dialog.Trigger></div>
    <Dialog.Portal><Dialog.Overlay className="copy-modal-overlay"/><Dialog.Content className="copy-live copy-modal" onPointerDownOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{if(busy)e.preventDefault();}}>
     <div className="copy-modal-heading"><div><Dialog.Title>{replacingMasterId?"Changer de master":"Enregistrer un terminal"}</Dialog.Title><Dialog.Description>{replacingMasterId?"Renseignez le nouveau compte master. Les slaves et leurs identifiants sont conservés. La copie sera mise en pause jusqu’à la connexion du nouveau master.":"Ajoutez un compte MT5 et générez ses identifiants de connexion."}</Dialog.Description></div><Dialog.Close asChild><button disabled={busy} aria-label="Fermer le formulaire">✕</button></Dialog.Close></div>
     <p role="alert" className="copy-form-error">{formError}</p><form className="copy-registration" onSubmit={async e=>{e.preventDefault();setFormError("");
    const ok=await mutate({action:replacingMasterId?"replace_master":"register",...form,...(replacingMasterId?{id:replacingMasterId}:{})});if(ok){setReplacingMasterId(null);setFormOpen(false);setForm({...form,label:"",account:""});}
   }}>
    <><label>Nom<input required value={form.label} maxLength={60} onChange={e=>setForm({...form,label:e.target.value})}/></label><label>Rôle<select disabled={!!replacingMasterId} value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="master" disabled={!!master&&!replacingMasterId}>Master</option><option value="slave" disabled={slaves.length>=50}>Suiveur ({slaves.length}/50)</option></select></label><label>Login MT5<input required inputMode="numeric" pattern="[0-9]+" value={form.account} onChange={e=>setForm({...form,account:e.target.value})}/></label><label>Serveur MT5 exact<input required value={form.server} onChange={e=>setForm({...form,server:e.target.value})}/></label><label>Compte<select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}><option value="demo">Démo</option><option value="real">Réel</option></select></label></>
    <p className="copy-map copy-volume-help">Aucun réglage de lot, plafond, inversion ou correspondance de symboles. La copie accepte des brokers et serveurs différents et transmet les valeurs exactes du master. L’exécution reste soumise à l’acceptation du broker.</p>
    {replacingMasterId&&<p className="copy-map" role="status">{data.masterReplacementError||"Les identifiants de l’ancien master seront révoqués. Installez les nouveaux AgentId et AgentKey sur le terminal réel avec Role=MASTER, puis activez les slaves et démarrez la copie."}</p>}
    {replacingMasterId&&!!data.masterReplacementError&&slaves.some(a=>!a.online)&&<div className="copy-map copy-deleted-accounts"><p>Un compte a déjà été supprimé dans MT5 ? Retirez son ancien enregistrement du module. Ses identifiants seront révoqués et son historique archivé. Cette action ne ferme aucune position chez le broker.</p>{slaves.filter(a=>!a.online).map(a=><button type="button" key={a.id} disabled={busy} onClick={async()=>{setFormError("");await mutate({action:"archive_deleted_slave",id:a.id,account:a.account,server:a.server});}}>{`Compte supprimé : retirer ${a.label} du module`}</button>)}</div>}
    <button disabled={busy||!!(replacingMasterId&&data.masterReplacementError)}>{replacingMasterId?"Remplacer le master":"Créer les identifiants"}</button><button type="button" disabled={busy} onClick={()=>setFormOpen(false)}>Annuler</button>
   </form></Dialog.Content></Dialog.Portal></Dialog.Root>
   <section className="panel"><h3>Comptes suiveurs · {slaves.length}/50</h3><p>Comptes activés en premier, puis comptes en ligne.</p><div className="copy-live-table"><table><thead><tr><th>Compte</th><th>Connexion</th><th>Copie</th><th>Copies</th><th>État / commandes</th><th>Actions</th></tr></thead><tbody>{visibleSlaves.map(a=><tr key={a.id}><td><b>{a.label}</b><br/>{a.account} · {a.mode}<br/>{a.server}</td><td>{a.online?"En ligne":"Hors ligne"}</td><td>Identique 1:1</td><td>{a.positions?.filter(p=>p.copied).length??0} ouverte(s)<small className="copy-cell-note">{a.queuedCopies??0} en attente · {a.copyIssues?.length??0} bloquée(s)</small></td><td>{a.error|| (a.pending?`${a.pending.symbol} : cible ${a.pending.volume} lot(s)` : a.enabled?"Prêt":"En pause")}{!!a.copyIssues?.length&&<details className="copy-issues"><summary>Voir les refus par symbole</summary>{a.copyIssues.map(issue=><p key={issue.source}><b>{issue.symbol} · #{issue.source.split(":")[0]}</b><br/>{issue.message}</p>)}</details>}</td><td><div className="copy-account-actions"><button disabled={busy||(!a.enabled&&(!a.online||!!a.pending))} onClick={()=>void mutate({action:"enable",id:a.id,enabled:!a.enabled})}>{a.enabled?"Pause":"Activer"}</button><button disabled={busy||a.enabled||!!a.pending} onClick={()=>void mutate({action:"retry",id:a.id})}>Réessayer après vérification</button><button disabled={busy||a.managedCopies>0||!!a.pending} onClick={()=>void mutate({action:"remove",id:a.id})}>Révoquer</button></div></td></tr>)}</tbody></table></div>{slaves.length>0&&<nav className="copy-pagination" aria-label="Pagination des comptes suiveurs">
    <span aria-live="polite">{slavePageStart+1}–{Math.min(slavePageStart+slavePageSize,slaves.length)} sur {slaves.length} comptes</span>
    <label>Comptes par page<select value={slavePageSize} onChange={e=>{setSlavePageSize(Number(e.target.value));setSlavePage(1);}}>{[10,20,50].map(size=><option key={size} value={size}>{size}</option>)}</select></label>
    <div className="copy-pagination-controls"><button type="button" disabled={currentSlavePage===1} onClick={()=>setSlavePage(currentSlavePage-1)}>Précédent</button><span>Page {currentSlavePage} / {slavePageCount}</span><button type="button" disabled={currentSlavePage===slavePageCount} onClick={()=>setSlavePage(currentSlavePage+1)}>Suivant</button></div>
   </nav>}{!slaves.length&&<p>Enregistrez vos suiveurs puis connectez un EA sur chacun de leurs terminaux MT5.</p>}</section>
   <section className="panel"><h3>Journal des copies</h3><div className="copy-live-log">{data.logs.map((log,i)=><p key={`${log.at}-${i}`}><time>{new Date(log.at).toLocaleTimeString("fr-FR")}</time> <b>{data.agents.find(a=>a.id===log.agent)?.label??"Système"}</b> · {log.message}</p>)}</div></section>
  </>}
 </section>;
}
