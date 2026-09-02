export type OverUnderContractType = "DIGITOVER" | "DIGITUNDER";

export type OverUnderCandidate = {
  contractType: OverUnderContractType;
  barrier: number;
  probability: number;
  conservativeProbability: number;
  theoreticalProbability: number;
  modelLift: number;
  effectiveSampleSize: number;
  shortProbability: number;
  mediumProbability: number;
  longProbability: number;
  transitionProbability: number;
  agreementScore: number;
  supportingDigits: number;
  stable: boolean;
};

export type OverUnderPrediction = {
  ready: boolean;
  sampleSize: number;
  lastDigit: number | null;
  probabilities: number[];
  candidates: OverUnderCandidate[];
  bestCandidate: OverUnderCandidate | null;
};

export type UnderEightTransitionState = {
  state: "collecting" | "waiting_for_9" | "armed" | "triggered";
  previousDigit: number | null;
  lastDigit: number | null;
};

const BAYES_ALPHA = 2;
const MINIMUM_TICKS = 200;
const CONSERVATIVE_Z = 1;
const MINIMUM_MODEL_LIFT = 0.008;
const TARGET_WIN_PROBABILITY = 0.72;

export function getPriceLastDigit(price: number, pipSize: number) {
  return Number(price.toFixed(pipSize).at(-1));
}

export function getUnderEightTransitionState(ticks: number[], pipSize: number): UnderEightTransitionState {
  if (ticks.length < 2) {
    return {
      state: "collecting",
      previousDigit: null,
      lastDigit: ticks.length ? getPriceLastDigit(ticks[0], pipSize) : null,
    };
  }

  const previousDigit = getPriceLastDigit(ticks.at(-2)!, pipSize);
  const lastDigit = getPriceLastDigit(ticks.at(-1)!, pipSize);
  return {
    state: previousDigit === 9 && lastDigit !== 9
      ? "triggered"
      : lastDigit === 9
        ? "armed"
        : "waiting_for_9",
    previousDigit,
    lastDigit,
  };
}

function weightedDistribution(digits: number[], windowSize: number, lambda: number) {
  const sample = digits.slice(-windowSize).reverse();
  const counts = Array.from({ length: 10 }, () => 0);
  let weightSum = 0;
  let squaredWeightSum = 0;

  sample.forEach((digit, index) => {
    const weight = lambda ** index;
    counts[digit] += weight;
    weightSum += weight;
    squaredWeightSum += weight * weight;
  });

  const denominator = weightSum + 10 * BAYES_ALPHA;
  return {
    probabilities: counts.map((count) => (count + BAYES_ALPHA) / denominator),
    effectiveSampleSize: squaredWeightSum ? (weightSum * weightSum) / squaredWeightSum : 0,
  };
}

function transitionDistribution(digits: number[], currentDigit: number) {
  const counts = Array.from({ length: 10 }, () => 0);
  let weightSum = 0;
  let squaredWeightSum = 0;
  const transitions = digits.slice(-1000);

  for (let index = transitions.length - 2, age = 0; index >= 0; index -= 1, age += 1) {
    if (transitions[index] !== currentDigit) continue;
    const weight = 0.998 ** age;
    counts[transitions[index + 1]] += weight;
    weightSum += weight;
    squaredWeightSum += weight * weight;
  }

  const denominator = weightSum + 10 * BAYES_ALPHA;
  return {
    probabilities: counts.map((count) => (count + BAYES_ALPHA) / denominator),
    effectiveSampleSize: squaredWeightSum ? (weightSum * weightSum) / squaredWeightSum : 0,
  };
}

function sumRange(values: number[], start: number, end: number) {
  return values.slice(start, end).reduce((sum, value) => sum + value, 0);
}

export function buildOverUnderPrediction(ticks: number[], pipSize: number): OverUnderPrediction {
  const prices = ticks.slice(-1000);
  const digits = prices.map((price) => getPriceLastDigit(price, pipSize));
  const lastDigit = digits.at(-1) ?? null;
  const short = weightedDistribution(digits, 50, 0.97);
  const medium = weightedDistribution(digits, 200, 0.99);
  const long = weightedDistribution(digits, 1000, 0.998);
  const transition = transitionDistribution(digits, lastDigit ?? 0);
  const probabilities = Array.from({ length: 10 }, (_, digit) =>
    0.2 * 0.1
    + 0.3 * short.probabilities[digit]
    + 0.25 * medium.probabilities[digit]
    + 0.1 * long.probabilities[digit]
    + 0.15 * transition.probabilities[digit]);

  const effectiveSampleSize = Math.max(1, Math.min(
    digits.length,
    (0.3 * short.effectiveSampleSize
      + 0.25 * medium.effectiveSampleSize
      + 0.1 * long.effectiveSampleSize
      + 0.15 * transition.effectiveSampleSize) / 0.8,
  ));

  const candidates: OverUnderCandidate[] = [];
  const addCandidate = (contractType: OverUnderContractType, barrier: number) => {
    const isOver = contractType === "DIGITOVER";
    const start = isOver ? barrier + 1 : 0;
    const end = isOver ? 10 : barrier;
    const theoreticalProbability = isOver ? (9 - barrier) / 10 : barrier / 10;
    const probability = sumRange(probabilities, start, end);
    const shortProbability = sumRange(short.probabilities, start, end);
    const mediumProbability = sumRange(medium.probabilities, start, end);
    const longProbability = sumRange(long.probabilities, start, end);
    const transitionProbability = sumRange(transition.probabilities, start, end);
    const standardError = Math.sqrt((probability * (1 - probability)) / effectiveSampleSize);
    const conservativeProbability = Math.max(0, probability - CONSERVATIVE_Z * standardError);
    const supportingDigits = probabilities.slice(start, end).filter((value) => value >= 0.102).length;
    const agreementScore = [shortProbability, mediumProbability, longProbability, transitionProbability]
      .filter((value) => value > theoreticalProbability).length;
    const stable = digits.length >= MINIMUM_TICKS
      && theoreticalProbability >= 0.7
      && probability >= Math.max(TARGET_WIN_PROBABILITY, theoreticalProbability + MINIMUM_MODEL_LIFT)
      && shortProbability >= theoreticalProbability
      && mediumProbability >= theoreticalProbability
      && agreementScore >= 2
      && supportingDigits >= 2;
    candidates.push({
      contractType,
      barrier,
      probability,
      conservativeProbability,
      theoreticalProbability,
      modelLift: probability - theoreticalProbability,
      effectiveSampleSize,
      shortProbability,
      mediumProbability,
      longProbability,
      transitionProbability,
      agreementScore,
      supportingDigits,
      stable,
    });
  };

  for (let barrier = 0; barrier <= 2; barrier += 1) addCandidate("DIGITOVER", barrier);
  for (let barrier = 7; barrier <= 9; barrier += 1) addCandidate("DIGITUNDER", barrier);

  const stableCandidates = candidates.filter((candidate) => candidate.stable);
  const bestCandidate = stableCandidates.sort((left, right) =>
    right.agreementScore - left.agreementScore
    || right.probability - left.probability)[0] ?? null;

  return {
    ready: digits.length >= MINIMUM_TICKS,
    sampleSize: digits.length,
    lastDigit,
    probabilities,
    candidates,
    bestCandidate,
  };
}

export function evaluateOverUnderQuote(
  candidate: OverUnderCandidate,
  askPrice: number,
  payout: number,
) {
  const breakEvenProbability = payout > 0 ? askPrice / payout : 1;
  const decisionProbability = candidate.probability;
  const edge = decisionProbability - breakEvenProbability;
  const expectedValue = decisionProbability * payout - askPrice;
  const minimumEdge = 0.0025;
  const windowConsensusProbability = (candidate.shortProbability + candidate.mediumProbability) / 2;
  const windowsAgreeWithPayout = windowConsensusProbability >= breakEvenProbability - 0.003
    && candidate.longProbability >= candidate.theoreticalProbability - 0.015
    && candidate.transitionProbability >= candidate.theoreticalProbability - 0.03;
  const highWinRateBarrier = (candidate.contractType === "DIGITOVER" && candidate.barrier <= 2)
    || (candidate.contractType === "DIGITUNDER" && candidate.barrier >= 7);
  return {
    decisionProbability,
    breakEvenProbability,
    minimumEdge,
    edge,
    expectedValue,
    highWinRateBarrier,
    windowConsensusProbability,
    windowsAgreeWithPayout,
    accepted: payout > 0
      && highWinRateBarrier
      && candidate.stable
      && decisionProbability >= TARGET_WIN_PROBABILITY
      && candidate.modelLift >= MINIMUM_MODEL_LIFT
      && windowsAgreeWithPayout
      && edge >= minimumEdge
      && expectedValue > 0,
  };
}
