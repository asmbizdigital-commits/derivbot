export type RiseFallDirection = "CALL" | "PUT";
export type RiseFallStrategy = "trend" | "momentum" | "reversal";

export type RiseFallSignal = {
  direction: RiseFallDirection;
  confidence: number;
  probability: number;
  duration: 2 | 3 | 5;
  reason: string;
  agreement: number;
  trendEfficiency: number;
  volatilityRatio: number;
};

const MINIMUM_TICKS = 80;

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function standardDeviation(values: number[]) {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function direction(value: number, noiseFloor: number) {
  if (value > noiseFloor) return 1;
  if (value < -noiseFloor) return -1;
  return 0;
}

function windowMetrics(prices: number[], size: number) {
  const sample = prices.slice(-size);
  const changes = sample.slice(1).map((price, index) => price - sample[index]);
  const path = changes.reduce((sum, change) => sum + Math.abs(change), 0);
  const net = (sample.at(-1) ?? 0) - (sample[0] ?? 0);
  const positive = changes.filter((change) => change > 0).length;
  const negative = changes.filter((change) => change < 0).length;

  return {
    net,
    path,
    efficiency: path > 0 ? Math.abs(net) / path : 0,
    directionalShare: changes.length ? Math.max(positive, negative) / changes.length : 0,
  };
}

export function buildRiseFallSignal(ticks: number[], strategy: RiseFallStrategy): RiseFallSignal | null {
  if (ticks.length < MINIMUM_TICKS) return null;

  const prices = ticks.slice(-160);
  const changes = prices.slice(1).map((price, index) => price - prices[index]);
  const baselineMoves = changes.slice(-80).map(Math.abs);
  const baselineVolatility = mean(baselineMoves);
  if (!Number.isFinite(baselineVolatility) || baselineVolatility <= 0) return null;

  const latestMoves = changes.slice(-8);
  const recentVolatility = mean(latestMoves.map(Math.abs));
  const volatilityRatio = recentVolatility / baselineVolatility;
  if (volatilityRatio < 0.35 || volatilityRatio > 2.4) return null;

  const short = windowMetrics(prices, 8);
  const medium = windowMetrics(prices, 21);
  const long = windowMetrics(prices, 55);
  const noiseFloor = baselineVolatility * 0.35;
  const shortDirection = direction(short.net, noiseFloor);
  const mediumDirection = direction(medium.net, noiseFloor * 1.5);
  const longDirection = direction(long.net, noiseFloor * 2);
  const last = prices.at(-1)!;

  if (strategy === "reversal") {
    const reference = prices.slice(-55, -3);
    const referenceMean = mean(reference);
    const deviation = standardDeviation(reference);
    if (deviation <= 0) return null;

    const previous = prices.at(-2)!;
    const extremeZ = (previous - referenceMean) / deviation;
    const reversalDirection = extremeZ > 0 ? -1 : 1;
    const confirmationMove = last - previous;
    const confirmationDirection = direction(confirmationMove, noiseFloor * 0.2);
    const longConflict = longDirection !== 0 && longDirection !== reversalDirection && long.efficiency >= 0.42;
    if (Math.abs(extremeZ) < 1.55 || confirmationDirection !== reversalDirection || longConflict) return null;

    const confirmationStrength = Math.abs(confirmationMove) / baselineVolatility;
    const score = Math.min(90, Math.round(68 + (Math.abs(extremeZ) - 1.55) * 8 + Math.min(confirmationStrength, 1.8) * 5));
    if (score < 72) return null;

    return {
      direction: reversalDirection > 0 ? "CALL" : "PUT",
      confidence: score,
      probability: Math.min(0.61, 0.53 + (score - 68) * 0.0035),
      duration: confirmationStrength >= 1.1 ? 2 : 3,
      reason: `Retournement confirmé · écart ${Math.abs(extremeZ).toFixed(1)}σ`,
      agreement: 2,
      trendEfficiency: medium.efficiency,
      volatilityRatio,
    };
  }

  const targetDirection = strategy === "trend" ? mediumDirection : shortDirection;
  if (targetDirection === 0) return null;

  const agreement = [shortDirection, mediumDirection, longDirection].filter((value) => value === targetDirection).length;
  const opposing = [shortDirection, mediumDirection, longDirection].filter((value) => value === -targetDirection).length;
  if (agreement < 2 || opposing > 0) return null;

  if (strategy === "trend") {
    if (medium.efficiency < 0.28 || long.efficiency < 0.18 || medium.directionalShare < 0.58) return null;
    const continuationMove = latestMoves.slice(-3).reduce((sum, value) => sum + value, 0);
    if (direction(continuationMove, noiseFloor) !== targetDirection) return null;

    const score = Math.min(92, Math.round(
      58
      + agreement * 5
      + Math.min(medium.efficiency, 0.65) * 22
      + Math.min(long.efficiency, 0.55) * 12,
    ));
    if (score < 72) return null;

    return {
      direction: targetDirection > 0 ? "CALL" : "PUT",
      confidence: score,
      probability: Math.min(0.63, 0.53 + (score - 68) * 0.0038),
      duration: long.efficiency >= 0.36 ? 5 : 3,
      reason: `Tendance multi-horizon ${agreement}/3 confirmée`,
      agreement,
      trendEfficiency: medium.efficiency,
      volatilityRatio,
    };
  }

  const impulse = latestMoves.slice(-4).reduce((sum, value) => sum + value, 0);
  const previousImpulse = latestMoves.slice(-8, -4).reduce((sum, value) => sum + value, 0);
  const impulseStrength = Math.abs(impulse) / (baselineVolatility * 4);
  const acceleration = Math.abs(impulse) / Math.max(Math.abs(previousImpulse), baselineVolatility);
  if (short.directionalShare < 0.7 || impulseStrength < 0.65 || acceleration < 1.05 || medium.efficiency < 0.2) return null;

  const score = Math.min(91, Math.round(
    62
    + agreement * 4
    + Math.min(impulseStrength, 1.8) * 7
    + Math.min(acceleration, 2) * 4,
  ));
  if (score < 73) return null;

  return {
    direction: targetDirection > 0 ? "CALL" : "PUT",
    confidence: score,
    probability: Math.min(0.62, 0.53 + (score - 69) * 0.0037),
    duration: impulseStrength >= 1.1 ? 2 : 3,
    reason: `Impulsion alignée ${agreement}/3 · accélération ${acceleration.toFixed(1)}x`,
    agreement,
    trendEfficiency: medium.efficiency,
    volatilityRatio,
  };
}

export function evaluateRiseFallQuote(signal: RiseFallSignal, askPrice: number, payout: number) {
  const breakEvenProbability = payout > 0 ? askPrice / payout : 1;
  const edge = signal.probability - breakEvenProbability;
  const expectedValue = signal.probability * payout - askPrice;
  const minimumEdge = 0.012;

  return {
    breakEvenProbability,
    edge,
    expectedValue,
    minimumEdge,
    accepted: payout > 0
      && signal.confidence >= 72
      && signal.agreement >= 2
      && signal.volatilityRatio >= 0.35
      && signal.volatilityRatio <= 2.4
      && edge >= minimumEdge
      && expectedValue > 0,
  };
}
