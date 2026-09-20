import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export type Position = { id: string; symbol: string; side: "BUY" | "SELL"; volume: number; sl: number; tp: number; magic: number };
export type Settings = { multiplier: number; maxLot: number; maxTotalLots: number; lossLimitPct: number; reverse: boolean; symbols: Record<string, string> };
export type Command = { fromVolume: number; id: string; magic: number; symbol: string; side: "BUY" | "SELL"; volume: number; sl: number; tp: number; expiresAt: number; issuedAt: number; account: string; server: string; mode: "demo" | "real"; maxTotalLots: number; lossFloor: number };
export type Agent = { id: string; label: string; role: "master" | "slave"; account: string; server: string; mode: "demo" | "real"; tokenHash: string; enabled: boolean; settings: Settings; lastSeen: number; session: string; seq: number; equity: number; sessionEquity: number; positions: Position[]; pending: Command | null; lastAck: string; error: string };
type Binding = { slave: string; source: string; magic: number; symbol: string; side: "BUY" | "SELL"; multiplier: number; volume: number; sl: number; tp: number; blocked: boolean; closed: boolean; appliedVolume?: number; opened?: boolean; appliedSl?: number; appliedTp?: number; observedSl?: number; observedTp?: number };
export type CopyState = { version: 1; enabled: boolean; agents: Agent[]; bindings: Binding[]; baseline: Position[] | null; logs: { at: number; agent: string; message: string }[] };
export const freshCopyState = (): CopyState => ({ version: 1, enabled: false, agents: [], bindings: [], baseline: null, logs: [] });
const defaults: Settings = { multiplier: 1, maxLot: 1, maxTotalLots: 5, lossLimitPct: 10, reverse: false, symbols: {} };
const key = (p: Position) => `${p.id}:${p.side}`;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export function secretEqual(a: string, b: string) { const aa = Buffer.from(hash(a)), bb = Buffer.from(hash(b)); return timingSafeEqual(aa, bb); }
function number(value: unknown, min: number, max: number, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} invalide`);
  return value;
}
function str(value: unknown, name: string, max = 100) { if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${name} invalide`); return value.trim(); }
export function parseSettings(input: unknown): Settings {
  const d = { ...defaults, ...(input && typeof input === "object" ? input : {}) } as Settings;
  if (typeof d.reverse !== "boolean" || !d.symbols || Array.isArray(d.symbols) || typeof d.symbols !== "object" || Object.keys(d.symbols).length > 100) throw new Error("Paramètres invalides");
  const symbols: Record<string, string> = Object.create(null);
  for (const [a,b] of Object.entries(d.symbols)) symbols[str(a,"Symbole",80)] = str(b,"Symbole cible",80);
  return { multiplier: number(d.multiplier,.01,100,"Multiplicateur"), maxLot: number(d.maxLot,.001,1000,"Lot maximum"), maxTotalLots: number(d.maxTotalLots,.001,10000,"Total lots"), lossLimitPct: number(d.lossLimitPct,.1,100,"Perte session"), reverse:d.reverse,symbols };
}
export function parsePositions(input: unknown): Position[] {
  if (!Array.isArray(input) || input.length > 300) throw new Error("Snapshot complet requis (300 positions maximum)");
  const ids = new Set<string>();
  return input.map((p) => {
    if (!p || typeof p !== "object") throw new Error("Position invalide");
    const id = str(p.id,"Identifiant position",30);
    if (!/^\d+$/.test(id) || ids.has(id) || (p.side !== "BUY" && p.side !== "SELL")) throw new Error("Position dupliquée ou invalide");
    ids.add(id);
    const magic = number(p.magic,0,Number.MAX_SAFE_INTEGER,"Magic");
    if (!Number.isSafeInteger(magic)) throw new Error("Magic invalide");
    return { id,symbol:str(p.symbol,"Symbole",80),side:p.side,volume:number(p.volume,.00000001,100000,"Volume"),sl:number(p.sl,0,1e15,"SL"),tp:number(p.tp,0,1e15,"TP"),magic };
  });
}

/** Mutations are synchronous; the storage adapter commits before any command is returned. */
export class CopyEngine {
  constructor(public state: CopyState = freshCopyState(), private now: () => number = Date.now) {}
  log(agent: string, message: string) { this.state.logs.unshift({at:this.now(),agent,message});this.state.logs.length=Math.min(this.state.logs.length,1000); }
  online(a: Pick<Agent,"lastSeen">) { return a.lastSeen > 0 && this.now()-a.lastSeen < 15000; }
  authenticate(id: string, token: string) {
    const a=this.state.agents.find(a=>a.id===id);
    if (!a || !secretEqual(a.tokenHash,hash(token))) throw new Error("Terminal non authentifié");
    return a;
  }
  register(input: Record<string, unknown>) {
    if (input.role!=="master" && input.role!=="slave") throw new Error("Rôle invalide");
    if (input.role==="master" && this.state.agents.some(a=>a.role==="master")) throw new Error("Un seul master autorisé");
    if (input.role==="slave" && this.state.agents.filter(a=>a.role==="slave").length>=50) throw new Error("Maximum 50 suiveurs");
    if (input.mode!=="demo" && input.mode!=="real") throw new Error("Mode requis");
    const account=str(input.account,"Login MT5",30), server=str(input.server,"Serveur MT5");
    if (!/^\d+$/.test(account) || this.state.agents.some(a=>a.account===account&&a.server===server)) throw new Error("Compte invalide ou déjà enregistré");
    const token=randomBytes(32).toString("hex");
    const agent:Agent={id:randomUUID(),label:str(input.label,"Nom",60),role:input.role,account,server,mode:input.mode,tokenHash:hash(token),enabled:false,settings:parseSettings(input.settings),lastSeen:0,session:"",seq:0,equity:0,sessionEquity:0,positions:[],pending:null,lastAck:"",error:""};
    this.state.agents.push(agent);this.log(agent.id,"Terminal enregistré, copie en pause");return {id:agent.id,token};
  }
  admin(input: Record<string, unknown>) {
    if (input.action==="register") return this.register(input);
    if (input.action==="switch") {
      if (typeof input.enabled!=="boolean") throw new Error("État invalide");
      if (input.enabled) {
        const master=this.state.agents.find(a=>a.role==="master");
        if (!master || !this.online(master) || this.state.baseline===null) throw new Error("Connectez le master avant le démarrage");
        if (this.state.enabled) return {};
        this.state.enabled=true;
        if (input.copyExisting===true) for(const a of this.state.agents.filter(a=>a.role==="slave"&&a.enabled&&this.online(a))) for(const p of master.positions) this.bind(a,p);
      } else { this.state.enabled=false; for(const a of this.state.agents) if(a.pending?.expiresAt) a.pending.expiresAt=this.now()-1; }
      this.log("system",this.state.enabled?"Copie démarrée":"Pause des nouvelles expositions ; suivi des copies existantes conservé");return {};
    }
    const a=this.state.agents.find(a=>a.id===input.id);
    if (!a) throw new Error("Terminal inconnu");
    if (input.action==="settings") {
      if (a.enabled || a.pending) throw new Error("Mettre le suiveur en pause et attendre la commande en cours");
      a.settings=parseSettings(input.settings);this.log(a.id,"Paramètres mis à jour (nouvelles copies)");return {};
    }
    if (input.action==="enable") {
      if (a.role!=="slave" || typeof input.enabled!=="boolean") throw new Error("Suiveur requis");
      if (input.enabled && (!this.online(a)||a.equity<=0||a.pending)) throw new Error("Suiveur hors ligne ou commande en attente");
      if (input.enabled && !a.enabled) { a.sessionEquity=a.equity;a.error=""; }
      a.enabled=input.enabled;
      if(!a.enabled && a.pending?.expiresAt)a.pending.expiresAt=this.now()-1;
      this.log(a.id,a.enabled?"Suiveur activé, nouvelle référence de perte session":"Suiveur en pause");return {};
    }
    if (input.action==="retry") {
      if (a.pending || a.enabled) throw new Error("Pause et acquittement de la commande requis avant réessai");
      this.state.bindings.filter(b=>b.slave===a.id&&!b.closed).forEach(b=>b.blocked=false);
      this.log(a.id,"Réessai demandé après vérification du terminal");return {};
    }
    if (input.action==="remove") {
      if (a.pending || (a.role==="master" ? this.state.bindings.some(b=>!b.closed) : this.state.bindings.some(b=>b.slave===a.id&&!b.closed))) throw new Error("Fermez et réconciliez les copies avant suppression");
      this.state.agents=this.state.agents.filter(x=>x.id!==a.id);this.state.bindings=this.state.bindings.filter(b=>b.slave!==a.id);
      if(a.role==="master"){this.state.enabled=false;this.state.baseline=null;this.state.bindings=[];}
      this.log(a.id,"Terminal révoqué");return {};
    }
    throw new Error("Action inconnue");
  }
  private bind(a:Agent,p:Position) {
    if(this.state.bindings.some(b=>b.slave===a.id&&b.source===key(p)))return;
    if(this.state.bindings.length>=15000){a.enabled=false;a.error="Capacité du journal de copies atteinte : nouvelles copies bloquées";this.log(a.id,a.error);return;}
    const side=a.settings.reverse?(p.side==="BUY"?"SELL":"BUY"):p.side;
    // Independent magic per copy, within exact JS/MQL integer range.
    let magic:number; do{magic=randomBytes(6).readUIntBE(0,6);}while(magic===0||this.state.bindings.some(b=>b.magic===magic));
    this.state.bindings.push({slave:a.id,source:key(p),magic,symbol:a.settings.symbols[p.symbol]??p.symbol,side,multiplier:a.settings.multiplier,volume:Math.min(p.volume*a.settings.multiplier,a.settings.maxLot),sl:a.settings.reverse?p.tp:p.sl,tp:a.settings.reverse?p.sl:p.tp,blocked:false,closed:false});
    this.log(a.id,`Copie détectée : ${p.side} ${p.symbol} #${p.id}`);
  }
  private sourceUpdate(master:Agent, previous:Position[]|null) {
    const current=new Map(master.positions.map(p=>[key(p),p]));
    for(const b of this.state.bindings.filter(b=>!b.closed)) {
      const p=current.get(b.source);const a=this.state.agents.find(a=>a.id===b.slave)!;
      if(!p){b.volume=0;if(a.pending?.magic===b.magic&&a.pending.expiresAt)a.pending.expiresAt=this.now()-1;continue;}
      const target=Math.min(p.volume*b.multiplier,a.settings.maxLot);
      if(a.pending?.magic===b.magic&&a.pending.expiresAt&&target<a.pending.volume)a.pending.expiresAt=this.now()-1;
      b.volume=this.state.enabled&&a.enabled&&this.online(a)?target:Math.min(b.volume,target);
      const reverse=b.side!==p.side;b.sl=reverse?p.tp:p.sl;b.tp=reverse?p.sl:p.tp;
    }
    if(previous && this.state.enabled){
      const old=new Set(previous.map(key));
      for(const p of master.positions.filter(p=>!old.has(key(p))))for(const a of this.state.agents.filter(a=>a.role==="slave")){
        if(a.enabled&&this.online(a))this.bind(a,p);
        else this.log(a.id,`Ouverture ignorée (pause/hors ligne) : ${p.symbol} #${p.id}`);
      }
    }
    this.state.baseline=master.positions;
  }
  heartbeat(a:Agent,input:Record<string,unknown>) {
    if(input.role!==a.role)throw new Error("Rôle EA différent du terminal enregistré");
    if(input.account!==a.account||input.server!==a.server||input.mode!==a.mode)throw new Error("Compte MT5 différent du compte enregistré");
    if(a.role==="slave"&&input.hedging!==true)throw new Error("Le terminal suiveur doit utiliser un compte MT5 hedging");
    const session=str(input.session,"Session",80), seq=number(input.seq,1,Number.MAX_SAFE_INTEGER,"Séquence");
    if(!Number.isInteger(seq))throw new Error("Séquence invalide");
    if(a.session&&a.session!==session&&this.online(a))throw new Error("Un autre EA est déjà connecté avec cette identité");
    if(a.session===session&&seq<=a.seq)return {command:a.pending};
    const positions=parsePositions(input.positions), equity=number(input.equity,0,1e15,"Equity");
    const previous=this.state.baseline;
    a.session=session;a.seq=seq;a.lastSeen=this.now();a.equity=equity;a.positions=positions;
    if(a.role==="master"){this.sourceUpdate(a,previous);return {command:null};}
    if(input.ack){
      const ack=input.ack as Record<string,unknown>;
      if(ack.id!==a.lastAck){
        if(!a.pending||ack.id!==a.pending.id||!["done","failed","uncertain"].includes(String(ack.status)))throw new Error("Acquittement inconnu");
        const b=this.state.bindings.find(b=>b.magic===a.pending!.magic&&b.slave===a.id)!;
        const actual=positions.filter(p=>p.magic===b.magic);
        if(ack.status!=="done") { b.blocked=true;a.enabled=false;a.error=str(ack.message??"Commande refusée","Message",250); }
        else {
          if(actual.some(p=>p.symbol!==b.symbol||p.side!==b.side) || (a.pending.volume===0 && actual.length)) throw new Error("Acquittement incompatible avec les positions");
          b.appliedVolume=a.pending.volume;b.appliedSl=a.pending.sl;b.appliedTp=a.pending.tp;b.observedSl=actual[0]?.sl;b.observedTp=actual[0]?.tp;b.opened=true;
          if(!actual.length)b.closed=true;
        }
        this.log(a.id,`${ack.status} · ${a.pending.symbol} · ${String(ack.message??"").slice(0,250)}`);
        a.lastAck=a.pending.id;a.pending=null;
      }
    }
    if(a.pending){
      if(this.now()-a.pending.issuedAt>30000){a.enabled=false;a.error="Acquittement manquant : vérifier le terminal, aucun nouvel ordre";}
      return {command:a.pending};
    }
    if(a.enabled && a.sessionEquity>0 && equity<=a.sessionEquity*(1-a.settings.lossLimitPct/100)){
      a.enabled=false;a.error="Limite de perte session atteinte : nouvelles expositions bloquées";this.log(a.id,a.error);
    }
    const master=this.state.agents.find(x=>x.role==="master");
    const canIncrease=this.state.enabled&&a.enabled&&!!master&&this.online(master);
    for(const b of this.state.bindings.filter(b=>b.slave===a.id&&!b.closed&&!b.blocked).sort((a,b)=>a.volume-b.volume)){
      const actual=positions.filter(p=>p.magic===b.magic);
      const volume=actual.reduce((n,p)=>n+p.volume,0);
      if(actual.some(p=>p.symbol!==b.symbol||p.side!==b.side)){b.blocked=true;a.enabled=false;a.error="Position copiée incohérente : vérifier le terminal";this.log(a.id,a.error);continue;}
      if(b.opened && volume===0 && b.volume>0){b.closed=true;this.log(a.id,`Copie fermée sur le terminal : ${b.symbol}, aucune réouverture`);continue;}
      if(b.volume===0 && volume===0){b.closed=true;continue;}
      const target=canIncrease?b.volume:Math.min(volume,b.volume);
      if(target>volume+1e-8 && positions.reduce((n,p)=>n+p.volume,0)+target-volume>a.settings.maxTotalLots+1e-8){b.blocked=true;this.log(a.id,`Limite totale de lots : ${b.symbol}`);continue;}
      if((Math.abs(target-volume)<1e-8 || b.appliedVolume===target) && actual.every(p=>(Math.abs(p.sl-b.sl)<1e-8&&Math.abs(p.tp-b.tp)<1e-8)||(b.appliedSl===b.sl&&b.appliedTp===b.tp&&p.sl===b.observedSl&&p.tp===b.observedTp)))continue;
      // An externally closed copy is not reopened without a new master event.
      if(target===0&&volume===0)continue;
      a.pending={fromVolume:volume,id:randomUUID(),magic:b.magic,symbol:b.symbol,side:b.side,volume:target,sl:b.sl,tp:b.tp,issuedAt:this.now(),expiresAt:target>volume?this.now()+15000:0,account:a.account,server:a.server,mode:a.mode,maxTotalLots:a.settings.maxTotalLots,lossFloor:a.sessionEquity*(1-a.settings.lossLimitPct/100)};
      this.log(a.id,`Commande ${a.pending.id} · ${b.symbol} · volume cible ${target}`);
      return {command:a.pending};
    }
    return {command:null};
  }
  snapshot() {
    return {
      enabled:this.state.enabled,limit:50,
      agents:this.state.agents.map(a=>({
        id:a.id,label:a.label,role:a.role,account:a.account,server:a.server,mode:a.mode,
        enabled:a.enabled,settings:a.settings,lastSeen:a.lastSeen,equity:a.equity,
        sessionEquity:a.sessionEquity,pending:a.pending,error:a.error,
        online:this.online(a),positionCount:a.positions.length,
        managedCopies:this.state.bindings.filter(b=>b.slave===a.id&&!b.closed).length,
      })),
      logs:this.state.logs.slice(0,200),
    };
  }
}
