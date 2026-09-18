export type ContractProgress = {
  duration: number;
  contractPhase?: "entry" | "active" | "settlement";
  entryTime?: number;
  exitTime?: number;
};

export type ContractProgressUpdate = {
  tick_count?: number;
  entry_spot?: string | number | null;
  entry_spot_time?: number | null;
  exit_spot_time?: number | null;
  is_expired?: boolean | number;
};

// tick_count is the contract's duration, not elapsed ticks. Do not infer expiry
// from the market feed or tick_stream: only Deriv confirms expiry/settlement.
export function updateContractProgress(previous: ContractProgress, update: ContractProgressUpdate): ContractProgress {
  const duration = Number.isInteger(update.tick_count) && update.tick_count! > 0 ? update.tick_count! : previous.duration;
  const entryTime = typeof update.entry_spot_time === "number" && update.entry_spot_time > 0 ? update.entry_spot_time : previous.entryTime;
  const exitTime = typeof update.exit_spot_time === "number" && update.exit_spot_time > 0 ? update.exit_spot_time : previous.exitTime;
  const hasEntry = entryTime !== undefined || (update.entry_spot != null && update.entry_spot !== "" && Number.isFinite(Number(update.entry_spot)));
  const contractPhase = previous.contractPhase === "settlement" || update.is_expired === true || update.is_expired === 1
    ? "settlement" : hasEntry || previous.contractPhase === "active" ? "active" : "entry";
  return { duration, contractPhase, entryTime, exitTime };
}

export function contractPhaseLabel(phase: ContractProgress["contractPhase"]) {
  return phase === "settlement" ? "EN ATTENTE DU RÈGLEMENT" : phase === "active" ? "EN COURS" : "EN ATTENTE DU TICK D’ENTRÉE";
}
