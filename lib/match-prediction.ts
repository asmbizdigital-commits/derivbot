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
  observedFrequency?: number;
};

export type MatchPrediction = {
  ready: boolean;
  sampleSize: number;
  candidates: MatchCandidate[];
  bestCandidate: MatchCandidate | null;
  validationSamples?: number;
};

export type MatchSelectionMode = "advanced_probability" | "most_appearing_1000" | "frequency_window" | "top_two_frequency" | "top_two_adaptive";

export function isFastMatchMode(mode: MatchSelectionMode) {
  return mode === "top_two_frequency" || mode === "top_two_adaptive";
}

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

// These are estimates, not calibrated win probabilities. Always retain a
// uniform component so small historical clusters do not become certainty.
function adaptiveDistributions(digits: number[], windowSize: number) {
  const uniform = Array.from({ length: 10 }, () => BASE_PROBABILITY);
  const frequency = distribution(digits, windowSize, 50);
  const recent = distribution(digits, Math.min(20, windowSize), 50);
  const transition = conditionalDistribution(digits, [digits.at(-1)!]);
  return { models: [uniform, frequency, recent, transition.total >= 20 ? transition.probabilities : uniform], transition };
}

function buildAdaptiveMatchPrediction(digits: number[], preferredDigit: number | null, rules: MatchStrategyRules): MatchPrediction {
  const windowSize = Math.max(1, Math.min(1000, Math.trunc(rules.windowSize)));
  const counts = Array.from({ length: 10 }, () => 0);
  const sample = digits.slice(-windowSize);
  sample.forEach((digit) => counts[digit] += 1);
  const ranked = counts.map((count, digit) => ({ count, digit })).sort((a, b) => b.count - a.count || a.digit - b.digit);

  // Replay only past forecasts: history ends BEFORE each scored result.
  // Rolling expert weights are a ranking aid, not an out-of-sample edge claim.
  const logWeights = [Math.log(4), 0, 0, 0];
  const firstOutcome = Math.max(windowSize, digits.length - 100);
  const validationSamples = Math.max(0, digits.length - firstOutcome);
  for (let index = firstOutcome; index < digits.length; index += 1) {
    const { models } = adaptiveDistributions(digits.slice(Math.max(0, index - 500), index), windowSize);
    models.forEach((model, expert) => { logWeights[expert] += Math.log(model[digits[index]]); });
  }
  const maximumLogWeight = Math.max(...logWeights);
  const weights = logWeights.map((value) => Math.exp(value - maximumLogWeight));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const { models, transition } = adaptiveDistributions(digits.slice(-500), windowSize);
  const scores = counts.map((_, digit) => 0.5 * BASE_PROBABILITY + 0.5 * models.reduce((sum, model, expert) => sum + model[digit] * weights[expert] / weightTotal, 0));
  const topTwo = ranked.slice(0, 2).sort((a, b) => scores[b.digit] - scores[a.digit] || b.count - a.count || a.digit - b.digit);
  const targetDigit = preferredDigit ?? topTwo[0].digit;
  const ready = sample.length >= rules.minimumTicks;
  const candidates = counts.map((count, digit): MatchCandidate => ({
    digit,
    probability: scores[digit],
    observedFrequency: count / sample.length,
    longProbability: models[1][digit],
    mediumProbability: models[1][digit],
    shortProbability: models[2][digit],
    transitionProbability: models[3][digit],
    contextProbability: BASE_PROBABILITY,
    transitionSamples: transition.total,
    contextSamples: 0,
    agreementScore: models.slice(1).filter((model) => model[digit] > BASE_PROBABILITY).length,
    dominanceGap: scores[digit] - Math.max(...scores.filter((_, index) => index !== digit)),
    stable: ready && digit === targetDigit && scores[digit] >= rules.minimumProbability,
  }));
  return { ready, sampleSize: sample.length, candidates, bestCandidate: candidates.find((candidate) => candidate.stable) ?? null, validationSamples };
}

export function buildMatchPrediction(ticks: number[], pipSize: number, preferredDigit: number | null = null, rules: MatchStrategyRules = DEFAULT_MATCH_STRATEGY_RULES, completedContracts = 0): MatchPrediction {
  const prices = ticks.slice(-1000);
  if (!Number.isInteger(pipSize) || pipSize < 0 || pipSize > 20 || prices.some((price) => !Number.isFinite(price) || Math.abs(price) >= 1e21)) {
    return { ready: false, sampleSize: 0, candidates: [], bestCandidate: null };
  }
  const digits = prices.map((price) => Number(price.toFixed(pipSize).at(-1)));
  if (!digits.length) return { ready: false, sampleSize: 0, candidates: [], bestCandidate: null };

  if (rules.selectionMode === "top_two_adaptive") return buildAdaptiveMatchPrediction(digits, preferredDigit, rules);

  if (rules.selectionMode === "frequency_window" || rules.selectionMode === "top_two_frequency") {
    const windowSize = Math.max(1, Math.min(1000, Math.trunc(rules.windowSize)));
    const sample = digits.slice(-windowSize);
    const counts = Array.from({ length: 10 }, () => 0);
    sample.forEach((digit) => counts[digit] += 1);
    const ranked = counts
      .map((count, digit) => ({ digit, count, probability: sample.length ? count / sample.length : 0 }))
      .sort((left, right) => right.count - left.count || left.digit - right.digit);
    const top = ranked[0];
    const runnerUp = ranked[1] ?? { digit: top.digit, count: 0, probability: 0 };
    const alternatingRank = rules.selectionMode === "top_two_frequency" ? Math.max(0, Math.trunc(completedContracts)) % 2 : 0;
    const targetDigit = preferredDigit ?? ranked[alternatingRank].digit;
    const candidates = counts.map((count, digit) => {
      const probability = sample.length ? count / sample.length : 0;
      const dominanceGap = digit === top.digit ? probability - runnerUp.probability : probability - top.probability;
      const selectedDigit = digit === targetDigit;
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
