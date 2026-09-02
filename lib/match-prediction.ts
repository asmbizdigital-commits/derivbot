export type MatchCandidate = {
  digit: number;
  probability: number;
  longProbability: number;
  mediumProbability: number;
  shortProbability: number;
  transitionProbability: number;
  contextProbability: number;
  transitionSamples: number;
  contextSamples: number;
  agreementScore: number;
  dominanceGap: number;
  stable: boolean;
};

export type MatchPrediction = {
  ready: boolean;
  sampleSize: number;
  candidates: MatchCandidate[];
  bestCandidate: MatchCandidate | null;
};

export type MatchSelectionMode = "advanced_probability" | "most_appearing_1000" | "frequency_window";

export type MatchStrategyRules = {
  selectionMode: MatchSelectionMode;
  minimumTicks: number;
  minimumProbability: number;
  minimumAgreementScore: number;
  minimumDominanceGap: number;
  minimumMediumProbability: number;
  minimumShortProbability: number;
  minimumEdge: number;
  requireConditionalEvidence: boolean;
  maximumTopTwoGap: number;
  requireLastDigitMatch: boolean;
  windowSize: number;
};

export const DEFAULT_MATCH_STRATEGY_RULES: MatchStrategyRules = {
  selectionMode: "advanced_probability",
  minimumTicks: 200,
  minimumProbability: 0.135,
  minimumAgreementScore: 4,
  minimumDominanceGap: 0.012,
  minimumMediumProbability: 0.108,
  minimumShortProbability: 0.118,
  minimumEdge: 0.01,
  requireConditionalEvidence: true,
  maximumTopTwoGap: 1,
  requireLastDigitMatch: false,
  windowSize: 10,
};

const BASE_PROBABILITY = 0.1;

function posteriorProbability(hits: number, total: number, priorStrength: number) {
  return (hits + BASE_PROBABILITY * priorStrength) / (total + priorStrength);
}

function distribution(digits: number[], windowSize: number, priorStrength: number) {
  const sample = digits.slice(-windowSize);
  const counts = Array.from({ length: 10 }, () => 0);
  sample.forEach((digit) => counts[digit] += 1);
  return counts.map((count) => posteriorProbability(count, sample.length, priorStrength));
}

function conditionalDistribution(digits: number[], context: number[]) {
  const counts = Array.from({ length: 10 }, () => 0);
  let total = 0;

  for (let index = context.length - 1; index < digits.length - 1; index += 1) {
    const matches = context.every((digit, offset) => digits[index - context.length + 1 + offset] === digit);
    if (!matches) continue;
    counts[digits[index + 1]] += 1;
    total += 1;
  }

  const priorStrength = context.length === 2 ? 24 : 36;
  return {
    total,
    probabilities: counts.map((count) => posteriorProbability(count, total, priorStrength)),
  };
}

export function buildMatchPrediction(ticks: number[], pipSize: number, preferredDigit: number | null = null, rules: MatchStrategyRules = DEFAULT_MATCH_STRATEGY_RULES): MatchPrediction {
  const prices = ticks.slice(-1000);
  const digits = prices.map((price) => Number(price.toFixed(pipSize).at(-1)));
  if (!digits.length) return { ready: false, sampleSize: 0, candidates: [], bestCandidate: null };

  if (rules.selectionMode === "frequency_window") {
    const windowSize = Math.max(1, Math.min(1000, Math.trunc(rules.windowSize)));
    const sample = digits.slice(-windowSize);
    const counts = Array.from({ length: 10 }, () => 0);
    sample.forEach((digit) => counts[digit] += 1);
    const ranked = counts
      .map((count, digit) => ({ digit, count, probability: sample.length ? count / sample.length : 0 }))
      .sort((left, right) => right.count - left.count || left.digit - right.digit);
    const top = ranked[0];
    const runnerUp = ranked[1] ?? { digit: top.digit, count: 0, probability: 0 };
    const targetDigit = preferredDigit === null ? top.digit : preferredDigit;
    const candidates = counts.map((count, digit) => {
      const probability = sample.length ? count / sample.length : 0;
      const dominanceGap = digit === top.digit ? probability - runnerUp.probability : probability - top.probability;
      const selectedDigit = digit === targetDigit && (preferredDigit !== null || digit === top.digit);
      const stable = sample.length >= rules.minimumTicks
        && selectedDigit
        && probability >= rules.minimumProbability;
      return {
        digit,
        probability,
        longProbability: probability,
        mediumProbability: probability,
        shortProbability: probability,
        transitionProbability: probability,
        contextProbability: probability,
        transitionSamples: sample.length,
        contextSamples: sample.length,
        agreementScore: stable ? 5 : 1,
        dominanceGap,
        stable,
      };
    });
    const selected = candidates.find((candidate) => candidate.digit === targetDigit) ?? null;
    return {
      ready: sample.length >= rules.minimumTicks,
      candidates,
      sampleSize: sample.length,
      bestCandidate: selected?.stable ? selected : null,
    };
  }

  if (rules.selectionMode === "most_appearing_1000") {
    const counts = Array.from({ length: 10 }, () => 0);
    digits.forEach((digit) => counts[digit] += 1);
    const ranked = counts
      .map((count, digit) => ({ digit, count, probability: count / digits.length }))
      .sort((left, right) => right.count - left.count || left.digit - right.digit);
    const top = ranked[0];
    const runnerUp = ranked[1] ?? { digit: top.digit, count: 0, probability: 0 };
    const lastDigit = digits.at(-1)!;
    const topTwoGap = top.probability - runnerUp.probability;
    const targetDigit = preferredDigit === null ? top.digit : preferredDigit;
    const candidates = counts.map((count, digit) => {
      const probability = count / digits.length;
      const dominanceGap = digit === top.digit ? topTwoGap : probability - top.probability;
      const selectedTopDigit = digit === targetDigit && digit === top.digit;
      const lastDigitPass = !rules.requireLastDigitMatch || lastDigit === digit;
      const stable = digits.length >= rules.minimumTicks
        && selectedTopDigit
        && probability >= rules.minimumProbability
        && topTwoGap <= rules.maximumTopTwoGap
        && lastDigitPass;
      return {
        digit,
        probability,
        longProbability: probability,
        mediumProbability: probability,
        shortProbability: probability,
        transitionProbability: probability,
        contextProbability: probability,
        transitionSamples: digits.length,
        contextSamples: digits.length,
        agreementScore: stable ? 5 : 1,
        dominanceGap,
        stable,
      };
    });
    const selected = candidates.find((candidate) => candidate.digit === targetDigit) ?? null;
    return {
      ready: digits.length >= rules.minimumTicks,
      candidates,
      sampleSize: digits.length,
      bestCandidate: selected?.stable ? selected : null,
    };
  }

  const long = distribution(digits, 500, 50);
  const medium = distribution(digits, 160, 35);
  const short = distribution(digits, 50, 25);
  const transition = conditionalDistribution(digits, [digits.at(-1)!]);
  const context = digits.length >= 2
    ? conditionalDistribution(digits, digits.slice(-2))
    : { total: 0, probabilities: Array.from({ length: 10 }, () => BASE_PROBABILITY) };

  const rawCandidates = Array.from({ length: 10 }, (_, digit) => {
    const transitionWeight = transition.total >= 10 ? 0.16 : 0.06;
    const contextWeight = context.total >= 5 ? 0.1 : 0.02;
    const baseWeight = 1 - 0.22 - 0.24 - 0.24 - transitionWeight - contextWeight;
    const probability = baseWeight * BASE_PROBABILITY
      + 0.22 * long[digit]
      + 0.24 * medium[digit]
      + 0.24 * short[digit]
      + transitionWeight * transition.probabilities[digit]
      + contextWeight * context.probabilities[digit];
    const agreementScore = [
      long[digit],
      medium[digit],
      short[digit],
      transition.probabilities[digit],
      context.probabilities[digit],
    ].filter((value) => value >= 0.105).length;

    return {
      digit,
      probability,
      longProbability: long[digit],
      mediumProbability: medium[digit],
      shortProbability: short[digit],
      transitionProbability: transition.probabilities[digit],
      contextProbability: context.probabilities[digit],
      transitionSamples: transition.total,
      contextSamples: context.total,
      agreementScore,
      dominanceGap: 0,
      stable: false,
    };
  });

  const ranked = [...rawCandidates].sort((left, right) => right.probability - left.probability);
  const runnerUpProbability = ranked[1]?.probability ?? BASE_PROBABILITY;
  const candidates = rawCandidates.map((candidate) => {
    const dominanceGap = candidate.probability - Math.max(
      ...rawCandidates.filter((item) => item.digit !== candidate.digit).map((item) => item.probability),
    );
    const conditionalEvidence = (candidate.transitionSamples >= 10 && candidate.transitionProbability >= 0.11)
      || (candidate.contextSamples >= 4 && candidate.contextProbability >= 0.115);
    const trendAligned = candidate.mediumProbability >= rules.minimumMediumProbability
      && candidate.shortProbability >= rules.minimumShortProbability
      && candidate.shortProbability >= candidate.longProbability - 0.004;
    const conditionalEvidencePass = !rules.requireConditionalEvidence || conditionalEvidence;
    const stable = digits.length >= rules.minimumTicks
      && candidate.probability >= rules.minimumProbability
      && candidate.longProbability >= 0.1
      && trendAligned
      && candidate.agreementScore >= rules.minimumAgreementScore
      && conditionalEvidencePass
      && dominanceGap >= rules.minimumDominanceGap;
    return { ...candidate, dominanceGap, stable };
  });

  const selected = preferredDigit === null
    ? [...candidates].sort((left, right) => right.probability - left.probability)[0]
    : candidates.find((candidate) => candidate.digit === preferredDigit);
  const bestCandidate = selected?.stable ? selected : null;

  return {
    ready: digits.length >= rules.minimumTicks,
    sampleSize: digits.length,
    candidates,
    bestCandidate: bestCandidate && bestCandidate.probability >= runnerUpProbability ? bestCandidate : null,
  };
}

export function evaluateMatchQuote(candidate: MatchCandidate, askPrice: number, payout: number, rules: MatchStrategyRules = DEFAULT_MATCH_STRATEGY_RULES) {
  const breakEvenProbability = payout > 0 ? askPrice / payout : 1;
  const edge = candidate.probability - breakEvenProbability;
  const expectedValue = candidate.probability * payout - askPrice;
  const minimumEdge = rules.minimumEdge;
  const windowsCoverBreakEven = candidate.longProbability >= breakEvenProbability - 0.01
    && candidate.mediumProbability >= breakEvenProbability
    && candidate.shortProbability >= breakEvenProbability + 0.005;

  return {
    breakEvenProbability,
    edge,
    expectedValue,
    minimumEdge,
    accepted: payout > 0
      && candidate.stable
      && candidate.probability >= rules.minimumProbability
      && candidate.agreementScore >= rules.minimumAgreementScore
      && windowsCoverBreakEven
      && edge >= minimumEdge
      && expectedValue > 0,
  };
}
