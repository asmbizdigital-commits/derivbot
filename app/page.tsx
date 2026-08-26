"use client";

import { useMemo, useState } from "react";
import { Activity, BarChart3, Bot, BrainCircuit, ChevronDown, Download, Gauge, LayoutDashboard, Menu, Octagon, Radio, Settings2, ShieldCheck, Signal, Sparkles, Target, WalletCards, X, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

const pricePaths = {
  "Volatility 25": "M0 102 C20 97 26 70 48 76 S78 98 95 70 S130 40 152 54 S184 97 204 72 S237 29 258 39 S287 74 308 54 S337 23 360 12",
  "Volatility 100": "M0 89 C20 72 36 108 54 85 S82 39 101 65 S128 111 147 80 S180 28 199 48 S225 92 244 64 S270 16 291 38 S329 83 360 30",
};
const prices = {
  "Volatility 25": { value: "2,458.37", change: "+1.24%", score: 82, bias: "HAUSSIER", setup: "Sweep + BOS + FVG" },
  "Volatility 100": { value: "1,927.84", change: "+0.71%", score: 68, bias: "NEUTRE", setup: "En attente de CHOCH" },
};

function MiniChart({ name }: { name: keyof typeof pricePaths }) {
  const id = `fill-${name.replaceAll(" ", "")}`;
  return <svg viewBox="0 0 360 120" className="chart" role="img" aria-label={`Courbe ${name}`}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b8f34a" stopOpacity=".28"/><stop offset="100%" stopColor="#b8f34a" stopOpacity="0"/></linearGradient></defs>
    <path d={`${pricePaths[name]} L360 120 L0 120 Z`} fill={`url(#${id})`}/><path d={pricePaths[name]} fill="none" stroke="#b8f34a" strokeWidth="3" strokeLinecap="round"/><circle cx="360" cy={name === "Volatility 25" ? 12 : 30} r="4" fill="#b8f34a"/>
  </svg>;
}

export default function Home() {
  const [symbol, setSymbol] = useState<keyof typeof prices>("Volatility 25");
  const [autoTrade, setAutoTrade] = useState(true);
  const [stopped, setStopped] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const market = prices[symbol];
  const status = useMemo(() => stopped ? "ARRÊTÉ" : autoTrade ? "ANALYSE ACTIVE" : "SURVEILLANCE", [stopped, autoTrade]);

  return <main className="app-shell"><div className="noise"/>
    <aside className={`sidebar ${sidebar ? "sidebar-open" : ""}`}>
      <div className="brand"><span className="brand-mark"><Zap size={18}/></span><span>NEURAL<span>TRADE</span></span></div>
      <button className="close-mobile" onClick={() => setSidebar(false)} aria-label="Fermer le menu"><X/></button>
      <nav><p>ESPACE DE TRAVAIL</p><a className="active"><LayoutDashboard/> Vue d&apos;ensemble</a><a><Activity/> Marchés <span className="nav-badge">2</span></a><a><Target/> Positions</a><a><BarChart3/> Performance</a><p>SYSTÈME</p><a><BrainCircuit/> Modèle IA</a><a><ShieldCheck/> Gestion du risque</a><a><Settings2/> Configuration</a></nav>
      <div className="account-card"><div className="account-row"><span className="pulse-dot"/><span><b>Deriv MT5</b><small>Compte démo requis</small></span></div><div className="account-meta"><span>API<b className="green">Prête</b></span><span>EA<b>Hors ligne</b></span></div></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><button className="menu-mobile" onClick={() => setSidebar(true)} aria-label="Ouvrir le menu"><Menu/></button><div><p className="eyebrow">CENTRE DE COMMANDE</p><h1>Bonjour, Trader</h1></div><div className="top-actions"><div className={`system-pill ${stopped ? "danger" : ""}`}><span/><b>{status}</b></div><Button className="emergency" onClick={() => setStopped(!stopped)}><Octagon/> {stopped ? "Réactiver" : "Arrêt d'urgence"}</Button><div className="avatar">PK</div></div></header>
      <div className="content">
        <section className="capital-band"><div className="capital-main"><p>CAPITAL DE RÉFÉRENCE</p><h2>$100<span>.00</span></h2><small><span>●</span> Configuration MVP</small></div><div className="capital-metric"><WalletCards/><span>Solde MT5<b>Non connecté</b></span></div><div className="capital-metric"><Gauge/><span>Perte max / trade<b className="red">-$10.00</b></span></div><div className="risk-warning"><ShieldCheck/><span><b>Risque élevé : 10%</b><small>Mode démo imposé avant activation réelle</small></span></div></section>
        <div className="grid-main">
          <section className="panel market-panel"><div className="panel-head"><div><p className="eyebrow">ANALYSE DE MARCHÉ</p><h3>{symbol}</h3></div><div className="symbol-tabs">{(Object.keys(prices) as (keyof typeof prices)[]).map(s => <button key={s} onClick={() => setSymbol(s)} className={symbol === s ? "selected" : ""}>{s.replace("Volatility ", "V")}</button>)}</div></div><div className="price-row"><div><b>{market.value}</b><span>{market.change}</span></div><small>TIMEFRAME <b>H1 · M15 · M5</b></small></div><MiniChart name={symbol}/><div className="smc-row"><div><span>BIAIS HTF</span><b className={market.bias === "HAUSSIER" ? "green" : "muted"}>{market.bias}</b></div><div><span>STRUCTURE</span><b>BOS CONFIRMÉ</b></div><div><span>SETUP</span><b>{market.setup}</b></div></div></section>
          <section className="panel ai-panel"><div className="panel-head"><div><p className="eyebrow">MOTEUR HYBRIDE</p><h3>Score IA + SMC</h3></div><Sparkles className="lime"/></div><div className="score-ring" style={{"--score":`${market.score*3.6}deg`} as React.CSSProperties}><div><b>{market.score}</b><span>/100</span></div></div><div className="decision"><span>DÉCISION ACTUELLE</span><b>{market.score >= 75 ? "SETUP VALIDÉ" : "ATTENDRE"}</b><small>Seuil d&apos;exécution : 75/100</small></div><div className="factor"><span>Règles SMC</span><i><em style={{width:"86%"}}/></i><b>86%</b></div><div className="factor"><span>Confiance ML</span><i><em style={{width:`${market.score}%`}}/></i><b>{market.score}%</b></div></section>
        </div>
        <div className="grid-bottom"><section className="panel engine-panel"><div className="panel-head"><div><p className="eyebrow">AUTOMATISATION</p><h3>Moteur de trading</h3></div><Switch checked={autoTrade&&!stopped} disabled={stopped} onCheckedChange={setAutoTrade} aria-label="Activer le trading automatique"/></div><div className="engine-status"><Bot/><span><b>{stopped ? "Moteur arrêté" : autoTrade ? "Autonomie complète" : "Mode observation"}</b><small>{stopped ? "Aucun ordre ne peut être exécuté" : "Analyse continue 24h/24"}</small></span><span className="live"><Radio/> LIVE</span></div><div className="engine-grid"><span>Univers<b>V25 · V100</b></span><span>Risque / trade<b className="red">$10 max</b></span><span>Positions max<b>1 / indice</b></span><span>Compte<b>Démo</b></span></div></section>
          <section className="panel positions-panel"><div className="panel-head"><div><p className="eyebrow">EXÉCUTION</p><h3>Positions actives</h3></div><button className="text-button">Voir l&apos;historique <ChevronDown/></button></div><div className="empty-state"><div><Signal/><span/></div><b>Aucune position ouverte</b><small>Le moteur attend un signal ≥ 75/100 et une connexion EA active.</small></div></section></div>
        <section className="download-band"><div><span className="download-icon"><Download/></span><span><b>Agent MT5 v0.30 disponible</b><small>EA MQL5 + guide d’installation · Compte démo uniquement</small></span></div><div><a href="/INSTALLATION-MT5.txt" download>Guide</a><a className="primary-download" href="/DerivAITraderEA.mq5" download><Download/> Télécharger l’EA</a></div></section>
        <footer><span><span className="pulse-dot"/> API sécurisée prête · EA v0.30 disponible</span><span>Moteur SMC/Risk v0.3 · Exécution réelle verrouillée</span></footer>
      </div>
    </section>
  </main>;
}
