import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export type PositionDetails = { openPrice:number; currentPrice:number; profit:number; swap:number };
export type AccountMetrics = { balance:number; currency:string; floatingPnl:number; realizedDay:number|null; dealsDay:number|null; day:string; receivedAt:number };
export type Position = { id: string; symbol: string; side: "BUY" | "SELL"; volume: number; sl: number; tp: number; magic: number; details?:PositionDetails };
export type Settings = { multiplier: number; maxLot: number; maxTotalLots: number; lossLimitPct: number; reverse: boolean; symbols: Record<string, string> };
export type Command = { fromVolume: number; id: string; magic: number; symbol: string; side: "BUY" | "SELL"; volume: number; sl: number; tp: number; expiresAt: number; issuedAt: number; account: string; server: string; mode: "demo" | "real"; copyProtocol: 2; broker: string };
export type Agent = { broker?: string; copyProtocol?: number; id: string; label: string; role: "master" | "slave"; account: string; server: string; mode: "demo" | "real"; tokenHash: string; enabled: boolean; settings: Settings; lastSeen: number; session: string; seq: number; equity: number; sessionEquity: number; positions: Position[]; pending: Command | null; lastAck: string; error: string; metrics?:AccountMetrics|null; hasTraded?:boolean };
type Binding = { exact?: boolean; retired?: boolean; slave: string; source: string; magic: number; symbol: string; side: "BUY" | "SELL"; multiplier: number; volume: number; sl: number; tp: number; blocked: boolean; closed: boolean; lastError?:string; appliedVolume?: number; opened?: boolean; appliedSl?: number; appliedTp?: number; observedSl?: number; observedTp?: number };
export type CopyState = { version: 1; enabled: boolean; agents: Agent[]; bindings: Binding[]; baseline: Position[] | null; logs: { at: number; agent: string; message: string }[] };
export const freshCopyState = (): CopyState => ({ version: 1, enabled: false, agents: [], bindings: [], baseline: null, logs: [] });
// Zero caps are persisted only for backward-compatible state shape; execution has no custom limits.
const defaults: Settings = { multiplier: 1, maxLot: 0, maxTotalLots: 0, lossLimitPct: 0, reverse: false, symbols: {} };
const key = (p: Position) => `${p.id}:${p.side}`;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export function secretEqual(a: string, b: string) { const aa = Buffer.from(hash(a)), bb = Buffer.from(hash(b)); return timingSafeEqual(aa, bb); }
function number(value: unknown, min: number, max: number, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${name} invalide`);
  return value;
}
function str(value: unknown, name: string, max = 100) { if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x1f]/.test(value)) throw new Error(`${name} invalide`); return value.trim(); }
function parseMetrics(input:unknown, receivedAt:number):AccountMetrics|null {
  // Legacy EAs remain usable but must not be shown with invented zero balances/PnL.
  if(input===undefined||input===null)return null;
  if(typeof input!=="object"||Array.isArray(input))throw new Error("Statistiques MT5 invalides");
  const p=input as Record<string,unknown>, day=str(p.day,"Jour MT5",10), currency=str(p.currency,"Devise",12);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+"T00:00:00Z")))throw new Error("Jour MT5 invalide");
  const realizedDay=p.realizedDay===null?null:number(p.realizedDay,-1e15,1e15,"Résultat réalisé");
  const dealsDay=p.dealsDay===null?null:number(p.dealsDay,0,Number.MAX_SAFE_INTEGER,"Transactions du jour");
  if(dealsDay!==null&&!Number.isInteger(dealsDay))throw new Error("Transactions du jour invalides");
  if((realizedDay===null)!==(dealsDay===null))throw new Error("Historique MT5 incomplet");
  return {balance:number(p.balance,-1e15,1e15,"Balance"),currency,floatingPnl:number(p.floatingPnl,-1e15,1e15,"PnL flottant"),realizedDay,dealsDay,day,receivedAt};
}
export function parseSettings(): Settings { return { ...defaults, symbols: {} }; }
export function parsePositions(input: unknown): Position[] {
  if (!Array.isArray(input)) throw new Error("Snapshot complet requis");
  const ids = new Set<string>();
  return input.map((p) => {
    if (!p || typeof p !== "object") throw new Error("Position invalide");
    const id = str(p.id,"Identifiant position",30);
    if (!/^\d+$/.test(id) || ids.has(id) || (p.side !== "BUY" && p.side !== "SELL")) throw new Error("Position dupliquée ou invalide");
    ids.add(id);
    const magic = number(p.magic,0,Number.MAX_SAFE_INTEGER,"Magic");
    if (!Number.isSafeInteger(magic)) throw new Error("Magic invalide");
    let details:PositionDetails|undefined;
    if(p.details!==undefined){
      const d=p.details;
      if(!d||typeof d!=="object"||Array.isArray(d))throw new Error("Détails position invalides");
      details={openPrice:number(d.openPrice,0,1e15,"Prix entrée"),currentPrice:number(d.currentPrice,0,1e15,"Prix actuel"),profit:number(d.profit,-1e15,1e15,"Profit position"),swap:number(d.swap,-1e15,1e15,"Swap")};
    }
    return { id,symbol:str(p.symbol,"Symbole",80),side:p.side,volume:number(p.volume,.00000001,Number.MAX_SAFE_INTEGER,"Volume"),sl:number(p.sl,0,1e15,"SL"),tp:number(p.tp,0,1e15,"TP"),magic,...(details?{details}:{}) };
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
    const agent:Agent={id:randomUUID(),label:str(input.label,"Nom",60),role:input.role,account,server,mode:input.mode,tokenHash:hash(token),enabled:false,settings:parseSettings(),lastSeen:0,session:"",seq:0,equity:0,sessionEquity:0,positions:[],pending:null,lastAck:"",error:""};
    this.state.agents.push(agent);this.log(agent.id,"Terminal enregistré, copie en pause");return {id:agent.id,token};
  }
  private masterReplacementError() {
    if(this.state.agents.some(a=>a.pending))return "Attendez l’acquittement des commandes en cours avant de changer de master.";
    for(const a of this.state.agents.filter(a=>a.role==="slave")){
      const bindings=this.state.bindings.filter(b=>b.slave===a.id);
      if(bindings.some(b=>!b.closed)&&!this.online(a))return `Reconnectez ${a.label} pour vérifier ses copies avant de changer de master.`;
      if(a.positions.some(p=>bindings.some(b=>b.magic===p.magic)))return `Clôturez les copies de l’ancien master sur ${a.label}, puis attendez leur synchronisation.`;
    }
    return "";
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
        for(const a of this.state.agents.filter(a=>a.role==="slave"&&a.enabled&&this.online(a))) for(const p of master.positions) this.bind(a,p);
      } else { this.state.enabled=false; for(const a of this.state.agents) if(a.pending?.expiresAt) a.pending.expiresAt=this.now()-1; }
      this.log("system",this.state.enabled?"Copie démarrée":"Pause des nouvelles expositions ; suivi des copies existantes conservé");return {};
    }
    const a=this.state.agents.find(a=>a.id===input.id);
    if (!a) throw new Error("Terminal inconnu");
    if (input.action==="replace_master") {
      if(a.role!=="master")throw new Error("Le master à remplacer a changé. Actualisez la page.");
      const issue=this.masterReplacementError();if(issue)throw new Error(issue);
      // Validate/register in a separate state before revoking the old identity.
      const next=new CopyEngine({...this.state,enabled:false,baseline:null,bindings:[],logs:[...this.state.logs],
        agents:this.state.agents.filter(x=>x.id!==a.id).map(x=>({...x,enabled:false,error:""}))},this.now);
      const result=next.register({...input,role:"master"});
      next.log(result.id,`Master remplacé : ${a.label} (${a.account}) ; suiveurs conservés, copie en pause`);
      Object.assign(this.state,next.state);
      return result;
    }
    if (input.action==="settings") {
      if (a.enabled || a.pending) throw new Error("Mettre le suiveur en pause et attendre la commande en cours");
      throw new Error("Copie identique 1:1 : aucun paramètre personnalisé par suiveur");
    }
    if (input.action==="enable") {
      if (a.role!=="slave" || typeof input.enabled!=="boolean") throw new Error("Suiveur requis");
      if (input.enabled && (!this.online(a)||a.pending)) throw new Error("Suiveur hors ligne ou commande en attente");
      if (input.enabled && !a.enabled) { a.sessionEquity=a.equity;a.error=""; }
      a.enabled=input.enabled;
      if(!a.enabled && a.pending?.expiresAt)a.pending.expiresAt=this.now()-1;
      this.log(a.id,a.enabled?"Suiveur activé, copie identique 1:1":"Suiveur en pause");return {};
    }
    if (input.action==="retry") {
      if (a.pending || a.enabled) throw new Error("Pause et acquittement de la commande requis avant réessai");
      this.state.bindings.filter(b=>b.slave===a.id&&!b.closed).forEach(b=>{b.blocked=false;b.lastError=undefined;});
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
    if(this.state.bindings.some(b=>b.slave===a.id&&b.source===key(p)&&!b.retired))return;
    // Independent magic per copy, within exact JS/MQL integer range.
    let magic:number; do{magic=randomBytes(6).readUIntBE(0,6);}while(magic===0||this.state.bindings.some(b=>b.magic===magic));
    this.state.bindings.push({slave:a.id,source:key(p),magic,exact:true,symbol:p.symbol,side:p.side,multiplier:1,volume:p.volume,sl:p.sl,tp:p.tp,blocked:false,closed:false});
    this.log(a.id,`Copie détectée : ${p.side} ${p.symbol} #${p.id}`);
  }
  private sourceUpdate(master:Agent) {
    const current=new Map(master.positions.map(p=>[key(p),p]));
    for(const b of this.state.bindings.filter(b=>!b.closed)) {
      const p=current.get(b.source);const a=this.state.agents.find(a=>a.id===b.slave)!;
      if(!p||b.retired){b.volume=0;if(a.pending?.magic===b.magic&&a.pending.expiresAt)a.pending.expiresAt=this.now()-1;continue;}
      const target=p.volume;
      if(a.pending?.magic===b.magic&&a.pending.expiresAt&&target<a.pending.volume)a.pending.expiresAt=this.now()-1;
      b.volume=this.state.enabled&&a.enabled&&this.online(a)?target:Math.min(b.volume,target);
      if(b.exact){b.sl=p.sl;b.tp=p.tp;}
    }
    if(this.state.enabled)for(const a of this.state.agents.filter(a=>a.role==="slave"&&a.enabled&&this.online(a)))
      for(const p of master.positions)this.bind(a,p);
    this.state.baseline=master.positions;
  }
  heartbeat(a:Agent,input:Record<string,unknown>) {
    if(input.role!==a.role)throw new Error("Rôle EA différent du terminal enregistré");
    if(input.account!==a.account||input.server!==a.server||input.mode!==a.mode)throw new Error("Compte MT5 différent du compte enregistré");
    if(a.role==="slave"&&input.hedging!==true)throw new Error("Le terminal suiveur doit utiliser un compte MT5 hedging");
    const session=str(input.session,"Session",80), seq=number(input.seq,1,Number.MAX_SAFE_INTEGER,"Séquence");
    if(!Number.isInteger(seq))throw new Error("Séquence invalide");
    if(a.session&&a.session!==session&&this.online(a))throw new Error("Un autre EA est déjà connecté avec cette identité");
    if(a.session===session&&seq<=a.seq)return {command:a.pending?.copyProtocol===2&&(input.copyProtocol!==2||input.broker!==a.pending.broker)?null:a.pending};
    const positions=parsePositions(input.positions), equity=number(input.equity,0,1e15,"Equity"), metrics=parseMetrics(input.metrics,this.now());
    const broker=input.broker===undefined?undefined:str(input.broker,"Broker MT5");
    const copyProtocol=input.copyProtocol===2?2:undefined;
    a.broker=broker;a.copyProtocol=copyProtocol;a.settings=parseSettings();
    a.session=session;a.seq=seq;a.lastSeen=this.now();a.equity=equity;a.positions=positions;a.metrics=metrics;
    a.hasTraded=!!a.hasTraded||positions.length>0||(metrics?.dealsDay??0)>0;
    if(a.role==="master"){this.sourceUpdate(a);return {command:null};}
    if(input.ack){
      const ack=input.ack as Record<string,unknown>;
      if(ack.id!==a.lastAck){
        if(!a.pending||ack.id!==a.pending.id||!["done","failed","uncertain","skipped"].includes(String(ack.status)))throw new Error("Acquittement inconnu");
        const b=this.state.bindings.find(b=>b.magic===a.pending!.magic&&b.slave===a.id)!;
        const actual=positions.filter(p=>p.magic===b.magic);
        if(ack.status==="skipped") {
          // Isolate confirmed preflight/broker refusals of a never-opened copy.
          // Unknown execution results and errors on existing copies still require reconciliation.
          if(!["symbol_unavailable","symbol_specs_unavailable","volume_below_minimum","volume_incompatible","broker_rejected"].includes(String(ack.code))||a.pending.fromVolume!==0||a.pending.volume<=0||actual.length||b.opened)throw new Error("Refus local incompatible avec la commande");
          b.blocked=true;b.lastError=str(ack.message,"Motif du refus",250);
        }
        else if(ack.status!=="done") { b.blocked=true;a.enabled=false;b.lastError=str(ack.message??"Commande refusée","Message",250);a.error=`${b.symbol} : ${b.lastError}`; }
        else {
          if(actual.some(p=>p.symbol!==b.symbol||p.side!==b.side) || (a.pending.volume===0 && actual.length)) throw new Error("Acquittement incompatible avec les positions");
          if(a.pending.copyProtocol===2 && (Math.abs(actual.reduce((n,p)=>n+p.volume,0)-a.pending.volume)>1e-8 || actual.some(p=>Math.abs(p.sl-a.pending!.sl)>1e-8||Math.abs(p.tp-a.pending!.tp)>1e-8))) {
            b.blocked=true;b.lastError="Exécution différente des valeurs exactes du master";a.enabled=false;a.error=b.lastError;
          }
          b.appliedVolume=a.pending.volume;b.appliedSl=a.pending.sl;b.appliedTp=a.pending.tp;b.observedSl=actual[0]?.sl;b.observedTp=actual[0]?.tp;b.opened=true;
          if(!actual.length)b.closed=true;
        }
        this.log(a.id,`${ack.status} · ${a.pending.symbol} · ${String(ack.message??"").slice(0,250)}`);
        a.lastAck=a.pending.id;a.pending=null;
      }
    }
    if(a.pending){
      if(this.now()-a.pending.issuedAt>30000){a.enabled=false;a.error="Acquittement manquant : vérifier le terminal, aucun nouvel ordre";}
      return {command:a.pending.copyProtocol===2&&(a.copyProtocol!==2||a.broker!==a.pending.broker)?null:a.pending};
    }
    const master=this.state.agents.find(x=>x.role==="master");
    // Brokers/servers may differ from the master. Commands target the follower’s own identity.
    const compatibilityError=!master?"Master absent":
      a.copyProtocol!==2||master.copyProtocol!==2||!a.broker?"Installer l’EA 1.04 sur le master et le suiveur pour la copie identique":"";
    const canIncrease=this.state.enabled&&a.enabled&&!!master&&this.online(master)&&!compatibilityError;
    if(canIncrease&&master){
      // Migrate persisted caps/multipliers. Old commands must be acknowledged first.
      for(const b of this.state.bindings.filter(b=>b.slave===a.id&&!b.closed&&!b.exact&&!b.retired)){
        const p=master.positions.find(p=>key(p)===b.source);if(!p)continue;
        if(b.symbol!==p.symbol||b.side!==p.side){
          if(b.blocked)continue; // Uncertain execution still requires reconciliation.
          b.retired=true;b.volume=0;
        }else{
          b.exact=true;b.multiplier=1;b.volume=p.volume;b.sl=p.sl;b.tp=p.tp;
          if(b.lastError&&/Limite totale|Volume inférieur|volume.*minimum|Limite de lots|Limite de perte/i.test(b.lastError)){b.blocked=false;b.lastError=undefined;}
        }
      }
      for(const p of master.positions)this.bind(a,p);
      this.sourceUpdate(master);
    }
    // Old EAs can finish their outstanding command but cannot receive new-format commands.
    if(a.copyProtocol!==2)return {command:null};
    for(const b of this.state.bindings.filter(b=>b.slave===a.id&&!b.closed&&!b.blocked).sort((a,b)=>a.volume-b.volume)){
      const actual=positions.filter(p=>p.magic===b.magic);
      const volume=actual.reduce((n,p)=>n+p.volume,0);
      if(actual.some(p=>p.symbol!==b.symbol||p.side!==b.side)){b.blocked=true;a.enabled=false;a.error="Position copiée incohérente : vérifier le terminal";b.lastError=a.error;this.log(a.id,a.error);break;}
      if(b.opened && volume===0 && b.volume>0){b.closed=true;this.log(a.id,`Copie fermée sur le terminal : ${b.symbol}, aucune réouverture`);continue;}
      if(b.volume===0 && volume===0){b.closed=true;continue;}
      const target=canIncrease?b.volume:Math.min(volume,b.volume);
      if(Math.abs(target-volume)<1e-8 && actual.every(p=>Math.abs(p.sl-b.sl)<1e-8&&Math.abs(p.tp-b.tp)<1e-8))continue;
      // An externally closed copy is not reopened without a new master event.
      if(target===0&&volume===0)continue;
      a.pending={fromVolume:volume,id:randomUUID(),magic:b.magic,symbol:b.symbol,side:b.side,volume:target,sl:b.sl,tp:b.tp,issuedAt:this.now(),expiresAt:target>volume?this.now()+15000:0,account:a.account,server:a.server,mode:a.mode,copyProtocol:2,broker:a.broker!};
      this.log(a.id,`Commande ${a.pending.id} · ${b.symbol} · volume cible ${target}`);
      return {command:a.pending};
    }
    return {command:null};
  }
  snapshot() {
    const master=this.state.agents.find(a=>a.role==="master");
    const compatibility=(a:Agent)=>a.role!=="slave"?"":a.copyProtocol!==2||master?.copyProtocol!==2||!a.broker?"Installer l’EA 1.04 sur le master et le suiveur pour la copie identique":"";
    return {
      enabled:this.state.enabled,limit:50,masterReplacementError:this.masterReplacementError(),
      agents:this.state.agents.map(a=>({
        id:a.id,label:a.label,role:a.role,account:a.account,server:a.server,mode:a.mode,
        enabled:a.enabled,settings:parseSettings(),broker:a.broker??null,copyProtocol:a.copyProtocol??null,lastSeen:a.lastSeen,equity:a.equity,
        sessionEquity:a.sessionEquity,pending:a.pending,error:a.error||compatibility(a),
        online:this.online(a),positionCount:a.positions.length,
        metrics:a.metrics??null,hasTraded:!!a.hasTraded||a.positions.length>0||this.state.bindings.some(b=>b.slave===a.id&&b.opened),
        positions:a.positions.map(p=>({...p,copied:a.role==="slave"&&this.state.bindings.some(b=>b.slave===a.id&&b.magic===p.magic)})),
        managedCopies:this.state.bindings.filter(b=>b.slave===a.id&&!b.closed).length,
        queuedCopies:this.state.bindings.filter(b=>b.slave===a.id&&!b.closed&&!b.blocked&&!b.opened).length,
        copyIssues:this.state.bindings.filter(b=>b.slave===a.id&&!b.closed&&b.blocked).map(b=>({source:b.source,symbol:b.symbol,message:b.lastError??"Copie bloquée : consulter le journal et vérifier le terminal"})),
      })),
      logs:this.state.logs.slice(0,200),
    };
  }
}
