// Extracted from the supplied Blockly XML: these are literal trade options,
// not predictions. The XML's CURRENT_STAKE variable is not wired to AMOUNT.
export const DBX_MATCH_CONFIG = {
  name: "DBX (V2) Pro · Matches fixe 1",
  contractType: "DIGITMATCH",
  symbol: "1HZ50V",
  barrier: 1,
  duration: 1,
  stake: 5,
} as const;

export const DBX_DYNAMIC_MATCH_CONFIG = {
  name: "DBX (V3) Adaptatif · Matches dynamique",
  windowSize: 50,
} as const;

export function isDbxMode(mode: string) {
  return mode === "dbx_fixed" || mode === "dbx_dynamic";
}

export function buildDbxMatchOrder(stake: number, digit: number = DBX_MATCH_CONFIG.barrier) {
  if (!Number.isFinite(stake) || stake < 0.35 || !Number.isInteger(digit) || digit < 0 || digit > 9) return null;
  return { contractType: DBX_MATCH_CONFIG.contractType, symbol: DBX_MATCH_CONFIG.symbol,
    barrier: digit, duration: DBX_MATCH_CONFIG.duration,
    stake, batchIndex: 1, batchTotal: 1, dbx: true as const };
}

export function validDbxQuote(ask: number, payout: number, stake: number, balance: number | null) {
  return Number.isFinite(ask) && ask > 0 && Number.isFinite(payout) && payout > ask
    && Number.isFinite(stake) && stake >= 0.35 && ask <= stake + 1e-8
    && balance !== null && Number.isFinite(balance) && balance >= ask;
}
