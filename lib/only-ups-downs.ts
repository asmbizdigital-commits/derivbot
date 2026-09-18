import { buildRiseFallSignal } from "./rise-fall-prediction";

export type RunContract = "RUNHIGH" | "RUNLOW";
export type RunStrategy = {
  name: string;
  entryMode: "consecutive" | "trend" | "momentum" | "reversal";
  confirmationMoves: number;
  durationTicks: number;
  contractType: RunContract | null;
  stake: number | null;
};

export const RUN_STRATEGIES: Record<string, RunStrategy> = {
  reactive: { name: "Série réactive · 2 mouvements", entryMode: "consecutive", confirmationMoves: 2, durationTicks: 2, contractType: null, stake: null },
  confirmed: { name: "Série confirmée · 3 mouvements", entryMode: "consecutive", confirmationMoves: 3, durationTicks: 2, contractType: null, stake: null },
  trend: { name: "Tendance multi-horizon", entryMode: "trend", confirmationMoves: 2, durationTicks: 2, contractType: null, stake: null },
  momentum: { name: "Impulsion filtrée", entryMode: "momentum", confirmationMoves: 2, durationTicks: 2, contractType: null, stake: null },
  reversal: { name: "Retournement confirmé", entryMode: "reversal", confirmationMoves: 2, durationTicks: 2, contractType: null, stake: null },
};

export function evaluateRunEntry(ticks: number[], type: RunContract, strategy: RunStrategy) {
  const label = type === "RUNHIGH" ? "Only Ups" : "Only Downs";
  if (strategy.entryMode !== "consecutive") {
    if (ticks.length < 80) return { ready: false, reason: `${label} · ${Math.min(ticks.length, 80)}/80 ticks collectés · ${strategy.name}` };
    const signal = buildRiseFallSignal(ticks, strategy.entryMode);
    const ready = signal?.direction === (type === "RUNHIGH" ? "CALL" : "PUT");
    return { ready, reason: `${label} · ${strategy.name} · ${ready ? "signal confirmé" : "attente du filtre directionnel"}` };
  }
  const required = strategy.confirmationMoves + 1;
  const recent = ticks.slice(-required);
  if (recent.length < required) return { ready: false, reason: `${label} · ${recent.length}/${required} ticks collectés` };
  if (recent.some((price) => !Number.isFinite(price))) return { ready: false, reason: `${label} · prix invalides, attente du flux` };
  let matched = 0;
  for (let i = recent.length - 1; i > 0; i--) {
    if (type === "RUNHIGH" ? recent[i] <= recent[i - 1] : recent[i] >= recent[i - 1]) break;
    matched++;
  }
  return { ready: matched >= strategy.confirmationMoves,
    reason: `${label} · ${matched}/${strategy.confirmationMoves} mouvements ${type === "RUNHIGH" ? "haussiers" : "baissiers"} consécutifs` };
}

export function parseRunStrategyMarkdown(markdown: string): RunStrategy {
  if (markdown.length > 65536) throw new Error("Fichier trop volumineux (64 Ko maximum)");
  const blocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (blocks.length !== 1) throw new Error("Le fichier doit contenir exactement un bloc JSON");
  const data = JSON.parse(blocks[0][1]);
  if (!data || Array.isArray(data) || data.strategy !== "only_ups_downs" || data.version !== 1) throw new Error("Stratégie Only Ups / Only Downs version 1 requise");
  const allowed = new Set(["strategy", "version", "name", "entryMode", "confirmationMoves", "durationTicks", "contractType", "stake"]);
  if (Object.keys(data).some((key) => !allowed.has(key))) throw new Error("Paramètre inconnu dans la stratégie");
  if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 100) throw new Error("Nom requis (100 caractères maximum)");
  if (!["consecutive", "trend", "momentum", "reversal"].includes(data.entryMode)) throw new Error("Mode d’entrée inconnu");
  const confirmationMoves = data.confirmationMoves ?? 2;
  if (!Number.isInteger(confirmationMoves) || confirmationMoves < 1 || confirmationMoves > 5) throw new Error("confirmationMoves : entier de 1 à 5 requis");
  if (!Number.isInteger(data.durationTicks) || data.durationTicks < 2 || data.durationTicks > 5) throw new Error("durationTicks : entier de 2 à 5 requis");
  if (data.contractType != null && data.contractType !== "RUNHIGH" && data.contractType !== "RUNLOW") throw new Error("contractType : RUNHIGH, RUNLOW ou null requis");
  if (data.stake != null && (typeof data.stake !== "number" || !Number.isFinite(data.stake) || data.stake < 0.35 || data.stake > 10000)) throw new Error("Mise invalide : 0,35 à 10 000 requis");
  return { name: data.name.trim(), entryMode: data.entryMode, confirmationMoves, durationTicks: data.durationTicks, contractType: data.contractType ?? null, stake: data.stake ?? null };
}
