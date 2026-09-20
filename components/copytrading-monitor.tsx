"use client";
import { useEffect, useState } from "react";
import type { AccountMetrics, Position } from "../lib/copytrading/engine";

export type MonitorAccount = {
 connectionError?:string;id:string;label:string;account:string;server:string;mode:string;online:boolean;
 lastSeen:number;equity:number;metrics:AccountMetrics|null;hasTraded:boolean;
 positions:(Position & {copied:boolean})[];
};
const amount=(value:number|null|undefined,currency?:string)=>value==null?"—":`${value.toLocaleString("fr-FR",{minimumFractionDigits:2,maximumFractionDigits:2})}${currency?` ${currency}`:""}`;
const price=(value:number|undefined)=>value==null?"—":value.toLocaleString("fr-FR",{maximumFractionDigits:10});
const tone=(value:number|null|undefined)=>value==null||value===0?"":value>0?"copy-profit":"copy-loss";
export const totalPnl=(metrics:AccountMetrics|null|undefined)=>metrics?.realizedDay==null?null:metrics.realizedDay+metrics.floatingPnl;

const hasTransmission=(account:MonitorAccount)=>account.lastSeen>0||!!account.metrics||(account.positions?.length??0)>0;

function Freshness({account,disconnected,now}:{account:MonitorAccount;disconnected:boolean;now:number}){
 const fresh=!disconnected&&account.online&&account.lastSeen>0&&now-account.lastSeen<15000;
 const seen=account.metrics?.receivedAt||account.lastSeen;
 return <span className={`copy-freshness ${fresh?"is-live":"is-stale"}`}><b>{fresh?"En direct":seen?"Données anciennes":"En attente"}</b><small>{seen?`Reçu le ${new Date(seen).toLocaleString("fr-FR")}`:"Aucune transmission MT5"}</small></span>;
}

export function CopyPositionTable({account}:{account:MonitorAccount}){
 const positions=account.positions??[];
 if(!positions.length)return <p className="copy-monitor-empty">{hasTransmission(account)?"Aucune position ouverte dans la dernière transmission.":"Les positions apparaîtront après la première transmission MT5."}</p>;
 return <div className="copy-live-table"><table><caption className="sr-only">Positions ouvertes de {account.label}</caption><thead><tr><th>Position / instrument</th><th>Sens</th><th>Lots</th><th>Prix d’entrée</th><th>Prix actuel</th><th>SL / TP</th><th>PnL flottant</th><th>Origine</th></tr></thead><tbody>{positions.map(p=>{
  const pnl=p.details?p.details.profit+p.details.swap:null;
  return <tr key={p.id}><td><b>{p.symbol}</b><small className="copy-cell-note">#{p.id}</small></td><td><span className={`copy-side ${p.side.toLowerCase()}`}>{p.side}</span></td><td>{p.volume}</td><td>{price(p.details?.openPrice)}</td><td>{price(p.details?.currentPrice)}</td><td>{p.sl?price(p.sl):"—"} / {p.tp?price(p.tp):"—"}</td><td className={tone(pnl)}>{amount(pnl,account.metrics?.currency)}</td><td>{p.copied?"Copie master":"Compte MT5"}</td></tr>;
 })}</tbody></table></div>;
}

export function CopyTradingMonitor({master,slaves,disconnected}:{master?:MonitorAccount;slaves:MonitorAccount[];disconnected:boolean}){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const active=slaves.filter(a=>a.hasTraded||(a.positions?.length??0)>0);
 const m=master?.metrics;
 const cards=[
  {label:"Balance",value:m?.balance,note:"Solde du compte"},
  {label:"Equity",value:master?.lastSeen||m?master?.equity:null,note:"Valeur actuelle du compte"},
  {label:"PnL flottant",value:m?.floatingPnl,note:"Positions ouvertes, swaps inclus",signed:true},
  {label:"Bénéfice net du jour",value:m?.realizedDay,note:m?`Réalisé · ${m.day} (serveur MT5)`:"Historique du serveur MT5",signed:true},
  {label:"PnL total",value:totalPnl(m),note:"Réalisé du jour + flottant",signed:true},
 ];
 return <>
  <section className="panel copy-monitor"><div className="panel-head"><div><p className="eyebrow">COMPTE MASTER</p><h3>Positions et performance</h3></div>{master&&<Freshness account={master} disconnected={disconnected} now={now}/>}</div>
   {master?<><p>{master.label} · {master.account} · {master.server} · {master.mode}</p>
    <div className="copy-metrics">{cards.map(c=><div key={c.label}><span>{c.label}</span><strong className={c.signed?tone(c.value):""}>{amount(c.value,m?.currency)}</strong><small>{c.note}</small></div>)}</div>
    {!m&&!hasTransmission(master)&&<p className="copy-monitor-waiting" role="status">En attente de la première transmission du master. Dans MT5, connectez ce compte et configurez l’EA avec Role=MASTER et les nouveaux AgentId et AgentKey. Vérifiez que le serveur enregistré correspond exactement au serveur indiqué dans MT5. La balance et le PnL apparaîtront automatiquement à réception des données.</p>}
    {!m&&hasTransmission(master)&&<p className="copy-monitor-notice">La dernière transmission MT5 ne contient pas les statistiques du compte. Vérifiez l’EA CopyTrading et son journal Experts ; la <a href="/DerivCopyTradingEA.mq5" download>version actuelle de l’EA</a> transmet la balance, la devise et le PnL. Les valeurs absentes restent indiquées par « — ».</p>}
    {m&&m.realizedDay===null&&<p className="copy-monitor-notice">Historique MT5 indisponible : le bénéfice réalisé et le PnL total ne sont pas encore calculables.</p>}
    <CopyPositionTable account={master}/>
   </>:<p className="copy-monitor-empty">Enregistrez et connectez le master pour suivre ses positions et sa performance.</p>}
  </section>
  <section className="panel copy-monitor"><div className="panel-head"><div><p className="eyebrow">COMPTES SUIVEURS</p><h3>Suiveurs ayant pris des positions</h3></div><span className="copy-monitor-count">{active.length} / {slaves.length}</span></div>
   <p>Comptes avec une position observée ou une transaction signalée par l’EA. Ils restent visibles après clôture.</p>
   {active.length?<div className="copy-live-table"><table><caption className="sr-only">Performance des comptes suiveurs</caption><thead><tr><th>Compte</th><th>Actualisation</th><th>Positions ouvertes</th><th>Balance</th><th>Equity</th><th>PnL flottant</th><th>Bénéfice net du jour</th><th>PnL total</th></tr></thead><tbody>{active.map(a=>{
    const metrics=a.metrics,positions=a.positions??[],total=totalPnl(metrics);
    return <tr key={a.id}><td><b>{a.label}</b><small className="copy-cell-note">{a.account} · {a.mode}<br/>{a.server}</small></td><td><Freshness account={a} disconnected={disconnected} now={now}/></td><td><details><summary>{positions.length} position(s) · {positions.filter(p=>p.copied).length} copie(s)</summary><div className="copy-position-detail"><CopyPositionTable account={a}/></div></details></td><td>{amount(metrics?.balance,metrics?.currency)}</td><td>{amount(a.lastSeen||metrics?a.equity:null,metrics?.currency)}</td><td className={tone(metrics?.floatingPnl)}>{amount(metrics?.floatingPnl,metrics?.currency)}</td><td className={tone(metrics?.realizedDay)}>{amount(metrics?.realizedDay,metrics?.currency)}<small className="copy-cell-note">{metrics?.day??(hasTransmission(a)?"Statistiques non transmises":"En attente de transmission")}</small></td><td className={tone(total)}>{amount(total,metrics?.currency)}</td></tr>;
   })}</tbody></table></div>:<p className="copy-monitor-empty">Aucune position de suiveur n’a encore été signalée.</p>}
   <p className="copy-monitor-footnote">Actualisation automatique de la page toutes les 3 s ; transmission MT5 toutes les 2 s par défaut. Les chiffres couvrent tout le compte, y compris les positions manuelles. Bénéfice net : profits, swaps et frais attachés aux transactions BUY/SELL du jour serveur, hors dépôts et retraits. PnL total = ce résultat réalisé + PnL des positions ouvertes. Aucune addition entre devises différentes.</p>
  </section>
 </>;
}
