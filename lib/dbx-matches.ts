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
  name: "DBX (V3.1) Adaptatif · Payout contrôlé",
  windowSize: 50,
} as const;

export const DBX_LAST_DIGIT_CONFIG = {
  name: "DBX (V4) Last Digit + Most Appearing",
  windowSize: 50,
} as const;

export function isDbxMode(mode: string) {
  return mode === "dbx_fixed" || mode === "dbx_dynamic" || mode === "dbx_last_digit";
}

export function buildDbxMatchOrder(stake: number, digit: number = DBX_MATCH_CONFIG.barrier, duration: number = DBX_MATCH_CONFIG.duration) {
  if (!Number.isFinite(stake) || stake < 0.35 || !Number.isInteger(digit) || digit < 0 || digit > 9
    || !Number.isInteger(duration) || duration < 1 || duration > 10) return null;
  return { contractType: DBX_MATCH_CONFIG.contractType, symbol: DBX_MATCH_CONFIG.symbol,
    barrier: digit, duration,
    stake, batchIndex: 1, batchTotal: 1, dbx: true as const };
}

export function validDbxQuote(ask: number, payout: number, stake: number, balance: number | null) {
  return Number.isFinite(ask) && ask > 0 && Number.isFinite(payout) && payout > ask
    && Number.isFinite(stake) && stake >= 0.35 && ask <= stake + 1e-8
    && balance !== null && Number.isFinite(balance) && balance >= ask;
}

export const DBX_V3_GUARD = {
  minimumTicks: 200,
  minimumReturnOnStake: 0.02,
  quoteMaxAgeMs: 3000,
  defaultLossBudgetStakes: 4,
} as const;

// Reserve the next stake before entry. This limits exposure, not losing streaks.
export function dbxV3BudgetAllows(netProfit: number, stake: number, budgetStakes: number, nextCost = stake) {
  return Number.isFinite(netProfit) && Number.isFinite(stake) && stake >= 0.35
    && Number.isFinite(budgetStakes) && budgetStakes >= 1 && Number.isFinite(nextCost) && nextCost > 0
    && netProfit - nextCost >= -stake * budgetStakes - 1e-8;
}

// A descriptive historical bound, not a calibrated next-tick probability.
// z=2.576 applies a one-sided 0.5% Wilson tail per digit (10 digits).
// Repeated selection, dependence and market drift invalidate a coverage promise.
export function evaluateDbxV3Quote(candidate: { digit: number; probability: number } | null, ticks: number[], pipSize: number, ask: number, payout: number) {
  const prices = ticks.slice(-DBX_V3_GUARD.minimumTicks);
  const valid = !!candidate && Number.isInteger(candidate.digit) && candidate.digit >= 0 && candidate.digit <= 9
    && Number.isFinite(candidate.probability) && candidate.probability >= 0 && candidate.probability <= 1
    && Number.isInteger(pipSize) && pipSize >= 0 && pipSize <= 20
    && prices.length >= DBX_V3_GUARD.minimumTicks && prices.every((price) => Number.isFinite(price) && Math.abs(price) < 1e21)
    && Number.isFinite(ask) && ask > 0 && Number.isFinite(payout) && payout > ask;
  if (!valid) return { accepted: false, sampleSize: prices.length, frequency: 0, lowerFrequency: 0, conservativeProbability: 0, breakEven: null, expectedValue: null, conservativeExpectedValue: null };
  const count = prices.filter((price) => Number(price.toFixed(pipSize).at(-1)) === candidate!.digit).length;
  const frequency = count / prices.length;
  const z2 = 2.576 ** 2;
  const lowerFrequency = Math.max(0, (frequency + z2 / (2 * prices.length)
    - Math.sqrt(z2) * Math.sqrt(frequency * (1 - frequency) / prices.length + z2 / (4 * prices.length ** 2))) / (1 + z2 / prices.length));
  const conservativeProbability = Math.min(candidate!.probability, lowerFrequency);
  const breakEven = ask / payout; // Payout is gross; net win is payout minus ask.
  const expectedValue = candidate!.probability * payout - ask;
  const conservativeExpectedValue = conservativeProbability * payout - ask;
  return { accepted: conservativeExpectedValue >= ask * DBX_V3_GUARD.minimumReturnOnStake,
    sampleSize: prices.length, frequency, lowerFrequency, conservativeProbability, breakEven, expectedValue, conservativeExpectedValue };
}
