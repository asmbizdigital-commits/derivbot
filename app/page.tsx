"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, BarChart3, Bot, BrainCircuit, ChevronDown, Download, Gauge, LayoutDashboard, LockKeyhole, Menu, Octagon, Play, PlugZap, Radio, RefreshCw, Settings2, ShieldCheck, Signal, Sparkles, Square, Target, Upload, WalletCards, X, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { DigitPredictionBalloon } from "@/components/digit-prediction-balloon";
import { MatchPredictionBalloon } from "@/components/match-prediction-balloon";
import { evaluateOverUnderQuote, getUnderEightTransitionState, type OverUnderCandidate } from "@/lib/over-under-prediction";
import { buildRiseFallSignal, evaluateRiseFallQuote, type RiseFallSignal } from "@/lib/rise-fall-prediction";
import { OverUnderPairPanel } from "@/components/over-under-pair-panel";
import { OverUnderPairScanner, EMPTY_PAIR_STATS, pairBalanceAllows, type PairRow, type PairTrade, type PairStats } from "@/lib/over-under-pair";
import { DBX_MATCH_CONFIG, DBX_DYNAMIC_MATCH_CONFIG, DBX_LAST_DIGIT_CONFIG, DBX_V3_GUARD, dbxV3BudgetAllows, evaluateDbxV3Quote, isDbxMode, buildDbxMatchOrder, validDbxQuote } from "@/lib/dbx-matches";
import { DEFAULT_MATCH_STRATEGY_RULES, buildMatchPrediction, evaluateMatchQuote, isFastMatchMode, type MatchCandidate, type MatchStrategyRules } from "@/lib/match-prediction";
import { DERIV_MARKETS, DERIV_MARKET_PIP_SIZES, isDerivMarketSymbol, type DerivMarketSymbol } from "@/lib/deriv-markets";

const pricePaths = {
  "Volatility 25": "M0 102 C20 97 26 70 48 76 S78 98 95 70 S130 40 152 54 S184 97 204 72 S237 29 258 39 S287 74 308 54 S337 23 360 12",
  "Volatility 100": "M0 89 C20 72 36 108 54 85 S82 39 101 65 S128 111 147 80 S180 28 199 48 S225 92 244 64 S270 16 291 38 S329 83 360 30",
};
const prices = {
  "Volatility 25": { value: "2,458.37", change: "+1.24%", score: 82, bias: "HAUSSIER", setup: "Sweep + BOS + FVG" },
  "Volatility 100": { value: "1,927.84", change: "+0.71%", score: 68, bias: "NEUTRE", setup: "En attente de CHOCH" },
};

type AppConfig = {
  referenceCapitalUsd: number;
  maxRiskUsd: number;
  minScore: number;
};

type AccountMode = "demo" | "real";

type SystemStatus = {
  config?: AppConfig;
  mt5?: {
    online: boolean;
    lastSeenAt: string | null;
    ageMs: number | null;
    payload?: {
      symbol?: string;
      currency?: string;
      balance?: number;
      equity?: number;
      profit?: number;
      last?: number;
      demo?: boolean;
      positions?: Mt5Position[];
    };
    analysis?: MarketAnalysis;
    ticks?: Mt5Tick[];
  };
};

type MarketAnalysis = {
  request?: {
    symbol: string;
    price?: number;
    timeframe: "M5" | "M15" | "H1";
    smc: {
      htfBias: "bullish" | "bearish" | "neutral";
      bos: boolean;
      choch: boolean;
      liquiditySweep: boolean;
      fairValueGap: boolean;
      premiumDiscountAligned: boolean;
      ltfConfirmation: boolean;
    };
    ml: { confidence: number };
  };
  decision?: {
    approved: boolean;
    action: "BUY" | "SELL" | "NO_TRADE";
    score: number;
    risk: { requestedUsd: number; capitalPercent: number };
  };
};

type Mt5Position = {
  ticket: number;
  symbol: string;
  type: "BUY" | "SELL";
  volume: number;
  priceOpen: number;
  profit: number;
};

type Mt5Tick = {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  receivedAt: string;
};

type DerivStatus = "connecting" | "public" | "demo" | "real" | "error";
type DerivContractCategory = "rise_fall" | "matches_differs" | "over_under" | "even_odd" | "touch_no_touch";
type DerivContractCode = "CALL" | "PUT" | "DIGITMATCH" | "DIGITDIFF" | "DIGITOVER" | "DIGITUNDER" | "DIGITEVEN" | "DIGITODD" | "ONETOUCH" | "NOTOUCH";
type DerivBarrier = number | string | null;

type DerivProposal = {
  id: string;
  askPrice: number;
  payout: number;
  longcode: string;
  duration: number;
  contractType: DerivContractCode;
  barrier: DerivBarrier;
  stake: number;
  symbol: string;
};

type DerivPendingBuy = {
  dbx?: true;
  dbxLastDigit?: true;
  dbxGuardRequestedAt?: number;
  pair?: boolean;
  contractType: DerivContractCode;
  barrier: DerivBarrier;
  stake: number;
  symbol: string;
  duration: number;
  batchIndex?: number;
  batchTotal?: number;
  overUnderCandidate?: OverUnderCandidate;
  riseFallSignal?: RiseFallSignal;
  matchCandidate?: MatchCandidate;
};

type DerivAutoQuote = DerivPendingBuy & {
  reqId: number;
  overUnderScan?: boolean;
};

type DerivOverUnderQualifiedQuote = {
  autoQuote: DerivAutoQuote;
  proposalId: string;
  askPrice: number;
  payout: number;
  edge: number;
  expectedValue: number;
};

type DerivOverUnderQuoteScan = {
  pendingReqIds: Set<number>;
  qualifiedQuotes: DerivOverUnderQualifiedQuote[];
};

type DerivDeal = {
  contractId: number;
  buyPrice: number;
  payout: number;
  contractType: DerivContractCode;
  barrier: DerivBarrier;
  symbol: string;
  createdAt: string;
  duration: number;
  ticksElapsed: number;
  status: "open" | "won" | "lost";
  profit: number | null;
  entrySpot: number | null;
  currentSpot: number | null;
};

type DerivApiProfitTransaction = {
  transaction_id?: string | number;
  contract_id?: string | number;
  buy_price?: string | number;
  sell_price?: string | number;
  payout?: string | number;
  profit_loss?: string | number;
  purchase_time?: string | number;
  sell_time?: string | number;
  contract_type?: string;
  barrier?: string | number;
  underlying_symbol?: string;
  longcode?: string;
  shortcode?: string;
};

type DurationDecision = {
  duration: 1 | 2 | 3 | 5 | 10;
  label: string;
  reason: string;
};

type DerivMode = "manual" | "auto";
type DerivStrategy = "trend" | "momentum" | "reversal";
type DerivHistoryPeriod = "today" | "7d" | "30d" | "all";
type DerivAutoDigitBarrierMode = "dynamic" | "fixed";
type DerivOverUnderStrategy = "under8_transition" | "over2" | "over5" | "under5" | "under5_over4_cross";
type EaStrategyPreset = "smc_ai" | "trend_breakout" | "scalping" | "conservative";
type EaTimeframe = "M5" | "M15" | "H1";
type CopyTradingProvider = "mt5_master" | "deriv_signal" | "manual_leader";

type DerivDigitAutoSignal = {
  contractType: DerivContractCode;
  barrier: DerivBarrier;
  confidence: number;
  reason: string;
  overUnderCandidate?: OverUnderCandidate;
  overUnderCandidates?: OverUnderCandidate[];
  matchCandidate?: MatchCandidate;
};

type ImportedMatchStrategy = {
  durationTicks?: number;
  dbxMinimumProbability?: number | null;
  lossBudgetStakes: number | null;
  executionMode: "statistical" | "dbx_fixed" | "dbx_dynamic" | "dbx_last_digit";
  name: string;
  contractType: "DIGITMATCH";
  barrierMode: DerivAutoDigitBarrierMode;
  fixedDigit: number | null;
  contractsPerSignal: number;
  stake: number | null;
  rules: MatchStrategyRules;
  bypassPayoutFilter: boolean;
  digitBlockAfterLosses: number;
  digitBlockTicksMultiplier: number;
  digitBlockMaxTicks: number;
  takeProfit: number | null;
  stopLoss: number | null;
  recoveryMultiplier: number;
  maxRecoverySteps: number;
  maxRecoveryStakeMultiplier: number;
};

const derivContractCategories: Record<DerivContractCategory, { name: string; description: string; options: DerivContractCode[] }> = {
  rise_fall: { name: "Rise / Fall", description: "Gagne si le dernier tick finit au-dessus ou en dessous du point d'entrée.", options: ["CALL", "PUT"] },
  matches_differs: { name: "Matches / Differs", description: "Compare le dernier chiffre du tick final à la barrière choisie.", options: ["DIGITMATCH", "DIGITDIFF"] },
  over_under: { name: "Over / Under", description: "Gagne si le dernier chiffre finit strictement au-dessus ou en dessous de la barrière.", options: ["DIGITOVER", "DIGITUNDER"] },
  even_odd: { name: "Even / Odd", description: "Gagne selon la parité du dernier chiffre du tick final.", options: ["DIGITEVEN", "DIGITODD"] },
  touch_no_touch: { name: "Touch / No Touch", description: "Gagne si le prix touche, ou ne touche pas, une barrière cible pendant le contrat.", options: ["ONETOUCH", "NOTOUCH"] },
};

const derivContractLabels: Record<DerivContractCode, string> = {
  CALL: "Hausse",
  PUT: "Baisse",
  DIGITMATCH: "Matches",
  DIGITDIFF: "Differs",
  DIGITOVER: "Over",
  DIGITUNDER: "Under",
  DIGITEVEN: "Even",
  DIGITODD: "Odd",
  ONETOUCH: "Touch",
  NOTOUCH: "No Touch",
};

const derivStrategies: Record<DerivStrategy, { name: string; description: string }> = {
  trend: { name: "Tendance multi-horizon", description: "Confirme la même direction sur 8, 21 et 55 ticks avant l’entrée." },
  momentum: { name: "Impulsion filtrée", description: "Valide direction, accélération et volatilité avant une entrée courte." },
  reversal: { name: "Retournement confirmé", description: "Attend un écart statistique marqué puis un vrai tick de retournement." },
};

const derivOverUnderStrategies: Record<DerivOverUnderStrategy, { name: string; description: string; contractType: "DIGITOVER" | "DIGITUNDER"; barrier: number }> = {
  under5_over4_cross: { name: "Under 5 + Over 4", description: "Analyse les fréquences sur toutes les volatilités et attend un passage vers la zone gagnante pour Under 5 et Over 4 sur deux indices distincts.", contractType: "DIGITUNDER", barrier: 5 },
  under8_transition: { name: "Under 8", description: "Scanne toutes les volatilités et lance deux Under 8 sur deux indices distincts après leur transition 9 → autre digit.", contractType: "DIGITUNDER", barrier: 8 },
  over2: { name: "Over 2", description: "Entre Over 2 quand les derniers chiffres favorisent 3 à 9.", contractType: "DIGITOVER", barrier: 2 },
  over5: { name: "Over 5", description: "Attend un digit 4, puis entre Over 5 dès que le flux passe à un autre digit.", contractType: "DIGITOVER", barrier: 5 },
  under5: { name: "Under 5", description: "Entre Under 5 quand les derniers chiffres favorisent 0 à 4.", contractType: "DIGITUNDER", barrier: 5 },
};

function isMultiIndexOverUnder(strategy: DerivOverUnderStrategy) {
  return strategy === "under5_over4_cross" || strategy === "under8_transition";
}

function getOverUnderStrategySummary(strategy: DerivOverUnderStrategy) {
  if (strategy === "under5_over4_cross") return "Transition vers la zone gagnante · deux indices distincts";
  const config = derivOverUnderStrategies[strategy];
  if (strategy === "under8_transition") return "9 → autre digit · deux indices distincts · toutes volatilités";
  if (strategy === "over5") return "Déclenche après 4 -> autre digit";
  return `${config.contractType === "DIGITOVER" ? "Over" : "Under"} ${config.barrier} · filtre statistique`;
}

const defaultImportedMatchStrategy: ImportedMatchStrategy = {
  lossBudgetStakes: null,
  executionMode: "statistical",
  name: "Matches avancé",
  contractType: "DIGITMATCH",
  barrierMode: "dynamic",
  fixedDigit: null,
  contractsPerSignal: 1,
  stake: null,
  rules: DEFAULT_MATCH_STRATEGY_RULES,
  bypassPayoutFilter: false,
  digitBlockAfterLosses: 2,
  digitBlockTicksMultiplier: 12,
  digitBlockMaxTicks: 60,
  takeProfit: null,
  stopLoss: null,
  recoveryMultiplier: 2,
  maxRecoverySteps: 0,
  maxRecoveryStakeMultiplier: 10,
};

const dbxMatchStrategy: ImportedMatchStrategy = {
  ...defaultImportedMatchStrategy,
  executionMode: "dbx_fixed",
  durationTicks: DBX_MATCH_CONFIG.duration,
  name: DBX_MATCH_CONFIG.name,
  barrierMode: "fixed",
  fixedDigit: DBX_MATCH_CONFIG.barrier,
  stake: DBX_MATCH_CONFIG.stake,
  contractsPerSignal: 1,
  bypassPayoutFilter: true,
};

const dbxDynamicMatchStrategy: ImportedMatchStrategy = {
  ...dbxMatchStrategy,
  executionMode: "dbx_dynamic",
  dbxMinimumProbability: null,
  lossBudgetStakes: DBX_V3_GUARD.defaultLossBudgetStakes,
  bypassPayoutFilter: false,
  name: DBX_DYNAMIC_MATCH_CONFIG.name,
  barrierMode: "dynamic",
  fixedDigit: null,
  rules: {
    ...DEFAULT_MATCH_STRATEGY_RULES,
    selectionMode: "top_two_adaptive",
    minimumTicks: DBX_DYNAMIC_MATCH_CONFIG.windowSize,
    windowSize: DBX_DYNAMIC_MATCH_CONFIG.windowSize,
    minimumProbability: 0,
  },
};

const dbxLastDigitStrategy: ImportedMatchStrategy = {
  ...dbxDynamicMatchStrategy,
  executionMode: "dbx_last_digit",
  lossBudgetStakes: null,
  bypassPayoutFilter: true,
  name: DBX_LAST_DIGIT_CONFIG.name,
  rules: {
    ...dbxDynamicMatchStrategy.rules,
    selectionMode: "last_digit_top_two",
    minimumTicks: DBX_LAST_DIGIT_CONFIG.windowSize,
    windowSize: DBX_LAST_DIGIT_CONFIG.windowSize,
  },
};

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseAdvancedMatchStrategyMarkdown(markdown: string): ImportedMatchStrategy {
  const jsonBlock = markdown.match(/```json\s*([\s\S]*?)```/i)?.[1];
  if (!jsonBlock) throw new Error("Bloc JSON introuvable dans le fichier Markdown");
  const data = JSON.parse(jsonBlock) as Record<string, unknown>;
  if (data.strategy !== "advanced_matches" || data.contractType !== "DIGITMATCH") {
    throw new Error("Le fichier n'est pas une stratégie Matches avancée compatible");
  }
  if (data.executionMode === "dbx_fixed" || data.executionMode === "dbx_dynamic" || data.executionMode === "dbx_last_digit") {
    const profile = data.executionMode === "dbx_last_digit" ? dbxLastDigitStrategy : data.executionMode === "dbx_dynamic" ? dbxDynamicMatchStrategy : dbxMatchStrategy;
    const risk = typeof data.risk === "object" && data.risk !== null ? data.risk as Record<string, unknown> : {};
    return { ...profile, stake: clampNumber(data.stake, DBX_MATCH_CONFIG.stake, 0.35, 10_000),
      durationTicks: data.executionMode !== "dbx_last_digit" ? Math.trunc(clampNumber(data.durationTicks, DBX_MATCH_CONFIG.duration, 1, 10)) : DBX_MATCH_CONFIG.duration,
      dbxMinimumProbability: data.executionMode === "dbx_dynamic" && data.dbxMinimumProbability != null ? clampNumber(data.dbxMinimumProbability, 0.1, 0, 1) : null,
      lossBudgetStakes: data.executionMode === "dbx_dynamic" ? clampNumber(risk.lossBudgetStakes, DBX_V3_GUARD.defaultLossBudgetStakes, 1, 100) : null };
  }
  const rulesData = typeof data.rules === "object" && data.rules !== null ? data.rules as Record<string, unknown> : {};
  const riskData = typeof data.risk === "object" && data.risk !== null ? data.risk as Record<string, unknown> : {};
  const barrierMode = data.barrierMode === "fixed" ? "fixed" : "dynamic";
  const fixedDigit = barrierMode === "fixed" ? Math.trunc(clampNumber(data.fixedDigit, 5, 0, 9)) : null;
  const selectionMode = rulesData.selectionMode === "most_appearing_1000" || rulesData.selectionMode === "frequency_window" || rulesData.selectionMode === "top_two_frequency" || rulesData.selectionMode === "top_two_adaptive"
    ? rulesData.selectionMode
    : DEFAULT_MATCH_STRATEGY_RULES.selectionMode;
  const configuredStake = data.stake ?? data.baseStake;
  const configuredWindowSize = rulesData.windowSize ?? data.windowSize;
  const configuredMinimumProbability = rulesData.minimumProbability ?? data.frequencyThreshold;
  return {
    executionMode: "statistical",
    lossBudgetStakes: null,
    name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : defaultImportedMatchStrategy.name,
    contractType: "DIGITMATCH",
    barrierMode,
    fixedDigit,
    contractsPerSignal: isFastMatchMode(selectionMode) ? 1 : Math.trunc(clampNumber(data.contractsPerSignal, defaultImportedMatchStrategy.contractsPerSignal, 1, 10)),
    stake: configuredStake === undefined || configuredStake === null ? null : clampNumber(configuredStake, 1, 0.35, 10_000),
    rules: {
      selectionMode,
      minimumTicks: Math.trunc(clampNumber(rulesData.minimumTicks, DEFAULT_MATCH_STRATEGY_RULES.minimumTicks, 1, 1000)),
      minimumProbability: clampNumber(configuredMinimumProbability, DEFAULT_MATCH_STRATEGY_RULES.minimumProbability, 0, 1),
      minimumAgreementScore: Math.trunc(clampNumber(rulesData.minimumAgreementScore, DEFAULT_MATCH_STRATEGY_RULES.minimumAgreementScore, 1, 5)),
      minimumDominanceGap: clampNumber(rulesData.minimumDominanceGap, DEFAULT_MATCH_STRATEGY_RULES.minimumDominanceGap, 0, 0.1),
      minimumMediumProbability: clampNumber(rulesData.minimumMediumProbability, DEFAULT_MATCH_STRATEGY_RULES.minimumMediumProbability, 0, 1),
      minimumShortProbability: clampNumber(rulesData.minimumShortProbability, DEFAULT_MATCH_STRATEGY_RULES.minimumShortProbability, 0, 1),
      minimumEdge: clampNumber(rulesData.minimumEdge, DEFAULT_MATCH_STRATEGY_RULES.minimumEdge, -1, 0.2),
      requireConditionalEvidence: typeof rulesData.requireConditionalEvidence === "boolean" ? rulesData.requireConditionalEvidence : DEFAULT_MATCH_STRATEGY_RULES.requireConditionalEvidence,
      maximumTopTwoGap: clampNumber(rulesData.maximumTopTwoGap, DEFAULT_MATCH_STRATEGY_RULES.maximumTopTwoGap, 0, 1),
      requireLastDigitMatch: typeof rulesData.requireLastDigitMatch === "boolean" ? rulesData.requireLastDigitMatch : DEFAULT_MATCH_STRATEGY_RULES.requireLastDigitMatch,
      windowSize: Math.trunc(clampNumber(configuredWindowSize, DEFAULT_MATCH_STRATEGY_RULES.windowSize, 1, 1000)),
    },
    bypassPayoutFilter: data.bypassPayoutFilter === true,
    digitBlockAfterLosses: Math.trunc(clampNumber(riskData.digitBlockAfterLosses, defaultImportedMatchStrategy.digitBlockAfterLosses, 1, 10)),
    digitBlockTicksMultiplier: Math.trunc(clampNumber(riskData.digitBlockTicksMultiplier, defaultImportedMatchStrategy.digitBlockTicksMultiplier, 1, 100)),
    digitBlockMaxTicks: Math.trunc(clampNumber(riskData.digitBlockMaxTicks, defaultImportedMatchStrategy.digitBlockMaxTicks, 1, 500)),
    takeProfit: (riskData.takeProfit ?? data.takeProfit) === undefined || (riskData.takeProfit ?? data.takeProfit) === null ? defaultImportedMatchStrategy.takeProfit : clampNumber(riskData.takeProfit ?? data.takeProfit, 5, 0.01, 100_000),
    stopLoss: (riskData.stopLoss ?? data.stopLoss) === undefined || (riskData.stopLoss ?? data.stopLoss) === null ? defaultImportedMatchStrategy.stopLoss : clampNumber(riskData.stopLoss ?? data.stopLoss, -10, -100_000, -0.01),
    recoveryMultiplier: clampNumber(riskData.recoveryMultiplier ?? data.recoveryMultiplier, defaultImportedMatchStrategy.recoveryMultiplier, 1, 10),
    maxRecoverySteps: Math.trunc(clampNumber(riskData.maxRecoverySteps ?? data.maxRecoverySteps, defaultImportedMatchStrategy.maxRecoverySteps, 0, 20)),
    maxRecoveryStakeMultiplier: clampNumber(riskData.maxRecoveryStakeMultiplier ?? data.maxRecoveryStakeMultiplier, defaultImportedMatchStrategy.maxRecoveryStakeMultiplier, 1, 100),
  };
}

const eaStrategyPresets: Record<EaStrategyPreset, { name: string; description: string; timeframe: EaTimeframe; minScore: number; maxPositions: number }> = {
  smc_ai: { name: "SMC + IA", description: "Combine structure SMC, sweep de liquidité, FVG et confiance ML.", timeframe: "M15", minScore: 75, maxPositions: 1 },
  trend_breakout: { name: "Breakout tendance", description: "Privilégie les BOS/CHOCH avec confirmation de tendance courte.", timeframe: "M5", minScore: 70, maxPositions: 2 },
  scalping: { name: "Scalping rapide", description: "Réagit plus vite aux impulsions MT5 avec filtre ML plus souple.", timeframe: "M5", minScore: 65, maxPositions: 1 },
  conservative: { name: "Conservateur", description: "Attend plusieurs confirmations avant d’autoriser un ordre EA.", timeframe: "H1", minScore: 85, maxPositions: 1 },
};

type DerivServerConfig = {
  tokenConfigured: boolean;
  appIdConfigured: boolean;
  accountIdConfigured: boolean;
  accountAutoDiscovery: boolean;
  oauthConfigured: boolean;
  oauthSessionActive: boolean;
  oauthRedirectUri?: string;
};

type ViewId = "overview" | "markets" | "positions" | "performance" | "derivbot" | "derivhistory" | "copytrading" | "ai" | "eastrategy" | "risk" | "settings";

const viewTitles: Record<ViewId, { eyebrow: string; title: string }> = {
  overview: { eyebrow: "CENTRE DE COMMANDE", title: "Bonjour, Trader" },
  markets: { eyebrow: "DONNÉES MT5", title: "Marchés" },
  positions: { eyebrow: "EXÉCUTION", title: "Positions" },
  performance: { eyebrow: "COMPTE MT5", title: "Performance" },
  derivbot: { eyebrow: "AUTOMATISATION", title: "Deriv Bot" },
  derivhistory: { eyebrow: "OPTIONS DIGITALES", title: "Historique gains" },
  copytrading: { eyebrow: "RÉPLICATION", title: "Copytrading" },
  ai: { eyebrow: "MOTEUR HYBRIDE", title: "Modèle IA" },
  eastrategy: { eyebrow: "EXPERT ADVISOR", title: "Stratégie EA" },
  risk: { eyebrow: "PROTECTION DU CAPITAL", title: "Gestion du risque" },
  settings: { eyebrow: "SYSTÈME", title: "Configuration" },
};

function formatUsd(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatPrice(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function toNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getContractCategory(contractType: DerivContractCode): DerivContractCategory {
  if (contractType === "CALL" || contractType === "PUT") return "rise_fall";
  if (contractType === "DIGITMATCH" || contractType === "DIGITDIFF") return "matches_differs";
  if (contractType === "DIGITOVER" || contractType === "DIGITUNDER") return "over_under";
  if (contractType === "DIGITEVEN" || contractType === "DIGITODD") return "even_odd";
  return "touch_no_touch";
}

function parseDerivContractCode(value: unknown): DerivContractCode {
  if (
    value === "CALL" ||
    value === "PUT" ||
    value === "DIGITMATCH" ||
    value === "DIGITDIFF" ||
    value === "DIGITOVER" ||
    value === "DIGITUNDER" ||
    value === "DIGITEVEN" ||
    value === "DIGITODD" ||
    value === "ONETOUCH" ||
    value === "NOTOUCH"
  ) {
    return value;
  }
  return "CALL";
}

function needsDigitBarrier(contractType: DerivContractCode) {
  return contractType === "DIGITMATCH" || contractType === "DIGITDIFF" || contractType === "DIGITOVER" || contractType === "DIGITUNDER";
}

function needsTouchBarrier(contractType: DerivContractCode) {
  return contractType === "ONETOUCH" || contractType === "NOTOUCH";
}

function getDigitBarrierOptions(contractType: DerivContractCode) {
  if (contractType === "DIGITOVER") return [0, 1, 2, 3, 4, 5, 6, 7, 8];
  if (contractType === "DIGITUNDER") return [1, 2, 3, 4, 5, 6, 7, 8, 9];
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
}

function normalizeDigitBarrier(contractType: DerivContractCode, barrier: number) {
  const options = getDigitBarrierOptions(contractType);
  if (options.includes(barrier)) return barrier;
  return options[Math.floor(options.length / 2)];
}

function normalizeTouchBarrier(value: string) {
  const trimmed = value.trim();
  const withSign = /^[+-]/.test(trimmed) ? trimmed : `+${trimmed}`;
  const numeric = Number(withSign);
  if (!Number.isFinite(numeric) || numeric === 0) return "+1";
  const rounded = Math.round(numeric * 1000) / 1000;
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function getDynamicTouchBarrier(ticks: number[], contractType: DerivContractCode) {
  const recent = ticks.slice(-18);
  const deltas = recent.slice(1).map((price, index) => price - recent[index]);
  const averageMove = deltas.length ? deltas.reduce((sum, delta) => sum + Math.abs(delta), 0) / deltas.length : 0.5;
  const distance = Math.min(10, Math.max(0.2, Math.round(averageMove * 3 * 1000) / 1000));
  const first = recent[0] ?? ticks[0] ?? 0;
  const last = recent.at(-1) ?? first;
  const trendUp = last >= first;
  const sign = contractType === "ONETOUCH" ? (trendUp ? "+" : "-") : (trendUp ? "-" : "+");
  return `${sign}${distance}`;
}

function formatDerivContract(contractType: DerivContractCode, barrier: DerivBarrier) {
  const label = derivContractLabels[contractType];
  return (needsDigitBarrier(contractType) || needsTouchBarrier(contractType)) && barrier !== null ? `${label} ${barrier}` : label;
}

function getHistoryPeriodStart(period: DerivHistoryPeriod) {
  const now = new Date();
  if (period === "today") return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (period === "7d") return now.getTime() - 7 * 24 * 60 * 60 * 1000;
  if (period === "30d") return now.getTime() - 30 * 24 * 60 * 60 * 1000;
  return 0;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatDerivApiDate(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function getHistoryPeriodDateFrom(period: DerivHistoryPeriod) {
  const timestamp = getHistoryPeriodStart(period);
  return timestamp > 0 ? formatDerivApiDate(timestamp) : null;
}

function parseDerivHistorySymbol(transaction: DerivApiProfitTransaction) {
  if (typeof transaction.underlying_symbol === "string" && transaction.underlying_symbol) return transaction.underlying_symbol;
  const text = `${transaction.shortcode ?? ""} ${transaction.longcode ?? ""}`;
  const match = text.match(/\bR_\d+\b/);
  return match?.[0] ?? "-";
}

function parseDerivHistoryBarrier(transaction: DerivApiProfitTransaction, contractType: DerivContractCode) {
  if (needsTouchBarrier(contractType) && typeof transaction.barrier === "string" && transaction.barrier) return transaction.barrier;
  const direct = toNumber(transaction.barrier);
  if (direct !== null) return direct;
  if (!needsDigitBarrier(contractType) && !needsTouchBarrier(contractType)) return null;
  const text = `${transaction.shortcode ?? ""} ${transaction.longcode ?? ""}`;
  const digitMatch = text.match(/\b(?:barrier|digit|last digit)\D*(\d)\b/i) ?? text.match(/\b(?:DIGITMATCH|DIGITDIFF|DIGITOVER|DIGITUNDER)\D+(\d)\b/i);
  return digitMatch ? Number(digitMatch[1]) : null;
}

function mapDerivProfitTransaction(transaction: DerivApiProfitTransaction): DerivDeal | null {
  const contractId = toNumber(transaction.contract_id) ?? toNumber(transaction.transaction_id);
  if (contractId === null) return null;
  const contractType = parseDerivContractCode(transaction.contract_type);
  const buyPrice = toNumber(transaction.buy_price) ?? 0;
  const sellPrice = toNumber(transaction.sell_price) ?? 0;
  const profit = toNumber(transaction.profit_loss) ?? sellPrice - buyPrice;
  const purchaseTime = toNumber(transaction.purchase_time) ?? toNumber(transaction.sell_time);
  return {
    contractId,
    buyPrice,
    payout: toNumber(transaction.payout) ?? sellPrice,
    contractType,
    barrier: parseDerivHistoryBarrier(transaction, contractType),
    symbol: parseDerivHistorySymbol(transaction),
    createdAt: purchaseTime ? new Date(purchaseTime * 1000).toISOString() : new Date().toISOString(),
    duration: 1,
    ticksElapsed: 1,
    status: profit >= 0 ? "won" : "lost",
    profit,
    entrySpot: null,
    currentSpot: null,
  };
}

function getLastDigit(price: number, pipSize = 3) {
  const normalized = price.toFixed(pipSize).replace(/\D/g, "");
  return Number(normalized.at(-1) ?? "0");
}

function getDigitStats(ticks: number[], sampleSize: number, pipSize = 3) {
  const sample = ticks.slice(-sampleSize).map((price) => getLastDigit(price, pipSize));
  const counts = Array.from({ length: 10 }, () => 0);
  sample.forEach((digit) => counts[digit] += 1);
  return { sample, counts };
}

function getDigitExitTransitionState(ticks: number[], triggerDigit: number, pipSize = 3) {
  if (ticks.length < 2) {
    return {
      state: "collecting" as const,
      previousDigit: null,
      lastDigit: ticks.length ? getLastDigit(ticks[0], pipSize) : null,
    };
  }

  const previousDigit = getLastDigit(ticks.at(-2)!, pipSize);
  const lastDigit = getLastDigit(ticks.at(-1)!, pipSize);
  return {
    state: previousDigit === triggerDigit && lastDigit !== triggerDigit
      ? "triggered" as const
      : lastDigit === triggerDigit
        ? "armed" as const
        : "waiting" as const,
    previousDigit,
    lastDigit,
  };
}

function getFixedOverUnderAutoSignal(ticks: number[], strategy: Exclude<DerivOverUnderStrategy, "under8_transition" | "over5" | "under5_over4_cross">, pipSize = 3): DerivDigitAutoSignal | null {
  if (ticks.length < 50) return null;
  const strategyConfig = derivOverUnderStrategies[strategy];
  const shortStats = getDigitStats(ticks, 25, pipSize);
  const mediumStats = getDigitStats(ticks, 80, pipSize);
  const isOver = strategyConfig.contractType === "DIGITOVER";
  const wins = (digit: number) => isOver ? digit > strategyConfig.barrier : digit < strategyConfig.barrier;
  const shortRate = shortStats.sample.filter(wins).length / Math.max(1, shortStats.sample.length);
  const mediumRate = mediumStats.sample.filter(wins).length / Math.max(1, mediumStats.sample.length);
  const theoreticalRate = isOver ? (9 - strategyConfig.barrier) / 10 : strategyConfig.barrier / 10;
  const requiredRate = strategyConfig.barrier === 2 ? 0.66 : theoreticalRate + 0.08;
  if (shortRate < requiredRate || mediumRate < theoreticalRate + 0.03) return null;

  return {
    contractType: strategyConfig.contractType,
    barrier: strategyConfig.barrier,
    confidence: Math.min(88, Math.round(55 + ((shortRate + mediumRate) / 2 - theoreticalRate) * 100)),
    reason: `${strategyConfig.name} validé · court ${Math.round(shortRate * 100)}% · moyen ${Math.round(mediumRate * 100)}%`,
  };
}

function getDerivDigitAutoSignal(ticks: number[], contractType: DerivContractCode, preferredBarrier: number | null = null, pipSize = 3, overUnderStrategy: DerivOverUnderStrategy = "under8_transition", excludedMatchDigits: Set<number> = new Set(), matchRules: MatchStrategyRules = DEFAULT_MATCH_STRATEGY_RULES, completedMatchContracts = 0): DerivDigitAutoSignal | null {
  if (contractType === "DIGITOVER" || contractType === "DIGITUNDER") {
    if (overUnderStrategy === "under5_over4_cross") return null;
    if (overUnderStrategy === "over5") {
      const transition = getDigitExitTransitionState(ticks, 4, pipSize);
      if (transition.state !== "triggered") return null;
      return {
        contractType: "DIGITOVER",
        barrier: 5,
        confidence: 40,
        reason: `Transition 4 → ${transition.lastDigit} confirmée · Over 5`,
      };
    }
    if (overUnderStrategy !== "under8_transition") return getFixedOverUnderAutoSignal(ticks, overUnderStrategy, pipSize);
    const transition = getUnderEightTransitionState(ticks, pipSize);
    if (transition.state !== "triggered") return null;
    return {
      contractType: "DIGITUNDER",
      barrier: 8,
      confidence: 80,
      reason: `Transition 9 → ${transition.lastDigit} confirmée · Under 8`,
    };
  }

  if (ticks.length < 25 && contractType !== "DIGITMATCH") return null;
  const longStats = getDigitStats(ticks, 50, pipSize);
  const shortStats = getDigitStats(ticks, 12, pipSize);
  const lastDigit = getLastDigit(ticks.at(-1)!, pipSize);

  if (contractType === "DIGITMATCH") {
    const fixedDigit = preferredBarrier !== null ? normalizeDigitBarrier(contractType, preferredBarrier) : null;
    const prediction = buildMatchPrediction(ticks, pipSize, fixedDigit, matchRules, completedMatchContracts);
    const rankedCandidates = [...prediction.candidates]
      .filter((item) => fixedDigit !== null ? item.digit === fixedDigit : (isFastMatchMode(matchRules.selectionMode) || !excludedMatchDigits.has(item.digit)))
      .sort((left, right) => Number(right.stable) - Number(left.stable) || right.probability - left.probability || right.dominanceGap - left.dominanceGap);
    const candidate = rankedCandidates.find((item) => item.stable) ?? null;
    if (!candidate) return null;
    const confidence = Math.min(93, Math.round(
      57
      + candidate.agreementScore * 5
      + Math.min(candidate.transitionSamples, 30) * 0.3
      + candidate.dominanceGap * 220,
    ));
    return {
      contractType,
      barrier: candidate.digit,
      confidence,
      reason: matchRules.selectionMode === "top_two_adaptive"
        ? `Top 2 adaptatif · digit ${candidate.digit} · fréquence ${((candidate.observedFrequency ?? 0) * 100).toFixed(1)}% · estimation ${(candidate.probability * 100).toFixed(1)}% · ${prediction.validationSamples ?? 0} prévisions passées comparées`
        : isFastMatchMode(matchRules.selectionMode)
        ? `Most appearing · rang ${fixedDigit !== null ? "fixe" : completedMatchContracts % 2 + 1} · digit ${candidate.digit} · fréquence ${(candidate.probability * 100).toFixed(1)}% sur ${prediction.sampleSize} ticks`
        : `${fixedDigit !== null ? "Matches fixe qualifié" : "Matches dynamique qualifié"} · digit ${candidate.digit} · P ${(candidate.probability * 100).toFixed(1)}% · accord ${candidate.agreementScore}/5`,
      matchCandidate: candidate,
    };
  }

  if (contractType === "DIGITDIFF") {
    const ranked = longStats.counts
      .map((count, digit) => ({ digit, count, shortCount: shortStats.counts[digit] }))
      .sort((a, b) => a.count - b.count || a.shortCount - b.shortCount);
    const fixedDigit = preferredBarrier !== null ? normalizeDigitBarrier(contractType, preferredBarrier) : null;
    const candidate = fixedDigit !== null ? ranked.find((item) => item.digit === fixedDigit)! : ranked[0];
    const longRate = candidate.count / longStats.sample.length;
    const shortRate = candidate.shortCount / shortStats.sample.length;
    if (candidate.digit === lastDigit) return null;
    if (fixedDigit === null && (longRate > 0.085 || shortRate > 0.1)) return null;
    if (fixedDigit !== null && longRate > 0.18 && shortRate > 0.2) return null;
    return {
      contractType,
      barrier: candidate.digit,
      confidence: Math.min(88, Math.round(66 + (0.1 - longRate) * 180 + (0.1 - shortRate) * 110)),
      reason: `${fixedDigit !== null ? "Differs fixe" : "Differs statistique"} · digit ${candidate.digit} peu fréquent`,
    };
  }

  if (contractType === "DIGITEVEN" || contractType === "DIGITODD") {
    const evenCount = longStats.sample.filter((digit) => digit % 2 === 0).length;
    const evenRate = evenCount / longStats.sample.length;
    const selectedType = evenRate < 0.46 ? "DIGITEVEN" : evenRate > 0.54 ? "DIGITODD" : contractType;
    if (selectedType === contractType && Math.abs(evenRate - 0.5) < 0.06) return null;
    return {
      contractType: selectedType,
      barrier: null,
      confidence: Math.min(84, Math.round(58 + Math.abs(evenRate - 0.5) * 180)),
      reason: `Parité statistique · pair ${Math.round(evenRate * 100)}%`,
    };
  }

  return null;
}

function chooseDerivContractDuration(contractType: DerivContractCode, ticks: number[]): DurationDecision {
  if (contractType.startsWith("DIGIT")) {
    return { duration: 1, label: "DIGIT", reason: "Contrat digit exécuté sur le prochain tick" };
  }
  return chooseDerivDuration(ticks);
}

function clampStake(value: number) {
  return Math.max(0.35, Math.round(value * 100) / 100);
}

function getMartingaleEffectiveLosses(losses: number, maxCycles: number | null) {
  const safeLosses = Math.max(0, losses);
  if (maxCycles === null) return safeLosses;
  const safeMaxCycles = Math.min(20, Math.max(1, Math.trunc(maxCycles)));
  return safeLosses <= safeMaxCycles ? safeLosses : 0;
}

function getMartingaleStake(baseStake: number, losses: number, enabled: boolean, multiplier: number, maxStake: number, maxCycles: number | null = null) {
  if (!enabled || losses <= 0) return clampStake(baseStake);
  const effectiveLosses = getMartingaleEffectiveLosses(losses, maxCycles);
  if (effectiveLosses <= 0) return clampStake(baseStake);
  const safeMultiplier = Math.min(5, Math.max(1.1, multiplier));
  const safeMaxStake = clampStake(maxStake);
  return clampStake(Math.min(safeMaxStake, baseStake * safeMultiplier ** effectiveLosses));
}

function getMatchStrategyStake(baseStake: number, losses: number, strategy: ImportedMatchStrategy) {
  if (strategy.maxRecoverySteps <= 0 || losses <= 0) return clampStake(baseStake);
  const effectiveLosses = losses >= strategy.maxRecoverySteps ? 0 : losses;
  const recoveredStake = baseStake * strategy.recoveryMultiplier ** effectiveLosses;
  return clampStake(Math.min(baseStake * strategy.maxRecoveryStakeMultiplier, recoveredStake));
}

function getDoubleRiskStake(stake: number, enabled: boolean, seriesIndex: number) {
  return clampStake(enabled ? stake * 2 ** Math.max(0, seriesIndex) : stake);
}

function getBalanceRiskStake(fallbackStake: number, enabled: boolean, balance: number | null) {
  return enabled && balance !== null && Number.isFinite(balance) && balance > 0 ? Math.round(balance * 50) / 100 : clampStake(fallbackStake);
}

function isMatchesDiffersContract(contractType: DerivContractCode) {
  return contractType === "DIGITMATCH" || contractType === "DIGITDIFF";
}

function chooseDerivDuration(ticks: number[]): DurationDecision {
  if (ticks.length < 12) {
    return { duration: 5, label: "ÉQUILIBRÉE", reason: "Collecte des premiers ticks" };
  }

  const recent = ticks.slice(-30);
  const deltas = recent.slice(1).map((price, index) => price - recent[index]);
  const path = deltas.reduce((sum, delta) => sum + Math.abs(delta), 0);
  const netMove = Math.abs(recent.at(-1)! - recent[0]);
  const efficiency = path > 0 ? netMove / path : 0;
  const averageMove = path / Math.max(deltas.length, 1);
  const latestMove = deltas.slice(-4).reduce((sum, delta) => sum + Math.abs(delta), 0) / Math.min(deltas.length, 4);

  if (efficiency >= 0.62 && latestMove >= averageMove * 1.15) {
    return { duration: 2, label: "RÉACTIVE", reason: "Impulsion nette et accélération récente" };
  }
  if (efficiency >= 0.45) {
    return { duration: 3, label: "COURTE", reason: "Direction récente suffisamment régulière" };
  }
  if (efficiency >= 0.25) {
    return { duration: 5, label: "ÉQUILIBRÉE", reason: "Mouvement modéré avec quelques oscillations" };
  }
  return { duration: 10, label: "FILTRÉE", reason: "Marché bruité, durée allongée par le bot" };
}

function displayBias(value?: "bullish" | "bearish" | "neutral") {
  if (value === "bullish") return "HAUSSIER";
  if (value === "bearish") return "BAISSIER";
  return "NEUTRE";
}

function displaySetup(analysis: MarketAnalysis | null) {
  const smc = analysis?.request?.smc;
  if (!smc) return null;
  const parts = [];
  if (smc.liquiditySweep) parts.push("Sweep");
  if (smc.bos) parts.push("BOS");
  if (smc.choch) parts.push("CHOCH");
  if (smc.fairValueGap) parts.push("FVG");
  if (!parts.length) return "En attente";
  return parts.join(" + ");
}

function buildTickPath(ticks: Mt5Tick[]) {
  if (ticks.length < 2) return null;
  const width = 360;
  const height = 120;
  const padding = 12;
  const prices = ticks.map((tick) => tick.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = Math.max(max - min, 0.0001);
  const points = ticks.map((tick, index) => {
    const x = ticks.length === 1 ? width : (index / (ticks.length - 1)) * width;
    const y = height - padding - ((tick.price - min) / range) * (height - padding * 2);
    return { x, y };
  });
  return {
    line: points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" "),
    area: `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")} L${width} ${height} L0 ${height} Z`,
    last: points.at(-1),
  };
}

function MiniChart({ name, ticks }: { name: string; ticks: Mt5Tick[] }) {
  const id = `fill-${name.replaceAll(" ", "")}`;
  const dynamicPath = buildTickPath(ticks);
  const fallbackPath = pricePaths[name as keyof typeof pricePaths] ?? pricePaths["Volatility 25"];
  return <svg viewBox="0 0 360 120" className="chart" role="img" aria-label={`Courbe ${name}`}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b8f34a" stopOpacity=".28"/><stop offset="100%" stopColor="#b8f34a" stopOpacity="0"/></linearGradient></defs>
    <path d={dynamicPath?.area ?? `${fallbackPath} L360 120 L0 120 Z`} fill={`url(#${id})`}/><path d={dynamicPath?.line ?? fallbackPath} fill="none" stroke="#b8f34a" strokeWidth="3" strokeLinecap="round"/><circle cx={dynamicPath?.last?.x ?? 360} cy={dynamicPath?.last?.y ?? 12} r="4" fill="#b8f34a"/>
  </svg>;
}

export default function Home() {
  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [symbol, setSymbol] = useState<keyof typeof prices>("Volatility 25");
  const [autoTrade, setAutoTrade] = useState(true);
  const [stopped, setStopped] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [mt5Online, setMt5Online] = useState(false);
  const [mt5Balance, setMt5Balance] = useState<number | null>(null);
  const [mt5Equity, setMt5Equity] = useState<number | null>(null);
  const [mt5Profit, setMt5Profit] = useState<number | null>(null);
  const [mt5Currency, setMt5Currency] = useState("USD");
  const [mt5Demo, setMt5Demo] = useState<boolean | null>(null);
  const [config, setConfig] = useState<AppConfig>({ referenceCapitalUsd: 100, maxRiskUsd: 10, minScore: 75 });
  const [liveSymbol, setLiveSymbol] = useState("");
  const [livePrice, setLivePrice] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [ticks, setTicks] = useState<Mt5Tick[]>([]);
  const [positions, setPositions] = useState<Mt5Position[]>([]);
  const [manualTradeStatus, setManualTradeStatus] = useState("");
  const [riskDraft, setRiskDraft] = useState<AppConfig>({ referenceCapitalUsd: 100, maxRiskUsd: 10, minScore: 75 });
	  const [configStatus, setConfigStatus] = useState("");
	  const derivSocketRef = useRef<WebSocket | null>(null);
	  const derivMarketRef = useRef<DerivMarketSymbol>("R_25");
	  const derivPendingBuyRef = useRef<DerivPendingBuy>({ contractType: "CALL", barrier: null, stake: 1, symbol: "R_25", duration: 5 });
	  const derivPendingBuysRef = useRef<Map<number, DerivPendingBuy>>(new Map());
  const derivStatusRef = useRef<DerivStatus>("connecting");
  const derivModeRef = useRef<DerivMode>("manual");
  const derivAutoRunningRef = useRef(false);
	  const derivStrategyRef = useRef<DerivStrategy>("trend");
	  const derivOverUnderStrategyRef = useRef<DerivOverUnderStrategy>("under8_transition");
	  const derivStakeRef = useRef(1);
	  const derivBalanceRef = useRef<number | null>(null);
	  const derivHalfBalanceRiskEnabledRef = useRef(false);
	  const derivDoubleRiskEnabledRef = useRef(false);
	  const derivDoubleRiskSeriesIndexRef = useRef(0);
	  const derivMartingaleEnabledRef = useRef(false);
		  const derivMartingaleMultiplierRef = useRef(2);
		  const derivMartingaleMaxStakeRef = useRef(20);
		  const derivOverUnderMartingaleCyclesRef = useRef(1);
		  const derivTradePauseEnabledRef = useRef(false);
		  const derivMatchStrategyRef = useRef(defaultImportedMatchStrategy);
		  const derivSessionContractsRef = useRef(0);
		  const derivSessionSignalsRef = useRef(0);
		  const derivSessionPnlRef = useRef(0);
		  const derivSessionWinsRef = useRef(0);
		  const derivSessionLossesRef = useRef(0);
		  const derivMaxSignalsRef = useRef(0);
		  const derivCurrencyRef = useRef("USD");
  const derivPipSizeRef = useRef(3);
  const derivTicksRef = useRef<number[]>([]);
  const derivTickSerialRef = useRef(0);
	  const derivLastTradeSerialRef = useRef(-20);
	  const derivOpenContractRef = useRef(false);
	  const derivOpenContractsRef = useRef<Set<number>>(new Set());
		  const derivContractTypeRef = useRef<DerivContractCode>("CALL");
		  const derivDigitBarrierRef = useRef(5);
		  const derivTouchBarrierRef = useRef("+1");
		  const derivAutoDigitBarrierModeRef = useRef<DerivAutoDigitBarrierMode>("dynamic");
		  const derivAutoQuoteRef = useRef<Map<number, DerivAutoQuote>>(new Map());
  const derivPairScannerRef = useRef<OverUnderPairScanner | null>(null);
  const [derivPairRows, setDerivPairRows] = useState<PairRow[]>([]);
  const [derivPairTrades, setDerivPairTrades] = useState<PairTrade[]>([]);
  const [derivPairStats, setDerivPairStats] = useState<PairStats>({ ...EMPTY_PAIR_STATS });
  const derivPairUiUpdateRef = useRef(0);
  const derivPortfolioReadyRef = useRef(false);
  const derivOverUnderQuoteScanRef = useRef<DerivOverUnderQuoteScan | null>(null);
  const derivLastOverUnderScanSerialRef = useRef(-20);
  const derivHistoryReqIdRef = useRef<number | null>(null);
  const derivReqIdRef = useRef(1000);
  const derivConsecutiveLossesRef = useRef(0);
  const derivMatchConsecutiveLossesRef = useRef(0);
  const derivMatchContractIdsRef = useRef<Set<number>>(new Set());
  const derivMatchContractDigitsRef = useRef<Map<number, number>>(new Map());
  const derivMatchDigitLossesRef = useRef<number[]>(Array.from({ length: 10 }, () => 0));
  const derivMatchDigitBlockedUntilRef = useRef<number[]>(Array.from({ length: 10 }, () => -1));
  const derivLastMatchLossSerialRef = useRef(-1);
  const derivSettledContractIdsRef = useRef<Set<number>>(new Set());
  const [derivStatus, setDerivStatus] = useState<DerivStatus>("connecting");
  const [derivMessage, setDerivMessage] = useState("Connexion au flux public...");
  const [derivMarket, setDerivMarket] = useState<DerivMarketSymbol>("R_25");
  const [derivPrice, setDerivPrice] = useState<number | null>(null);
  const [derivTicks, setDerivTicks] = useState<number[]>([]);
  const [derivPipSize, setDerivPipSize] = useState(3);
  const [digitPredictionOpen, setDigitPredictionOpen] = useState(true);
  const [matchPredictionOpen, setMatchPredictionOpen] = useState(false);
  const [matchStrategy, setMatchStrategy] = useState(defaultImportedMatchStrategy);
  const [matchStrategySelection, setMatchStrategySelection] = useState("advanced");
  const [importedMatchProfile, setImportedMatchProfile] = useState<ImportedMatchStrategy | null>(null);
  const [matchStrategyImportStatus, setMatchStrategyImportStatus] = useState("");
  const [derivSessionContracts, setDerivSessionContracts] = useState(0);
  const [derivSessionSignals, setDerivSessionSignals] = useState(0);
  const [derivSessionPnl, setDerivSessionPnl] = useState(0);
  const [derivSessionWins, setDerivSessionWins] = useState(0);
  const [derivSessionLosses, setDerivSessionLosses] = useState(0);
  const [derivMaxSignals, setDerivMaxSignals] = useState(0);
  const [derivBalance, setDerivBalance] = useState<number | null>(null);
  const [derivCurrency, setDerivCurrency] = useState("USD");
  const [derivAccountMode, setDerivAccountMode] = useState<AccountMode>("demo");
  const [mt5AccountMode, setMt5AccountMode] = useState<AccountMode>("demo");
  const [eaStrategyPreset, setEaStrategyPreset] = useState<EaStrategyPreset>("smc_ai");
  const [eaTimeframe, setEaTimeframe] = useState<EaTimeframe>("M15");
  const [eaUseSmc, setEaUseSmc] = useState(true);
  const [eaUseMl, setEaUseMl] = useState(true);
  const [eaUseTrendFilter, setEaUseTrendFilter] = useState(true);
  const [eaUseSessionFilter, setEaUseSessionFilter] = useState(false);
  const [eaMaxPositions, setEaMaxPositions] = useState(1);
  const [copyTradingEnabled, setCopyTradingEnabled] = useState(false);
  const [copyTradingProvider, setCopyTradingProvider] = useState<CopyTradingProvider>("mt5_master");
  const [copyTradingAccountMode, setCopyTradingAccountMode] = useState<AccountMode>("demo");
  const [copyTradingAllocation, setCopyTradingAllocation] = useState(25);
  const [copyTradingRiskLimit, setCopyTradingRiskLimit] = useState(10);
  const [copyTradingMultiplier, setCopyTradingMultiplier] = useState(1);
  const [copyTradingReverse, setCopyTradingReverse] = useState(false);
	  const [derivStake, setDerivStake] = useState(1);
	  const [derivHalfBalanceRiskEnabled, setDerivHalfBalanceRiskEnabled] = useState(false);
	  const [derivDoubleRiskEnabled, setDerivDoubleRiskEnabled] = useState(false);
	  const [derivDoubleRiskSeriesIndex, setDerivDoubleRiskSeriesIndex] = useState(0);
	  const [derivMartingaleEnabled, setDerivMartingaleEnabled] = useState(false);
		  const [derivMartingaleMultiplier, setDerivMartingaleMultiplier] = useState(2);
		  const [derivMartingaleMaxStake, setDerivMartingaleMaxStake] = useState(20);
		  const [derivOverUnderMartingaleCycles, setDerivOverUnderMartingaleCycles] = useState(1);
		  const [derivTradePauseEnabled, setDerivTradePauseEnabled] = useState(false);
		  const derivMultiplePositionsEnabledRef = useRef(false);
		  const derivPositionCountRef = useRef(2);
		  const derivMatchPositionCountRef = useRef(1);
		  const [derivMultiplePositionsEnabled, setDerivMultiplePositionsEnabled] = useState(false);
		  const [derivPositionCount, setDerivPositionCount] = useState(2);
		  const [derivMatchPositionCount, setDerivMatchPositionCount] = useState(1);
  const [derivContractCategory, setDerivContractCategory] = useState<DerivContractCategory>("rise_fall");
	  const [derivContractType, setDerivContractType] = useState<DerivContractCode>("CALL");
	  const [derivDigitBarrier, setDerivDigitBarrier] = useState(5);
	  const [derivTouchBarrier, setDerivTouchBarrier] = useState("+1");
	  const [derivAutoDigitBarrierMode, setDerivAutoDigitBarrierMode] = useState<DerivAutoDigitBarrierMode>("dynamic");
	  const [derivMode, setDerivMode] = useState<DerivMode>("manual");
  const [derivStrategy, setDerivStrategy] = useState<DerivStrategy>("trend");
  const [derivOverUnderStrategy, setDerivOverUnderStrategy] = useState<DerivOverUnderStrategy>("under8_transition");
  const [derivAutoRunning, setDerivAutoRunning] = useState(false);
  const [derivAutoStatus, setDerivAutoStatus] = useState("Bot arrêté");
  const [derivProposal, setDerivProposal] = useState<DerivProposal | null>(null);
  const [derivDeals, setDerivDeals] = useState<DerivDeal[]>([]);
  const [derivConsecutiveLosses, setDerivConsecutiveLosses] = useState(0);
  const [derivApiHistoryDeals, setDerivApiHistoryDeals] = useState<DerivDeal[]>([]);
  const [derivHistoryPeriod, setDerivHistoryPeriod] = useState<DerivHistoryPeriod>("today");
  const [derivHistoryLoading, setDerivHistoryLoading] = useState(false);
  const [derivHistoryError, setDerivHistoryError] = useState("");
  const [derivServerConfig, setDerivServerConfig] = useState<DerivServerConfig>({ tokenConfigured: false, appIdConfigured: false, accountIdConfigured: false, accountAutoDiscovery: false, oauthConfigured: false, oauthSessionActive: false, oauthRedirectUri: "" });
  const fallbackMarket = prices[symbol];
  const derivTradeConnected = derivStatus === "demo" || derivStatus === "real";
  const derivConnected = derivStatus === "public" || derivTradeConnected;
  const mt5ConnectedMode: AccountMode | null = mt5Online && mt5Demo !== null ? (mt5Demo ? "demo" : "real") : null;
	  const derivDurationDecision = useMemo(() => chooseDerivContractDuration(derivContractType, derivTicks), [derivContractType, derivTicks]);
	  const derivDuration = derivDurationDecision.duration;
	  const derivBalanceRiskStake = getBalanceRiskStake(derivStake, derivHalfBalanceRiskEnabled, derivBalance);
	  const derivBaseRiskStake = derivHalfBalanceRiskEnabled ? derivBalanceRiskStake : getDoubleRiskStake(derivBalanceRiskStake, derivDoubleRiskEnabled, derivDoubleRiskSeriesIndex);
	  const derivNextSeriesStake = derivHalfBalanceRiskEnabled ? derivBalanceRiskStake : getDoubleRiskStake(derivBalanceRiskStake, derivDoubleRiskEnabled, derivDoubleRiskSeriesIndex + 1);
  const selectedSymbolName = `${symbol} Index`;
  const analysisMatchesSymbol = analysis?.request?.symbol === selectedSymbolName;
  const liveMatchesSymbol = liveSymbol === selectedSymbolName;
  const symbolTicks = ticks.filter((tick) => tick.symbol === selectedSymbolName);
  const firstTick = symbolTicks[0]?.price;
  const lastTick = symbolTicks.at(-1)?.price;
  const tickChange = firstTick && lastTick ? ((lastTick - firstTick) / firstTick) * 100 : null;
  const marketPrice = lastTick ?? (liveMatchesSymbol ? livePrice : null) ?? (analysisMatchesSymbol && typeof analysis?.request?.price === "number" ? analysis.request.price : null);
  const marketScore = analysisMatchesSymbol ? analysis?.decision?.score ?? fallbackMarket.score : fallbackMarket.score;
  const marketBias = analysisMatchesSymbol ? displayBias(analysis?.request?.smc.htfBias) : fallbackMarket.bias;
  const marketSetup = analysisMatchesSymbol ? displaySetup(analysis) ?? fallbackMarket.setup : fallbackMarket.setup;
  const smcScore = analysisMatchesSymbol && analysis?.request?.smc
    ? Math.round([
      analysis.request.smc.bos,
      analysis.request.smc.choch,
      analysis.request.smc.liquiditySweep,
      analysis.request.smc.fairValueGap,
      analysis.request.smc.premiumDiscountAligned,
      analysis.request.smc.ltfConfirmation,
    ].filter(Boolean).length / 6 * 100)
    : 86;
  const mlConfidence = analysisMatchesSymbol ? Math.round((analysis?.request?.ml.confidence ?? fallbackMarket.score / 100) * 100) : fallbackMarket.score;
  const status = useMemo(() => stopped ? "ARRÊTÉ" : autoTrade ? "ANALYSE ACTIVE" : "SURVEILLANCE", [stopped, autoTrade]);

  useEffect(() => {
    derivModeRef.current = derivMode;
	    derivAutoRunningRef.current = derivAutoRunning;
	    derivStrategyRef.current = derivStrategy;
	    derivOverUnderStrategyRef.current = derivOverUnderStrategy;
	    derivStakeRef.current = derivStake;
	    derivBalanceRef.current = derivBalance;
	    derivHalfBalanceRiskEnabledRef.current = derivHalfBalanceRiskEnabled;
	    derivDoubleRiskEnabledRef.current = derivDoubleRiskEnabled;
	    derivDoubleRiskSeriesIndexRef.current = derivDoubleRiskSeriesIndex;
	    derivMartingaleEnabledRef.current = derivMartingaleEnabled;
		    derivMartingaleMultiplierRef.current = derivMartingaleMultiplier;
		    derivMartingaleMaxStakeRef.current = derivMartingaleMaxStake;
		    derivOverUnderMartingaleCyclesRef.current = derivOverUnderMartingaleCycles;
		    derivTradePauseEnabledRef.current = derivTradePauseEnabled;
		    derivMatchStrategyRef.current = matchStrategy;
		    derivMaxSignalsRef.current = derivMaxSignals;
		    derivMultiplePositionsEnabledRef.current = derivMultiplePositionsEnabled;
		    derivPositionCountRef.current = derivPositionCount;
		    derivMatchPositionCountRef.current = derivMatchPositionCount;
		    derivCurrencyRef.current = derivCurrency;
	    derivContractTypeRef.current = derivContractType;
	    derivDigitBarrierRef.current = derivDigitBarrier;
	    derivTouchBarrierRef.current = derivTouchBarrier;
	    derivAutoDigitBarrierModeRef.current = derivAutoDigitBarrierMode;
	  }, [derivMode, derivAutoRunning, derivStrategy, derivOverUnderStrategy, derivStake, derivBalance, derivHalfBalanceRiskEnabled, derivDoubleRiskEnabled, derivDoubleRiskSeriesIndex, derivMartingaleEnabled, derivMartingaleMultiplier, derivMartingaleMaxStake, derivOverUnderMartingaleCycles, derivTradePauseEnabled, matchStrategy, derivMaxSignals, derivMultiplePositionsEnabled, derivPositionCount, derivMatchPositionCount, derivCurrency, derivContractType, derivDigitBarrier, derivTouchBarrier, derivAutoDigitBarrierMode]);

  useEffect(() => {
    let active = true;
    async function refreshStatus() {
      try {
        const response = await fetch("/api/system/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as SystemStatus;
        if (active) {
          if (data.config) setConfig(data.config);
          setMt5Online(Boolean(data.mt5?.online));
          setMt5Balance(typeof data.mt5?.payload?.balance === "number" ? data.mt5.payload.balance : null);
          setMt5Equity(typeof data.mt5?.payload?.equity === "number" ? data.mt5.payload.equity : null);
          setMt5Profit(typeof data.mt5?.payload?.profit === "number" ? data.mt5.payload.profit : null);
          setMt5Currency(data.mt5?.payload?.currency ?? "USD");
          setMt5Demo(typeof data.mt5?.payload?.demo === "boolean" ? data.mt5.payload.demo : null);
          setLiveSymbol(data.mt5?.payload?.symbol ?? "");
          setLivePrice(typeof data.mt5?.payload?.last === "number" ? data.mt5.payload.last : null);
          setAnalysis(data.mt5?.analysis ?? null);
          setTicks(Array.isArray(data.mt5?.ticks) ? data.mt5.ticks : []);
          setPositions(Array.isArray(data.mt5?.payload?.positions) ? data.mt5.payload.positions : []);
        }
      } catch {
        if (active) {
          setMt5Online(false);
          setMt5Balance(null);
          setMt5Equity(null);
          setMt5Profit(null);
          setMt5Demo(null);
          setTicks([]);
          setPositions([]);
        }
      }
    }
    refreshStatus();
    const interval = window.setInterval(refreshStatus, 300);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  function resetDerivSessionStats() {
    derivSessionContractsRef.current = 0;
    derivSessionSignalsRef.current = 0;
    derivSessionPnlRef.current = 0;
    derivSessionWinsRef.current = 0;
    derivSessionLossesRef.current = 0;
    setDerivSessionContracts(0);
    setDerivSessionSignals(0);
    setDerivSessionPnl(0);
    setDerivSessionWins(0);
    setDerivSessionLosses(0);
  }

  function stopDerivAutoOnSignalLimit() {
    derivPairScannerRef.current?.stop();
    derivAutoRunningRef.current = false;
    derivAutoQuoteRef.current.clear();
    derivOverUnderQuoteScanRef.current = null;
    clearPendingNormalBuys();
    setDerivAutoRunning(false);
    setDerivAutoStatus(`Session stoppée · limite ${derivMaxSignalsRef.current} signal${derivMaxSignalsRef.current > 1 ? "s" : ""} atteinte`);
    setDerivMessage("Limite de signaux atteinte · aucun nouvel achat ne sera envoyé");
  }

  function stopDerivAutoOnPnlLimit(reason: string) {
    derivPairScannerRef.current?.stop();
    derivAutoRunningRef.current = false;
    derivAutoQuoteRef.current.clear();
    derivOverUnderQuoteScanRef.current = null;
    clearPendingNormalBuys();
    setDerivAutoRunning(false);
    setDerivAutoStatus(reason);
    setDerivMessage(`${reason} · aucun nouvel achat ne sera envoyé`);
  }

  function registerDerivSessionSignal() {
    derivSessionSignalsRef.current += 1;
    setDerivSessionSignals(derivSessionSignalsRef.current);
  }

  function isDerivTradingStatus(statusValue: DerivStatus) {
    return statusValue === "demo" || statusValue === "real";
  }

  function connectDerivSocket(url: string, mode: "public" | AccountMode) {
    derivPairScannerRef.current?.dispose();
    derivPairScannerRef.current = null;
    setDerivPairRows([]);
    setDerivPairTrades([]);
    setDerivPairStats({ ...EMPTY_PAIR_STATS });
    derivPortfolioReadyRef.current = false;
    derivPendingBuysRef.current.clear();
    derivAutoRunningRef.current = false;
    setDerivAutoRunning(false);
    const previous = derivSocketRef.current;
    derivSocketRef.current = null;
    previous?.close();
    derivStatusRef.current = "connecting";
    derivAutoQuoteRef.current.clear();
    derivOverUnderQuoteScanRef.current = null;
    clearPendingNormalBuys();
    if (mode === "public") {
      derivAutoRunningRef.current = false;
      setDerivAutoRunning(false);
      setDerivAutoStatus("Bot arrêté");
    }
    setDerivStatus("connecting");
    setDerivMessage(mode === "public" ? "Connexion au flux public Deriv..." : `Connexion au compte Options ${mode === "demo" ? "démo" : "réel"}...`);
    setDerivProposal(null);

    const socket = new WebSocket(url);
    derivSocketRef.current = socket;
    socket.onopen = () => {
      if (derivSocketRef.current !== socket) return;
      derivStatusRef.current = mode;
      setDerivStatus(mode);
      setDerivMessage(mode === "public" ? "Cours publics Deriv en direct" : `Compte Options ${mode === "demo" ? "démo" : "réel"} connecté`);
      socket.send(JSON.stringify({ ticks: derivMarketRef.current, subscribe: 1 }));
      socket.send(JSON.stringify({ ticks_history: derivMarketRef.current, end: "latest", count: 1000, style: "ticks" }));
      if (mode !== "public") {
        socket.send(JSON.stringify({ balance: 1, subscribe: 1 }));
        socket.send(JSON.stringify({ portfolio: 1 }));
      }
    };
    socket.onmessage = (event) => {
      if (derivSocketRef.current !== socket) return;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      if (derivPairScannerRef.current?.handle(message)) return;

      const error = message.error as { message?: string } | undefined;
      if (error) {
        const reqId = toNumber(message.req_id);
        if (derivHistoryReqIdRef.current !== null && reqId === derivHistoryReqIdRef.current) {
          derivHistoryReqIdRef.current = null;
          setDerivHistoryLoading(false);
          setDerivHistoryError(error.message ?? "Historique Deriv indisponible");
          return;
        }
        const failedQuote = reqId !== null ? derivAutoQuoteRef.current.get(reqId) : undefined;
        const failedBuy = reqId !== null ? derivPendingBuysRef.current.get(reqId) : undefined;
        const failedAutoRequest = failedBuy ?? failedQuote;
        const wasAutoRequest = Boolean(failedAutoRequest);
        if (reqId !== null) {
          derivAutoQuoteRef.current.delete(reqId);
          derivPendingBuysRef.current.delete(reqId);
        } else {
          derivAutoQuoteRef.current.clear();
          derivOverUnderQuoteScanRef.current = null;
          clearPendingNormalBuys();
        }
        if (failedBuy?.pair) {
          derivAutoRunningRef.current = false;
          setDerivAutoRunning(false);
          derivPairScannerRef.current?.stop();
          setDerivAutoStatus(`Paire incomplète · ${error.message ?? "achat refusé"} · aucun rachat automatique`);
          return;
        }
        if (failedQuote?.overUnderScan && reqId !== null) {
          derivOverUnderQuoteScanRef.current?.pendingReqIds.delete(reqId);
          finishDerivOverUnderQuoteScan(socket);
          return;
        }
        setDerivMessage(error.message ?? "Erreur API Deriv");
        if (wasAutoRequest) {
          const nextIndex = (failedAutoRequest?.batchIndex ?? 1) + 1;
          if (derivAutoRunningRef.current && failedAutoRequest?.batchTotal && nextIndex <= failedAutoRequest.batchTotal && socket.readyState === WebSocket.OPEN) {
            requestDerivAutoPosition(socket, { ...failedAutoRequest, batchIndex: nextIndex, batchTotal: failedAutoRequest.batchTotal });
          }
          setDerivAutoStatus(`Erreur position ${failedAutoRequest?.batchIndex ?? 1}/${failedAutoRequest?.batchTotal ?? 1} · ${error.message ?? "requête refusée"} · bot continue`);
          setDerivProposal(null);
          return;
        }
        setDerivProposal(null);
        return;
      }

      const profitTable = message.profit_table as { transactions?: DerivApiProfitTransaction[] } | undefined;
      if (Array.isArray(profitTable?.transactions)) {
        const reqId = toNumber(message.req_id);
        if (derivHistoryReqIdRef.current === null || reqId === derivHistoryReqIdRef.current) {
          derivHistoryReqIdRef.current = null;
          setDerivApiHistoryDeals(profitTable.transactions.map(mapDerivProfitTransaction).filter((deal): deal is DerivDeal => deal !== null));
          setDerivHistoryLoading(false);
          setDerivHistoryError("");
        }
      }

      const history = message.history as { prices?: unknown[] } | undefined;
      const historyRequest = message.echo_req as { ticks_history?: string } | undefined;
      if (Array.isArray(history?.prices) && historyRequest?.ticks_history === derivMarketRef.current) {
        const historyTicks = history.prices.map(toNumber).filter((value): value is number => value !== null).slice(-1000);
        derivTicksRef.current = historyTicks;
        setDerivTicks(historyTicks);
        setDerivPrice(historyTicks.at(-1) ?? null);
      }

      const tick = message.tick as { quote?: number; symbol?: string; pip_size?: number } | undefined;
      if (tick?.symbol === derivMarketRef.current && typeof tick.quote === "number") {
        const nextTicks = [...derivTicksRef.current, tick.quote].slice(-1000);
        derivTicksRef.current = nextTicks;
        derivTickSerialRef.current += 1;
        if (Number.isInteger(tick.pip_size) && tick.pip_size! >= 0 && tick.pip_size! <= 8) {
          derivPipSizeRef.current = tick.pip_size!;
          setDerivPipSize(tick.pip_size!);
        }
        setDerivPrice(tick.quote);
        setDerivTicks(nextTicks);
        maybeRunDerivAuto(nextTicks, socket);
      }

      const balance = message.balance as { balance?: number; currency?: string } | undefined;
      if (typeof balance?.balance === "number") {
        derivBalanceRef.current = balance.balance;
        setDerivBalance(balance.balance);
        setDerivCurrency(balance.currency ?? "USD");
      }

      const proposal = message.proposal as { id?: string; ask_price?: number; payout?: number; longcode?: string } | undefined;
      if (proposal?.id && typeof proposal.ask_price === "number") {
        const echoRequest = message.echo_req as { duration?: number; contract_type?: DerivContractCode; barrier?: string | number; amount?: number; underlying_symbol?: string } | undefined;
        const reqId = toNumber(message.req_id);
        const autoQuote = reqId !== null ? derivAutoQuoteRef.current.get(reqId) : undefined;
        if (autoQuote) {
          derivAutoQuoteRef.current.delete(reqId!);
          if (autoQuote.overUnderScan && autoQuote.overUnderCandidate) {
            const scan = derivOverUnderQuoteScanRef.current;
            scan?.pendingReqIds.delete(reqId!);
            const quoteEvaluation = evaluateOverUnderQuote(autoQuote.overUnderCandidate, proposal.ask_price, proposal.payout ?? 0);
            if (scan && quoteEvaluation.accepted) {
              scan.qualifiedQuotes.push({ autoQuote, proposalId: proposal.id, askPrice: proposal.ask_price, payout: proposal.payout ?? 0, edge: quoteEvaluation.edge, expectedValue: quoteEvaluation.expectedValue });
            }
            if (scan?.pendingReqIds.size) setDerivAutoStatus(`Comparaison payout · ${scan.pendingReqIds.size} cotation${scan.pendingReqIds.size > 1 ? "s" : ""} restante${scan.pendingReqIds.size > 1 ? "s" : ""}`);
            finishDerivOverUnderQuoteScan(socket);
            return;
          }
          if (!derivAutoRunningRef.current || !isDerivTradingStatus(derivStatusRef.current)) {
            setDerivAutoStatus("Proposition annulée par Stop");
          } else {
            if (autoQuote.dbxGuardRequestedAt !== undefined) {
              const active = derivMatchStrategyRef.current;
              if (active.executionMode !== "dbx_dynamic" || derivMarketRef.current !== autoQuote.symbol
                || Date.now() - autoQuote.dbxGuardRequestedAt < 0 || Date.now() - autoQuote.dbxGuardRequestedAt > DBX_V3_GUARD.quoteMaxAgeMs) {
                setDerivAutoStatus("DBX V3.1 · cotation périmée ou stratégie modifiée · aucun achat");
                return;
              }
              const current = buildMatchPrediction(derivTicksRef.current, derivPipSizeRef.current, null, active.rules).bestCandidate;
              const quoted = autoQuote.matchCandidate;
              if (!current || !quoted || current.digit !== autoQuote.barrier) {
                setDerivAutoStatus("DBX V3.1 · digit sélectionné modifié pendant la cotation · aucun achat");
                return;
              }
              const evaluation = evaluateDbxV3Quote({ ...current, probability: Math.min(current.probability, quoted.probability) }, derivTicksRef.current, derivPipSizeRef.current, proposal.ask_price, proposal.payout ?? 0, active.dbxMinimumProbability ?? null);
              if (!evaluation.accepted) {
                setDerivAutoStatus(`DBX V3.1 · refus ${active.dbxMinimumProbability == null ? "payout automatique" : "seuil manuel"} · seuil requis ${evaluation.requiredProbability === null ? "indisponible" : (evaluation.requiredProbability * 100).toFixed(2) + "%"} · estimation prudente ${(evaluation.conservativeProbability * 100).toFixed(2)}% · équilibre payout ${evaluation.breakEven === null ? "indisponible" : (evaluation.breakEven * 100).toFixed(2) + "%"}`);
                return;
              }
              if (!dbxV3BudgetAllows(derivSessionPnlRef.current, derivStakeRef.current, active.lossBudgetStakes ?? DBX_V3_GUARD.defaultLossBudgetStakes, proposal.ask_price)) {
                stopDerivAutoOnPnlLimit("DBX V3.1 · budget de perte atteint : prochain achat annulé");
                return;
              }
            }
            if (autoQuote.dbxLastDigit) {
              const current = buildMatchPrediction(derivTicksRef.current, derivPipSizeRef.current, null, derivMatchStrategyRef.current.rules);
              if (derivMarketRef.current !== autoQuote.symbol || current.bestCandidate?.digit !== autoQuote.barrier) {
                setDerivAutoStatus("DBX V4 · cotation annulée : le dernier digit ne confirme plus le digit coté dans le Top 2");
                return;
              }
            }
            if (autoQuote.dbx && !validDbxQuote(proposal.ask_price, proposal.payout ?? 0, autoQuote.stake, derivBalanceRef.current)) {
              setDerivAutoStatus("DBX · cotation invalide ou solde insuffisant · aucun achat");
              return;
            }
            const quoteEvaluation = autoQuote.overUnderCandidate
              ? evaluateOverUnderQuote(autoQuote.overUnderCandidate, proposal.ask_price, proposal.payout ?? 0)
              : autoQuote.riseFallSignal
                ? evaluateRiseFallQuote(autoQuote.riseFallSignal, proposal.ask_price, proposal.payout ?? 0)
                : autoQuote.dbxGuardRequestedAt === undefined && autoQuote.matchCandidate && !derivMatchStrategyRef.current.bypassPayoutFilter
                  ? evaluateMatchQuote(autoQuote.matchCandidate, proposal.ask_price, proposal.payout ?? 0, derivMatchStrategyRef.current.rules)
                : null;
            if (quoteEvaluation && !quoteEvaluation.accepted) {
              const edge = (quoteEvaluation.edge * 100).toFixed(2);
              const minimumEdge = (quoteEvaluation.minimumEdge * 100).toFixed(2).replace(".", ",");
              setDerivAutoStatus(`Refus payout · Edge ${edge}% · minimum +${minimumEdge}%`);
              setDerivMessage(`Cotation ${formatDerivContract(autoQuote.contractType, autoQuote.barrier)} refusée · EV ${formatUsd(quoteEvaluation.expectedValue)}`);
              return;
            }
            if (autoQuote.dbxGuardRequestedAt !== undefined) registerDerivSessionSignal();
            const buyReqId = ++derivReqIdRef.current;
            const pendingBuy = { dbx: autoQuote.dbx, dbxLastDigit: autoQuote.dbxLastDigit, contractType: autoQuote.contractType, barrier: autoQuote.barrier, stake: autoQuote.stake, symbol: autoQuote.symbol, duration: autoQuote.duration, batchIndex: autoQuote.batchIndex, batchTotal: autoQuote.batchTotal, overUnderCandidate: autoQuote.overUnderCandidate, riseFallSignal: autoQuote.riseFallSignal, matchCandidate: autoQuote.matchCandidate };
            derivPendingBuyRef.current = pendingBuy;
            derivPendingBuysRef.current.set(buyReqId, pendingBuy);
            setDerivContractCategory(getContractCategory(autoQuote.contractType));
            setDerivContractType(autoQuote.contractType);
            setDerivAutoStatus(quoteEvaluation
              ? `Payout validé · Edge +${(quoteEvaluation.edge * 100).toFixed(2)}% · achat en cours`
              : `Signal validé · achat ${autoQuote.batchIndex ?? 1}/${autoQuote.batchTotal ?? 1} en cours`);
            setDerivMessage(`Mode auto: achat ${formatDerivContract(autoQuote.contractType, autoQuote.barrier)} ${autoQuote.batchIndex ?? 1}/${autoQuote.batchTotal ?? 1}`);
            socket.send(JSON.stringify({ buy: proposal.id, price: proposal.ask_price, req_id: buyReqId }));
          }
        } else {
          const contractType = parseDerivContractCode(echoRequest?.contract_type);
          const barrier = needsDigitBarrier(contractType) ? normalizeDigitBarrier(contractType, toNumber(echoRequest?.barrier) ?? derivDigitBarrierRef.current) : needsTouchBarrier(contractType) && echoRequest?.barrier !== undefined ? String(echoRequest.barrier) : null;
          setDerivProposal({ id: proposal.id, askPrice: proposal.ask_price, payout: proposal.payout ?? 0, longcode: proposal.longcode ?? "Contrat Deriv Options", duration: echoRequest?.duration ?? 5, contractType, barrier, stake: echoRequest?.amount ?? proposal.ask_price, symbol: echoRequest?.underlying_symbol ?? derivMarketRef.current });
          setDerivMessage("Proposition reçue, prête à être achetée");
        }
      }

      const buy = message.buy as { contract_id?: number; buy_price?: number; payout?: number } | undefined;
      if (typeof buy?.contract_id === "number") {
        if (derivOpenContractsRef.current.has(buy.contract_id) || derivSettledContractIdsRef.current.has(buy.contract_id)) return;
        const reqId = toNumber(message.req_id);
        const pending = reqId !== null ? derivPendingBuysRef.current.get(reqId) ?? derivPendingBuyRef.current : derivPendingBuyRef.current;
        if (reqId !== null) derivPendingBuysRef.current.delete(reqId);
        derivOpenContractsRef.current.add(buy.contract_id);
        derivSessionContractsRef.current += 1;
        setDerivSessionContracts(derivSessionContractsRef.current);
        if (pending.contractType === "DIGITMATCH") {
          derivMatchContractIdsRef.current.add(buy.contract_id);
          const digit = toNumber(pending.barrier);
          if (digit !== null && digit >= 0 && digit <= 9) derivMatchContractDigitsRef.current.set(buy.contract_id, digit);
        }
        derivOpenContractRef.current = derivOpenContractsRef.current.size > 0;
        derivLastTradeSerialRef.current = derivTickSerialRef.current;
        setDerivDeals((current) => [{ contractId: buy.contract_id!, buyPrice: buy.buy_price ?? pending.stake, payout: buy.payout ?? 0, contractType: pending.contractType, barrier: pending.barrier, symbol: pending.symbol, createdAt: new Date().toISOString(), duration: pending.duration, ticksElapsed: 0, status: "open" as const, profit: null, entrySpot: null, currentSpot: null }, ...current].slice(0, 24));
        setDerivProposal(null);
        setDerivMessage(`Contrat #${buy.contract_id} en cours · 0/${pending.duration} ticks`);
        if (derivAutoRunningRef.current) setDerivAutoStatus(`Contrat #${buy.contract_id} en cours${pending.batchTotal ? ` · position ${pending.batchIndex}/${pending.batchTotal}` : ""}`);
        socket.send(JSON.stringify({ proposal_open_contract: 1, contract_id: buy.contract_id, subscribe: 1 }));
        if (!pending.pair && derivAutoRunningRef.current && pending.batchTotal && pending.batchIndex && pending.batchIndex < pending.batchTotal) {
          requestDerivAutoPosition(socket, { ...pending, batchIndex: pending.batchIndex + 1, batchTotal: pending.batchTotal });
        }
      }

      const portfolio = message.portfolio as { contracts?: Array<{ contract_id?: number; buy_price?: string | number; payout?: string | number; contract_type?: string; barrier?: string | number; symbol?: string; date_start?: number }> } | undefined;
      if (Array.isArray(portfolio?.contracts)) {
        derivPortfolioReadyRef.current = true;
        const openContracts = portfolio.contracts.filter((contract) => typeof contract.contract_id === "number");
        derivOpenContractsRef.current = new Set(openContracts.map((contract) => contract.contract_id!));
        derivOpenContractRef.current = derivOpenContractsRef.current.size > 0;
        setDerivDeals((current) => {
          const known = new Set(current.map((deal) => deal.contractId));
          const recovered = openContracts.filter((contract) => !known.has(contract.contract_id!)).map((contract) => {
            const contractType = parseDerivContractCode(contract.contract_type);
            if (contractType === "DIGITMATCH") {
              derivMatchContractIdsRef.current.add(contract.contract_id!);
              const digit = toNumber(contract.barrier);
              if (digit !== null && digit >= 0 && digit <= 9) derivMatchContractDigitsRef.current.set(contract.contract_id!, digit);
            }
            return ({
            contractId: contract.contract_id!,
            buyPrice: toNumber(contract.buy_price) ?? 0,
            payout: toNumber(contract.payout) ?? 0,
            contractType,
            barrier: needsDigitBarrier(contractType) ? toNumber(contract.barrier) : null,
            symbol: contract.symbol ?? derivMarketRef.current,
            createdAt: contract.date_start ? new Date(contract.date_start * 1000).toISOString() : new Date().toISOString(),
            duration: 5,
            ticksElapsed: 0,
            status: "open" as const,
            profit: null,
            entrySpot: null,
            currentSpot: null,
          });
          });
          return [...recovered, ...current].slice(0, 24);
        });
        openContracts.forEach((contract) => socket.send(JSON.stringify({ proposal_open_contract: 1, contract_id: contract.contract_id, subscribe: 1 })));
      }

      const openContract = message.proposal_open_contract as {
        contract_id?: number;
        buy_price?: string | number;
        payout?: string | number;
        profit?: string | number;
        entry_spot?: string | number;
        current_spot?: string | number;
        contract_type?: string;
        status?: string;
        is_sold?: boolean | number;
        tick_count?: number;
        tick_stream?: unknown[];
      } | undefined;
      if (typeof openContract?.contract_id === "number") {
        const isSold = openContract.is_sold === true || openContract.is_sold === 1 || openContract.status === "won" || openContract.status === "lost";
        const profit = toNumber(openContract.profit);
        if (isSold && profit === null && derivMatchContractIdsRef.current.has(openContract.contract_id)
          && derivMatchStrategyRef.current.executionMode === "dbx_dynamic") {
          stopDerivAutoOnPnlLimit("DBX V3.1 · résultat net manquant : arrêt, reconnectez pour réconcilier le portefeuille");
          return;
        }
        const ticksElapsed = typeof openContract.tick_count === "number" ? openContract.tick_count : Array.isArray(openContract.tick_stream) ? openContract.tick_stream.length : 0;
        setDerivDeals((current) => current.map((deal) => deal.contractId !== openContract.contract_id ? deal : {
          ...deal,
          buyPrice: toNumber(openContract.buy_price) ?? deal.buyPrice,
          payout: toNumber(openContract.payout) ?? deal.payout,
          profit,
          entrySpot: toNumber(openContract.entry_spot) ?? deal.entrySpot,
          currentSpot: toNumber(openContract.current_spot) ?? deal.currentSpot,
          ticksElapsed: Math.min(Math.max(ticksElapsed, deal.ticksElapsed), deal.duration),
          status: isSold ? (openContract.status === "won" || (openContract.status !== "lost" && (profit ?? 0) > 0) ? "won" : "lost") : "open",
        }));
        if (isSold) {
          if (derivSettledContractIdsRef.current.has(openContract.contract_id)) return;
          derivSettledContractIdsRef.current.add(openContract.contract_id);
          derivSessionPnlRef.current += profit ?? 0;
          setDerivSessionPnl(derivSessionPnlRef.current);
          if ((profit ?? 0) > 0) {
            derivSessionWinsRef.current += 1;
            setDerivSessionWins(derivSessionWinsRef.current);
          } else {
            derivSessionLossesRef.current += 1;
            setDerivSessionLosses(derivSessionLossesRef.current);
          }
          const wasMatchContract = derivMatchContractIdsRef.current.delete(openContract.contract_id);
          const matchDigit = wasMatchContract ? derivMatchContractDigitsRef.current.get(openContract.contract_id) ?? null : null;
          derivMatchContractDigitsRef.current.delete(openContract.contract_id);
          derivOpenContractsRef.current.delete(openContract.contract_id);
          derivOpenContractRef.current = derivOpenContractsRef.current.size > 0;
          const shouldStopAfterSettlement = derivMaxSignalsRef.current > 0 && derivSessionSignalsRef.current >= derivMaxSignalsRef.current && derivOpenContractsRef.current.size === 0;
          const activeMatchStrategy = derivMatchStrategyRef.current;
          const shouldStopForTakeProfit = wasMatchContract
            && activeMatchStrategy.takeProfit !== null
            && derivSessionPnlRef.current >= activeMatchStrategy.takeProfit
            && derivOpenContractsRef.current.size === 0;
          const shouldStopForStopLoss = wasMatchContract
            && activeMatchStrategy.stopLoss !== null
            && derivSessionPnlRef.current <= activeMatchStrategy.stopLoss
            && derivOpenContractsRef.current.size === 0;
          const shouldStopForDbxBudget = wasMatchContract && activeMatchStrategy.executionMode === "dbx_dynamic"
            && derivOpenContractsRef.current.size === 0
            && !dbxV3BudgetAllows(derivSessionPnlRef.current, derivStakeRef.current, activeMatchStrategy.lossBudgetStakes ?? DBX_V3_GUARD.defaultLossBudgetStakes);
          if (derivAutoRunningRef.current && derivDoubleRiskEnabledRef.current) {
            derivDoubleRiskSeriesIndexRef.current += 1;
            setDerivDoubleRiskSeriesIndex(derivDoubleRiskSeriesIndexRef.current);
          }
          if ((profit ?? 0) > 0) {
            derivConsecutiveLossesRef.current = 0;
            setDerivConsecutiveLosses(0);
            if (wasMatchContract) {
              derivMatchConsecutiveLossesRef.current = 0;
              derivLastMatchLossSerialRef.current = -1;
              if (matchDigit !== null && matchDigit >= 0 && matchDigit <= 9) {
                derivMatchDigitLossesRef.current[matchDigit] = 0;
                derivMatchDigitBlockedUntilRef.current[matchDigit] = -1;
              }
            }
          } else {
            derivConsecutiveLossesRef.current += 1;
            setDerivConsecutiveLosses(derivConsecutiveLossesRef.current);
            if (wasMatchContract) {
              if (derivLastMatchLossSerialRef.current !== derivTickSerialRef.current) {
                derivMatchConsecutiveLossesRef.current += 1;
                derivLastMatchLossSerialRef.current = derivTickSerialRef.current;
              }
              const strategy = derivMatchStrategyRef.current;
              if (strategy.maxRecoverySteps > 0 && derivMatchConsecutiveLossesRef.current >= strategy.maxRecoverySteps) {
                derivMatchConsecutiveLossesRef.current = 0;
              }
              if (matchDigit !== null && matchDigit >= 0 && matchDigit <= 9) {
                const nextLosses = derivMatchDigitLossesRef.current[matchDigit] + 1;
                derivMatchDigitLossesRef.current[matchDigit] = nextLosses;
                if (nextLosses >= strategy.digitBlockAfterLosses) {
                  derivMatchDigitBlockedUntilRef.current[matchDigit] = derivTickSerialRef.current + Math.min(strategy.digitBlockMaxTicks, strategy.digitBlockTicksMultiplier * nextLosses);
                }
              }
            }
          }
          setDerivMessage(`Contrat #${openContract.contract_id} ${((profit ?? 0) > 0 ? "gagné" : "perdu")} · ${profit !== null && profit >= 0 ? "+" : ""}${formatUsd(profit ?? 0)}`);
          if (derivAutoRunningRef.current) {
	            const nextBaseStake = getBalanceRiskStake(derivStakeRef.current, derivHalfBalanceRiskEnabledRef.current, derivBalanceRef.current);
	            const openContractType = parseDerivContractCode(openContract.contract_type);
	            const overUnderMartingaleLimit = openContractType === "DIGITOVER" || openContractType === "DIGITUNDER" ? derivOverUnderMartingaleCyclesRef.current : null;
	            const nextStake = derivHalfBalanceRiskEnabledRef.current ? nextBaseStake : getMartingaleStake(getDoubleRiskStake(nextBaseStake, derivDoubleRiskEnabledRef.current, derivDoubleRiskSeriesIndexRef.current), derivConsecutiveLossesRef.current, derivMartingaleEnabledRef.current, derivMartingaleMultiplierRef.current, derivMartingaleMaxStakeRef.current, overUnderMartingaleLimit);
	            const martingaleCyclesDone = overUnderMartingaleLimit !== null && getMartingaleEffectiveLosses(derivConsecutiveLossesRef.current, overUnderMartingaleLimit) === 0 && derivConsecutiveLossesRef.current > 0;
	            const martingaleNote = !derivHalfBalanceRiskEnabledRef.current && derivMartingaleEnabledRef.current && derivConsecutiveLossesRef.current > 0 ? martingaleCyclesDone ? ` · cycles martingale terminés · prochaine mise ${formatUsd(nextStake)}` : ` · prochaine mise ${formatUsd(nextStake)}` : "";
	            setDerivAutoStatus(`${(profit ?? 0) > 0 ? "Gain" : "Perte"} ${profit !== null && profit >= 0 ? "+" : ""}${formatUsd(profit ?? 0)} · bot actif jusqu’au Stop${martingaleNote}`);
          }
          const subscription = message.subscription as { id?: string } | undefined;
          if (subscription?.id) socket.send(JSON.stringify({ forget: subscription.id }));
          socket.send(JSON.stringify({ balance: 1 }));
          if (shouldStopAfterSettlement) stopDerivAutoOnSignalLimit();
          if (shouldStopForTakeProfit) stopDerivAutoOnPnlLimit(`Take Profit atteint · +${formatUsd(derivSessionPnlRef.current)}`);
          if (shouldStopForDbxBudget) stopDerivAutoOnPnlLimit("DBX V3.1 · budget de perte atteint · session arrêtée");
          if (shouldStopForStopLoss) stopDerivAutoOnPnlLimit(`Stop Loss atteint · ${formatUsd(derivSessionPnlRef.current)}`);
        } else {
          setDerivMessage(`Contrat #${openContract.contract_id} en cours · ${ticksElapsed} tick${ticksElapsed > 1 ? "s" : ""} reçu${ticksElapsed > 1 ? "s" : ""}`);
        }
      }
    };
    socket.onerror = () => {
      if (derivSocketRef.current !== socket) return;
      derivPairScannerRef.current?.dispose();
      derivStatusRef.current = "error";
      derivAutoRunningRef.current = false;
      setDerivAutoRunning(false);
      setDerivAutoStatus("Bot arrêté · connexion impossible");
      setDerivStatus("error");
      setDerivMessage("Connexion WebSocket Deriv impossible");
    };
    socket.onclose = () => {
      if (derivSocketRef.current !== socket) return;
      derivPairScannerRef.current?.dispose();
      derivStatusRef.current = "error";
      derivAutoRunningRef.current = false;
      setDerivAutoRunning(false);
      setDerivAutoStatus("Bot arrêté · connexion fermée");
      setDerivStatus("error");
      setDerivMessage("Connexion Deriv fermée");
    };
  }

  function requestDerivProfitHistory() {
    const socket = derivSocketRef.current;
    if (!isDerivTradingStatus(derivStatusRef.current) || !socket || socket.readyState !== WebSocket.OPEN) {
      setDerivHistoryLoading(false);
      setDerivHistoryError("Connectez le compte Deriv Options pour charger l'historique API");
      setDerivApiHistoryDeals([]);
      return;
    }

    const reqId = ++derivReqIdRef.current;
    const dateFrom = getHistoryPeriodDateFrom(derivHistoryPeriod);
    const request: Record<string, string | number> = {
      profit_table: 1,
      description: 1,
      limit: 500,
      sort: "DESC",
      req_id: reqId,
    };
    if (dateFrom) request.date_from = dateFrom;

    derivHistoryReqIdRef.current = reqId;
    setDerivHistoryLoading(true);
    setDerivHistoryError("");
    socket.send(JSON.stringify(request));
  }

  useEffect(() => {
    // The socket connection is the external system this effect initializes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    connectDerivSocket("wss://api.derivws.com/trading/v1/options/ws/public", "public");
    fetch("/api/deriv/options/connect", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: DerivServerConfig) => setDerivServerConfig(data))
      .catch(() => undefined);

    const params = new URLSearchParams(window.location.search);
    const oauthStatus = params.get("deriv_oauth");
    if (oauthStatus === "connected") {
      const accountType = params.get("account_type") === "real" ? "real" : "demo";
      setActiveView("derivbot");
      setDerivAccountMode(accountType);
      setDerivMessage(`OAuth Deriv validé · connexion du compte ${accountType === "real" ? "réel" : "démo"}...`);
      window.history.replaceState(null, "", window.location.pathname);
      window.setTimeout(() => connectDerivAccount(accountType), 0);
    } else if (oauthStatus === "error") {
      setActiveView("derivbot");
      setDerivStatus("error");
      setDerivMessage(params.get("message") || "Connexion OAuth Deriv refusée");
      window.history.replaceState(null, "", window.location.pathname);
    }

    return () => {
      derivPairScannerRef.current?.dispose();
      derivSocketRef.current?.close();
      derivSocketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activeView !== "derivhistory") return;
    requestDerivProfitHistory();
  }, [activeView, derivHistoryPeriod, derivStatus]);

  function clearPendingNormalBuys() {
    for (const [id, pending] of derivPendingBuysRef.current) {
      if (!pending.pair && !pending.dbx) derivPendingBuysRef.current.delete(id);
    }
  }

  function startDerivPair(socket: WebSocket) {
    if (!derivPortfolioReadyRef.current || derivOpenContractsRef.current.size || derivPendingBuysRef.current.size || derivPairScannerRef.current?.busy) {
      setDerivAutoStatus("Attendez la réconciliation du portefeuille et la clôture des contrats en cours.");
      return;
    }
    const stake = derivStakeRef.current;
    if (!Number.isFinite(stake) || stake < 0.35 || !pairBalanceAllows(2 * stake, derivBalanceRef.current)) {
      setDerivAutoStatus("La mise doit être d’au moins 0,35 par contrat et le solde doit couvrir les deux contrats.");
      return;
    }
    derivPairScannerRef.current?.dispose();
    resetDerivSessionStats();
    derivModeRef.current = "auto";
    derivAutoRunningRef.current = true;
    setDerivMode("auto");
    setDerivAutoRunning(true);
    setDerivPairRows([]);
    setDerivPairTrades([]);
    setDerivPairStats({ ...EMPTY_PAIR_STATS });
    const strategy = derivOverUnderStrategyRef.current;
    const scanner = new OverUnderPairScanner({
      mode: strategy === "under8_transition" ? "under8_digit9" : "under5_over4",
      nextId: () => ++derivReqIdRef.current,
      send: (message) => {
        if (derivSocketRef.current !== socket || socket.readyState !== WebSocket.OPEN) throw new Error("Socket closed");
        socket.send(JSON.stringify(message));
      },
      onStatus: setDerivAutoStatus,
      onHalt: (message) => {
        derivAutoRunningRef.current = false;
        setDerivAutoRunning(false);
        setDerivAutoStatus(message);
        setDerivMessage(message);
      },
      onUpdate: () => {
        if (Date.now() - derivPairUiUpdateRef.current > 250) {
          derivPairUiUpdateRef.current = Date.now();
          setDerivPairRows(scanner.rows());
        }
        maybeRunDerivAuto(derivTicksRef.current, socket);
      },
      canBuy: (cost) => {
        if (!derivAutoRunningRef.current || derivModeRef.current !== "auto" || derivOverUnderStrategyRef.current !== strategy
          || (derivContractTypeRef.current !== "DIGITUNDER" && derivContractTypeRef.current !== "DIGITOVER")
          || !isDerivTradingStatus(derivStatusRef.current) || !derivPortfolioReadyRef.current || derivSocketRef.current !== socket
          || derivOpenContractsRef.current.size > 0 || derivPendingBuysRef.current.size > 0) return false;
        if (derivMaxSignalsRef.current > 0 && derivSessionSignalsRef.current >= derivMaxSignalsRef.current) { stopDerivAutoOnSignalLimit(); return false; }
        if (!pairBalanceAllows(cost, derivBalanceRef.current)) { stopDerivAutoOnPnlLimit("Balance insuffisante pour les deux contrats"); return false; }
        return true;
      },
      onBuyRequest: (id, leg) => { derivPendingBuysRef.current.set(id, leg); },
      onSignal: registerDerivSessionSignal,
      onResults: (trades, stats) => { setDerivPairTrades(trades); setDerivPairStats(stats); },
    });
    derivPairScannerRef.current = scanner;
    setDerivAutoStatus("Découverte de tous les indices de volatilité disponibles…");
    setDerivMessage(`${derivOverUnderStrategies[strategy].name} · deux indices distincts · 2 mises fixes par paire · martingale et multiplicateurs ignorés`);
    scanner.start();
  }

  function maybeRunDerivAuto(currentTicks: number[], socket: WebSocket) {
    if (derivModeRef.current !== "auto" || !derivAutoRunningRef.current || !isDerivTradingStatus(derivStatusRef.current)) return;
    if (derivOpenContractsRef.current.size > 0 || derivAutoQuoteRef.current.size > 0 || derivPendingBuysRef.current.size > 0 || derivOverUnderQuoteScanRef.current) return;
    if (derivMaxSignalsRef.current > 0 && derivSessionSignalsRef.current >= derivMaxSignalsRef.current) {
      stopDerivAutoOnSignalLimit();
      return;
    }
    const currentContractType = derivContractTypeRef.current;
    const currentMatchStrategy = derivMatchStrategyRef.current;
    if ((currentContractType === "DIGITOVER" || currentContractType === "DIGITUNDER") && isMultiIndexOverUnder(derivOverUnderStrategyRef.current)) {
      derivPairScannerRef.current?.requestBestPair(derivStakeRef.current, derivCurrencyRef.current);
      return;
    }
    if (currentContractType === "DIGITMATCH") {
      if (currentMatchStrategy.takeProfit !== null && derivSessionPnlRef.current >= currentMatchStrategy.takeProfit) {
        stopDerivAutoOnPnlLimit(`Take Profit atteint · +${formatUsd(derivSessionPnlRef.current)}`);
        return;
      }
      if (currentMatchStrategy.stopLoss !== null && derivSessionPnlRef.current <= currentMatchStrategy.stopLoss) {
        stopDerivAutoOnPnlLimit(`Stop Loss atteint · ${formatUsd(derivSessionPnlRef.current)}`);
        return;
      }
    }
    if (currentContractType === "DIGITMATCH" && isDbxMode(currentMatchStrategy.executionMode)) {
      if (derivMarketRef.current !== DBX_MATCH_CONFIG.symbol) {
        setDerivAutoStatus("DBX · sélectionnez Volatility 50 (1s) pour cette stratégie");
        return;
      }
      if (!derivPortfolioReadyRef.current || !currentTicks.length || !Number.isFinite(currentTicks.at(-1))) return;
      const guarded = currentMatchStrategy.executionMode === "dbx_dynamic";
      if (guarded) {
        if (!dbxV3BudgetAllows(derivSessionPnlRef.current, derivStakeRef.current, currentMatchStrategy.lossBudgetStakes ?? DBX_V3_GUARD.defaultLossBudgetStakes)) {
          stopDerivAutoOnPnlLimit("DBX V3.1 · budget de perte : la prochaine mise dépasserait la limite");
          return;
        }
        if (currentTicks.length < DBX_V3_GUARD.minimumTicks) {
          setDerivAutoStatus(`DBX V3.1 · contrôle prudent ${currentTicks.length}/${DBX_V3_GUARD.minimumTicks} ticks disponibles`);
          return;
        }
      }
      const lastDigitMode = currentMatchStrategy.executionMode === "dbx_last_digit";
      const dynamic = currentMatchStrategy.executionMode !== "dbx_fixed";
      const prediction = dynamic ? buildMatchPrediction(currentTicks, derivPipSizeRef.current, null, currentMatchStrategy.rules) : null;
      if (dynamic && !prediction?.bestCandidate) {
        if (lastDigitMode && prediction?.ready) {
          const top = [...prediction.candidates].sort((a, b) => b.probability - a.probability || a.digit - b.digit).slice(0, 2);
          const last = currentTicks.at(-1)!.toFixed(derivPipSizeRef.current).at(-1);
          setDerivAutoStatus(`DBX V4 · dernier digit ${last} · attente du Top 2 : ${top.map((item) => item.digit).join(" / ")}`);
        } else setDerivAutoStatus(`${lastDigitMode ? "DBX V4" : "DBX V3"} · collecte ${prediction?.sampleSize ?? 0}/${currentMatchStrategy.rules.minimumTicks} ticks valides · attente du digit dynamique`);
        return;
      }
      const digit = prediction?.bestCandidate?.digit ?? DBX_MATCH_CONFIG.barrier;
      const order = buildDbxMatchOrder(derivStakeRef.current, digit, lastDigitMode ? DBX_MATCH_CONFIG.duration : currentMatchStrategy.durationTicks ?? DBX_MATCH_CONFIG.duration);
      if (!order || !pairBalanceAllows(order.stake, derivBalanceRef.current)) {
        stopDerivAutoOnPnlLimit("DBX · mise invalide ou solde insuffisant");
        return;
      }
      derivDigitBarrierRef.current = digit;
      setDerivDigitBarrier(digit);
      if (!guarded) registerDerivSessionSignal();
      setDerivAutoStatus(`${lastDigitMode ? "DBX V4 · dernier digit confirmé dans le Top 2" : dynamic ? "DBX V3.1 · contrôle du payout" : "DBX V2 · fixe"} · Matches digit ${digit} · ${order.duration} tick${order.duration > 1 ? "s" : ""} · mise fixe ${order.stake.toFixed(2)} ${derivCurrencyRef.current}`);
      requestDerivAutoPosition(socket, guarded ? { ...order, dbxGuardRequestedAt: Date.now(), matchCandidate: prediction!.bestCandidate! } : lastDigitMode ? { ...order, dbxLastDigit: true } : order);
      return;
    }
    const isMatchesDiffers = isMatchesDiffersContract(currentContractType);
    const requiredPauseTicks = 8;
    if (!isMatchesDiffers && derivTradePauseEnabledRef.current && derivTickSerialRef.current - derivLastTradeSerialRef.current < requiredPauseTicks) {
      setDerivAutoStatus(`Pause entre trades · ${requiredPauseTicks} ticks`);
      return;
    }

    if (derivHalfBalanceRiskEnabledRef.current && (derivBalanceRef.current === null || !Number.isFinite(derivBalanceRef.current))) {
      setDerivAutoStatus("Attente balance Deriv pour risque 50%");
      return;
    }
    const isOverUnder = currentContractType === "DIGITOVER" || currentContractType === "DIGITUNDER";
    const overUnderMartingaleLimit = isOverUnder ? derivOverUnderMartingaleCyclesRef.current : null;
    const balanceRiskStake = getBalanceRiskStake(derivStakeRef.current, derivHalfBalanceRiskEnabledRef.current, derivBalanceRef.current);
    const baseStake = derivHalfBalanceRiskEnabledRef.current ? balanceRiskStake : getDoubleRiskStake(balanceRiskStake, derivDoubleRiskEnabledRef.current, derivDoubleRiskSeriesIndexRef.current);
    const stake = currentContractType === "DIGITMATCH" && currentMatchStrategy.maxRecoverySteps > 0
      ? getMatchStrategyStake(baseStake, derivMatchConsecutiveLossesRef.current, currentMatchStrategy)
      : derivHalfBalanceRiskEnabledRef.current
        ? baseStake
        : getMartingaleStake(baseStake, derivConsecutiveLossesRef.current, derivMartingaleEnabledRef.current, derivMartingaleMultiplierRef.current, derivMartingaleMaxStakeRef.current, overUnderMartingaleLimit);
    if (!Number.isFinite(stake) || stake < 0.35) {
      derivAutoRunningRef.current = false;
      setDerivAutoRunning(false);
      setDerivAutoStatus("Arrêt · mise invalide");
      return;
    }

	    const fixedDigitBarrier = !isOverUnder && currentContractType.startsWith("DIGIT") && needsDigitBarrier(currentContractType) && derivAutoDigitBarrierModeRef.current === "fixed" ? normalizeDigitBarrier(currentContractType, derivDigitBarrierRef.current) : null;
	    const excludedMatchDigits = currentContractType === "DIGITMATCH" && fixedDigitBarrier === null
	      ? new Set(derivMatchDigitBlockedUntilRef.current
	        .map((blockedUntil, digit) => blockedUntil > derivTickSerialRef.current ? digit : null)
	        .filter((digit): digit is number => digit !== null))
	      : new Set<number>();
		    const digitSignal = currentContractType.startsWith("DIGIT") ? getDerivDigitAutoSignal(currentTicks, currentContractType, fixedDigitBarrier, derivPipSizeRef.current, derivOverUnderStrategyRef.current, excludedMatchDigits, currentMatchStrategy.rules, derivSessionContractsRef.current) : null;
	    const priceSignal = currentContractType === "CALL" || currentContractType === "PUT" || needsTouchBarrier(currentContractType) ? buildRiseFallSignal(currentTicks, derivStrategyRef.current) : null;
		    if (currentContractType.startsWith("DIGIT") && !digitSignal) {
		      if (isOverUnder) {
		        const transition = getUnderEightTransitionState(currentTicks, derivPipSizeRef.current);
		        const overFiveTransition = getDigitExitTransitionState(currentTicks, 4, derivPipSizeRef.current);
		        setDerivAutoStatus(derivOverUnderStrategyRef.current === "under8_transition"
		          ? transition.state === "armed"
		            ? "Under 8 armé · digit 9 détecté · attente de sa sortie"
		            : transition.state === "collecting"
		              ? "Under 8 · collecte des ticks"
		              : "Under 8 · attente du digit 9"
		          : derivOverUnderStrategyRef.current === "over5"
		            ? overFiveTransition.state === "armed"
		              ? "Over 5 armé · digit 4 détecté · attente de sa sortie"
		              : overFiveTransition.state === "collecting"
		                ? "Over 5 · collecte des ticks"
		                : "Over 5 · attente du digit 4"
		          : `${derivOverUnderStrategies[derivOverUnderStrategyRef.current].name} · collecte statistique des digits`);
		        return;
		      }
		      if (currentContractType === "DIGITMATCH") {
		        const excludedNote = excludedMatchDigits.size ? ` · digits exclus ${[...excludedMatchDigits].join(", ")}` : "";
		        setDerivAutoStatus(isFastMatchMode(currentMatchStrategy.rules.selectionMode)
              ? `Top 2 · ${Math.min(currentTicks.length, currentMatchStrategy.rules.minimumTicks)}/${currentMatchStrategy.rules.minimumTicks} ticks · attente classement`
              : `Scan proba Matches${excludedNote} · aucun signal qualifié`);
		        return;
		      }
		      const requiredTicks = 25;
		      const barrierNote = fixedDigitBarrier !== null ? ` · barrière fixe ${fixedDigitBarrier}` : "";
		      setDerivAutoStatus(`Analyse digit${barrierNote} · ${Math.min(currentTicks.length, requiredTicks)}/${requiredTicks} ticks · attente signal`);
		      return;
		    }
    if (digitSignal?.overUnderCandidates?.length) {
      const scanCooldown = 2;
      if (derivTickSerialRef.current - derivLastOverUnderScanSerialRef.current < scanCooldown) {
        setDerivAutoStatus(`Over/Under · attente de ${scanCooldown} nouveaux ticks avant la prochaine comparaison`);
        return;
      }
      derivLastOverUnderScanSerialRef.current = derivTickSerialRef.current;
      registerDerivSessionSignal();
      requestDerivOverUnderQuoteScan(socket, digitSignal.overUnderCandidates, stake);
      return;
    }
    if ((currentContractType === "CALL" || currentContractType === "PUT" || needsTouchBarrier(currentContractType)) && !priceSignal) {
      setDerivAutoStatus(`Analyse Rise/Fall · 80 ticks · ${derivStrategies[derivStrategyRef.current].name}`);
      return;
    }
    const selectedContractType = digitSignal?.contractType ?? (needsTouchBarrier(currentContractType) ? currentContractType : priceSignal!.direction);
    const duration = (selectedContractType === "CALL" || selectedContractType === "PUT") && priceSignal
      ? priceSignal.duration
      : chooseDerivContractDuration(selectedContractType, currentTicks).duration;
    const barrier = fixedDigitBarrier !== null && needsDigitBarrier(selectedContractType) ? normalizeDigitBarrier(selectedContractType, fixedDigitBarrier) : digitSignal?.barrier ?? (needsDigitBarrier(selectedContractType) ? normalizeDigitBarrier(selectedContractType, derivDigitBarrierRef.current) : needsTouchBarrier(selectedContractType) ? getDynamicTouchBarrier(currentTicks, selectedContractType) : null);
    const positionTotal = currentContractType === "DIGITMATCH"
      ? isFastMatchMode(currentMatchStrategy.rules.selectionMode) ? 1 : Math.min(10, Math.max(1, Math.trunc(derivMatchPositionCountRef.current)))
      : derivHalfBalanceRiskEnabledRef.current || digitSignal?.overUnderCandidate
        ? 1
        : derivMultiplePositionsEnabledRef.current
          ? Math.min(10, Math.max(2, Math.trunc(derivPositionCountRef.current)))
          : 1;
    setDerivContractCategory(getContractCategory(selectedContractType));
    setDerivContractType(selectedContractType);
    if (typeof barrier === "number") {
      derivDigitBarrierRef.current = barrier;
      setDerivDigitBarrier(barrier);
    } else if (typeof barrier === "string") {
      derivTouchBarrierRef.current = barrier;
      setDerivTouchBarrier(barrier);
    }
    const signalReason = digitSignal?.reason ?? (needsTouchBarrier(selectedContractType) ? `${derivContractLabels[selectedContractType]} dynamique · barrière ${barrier}` : priceSignal!.reason);
    const signalConfidence = digitSignal?.confidence ?? priceSignal!.confidence;
    const martingaleSuffix = !derivHalfBalanceRiskEnabledRef.current && derivMartingaleEnabledRef.current && derivConsecutiveLossesRef.current > 0 ? ` · martingale ${formatUsd(stake)}` : "";
    const fixedBarrierSuffix = fixedDigitBarrier !== null ? ` · barrière fixe ${barrier}` : "";
    registerDerivSessionSignal();
    setDerivAutoStatus(`${signalReason}${isFastMatchMode(currentMatchStrategy.rules.selectionMode) && currentContractType === "DIGITMATCH" ? "" : ` · confiance ${signalConfidence}%`}${fixedBarrierSuffix}${martingaleSuffix} · ${positionTotal} position${positionTotal > 1 ? "s" : ""}`);
    setDerivMessage(`Signal automatique ${formatDerivContract(selectedContractType, barrier)} · ${positionTotal} proposition${positionTotal > 1 ? "s" : ""}`);
    requestDerivAutoPosition(socket, { contractType: selectedContractType, barrier, duration, stake, symbol: derivMarketRef.current, batchIndex: 1, batchTotal: positionTotal, overUnderCandidate: digitSignal?.overUnderCandidate, riseFallSignal: selectedContractType === "CALL" || selectedContractType === "PUT" ? priceSignal ?? undefined : undefined, matchCandidate: digitSignal?.matchCandidate });
  }

  function requestDerivOverUnderQuoteScan(socket: WebSocket, candidates: OverUnderCandidate[], stake: number) {
    const scan: DerivOverUnderQuoteScan = { pendingReqIds: new Set(), qualifiedQuotes: [] };
    derivOverUnderQuoteScanRef.current = scan;
    setDerivAutoStatus(`Comparaison de ${candidates.length} payout${candidates.length > 1 ? "s" : ""} Over/Under`);
    setDerivMessage("Calcul Edge et EV sur les cotations Deriv disponibles");

    candidates.forEach((candidate) => {
      const reqId = ++derivReqIdRef.current;
      const autoQuote: DerivAutoQuote = {
        contractType: candidate.contractType,
        barrier: candidate.barrier,
        stake,
        symbol: derivMarketRef.current,
        duration: 1,
        batchIndex: 1,
        batchTotal: 1,
        reqId,
        overUnderCandidate: candidate,
        overUnderScan: true,
      };
      scan.pendingReqIds.add(reqId);
      derivAutoQuoteRef.current.set(reqId, autoQuote);
      socket.send(JSON.stringify(buildDerivProposalRequest({ contractType: candidate.contractType, barrier: candidate.barrier, stake, currency: derivCurrencyRef.current, duration: 1, symbol: derivMarketRef.current, reqId })));
    });
  }

  function finishDerivOverUnderQuoteScan(socket: WebSocket) {
    const scan = derivOverUnderQuoteScanRef.current;
    if (!scan || scan.pendingReqIds.size > 0) return;
    derivOverUnderQuoteScanRef.current = null;
    if (!derivAutoRunningRef.current || !isDerivTradingStatus(derivStatusRef.current)) return;

    const best = scan.qualifiedQuotes.sort((left, right) => right.expectedValue - left.expectedValue)[0];
    if (!best) {
      const scanCooldown = 2;
      setDerivAutoStatus("Objectif 7/10 · signal ou payout non confirmé");
      setDerivMessage(`Over/Under refusé · nouvelle analyse après ${scanCooldown} ticks`);
      return;
    }

    const pendingBuy: DerivPendingBuy = { ...best.autoQuote, batchIndex: 1, batchTotal: 1 };
    const buyReqId = ++derivReqIdRef.current;
    derivPendingBuyRef.current = pendingBuy;
    derivPendingBuysRef.current.set(buyReqId, pendingBuy);
    derivContractTypeRef.current = best.autoQuote.contractType;
    derivDigitBarrierRef.current = Number(best.autoQuote.barrier);
    setDerivContractCategory("over_under");
    setDerivContractType(best.autoQuote.contractType);
    setDerivDigitBarrier(Number(best.autoQuote.barrier));
    setDerivAutoStatus(`Meilleure EV ${formatUsd(best.expectedValue)} · Edge +${(best.edge * 100).toFixed(2)}% · achat en cours`);
    setDerivMessage(`${formatDerivContract(best.autoQuote.contractType, best.autoQuote.barrier)} sélectionné après comparaison des payouts`);
    socket.send(JSON.stringify({ buy: best.proposalId, price: best.askPrice, req_id: buyReqId }));
  }

  function requestDerivAutoPosition(socket: WebSocket, input: DerivPendingBuy & { batchIndex: number; batchTotal: number }) {
    if (!derivAutoRunningRef.current || !isDerivTradingStatus(derivStatusRef.current) || socket.readyState !== WebSocket.OPEN) return;
    const reqId = ++derivReqIdRef.current;
    derivAutoQuoteRef.current.set(reqId, { ...input, reqId });
    setDerivAutoStatus(`Demande position ${input.batchIndex}/${input.batchTotal} · ${formatDerivContract(input.contractType, input.barrier)}`);
    socket.send(JSON.stringify(buildDerivProposalRequest({
      contractType: input.contractType,
      barrier: input.barrier,
      stake: input.stake,
      currency: derivCurrencyRef.current,
      duration: input.duration,
      symbol: input.symbol,
      reqId,
    })));
  }

  function buildDerivProposalRequest(input: { contractType: DerivContractCode; barrier: DerivBarrier; stake: number; currency: string; duration: number; symbol: string; reqId?: number }) {
    const request: Record<string, string | number> = {
      proposal: 1,
      amount: input.stake,
      basis: "stake",
      contract_type: input.contractType,
      currency: input.currency,
      duration: input.duration,
      duration_unit: "t",
      underlying_symbol: input.symbol,
    };
    if (needsDigitBarrier(input.contractType) && input.barrier !== null) request.barrier = input.barrier;
    if (needsTouchBarrier(input.contractType)) request.barrier = typeof input.barrier === "string" ? normalizeTouchBarrier(input.barrier) : "+1";
    if (input.reqId) request.req_id = input.reqId;
    return request;
  }

  function changeDerivContractCategory(nextCategory: DerivContractCategory) {
    if (nextCategory === "over_under" && isMultiIndexOverUnder(derivOverUnderStrategyRef.current)) { derivModeRef.current = "auto"; setDerivMode("auto"); }
    const selectedOverUnder = derivOverUnderStrategies[derivOverUnderStrategyRef.current];
    const nextType = nextCategory === "over_under" ? selectedOverUnder.contractType : derivContractCategories[nextCategory].options[0];
    const nextBarrier = normalizeDigitBarrier(nextType, derivDigitBarrier);
    derivContractTypeRef.current = nextType;
    derivDigitBarrierRef.current = nextCategory === "over_under" ? selectedOverUnder.barrier : nextBarrier;
    setDerivContractCategory(nextCategory);
    setDerivContractType(nextType);
    if (nextType === "DIGITMATCH") setMatchPredictionOpen(true);
    setDerivDigitBarrier(nextCategory === "over_under" ? selectedOverUnder.barrier : nextBarrier);
    if (needsTouchBarrier(nextType)) setDerivTouchBarrier(normalizeTouchBarrier(derivTouchBarrier));
    setDerivAutoDigitBarrierMode(needsDigitBarrier(nextType) ? derivAutoDigitBarrierMode : "dynamic");
    setDerivProposal(null);
  }

  function changeDerivOverUnderStrategy(nextStrategy: DerivOverUnderStrategy) {
    stopDerivAuto();
    if (isMultiIndexOverUnder(nextStrategy)) { derivModeRef.current = "auto"; setDerivMode("auto"); }
    const strategy = derivOverUnderStrategies[nextStrategy];
    derivOverUnderStrategyRef.current = nextStrategy;
    derivContractTypeRef.current = strategy.contractType;
    derivDigitBarrierRef.current = strategy.barrier;
    setDerivOverUnderStrategy(nextStrategy);
    setDerivContractCategory("over_under");
    setDerivContractType(strategy.contractType);
    setDerivDigitBarrier(strategy.barrier);
    setDerivProposal(null);
  }

  function changeDerivContractType(nextType: DerivContractCode) {
    const nextBarrier = normalizeDigitBarrier(nextType, derivDigitBarrier);
    derivContractTypeRef.current = nextType;
    derivDigitBarrierRef.current = nextBarrier;
    setDerivContractType(nextType);
    if (nextType === "DIGITMATCH") setMatchPredictionOpen(true);
    setDerivDigitBarrier(nextBarrier);
    if (needsTouchBarrier(nextType)) setDerivTouchBarrier(normalizeTouchBarrier(derivTouchBarrier));
    setDerivAutoDigitBarrierMode(needsDigitBarrier(nextType) ? derivAutoDigitBarrierMode : "dynamic");
    setDerivProposal(null);
  }

  function changeDerivDigitBarrier(nextBarrier: number) {
    const normalizedBarrier = normalizeDigitBarrier(derivContractType, Math.trunc(nextBarrier));
    derivDigitBarrierRef.current = normalizedBarrier;
    setDerivDigitBarrier(normalizedBarrier);
    setDerivProposal(null);
  }

  function changeDbxDuration(durationTicks: number) {
    if (derivAutoRunningRef.current || derivOpenContractsRef.current.size || derivPendingBuysRef.current.size
      || derivAutoQuoteRef.current.size || !["dbx_fixed", "dbx_dynamic"].includes(derivMatchStrategyRef.current.executionMode)
      || !Number.isInteger(durationTicks) || durationTicks < 1 || durationTicks > 10) return;
    const next = { ...derivMatchStrategyRef.current, durationTicks };
    derivMatchStrategyRef.current = next;
    setMatchStrategy(next);
    setDerivProposal(null);
  }

  function changeDbxThreshold(minimumProbability: number | null) {
    if (derivAutoRunningRef.current || derivOpenContractsRef.current.size || derivPendingBuysRef.current.size
      || derivAutoQuoteRef.current.size || derivMatchStrategyRef.current.executionMode !== "dbx_dynamic"
      || (minimumProbability !== null && (!Number.isFinite(minimumProbability) || minimumProbability < 0 || minimumProbability > 1))) return;
    const next = { ...derivMatchStrategyRef.current, dbxMinimumProbability: minimumProbability };
    derivMatchStrategyRef.current = next;
    setMatchStrategy(next);
    setDerivProposal(null);
  }

  function selectMatchStrategy(selection: string, supplied?: ImportedMatchStrategy) {
    if (derivAutoRunningRef.current || derivOpenContractsRef.current.size || derivPendingBuysRef.current.size) {
      setDerivAutoStatus("Arrêtez le bot et attendez la clôture des contrats avant de changer de stratégie.");
      return;
    }
    const profile = supplied ?? (selection === "dbx" ? dbxMatchStrategy : selection === "dbx_dynamic" ? dbxDynamicMatchStrategy : selection === "dbx_last_digit" ? dbxLastDigitStrategy : selection === "imported" ? importedMatchProfile : defaultImportedMatchStrategy);
    if (!profile) return;
    stopDerivAuto();
    if (isDbxMode(profile.executionMode)) changeDerivMarket(DBX_MATCH_CONFIG.symbol);
    derivMatchStrategyRef.current = profile;
    derivModeRef.current = "auto";
    derivContractTypeRef.current = "DIGITMATCH";
    derivAutoDigitBarrierModeRef.current = profile.barrierMode;
    derivMatchPositionCountRef.current = profile.contractsPerSignal;
    if (profile.fixedDigit !== null) derivDigitBarrierRef.current = profile.fixedDigit;
    if (profile.stake !== null) derivStakeRef.current = profile.stake;
    setMatchStrategy(profile);
    setMatchStrategySelection(selection);
    setDerivMode("auto");
    setDerivContractCategory("matches_differs");
    setDerivContractType("DIGITMATCH");
    setDerivAutoDigitBarrierMode(profile.barrierMode);
    setDerivMatchPositionCount(profile.contractsPerSignal);
    if (profile.fixedDigit !== null) setDerivDigitBarrier(profile.fixedDigit);
    if (profile.stake !== null) setDerivStake(profile.stake);
    if (isDbxMode(profile.executionMode)) {
      derivMartingaleEnabledRef.current = false;
      derivDoubleRiskEnabledRef.current = false;
      derivHalfBalanceRiskEnabledRef.current = false;
      setDerivMartingaleEnabled(false);
      setDerivDoubleRiskEnabled(false);
      setDerivHalfBalanceRiskEnabled(false);
    }
    setMatchPredictionOpen(true);
    setMatchStrategyImportStatus(`${profile.name} sélectionnée · appuyez sur Play`);
    setDerivAutoStatus("Stratégie prête · appuyez sur Play");
  }

  async function importMatchStrategyFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = parseAdvancedMatchStrategyMarkdown(await file.text());
      setImportedMatchProfile(imported);
      if (isDbxMode(imported.executionMode)) { selectMatchStrategy(imported.executionMode === "dbx_last_digit" ? "dbx_last_digit" : imported.executionMode === "dbx_dynamic" ? "dbx_dynamic" : "dbx", imported); return; }
      setMatchStrategySelection("imported");
      derivMatchStrategyRef.current = imported;
      derivContractTypeRef.current = "DIGITMATCH";
      derivAutoDigitBarrierModeRef.current = imported.barrierMode;
      derivMatchPositionCountRef.current = imported.contractsPerSignal;
      if (imported.fixedDigit !== null) derivDigitBarrierRef.current = imported.fixedDigit;
      if (imported.stake !== null) derivStakeRef.current = imported.stake;
      derivTradePauseEnabledRef.current = false;
      setMatchStrategy(imported);
      setDerivContractCategory("matches_differs");
      setDerivContractType("DIGITMATCH");
      setDerivAutoDigitBarrierMode(imported.barrierMode);
      if (imported.fixedDigit !== null) setDerivDigitBarrier(imported.fixedDigit);
      if (imported.stake !== null) setDerivStake(imported.stake);
      setDerivMatchPositionCount(imported.contractsPerSignal);
      setDerivTradePauseEnabled(false);
      setMatchPredictionOpen(true);
      setDerivProposal(null);

      const socket = derivSocketRef.current;
      if (!isDerivTradingStatus(derivStatusRef.current) || !socket || socket.readyState !== WebSocket.OPEN) {
        setMatchStrategyImportStatus(`${imported.name} importée · connectez Deriv puis lancez Play`);
        setDerivAutoStatus("Stratégie Matches importée · compte Deriv requis");
        return;
      }

      derivModeRef.current = "auto";
      derivAutoRunningRef.current = true;
      derivConsecutiveLossesRef.current = 0;
      derivDoubleRiskSeriesIndexRef.current = 0;
      derivAutoQuoteRef.current.clear();
      derivOverUnderQuoteScanRef.current = null;
      derivMatchContractDigitsRef.current.clear();
      derivMatchDigitLossesRef.current = Array.from({ length: 10 }, () => 0);
      derivMatchDigitBlockedUntilRef.current = Array.from({ length: 10 }, () => -1);
      resetDerivSessionStats();
      setDerivMode("auto");
      setDerivAutoRunning(true);
      setDerivConsecutiveLosses(0);
      setDerivDoubleRiskSeriesIndex(0);
      setMatchStrategyImportStatus(`${imported.name} importée et lancée`);
      setDerivAutoStatus(`${imported.name} · ${imported.rules.selectionMode === "top_two_adaptive" ? `choix adaptatif · ${imported.rules.windowSize} ticks` : imported.rules.selectionMode === "top_two_frequency" ? `1er / 2e · fenêtre ${imported.rules.windowSize} ticks` : imported.rules.selectionMode === "frequency_window" ? `fenêtre ${imported.rules.windowSize} ticks` : "scan proba avancé"}`);
      setDerivMessage(`Mode Matches importé actif · ${imported.contractsPerSignal} contrat${imported.contractsPerSignal > 1 ? "s" : ""} par signal`);
      window.setTimeout(() => maybeRunDerivAuto(derivTicksRef.current, socket), 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : "import impossible";
      setMatchStrategyImportStatus(`Import refusé · ${message}`);
      setDerivAutoStatus(`Import stratégie Matches refusé · ${message}`);
    }
  }

  function changeDerivMode(nextMode: DerivMode) {
    derivPairScannerRef.current?.stop();
    derivModeRef.current = nextMode;
    derivAutoRunningRef.current = false;
    derivAutoQuoteRef.current.clear();
    derivOverUnderQuoteScanRef.current = null;
    clearPendingNormalBuys();
    setDerivMode(nextMode);
    setDerivAutoRunning(false);
    setDerivAutoStatus(nextMode === "auto" ? "Prêt · appuyez sur Play" : "Bot arrêté");
    setDerivProposal(null);
  }

  function startDerivAuto() {
    const socket = derivSocketRef.current;
    if (!isDerivTradingStatus(derivStatusRef.current) || !socket || socket.readyState !== WebSocket.OPEN) {
      setDerivAutoStatus("Connectez d’abord le compte Deriv Options");
      setDerivMessage("Le mode automatique exige un compte Options connecté");
      return;
    }
    if (isMultiIndexOverUnder(derivOverUnderStrategyRef.current) && (derivContractTypeRef.current === "DIGITOVER" || derivContractTypeRef.current === "DIGITUNDER")) {
      startDerivPair(socket);
      return;
    }
    if (derivContractTypeRef.current === "DIGITMATCH" && isDbxMode(derivMatchStrategyRef.current.executionMode)
      && (!derivPortfolioReadyRef.current || derivOpenContractsRef.current.size || derivPendingBuysRef.current.size)) {
      setDerivAutoStatus("DBX · attendez la réconciliation du portefeuille et la clôture des contrats");
      return;
    }
    const isAdvancedOverUnder = derivContractType === "DIGITOVER" || derivContractType === "DIGITUNDER";
	    const isAdvancedRiseFall = derivContractType === "CALL" || derivContractType === "PUT";
	    const isAdvancedMatch = derivContractType === "DIGITMATCH";
		    if (derivHalfBalanceRiskEnabled && (derivBalance === null || !Number.isFinite(derivBalance))) {
		      setDerivAutoStatus("Balance Deriv requise pour risquer 50%");
		      return;
		    }
		    const effectiveStake = derivHalfBalanceRiskEnabled ? getBalanceRiskStake(derivStake, true, derivBalance) : getDoubleRiskStake(getBalanceRiskStake(derivStake, false, derivBalance), derivDoubleRiskEnabled, 0);
	    if (!Number.isFinite(effectiveStake) || effectiveStake < 0.35) {
	      setDerivAutoStatus("Mise requise à partir de 0,35 USD");
	      return;
	    }
	    derivModeRef.current = "auto";
	    derivAutoRunningRef.current = true;
	    derivConsecutiveLossesRef.current = 0;
	    derivDoubleRiskSeriesIndexRef.current = 0;
	    derivMatchContractDigitsRef.current.clear();
	    derivMatchDigitLossesRef.current = Array.from({ length: 10 }, () => 0);
	    derivMatchDigitBlockedUntilRef.current = Array.from({ length: 10 }, () => -1);
	    resetDerivSessionStats();
	    setDerivConsecutiveLosses(0);
	    setDerivDoubleRiskSeriesIndex(0);
    setDerivAutoRunning(true);
    setDerivAutoStatus(isAdvancedOverUnder
      ? derivOverUnderStrategy === "under8_transition" ? "Under 8 · attente du digit 9" : derivOverUnderStrategy === "over5" ? "Over 5 · attente du digit 4" : `${derivOverUnderStrategies[derivOverUnderStrategy].name} · collecte statistique des digits`
      : isAdvancedRiseFall
        ? `Rise/Fall avancé · collecte 80 ticks · ${derivStrategies[derivStrategy].name}`
        : isAdvancedMatch
          ? `${matchStrategy.name} · ${derivMatchPositionCount} contrat${derivMatchPositionCount > 1 ? "s" : ""} par signal qualifié`
        : `Analyse · ${derivStrategies[derivStrategy].name}`);
    setDerivMessage(isAdvancedOverUnder
      ? `Mode ${derivOverUnderStrategies[derivOverUnderStrategy].name} actif · ${derivOverUnderStrategies[derivOverUnderStrategy].description} · Martingale ${derivMartingaleEnabled ? `ON (${derivOverUnderMartingaleCycles} cycle${derivOverUnderMartingaleCycles > 1 ? "s" : ""})` : "OFF"} · Double risque ${derivDoubleRiskEnabled ? "ON" : "OFF"}`
      : isAdvancedRiseFall
        ? "Mode Rise/Fall actif · direction, durée et payout validés automatiquement"
      : isAdvancedMatch
        ? `Mode Matches actif · ${matchStrategy.name} · ${derivMatchPositionCount} contrat${derivMatchPositionCount > 1 ? "s" : ""} par signal qualifié`
      : `Mode full automatique actif sur le compte ${derivStatusRef.current === "real" ? "réel" : "démo"}`);
    maybeRunDerivAuto(derivTicksRef.current, socket);
  }

  function stopDerivAuto() {
    derivPairScannerRef.current?.stop();
    derivAutoRunningRef.current = false;
    derivAutoQuoteRef.current.clear();
    derivOverUnderQuoteScanRef.current = null;
    clearPendingNormalBuys();
    setDerivAutoRunning(false);
    setDerivAutoStatus(derivOpenContractRef.current ? "Arrêté · le contrat engagé reste suivi" : "Bot arrêté");
    setDerivMessage("Mode automatique arrêté · aucun nouvel achat ne sera envoyé");
  }

  function changeDerivMarket(nextMarket: string) {
    if (!isDerivMarketSymbol(nextMarket)) return;
    stopDerivAuto();
    derivMarketRef.current = nextMarket;
    setDerivMarket(nextMarket);
    setDerivPrice(null);
    setDerivTicks([]);
    setDerivPipSize(DERIV_MARKET_PIP_SIZES[nextMarket]);
    derivPipSizeRef.current = DERIV_MARKET_PIP_SIZES[nextMarket];
    derivTicksRef.current = [];
    derivTickSerialRef.current = 0;
    derivLastOverUnderScanSerialRef.current = -20;
    derivMatchConsecutiveLossesRef.current = 0;
    derivMatchContractDigitsRef.current.clear();
    derivMatchDigitLossesRef.current = Array.from({ length: 10 }, () => 0);
    derivMatchDigitBlockedUntilRef.current = Array.from({ length: 10 }, () => -1);
    derivLastMatchLossSerialRef.current = -1;
    setDerivProposal(null);
    const socket = derivSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ forget_all: "ticks" }));
      socket.send(JSON.stringify({ ticks: nextMarket, subscribe: 1 }));
      socket.send(JSON.stringify({ ticks_history: nextMarket, end: "latest", count: 1000, style: "ticks" }));
    }
  }

  function beginDerivOAuth(flow: "pkce" | "legacy" = "pkce") {
    if (!derivServerConfig.oauthConfigured) {
      setDerivStatus("error");
      setDerivMessage("Configurez DERIV_OAUTH_CLIENT_ID ou DERIV_APP_ID côté serveur");
      return;
    }
    window.location.href = `/api/deriv/oauth/start?accountType=${derivAccountMode}&flow=${flow}`;
  }

  async function disconnectDerivAccount() {
    stopDerivAuto();
    await fetch("/api/deriv/oauth/session", { method: "DELETE" }).catch(() => undefined);
    connectDerivSocket("wss://api.derivws.com/trading/v1/options/ws/public", "public");
    setDerivBalance(null);
    setDerivServerConfig((current) => ({ ...current, oauthSessionActive: false }));
  }

  async function connectDerivAccount(accountMode = derivAccountMode) {
    derivStatusRef.current = "connecting";
    setDerivStatus("connecting");
    setDerivMessage(`Création de la session Options ${accountMode === "demo" ? "démo" : "réelle"}...`);
    try {
      const response = await fetch("/api/deriv/options/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountType: accountMode }),
      });
      const data = (await response.json()) as { url?: string; accountType?: AccountMode; error?: string };
      if (!response.ok || !data.url) {
        derivStatusRef.current = "error";
        setDerivStatus("error");
        setDerivMessage(data.error ?? "Connexion Deriv refusée");
        return;
      }
      setDerivServerConfig((current) => ({ ...current, oauthSessionActive: true }));
      connectDerivSocket(data.url, data.accountType ?? accountMode);
    } catch {
      derivStatusRef.current = "error";
      setDerivStatus("error");
      setDerivMessage("API Deriv indisponible");
    }
  }

  function requestDerivProposal() {
    if (isMultiIndexOverUnder(derivOverUnderStrategyRef.current) && (derivContractTypeRef.current === "DIGITOVER" || derivContractTypeRef.current === "DIGITUNDER")) { setDerivMessage("La stratégie multi-indices se lance en Full automatique avec Play."); return; }
    const socket = derivSocketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setDerivMessage("Connectez d’abord le flux Deriv");
      return;
    }
	    if (derivHalfBalanceRiskEnabled && (derivBalance === null || !Number.isFinite(derivBalance))) {
	      setDerivMessage("Balance Deriv requise pour risquer 50% du compte");
	      return;
	    }
	    const effectiveStake = derivHalfBalanceRiskEnabled ? getBalanceRiskStake(derivStake, true, derivBalance) : getDoubleRiskStake(getBalanceRiskStake(derivStake, false, derivBalance), derivDoubleRiskEnabled, 0);
	    if (!Number.isFinite(effectiveStake) || effectiveStake < 0.35) {
	      setDerivMessage("La mise doit être au minimum de 0,35 USD");
	      return;
	    }
    setDerivProposal(null);
    setDerivMessage("Calcul de la proposition...");
    const barrier = needsDigitBarrier(derivContractType) ? normalizeDigitBarrier(derivContractType, derivDigitBarrier) : needsTouchBarrier(derivContractType) ? normalizeTouchBarrier(derivTouchBarrier) : null;
    socket.send(JSON.stringify(buildDerivProposalRequest({
      contractType: derivContractType,
      barrier,
	      stake: effectiveStake,
      currency: derivCurrency,
      duration: derivDuration,
      symbol: derivMarket,
    })));
  }

  function buyDerivContract() {
    const socket = derivSocketRef.current;
    if (!derivTradeConnected || !derivProposal || !socket || socket.readyState !== WebSocket.OPEN) {
      setDerivMessage("Un compte Options connecté et une proposition valide sont requis");
      return;
    }
    derivPendingBuyRef.current = { contractType: derivProposal.contractType, barrier: derivProposal.barrier, stake: derivProposal.stake, symbol: derivProposal.symbol, duration: derivProposal.duration };
    setDerivMessage(`Achat du contrat ${derivStatus === "real" ? "réel" : "démo"}...`);
    socket.send(JSON.stringify({ buy: derivProposal.id, price: derivProposal.askPrice }));
  }

  async function sendManualSell() {
    setManualTradeStatus("Envoi...");
    try {
      const response = await fetch("/api/trading/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SELL", symbol: "Volatility 25 Index", volume: 0.5, accountMode: mt5AccountMode }),
      });
      const data = (await response.json()) as { error?: string };
      setManualTradeStatus(response.ok ? `SELL 0.5 envoyé (${mt5AccountMode === "real" ? "réel" : "démo"})` : data.error ?? "Ordre refusé");
    } catch {
      setManualTradeStatus("Erreur API");
    }
  }

  function navigate(view: ViewId) {
    setActiveView(view);
    if (view === "derivbot") setDigitPredictionOpen(true);
    setSidebar(false);
    setConfigStatus("");
    if (view === "risk") setRiskDraft(config);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function saveRiskConfig() {
    setConfigStatus("Enregistrement...");
    try {
      const response = await fetch("/api/system/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(riskDraft),
      });
      const data = (await response.json()) as { config?: AppConfig; error?: string };
      if (!response.ok || !data.config) {
        setConfigStatus(data.error ?? "Configuration refusée");
        return;
      }
      setConfig(data.config);
      setRiskDraft(data.config);
      setConfigStatus("Configuration enregistrée");
    } catch {
      setConfigStatus("API indisponible");
    }
  }

  function applyEaStrategyPreset(preset: EaStrategyPreset) {
    const strategy = eaStrategyPresets[preset];
    setEaStrategyPreset(preset);
    setEaTimeframe(strategy.timeframe);
    setEaMaxPositions(strategy.maxPositions);
    setRiskDraft((draft) => ({ ...draft, minScore: strategy.minScore }));
    setEaUseSmc(true);
    setEaUseMl(preset !== "trend_breakout");
    setEaUseTrendFilter(preset !== "scalping");
    setEaUseSessionFilter(preset === "conservative");
  }

  function renderSecondaryView() {
    if (activeView === "markets") return <section className="view-stack">
      <div className="view-heading"><div><p className="eyebrow">COTATIONS EN DIRECT</p><h2>Indices synthétiques</h2></div><span className={`connection-chip ${mt5Online ? "online" : ""}`}><i/>{mt5Online ? "Flux MT5 actif" : "EA hors ligne"}</span></div>
      <div className="market-list">
        {(Object.keys(prices) as (keyof typeof prices)[]).map((market) => {
          const fullName = `${market} Index`;
          const marketTicks = ticks.filter((tick) => tick.symbol === fullName);
          const current = marketTicks.at(-1)?.price ?? (liveSymbol === fullName ? livePrice : null);
          const connected = liveSymbol === fullName && mt5Online;
          return <button key={market} className="market-row" onClick={() => { setSymbol(market); navigate("overview"); }}>
            <span className="market-symbol"><Activity/><span><b>{market}</b><small>{connected ? "Coté par MT5" : "En attente du flux EA"}</small></span></span>
            <span><small>Dernier prix</small><b>{current === null ? "-" : formatPrice(current)}</b></span>
            <span><small>Ticks reçus</small><b>{marketTicks.length}</b></span>
            <span className={connected ? "green" : "muted"}>{connected ? "LIVE" : "INDISPONIBLE"}</span>
          </button>;
        })}
      </div>
    </section>;

    if (activeView === "positions") return <section className="view-stack">
      <div className="view-heading"><div><p className="eyebrow">POSITIONS MT5</p><h2>{positions.length} position{positions.length > 1 ? "s" : ""} ouverte{positions.length > 1 ? "s" : ""}</h2></div><span className="live-value">P/L total <b className={(mt5Profit ?? 0) < 0 ? "red" : "green"}>{mt5Profit === null ? "-" : `${formatUsd(mt5Profit)} ${mt5Currency}`}</b></span></div>
      <div className="panel wide-panel">{positions.length ? <div className="positions-list expanded">{positions.map((position) => <div className="position-row" key={position.ticket}><span><b className={position.type === "SELL" ? "red" : "green"}>{position.type}</b><small>{position.symbol} · #{position.ticket}</small></span><span><small>Volume</small><b>{position.volume.toFixed(2)} lot</b></span><span><small>Prix d&apos;entrée</small><b>{formatPrice(position.priceOpen)}</b></span><span><small>Profit flottant</small><b className={position.profit < 0 ? "red" : "green"}>{formatUsd(position.profit)}</b></span></div>)}</div> : <div className="large-empty"><Target/><b>Aucune position MT5 ouverte</b><small>Les nouvelles positions envoyées par l’EA apparaîtront ici automatiquement.</small></div>}</div>
    </section>;

    if (activeView === "performance") {
      const floatingReturn = mt5Balance && mt5Profit !== null ? (mt5Profit / mt5Balance) * 100 : null;
      const equityGap = mt5Balance !== null && mt5Equity !== null ? mt5Equity - mt5Balance : null;
      return <section className="view-stack">
        <div className="view-heading"><div><p className="eyebrow">SYNTHÈSE LIVE</p><h2>État du compte MT5</h2></div><span className="data-note">Données du compte connecté</span></div>
        <div className="metric-grid"><div className="metric-card"><span>Balance</span><b>{mt5Balance === null ? "-" : formatUsd(mt5Balance)}</b><small>{mt5Currency}</small></div><div className="metric-card"><span>Equity</span><b>{mt5Equity === null ? "-" : formatUsd(mt5Equity)}</b><small className={(equityGap ?? 0) < 0 ? "red" : "green"}>{equityGap === null ? "Pas de donnée" : `${equityGap >= 0 ? "+" : ""}${formatUsd(equityGap)} vs balance`}</small></div><div className="metric-card"><span>P/L ouvert</span><b className={(mt5Profit ?? 0) < 0 ? "red" : "green"}>{mt5Profit === null ? "-" : formatUsd(mt5Profit)}</b><small>{floatingReturn === null ? "Pas de donnée" : `${floatingReturn.toFixed(3)}% de la balance`}</small></div><div className="metric-card"><span>Exposition</span><b>{positions.reduce((sum, position) => sum + position.volume, 0).toFixed(2)}</b><small>lots ouverts</small></div></div>
        <div className="panel info-panel"><BarChart3/><div><b>Historique de performance</b><p>Le flux EA fournit actuellement la balance, l’equity et les positions ouvertes. Les statistiques clôturées apparaîtront quand l’EA transmettra l’historique des deals.</p></div></div>
      </section>;
    }

    if (activeView === "derivhistory") {
      const periodStart = getHistoryPeriodStart(derivHistoryPeriod);
      const closedDeals = derivApiHistoryDeals.filter((deal) => deal.status !== "open" && new Date(deal.createdAt).getTime() >= periodStart);
      const wonDeals = closedDeals.filter((deal) => deal.status === "won");
      const lostDeals = closedDeals.filter((deal) => deal.status === "lost");
      const grossProfit = wonDeals.reduce((sum, deal) => sum + Math.max(deal.profit ?? 0, 0), 0);
      const grossLoss = lostDeals.reduce((sum, deal) => sum + Math.abs(Math.min(deal.profit ?? 0, 0)), 0);
      const netProfit = closedDeals.reduce((sum, deal) => sum + (deal.profit ?? 0), 0);
      const winRate = closedDeals.length ? Math.round((wonDeals.length / closedDeals.length) * 100) : 0;
      return <section className="view-stack">
        <div className="view-heading"><div><p className="eyebrow">HISTORIQUE DERIV</p><h2>Gains et pertes Options</h2></div><div className="heading-actions"><Button className="secondary-action" disabled={derivHistoryLoading || !derivTradeConnected} onClick={requestDerivProfitHistory}><RefreshCw/> Actualiser API</Button><Button className="secondary-action" onClick={() => navigate("derivbot")}><Bot/> Retour au bot</Button></div></div>
        <div className="period-filter" role="group" aria-label="Filtrer la période"><button className={derivHistoryPeriod === "today" ? "selected" : ""} onClick={() => setDerivHistoryPeriod("today")}>Aujourd’hui</button><button className={derivHistoryPeriod === "7d" ? "selected" : ""} onClick={() => setDerivHistoryPeriod("7d")}>7 jours</button><button className={derivHistoryPeriod === "30d" ? "selected" : ""} onClick={() => setDerivHistoryPeriod("30d")}>30 jours</button><button className={derivHistoryPeriod === "all" ? "selected" : ""} onClick={() => setDerivHistoryPeriod("all")}>Tout</button></div>
        {(derivHistoryLoading || derivHistoryError) && <div className={`history-api-status ${derivHistoryError ? "error" : ""}`}><Radio/>{derivHistoryLoading ? "Chargement de l’historique depuis l’API Deriv..." : derivHistoryError}</div>}
        <div className="metric-grid history-metrics"><div className="metric-card"><span>Gain net</span><b className={netProfit < 0 ? "red" : "green"}>{netProfit >= 0 ? "+" : ""}{formatUsd(netProfit)}</b><small>{closedDeals.length} contrat{closedDeals.length > 1 ? "s" : ""} clôturé{closedDeals.length > 1 ? "s" : ""}</small></div><div className="metric-card"><span>Gains bruts</span><b className="green">+{formatUsd(grossProfit)}</b><small>{wonDeals.length} gagné{wonDeals.length > 1 ? "s" : ""}</small></div><div className="metric-card"><span>Pertes brutes</span><b className="red">-{formatUsd(grossLoss)}</b><small>{lostDeals.length} perdu{lostDeals.length > 1 ? "s" : ""}</small></div><div className="metric-card"><span>Taux de gain</span><b>{winRate}%</b><small>{wonDeals.length}/{closedDeals.length || 0} gagnés</small></div></div>
        <section className="panel history-panel"><div className="panel-head"><div><p className="eyebrow">DÉTAIL DES CONTRATS</p><h3>{closedDeals.length ? "Résultats filtrés" : "Aucun résultat sur cette période"}</h3></div><span className="data-note">Source: API Deriv profit_table</span></div>{closedDeals.length ? <div className="history-list">{closedDeals.map((deal) => <div className={`history-row ${deal.status}`} key={deal.contractId}><span><b className={deal.status === "won" ? "green" : "red"}>{deal.status === "won" ? "GAIN" : "PERTE"}</b><small>{formatDateTime(deal.createdAt)} · #{deal.contractId}</small></span><span><small>Contrat</small><b>{formatDerivContract(deal.contractType, deal.barrier)}</b></span><span><small>Marché</small><b>{deal.symbol}</b></span><span><small>Résultat</small><b className={(deal.profit ?? 0) < 0 ? "red" : "green"}>{(deal.profit ?? 0) >= 0 ? "+" : ""}{formatUsd(deal.profit ?? 0)}</b></span><span><small>Paiement</small><b>{formatUsd(deal.status === "won" ? deal.buyPrice + (deal.profit ?? 0) : 0)}</b></span></div>)}</div> : <div className="large-empty compact"><WalletCards/><b>Aucun résultat API</b><small>{derivTradeConnected ? "L’API Deriv n’a retourné aucun contrat clôturé pour cette période." : "Connectez le compte Deriv Options pour charger profit_table."}</small></div>}</section>
      </section>;
    }

    if (activeView === "copytrading") return <section className="view-stack">
      <div className="view-heading"><div><p className="eyebrow">COPIE DE SIGNAUX</p><h2>Copytrading multi-compte</h2></div><span className={`connection-chip ${copyTradingEnabled ? "online" : ""}`}><i/>{copyTradingEnabled ? "Copytrading actif" : "Copytrading en pause"}</span></div>
      <section className={`bot-hero ${copyTradingEnabled ? "running" : ""}`}><div className="bot-identity"><span className="bot-avatar"><Signal/></span><div><p>MASTER / FOLLOWER</p><h3>{copyTradingEnabled ? "Réplication activée" : "Réplication désactivée"}</h3><small>{copyTradingEnabled ? `Source ${copyTradingProvider === "mt5_master" ? "MT5 master" : copyTradingProvider === "deriv_signal" ? "Signaux Deriv" : "Leader manuel"} · cible ${copyTradingAccountMode === "real" ? "réel" : "démo"}` : "Choisissez une source puis activez le copytrading."}</small></div></div><div className="bot-toggle"><span><b>{copyTradingEnabled ? "ON" : "OFF"}</b><small>Copie des positions entrantes</small></span><Switch checked={copyTradingEnabled} onCheckedChange={setCopyTradingEnabled}/></div></section>
      <div className="copytrading-layout">
        <section className="panel"><div className="panel-head"><div><p className="eyebrow">SOURCE</p><h3>Compte master</h3></div><Radio className="lime"/></div><div className="contract-category-picker copy-source-picker" role="group" aria-label="Source copytrading"><button className={copyTradingProvider === "mt5_master" ? "selected" : ""} onClick={() => setCopyTradingProvider("mt5_master")}>MT5 Master</button><button className={copyTradingProvider === "deriv_signal" ? "selected" : ""} onClick={() => setCopyTradingProvider("deriv_signal")}>Signaux Deriv</button><button className={copyTradingProvider === "manual_leader" ? "selected" : ""} onClick={() => setCopyTradingProvider("manual_leader")}>Leader manuel</button><small>{copyTradingProvider === "mt5_master" ? "Copie les positions reçues depuis un terminal MT5 master connecté." : copyTradingProvider === "deriv_signal" ? "Prépare la copie depuis les signaux du module Deriv Bot." : "Permettra de copier des trades validés manuellement depuis le dashboard."}</small></div><div className="deriv-mode-switch account-mode-switch" role="group" aria-label="Compte cible copytrading"><button className={copyTradingAccountMode === "demo" ? "selected" : ""} onClick={() => setCopyTradingAccountMode("demo")}>Copier en démo</button><button className={copyTradingAccountMode === "real" ? "selected" : ""} onClick={() => setCopyTradingAccountMode("real")}>Copier en réel</button></div></section>
        <section className="panel copy-risk-panel"><div className="panel-head"><div><p className="eyebrow">RISQUE</p><h3>Paramètres follower</h3></div><ShieldCheck className="lime"/></div><div className="form-panel copy-form"><label>Allocation du capital (%)<input type="number" min="1" max="100" value={copyTradingAllocation} onChange={(event) => setCopyTradingAllocation(Math.min(100, Math.max(1, Number(event.target.value))))}/></label><label>Perte max session (%)<input type="number" min="1" max="100" value={copyTradingRiskLimit} onChange={(event) => setCopyTradingRiskLimit(Math.min(100, Math.max(1, Number(event.target.value))))}/></label><label>Multiplicateur lot<input type="number" min="0.01" step="0.01" value={copyTradingMultiplier} onChange={(event) => setCopyTradingMultiplier(Math.max(0.01, Number(event.target.value)))}/></label></div><div className="settings-block copy-reverse-toggle"><div><ArrowDown/><span><b>Copie inversée</b><small>BUY devient SELL et SELL devient BUY</small></span></div><Switch checked={copyTradingReverse} onCheckedChange={setCopyTradingReverse}/></div></section>
      </div>
      <section className="panel"><div className="panel-head"><div><p className="eyebrow">MASTERS CONNECTÉS</p><h3>Suivi des fournisseurs</h3></div><button className="text-button">Historique <ChevronDown/></button></div><div className="copy-master-list"><div><span><b>MT5 Master Principal</b><small>{mt5Online ? `Terminal ${mt5ConnectedMode === "real" ? "réel" : mt5ConnectedMode === "demo" ? "démo" : "connecté"}` : "En attente du terminal master"}</small></span><span><small>Statut</small><b className={mt5Online ? "green" : "muted"}>{mt5Online ? "EN LIGNE" : "HORS LIGNE"}</b></span><span><small>Mode copie</small><b>{copyTradingAccountMode === "real" ? "Réel" : "Démo"}</b></span><span><small>Lot x</small><b>{copyTradingMultiplier.toFixed(2)}</b></span></div><div><span><b>Deriv Bot Signals</b><small>Source liée aux contrats Options</small></span><span><small>Statut</small><b className={derivConnected ? "green" : "muted"}>{derivConnected ? "DISPONIBLE" : "HORS LIGNE"}</b></span><span><small>Allocation</small><b>{copyTradingAllocation}%</b></span><span><small>Protection</small><b>{copyTradingRiskLimit}%</b></span></div></div></section>
      <div className="panel info-panel warning"><ShieldCheck/><div><b>Exécution réelle</b><p>Le menu Copytrading prépare la configuration follower. Pour exécuter réellement les copies MT5, il faudra ensuite connecter ces réglages à la file d’ordres et garder AllowRealTrading=true côté EA pour le compte réel.</p></div></div>
    </section>;

    if (activeView === "derivbot") {
      const derivConnected = derivStatus === "public" || derivTradeConnected;
      const chartTicks = derivTicks.map((price, index) => ({ symbol: derivMarket, price, receivedAt: String(index) }));
	      const chartName = DERIV_MARKETS[derivMarket];
	      const selectedContractCategory = derivContractCategories[derivContractCategory];
	      const selectedContractBarrierOptions = getDigitBarrierOptions(derivContractType);
	      const derivMartingalePercent = Math.round((derivMartingaleMultiplier - 1) * 100);
	      const isDbxMatch = derivContractType === "DIGITMATCH" && isDbxMode(matchStrategy.executionMode);
          const isDbxDynamic = isDbxMatch && matchStrategy.executionMode !== "dbx_fixed";
          const isDbxGuarded = isDbxMatch && matchStrategy.executionMode === "dbx_dynamic";
          const isDbxLastDigit = isDbxMatch && matchStrategy.executionMode === "dbx_last_digit";
	      const isPairedOverUnder = isMultiIndexOverUnder(derivOverUnderStrategy) && (derivContractCategory === "over_under" || derivContractType === "DIGITOVER" || derivContractType === "DIGITUNDER");
	      const pairMode = derivOverUnderStrategy === "under8_transition" ? "under8_digit9" : "under5_over4";
          const pairSessionMatches = derivPairScannerRef.current?.mode === pairMode;
	      const isOverUnderCategory = derivContractCategory === "over_under" || derivContractType === "DIGITOVER" || derivContractType === "DIGITUNDER";
	      const martingaleCycleLabel = derivConsecutiveLosses > derivOverUnderMartingaleCycles ? "Cycle terminé" : `${Math.max(0, derivConsecutiveLosses)}/${derivOverUnderMartingaleCycles}`;
	      return <section className="view-stack">
        <div className="view-heading"><div><p className="eyebrow">OPTIONS DIGITALES</p><h2>Terminal Deriv Bot</h2></div><div className="heading-actions"><Button className="secondary-action" onClick={() => navigate("derivhistory")}><WalletCards/> Historique des gains</Button><span className={`connection-chip ${derivConnected ? "online" : ""}`}><i/>{derivStatus === "real" ? "Compte réel connecté" : derivStatus === "demo" ? "Compte démo connecté" : derivStatus === "public" ? "Cours publics en direct" : "Connexion Deriv"}</span></div></div>
	        <div className="deriv-grid">
	          <div className="deriv-main-column">
	            <section className="panel deriv-market"><div className="panel-head"><div><p className="eyebrow">MARCHÉ DERIV</p><h3>{DERIV_MARKETS[derivMarket]} Index</h3></div><select value={derivMarket} onChange={(event) => changeDerivMarket(event.target.value)} aria-label="Marché Deriv">{(Object.entries(DERIV_MARKETS) as [DerivMarketSymbol, string][]).map(([market, label]) => <option key={market} value={market}>{label}</option>)}</select></div><div className="deriv-price"><b>{derivPrice === null ? "-" : derivPrice.toLocaleString("en-US", { minimumFractionDigits: derivPipSize, maximumFractionDigits: derivPipSize })}</b><span className={derivConnected ? "green" : "muted"}>{derivConnected ? "LIVE" : "HORS LIGNE"}</span></div><MiniChart name={chartName} ticks={chartTicks}/><div className="api-message"><Radio/>{derivMessage}</div></section>
	            <section className="panel deriv-connect"><div className="panel-head"><div><p className="eyebrow">CONNEXION SÉCURISÉE</p><h3>Compte Deriv Options {derivStatus === "real" ? "réel" : "démo"}</h3></div><PlugZap className={derivTradeConnected ? "lime" : "muted"}/></div>{derivTradeConnected ? <div className="connected-account"><span><small>Balance Options · {derivStatus === "real" ? "réel" : "démo"}</small><b>{derivBalance === null ? "-" : `${formatUsd(derivBalance)} ${derivCurrency}`}</b></span><Button className="secondary-action" onClick={disconnectDerivAccount}>Déconnecter</Button></div> : <><div className="deriv-mode-switch account-mode-switch" role="group" aria-label="Type de compte Deriv"><button className={derivAccountMode === "demo" ? "selected" : ""} onClick={() => setDerivAccountMode("demo")}>Compte démo</button><button className={derivAccountMode === "real" ? "selected" : ""} onClick={() => setDerivAccountMode("real")}>Compte réel</button></div><div className="oauth-connect-card"><PlugZap/><span><b>Connexion OAuth Deriv directe</b><small>{derivServerConfig.oauthConfigured ? "Connectez-vous sur Deriv; aucun ID de compte ni jeton ne sera saisi dans le dashboard." : "Configurez DERIV_APP_ID dans .env.local ou Sites pour activer la redirection OAuth."}</small></span></div>{derivServerConfig.oauthSessionActive && <Button className="connect-button" disabled={derivStatus === "connecting"} onClick={() => connectDerivAccount()}><PlugZap/> Reprendre la session Deriv</Button>}<Button className="connect-button" disabled={derivStatus === "connecting" || !derivServerConfig.oauthConfigured} onClick={() => beginDerivOAuth()}><PlugZap/> Se connecter avec Deriv OAuth</Button><small className="security-note">Redirect URI à enregistrer dans Deriv API : {derivServerConfig.oauthRedirectUri || "https://deriv-ai-trader.javakikso.chatgpt.site/deriv-oauth/callback"}</small></>}</section>
	            <section className="panel deal-log"><div className="panel-head"><p className="eyebrow">SUIVI DES CONTRATS</p><button className="text-button" onClick={() => navigate("derivhistory")}>Historique <ChevronDown/></button></div><div className="deal-session-summary"><span><small>Total gain/lost</small><b className={derivSessionPnl > 0 ? "green" : derivSessionPnl < 0 ? "red" : ""}>{derivSessionPnl > 0 ? "+" : ""}{formatUsd(derivSessionPnl)}</b></span><span><small>Contrats pris</small><b>{derivSessionContracts}</b></span><span><small>Trades gagnants</small><b className="green">{derivSessionWins}</b></span><span><small>Trades perdants</small><b className="red">{derivSessionLosses}</b></span><span><small>Signaux session</small><b>{derivMaxSignals > 0 ? `${derivSessionSignals}/${derivMaxSignals}` : derivSessionSignals}</b></span></div>{derivDeals.length ? <div className="deal-list">{derivDeals.map((deal) => <div className={`deal-row ${deal.status}`} key={deal.contractId}><span><b className={deal.status === "won" ? "green" : deal.status === "lost" ? "red" : "amber"}>{deal.status === "won" ? "GAGNÉ" : deal.status === "lost" ? "PERDU" : "EN COURS"}</b><small>{formatDerivContract(deal.contractType, deal.barrier)} · {deal.symbol} · #{deal.contractId}</small></span><span><small>{deal.status === "open" ? "Progression" : "Résultat"}</small><b>{deal.status === "open" ? `${deal.ticksElapsed}/${deal.duration} ticks` : `${(deal.profit ?? 0) >= 0 ? "+" : ""}${formatUsd(deal.profit ?? 0)}`}</b></span><span><small>{deal.status === "open" ? "Valeur actuelle" : "Paiement"}</small><b>{deal.status === "open" && deal.currentSpot !== null ? formatPrice(deal.currentSpot) : formatUsd(deal.status === "won" ? deal.buyPrice + (deal.profit ?? 0) : 0)}</b></span></div>)}</div> : <div className="large-empty compact"><Bot/><b>Aucun contrat acheté</b><small>Le résultat et le profit apparaîtront ici en temps réel.</small></div>}</section>
	          </div>
		          <section className={`panel trade-ticket ${derivAutoRunning ? "auto-running" : ""}`}>
		            <div className="panel-head"><div><p className="eyebrow">NOUVEAU CONTRAT</p><h3>{selectedContractCategory.name}</h3></div><span className="demo-badge">{derivStatus === "real" ? "COMPTE RÉEL" : "COMPTE DÉMO"}</span></div>
		            <div className="deriv-mode-switch" role="group" aria-label="Mode de trading"><button className={derivMode === "manual" ? "selected" : ""} onClick={() => changeDerivMode("manual")}>Manuel</button><button className={derivMode === "auto" ? "selected" : ""} onClick={() => changeDerivMode("auto")}>Full automatique</button></div>
		            <div className={`martingale-panel ${derivHalfBalanceRiskEnabled ? "enabled" : ""}`}><div className="martingale-toggle"><span><b>Risque 50% balance</b><small>{derivHalfBalanceRiskEnabled ? `ON: chaque nouveau trade utilise ${derivBalance === null ? "50% de la balance reçue" : formatUsd(derivBalanceRiskStake)} comme mise.` : "OFF: la mise saisie reste la base du prochain trade."}</small></span><button type="button" className={`martingale-toggle-button ${derivHalfBalanceRiskEnabled ? "enabled" : ""}`} disabled={derivAutoRunning || isDbxMatch} onClick={() => { const nextEnabled = !derivHalfBalanceRiskEnabled; derivDoubleRiskSeriesIndexRef.current = 0; setDerivDoubleRiskSeriesIndex(0); if (nextEnabled) { setDerivDoubleRiskEnabled(false); setDerivMartingaleEnabled(false); setDerivMultiplePositionsEnabled(false); } setDerivHalfBalanceRiskEnabled(nextEnabled); setDerivProposal(null); }}>{derivHalfBalanceRiskEnabled ? "ON" : "OFF"}</button></div><div className="protection-status"><span>Balance Options</span><b>{derivBalance === null ? "-" : `${formatUsd(derivBalance)} ${derivCurrency}`}</b></div></div>
		            <div className={`martingale-panel ${derivDoubleRiskEnabled ? "enabled" : ""}`}><div className="martingale-toggle"><span><b>Double risque progressif</b><small>{derivHalfBalanceRiskEnabled ? "Désactivé pendant le risque 50% balance." : derivDoubleRiskEnabled ? `ON: série x${2 ** derivDoubleRiskSeriesIndex} maintenant, x${2 ** (derivDoubleRiskSeriesIndex + 1)} au prochain trade.` : "OFF: chaque trade utilise la mise saisie."}</small></span><button type="button" className={`martingale-toggle-button ${derivDoubleRiskEnabled ? "enabled" : ""}`} disabled={derivAutoRunning || isDbxMatch || derivHalfBalanceRiskEnabled} onClick={() => { derivDoubleRiskSeriesIndexRef.current = 0; setDerivDoubleRiskSeriesIndex(0); setDerivDoubleRiskEnabled(!derivDoubleRiskEnabled); setDerivProposal(null); }}>{derivDoubleRiskEnabled ? "ON" : "OFF"}</button></div><div className="protection-status"><span>{derivDoubleRiskEnabled ? `Trade #${derivDoubleRiskSeriesIndex + 1} de la série` : "Mise effective"}</span><b>{formatUsd(derivBaseRiskStake)}</b></div>{derivDoubleRiskEnabled && <div className="protection-status"><span>Prochain trade</span><b>{formatUsd(derivNextSeriesStake)}</b></div>}</div>
			            <div className={`martingale-panel ${derivMartingaleEnabled ? "enabled" : ""}`}>
			              <div className="martingale-toggle">
			                <span>
			                  <b>Option Martingale</b>
			                  <small>{derivHalfBalanceRiskEnabled ? "Désactivée pendant le risque 50% balance." : derivMode === "auto" ? isOverUnderCategory ? `Augmente après perte · ${derivOverUnderMartingaleCycles} cycle${derivOverUnderMartingaleCycles > 1 ? "s" : ""} successif${derivOverUnderMartingaleCycles > 1 ? "s" : ""} max.` : "Augmente la mise après une perte, retour à la mise de base après un gain." : "Visible ici, appliquée uniquement quand Full automatique est actif."}</small>
			                </span>
			                <button type="button" className={`martingale-toggle-button ${derivMartingaleEnabled ? "enabled" : ""}`} disabled={derivAutoRunning || isDbxMatch || derivHalfBalanceRiskEnabled} onClick={() => setDerivMartingaleEnabled(!derivMartingaleEnabled)}>{derivMartingaleEnabled ? "ON" : "OFF"}</button>
			              </div>
			              {derivMartingaleEnabled && <div className="martingale-fields">
			                <label>Augmentation (%)<input type="number" min="10" max="400" step="5" disabled={derivAutoRunning} value={derivMartingalePercent} onChange={(event) => { const percent = Math.min(400, Math.max(10, Number(event.target.value) || 10)); setDerivMartingaleMultiplier(1 + percent / 100); }}/></label>
			                <label>Plafond mise<input type="number" min="0.35" step="0.01" disabled={derivAutoRunning} value={derivMartingaleMaxStake} onChange={(event) => setDerivMartingaleMaxStake(Number(event.target.value))}/></label>
			                {isOverUnderCategory && <label>Cycles successifs<input type="number" min="1" max="20" step="1" disabled={derivAutoRunning} value={derivOverUnderMartingaleCycles} onChange={(event) => setDerivOverUnderMartingaleCycles(Math.min(20, Math.max(1, Math.trunc(Number(event.target.value) || 1))))}/></label>}
			                {isOverUnderCategory && <span>Cycle Under/Over <b>{martingaleCycleLabel}</b></span>}
			                <span>Prochaine mise <b>{formatUsd(getMartingaleStake(derivBaseRiskStake, derivConsecutiveLosses, derivMartingaleEnabled, derivMartingaleMultiplier, derivMartingaleMaxStake, isOverUnderCategory ? derivOverUnderMartingaleCycles : null))}</b></span>
			              </div>}
			            </div>
		            <div className="martingale-panel capital-protection-panel"><div className="martingale-toggle"><span><b>Suivi des pertes</b><small>{isDbxGuarded ? "V3.1 : arrêt automatique selon le budget de perte configuré ci-dessous." : "Informatif: aucune coupure automatique. Utilisez Stop pour interrompre le bot."}</small></span></div><div className="protection-status"><span>Pertes consécutives</span><b className={derivConsecutiveLosses > 0 ? "red" : ""}>{derivConsecutiveLosses}</b></div></div>
		            <div className={`martingale-panel ${derivTradePauseEnabled && !isMatchesDiffersContract(derivContractType) ? "enabled" : ""}`}><div className="martingale-toggle"><span><b>Pause entre trades</b><small>{isMatchesDiffersContract(derivContractType) ? "Ignorée pour Matches/Differs: le bot peut enchaîner dès qu’un signal est validé." : derivTradePauseEnabled ? "ON: le bot attend 8 ticks après chaque contrat." : "OFF: le bot peut enchaîner dès qu’un nouveau signal est validé."}</small></span><button type="button" className={`martingale-toggle-button ${derivTradePauseEnabled ? "enabled" : ""}`} onClick={() => setDerivTradePauseEnabled(!derivTradePauseEnabled)}>{derivTradePauseEnabled ? "ON" : "OFF"}</button></div><div className="protection-status"><span>Délai actuel</span><b>{isMatchesDiffersContract(derivContractType) ? "Aucun" : derivTradePauseEnabled ? "8 ticks" : "Aucun"}</b></div></div>
		            <div className={`martingale-panel ${derivMultiplePositionsEnabled && derivContractType !== "DIGITMATCH" ? "enabled" : ""}`}><div className="martingale-toggle"><span><b>Positions par trade</b><small>{derivContractType === "DIGITMATCH" ? "Réglage séparé pour Matches disponible plus bas." : derivHalfBalanceRiskEnabled ? "Forcé à une seule position avec le risque 50% balance." : derivMultiplePositionsEnabled ? `ON: chaque signal ouvre ${derivPositionCount} positions.` : "OFF: chaque signal ouvre une seule position."}</small></span><button type="button" className={`martingale-toggle-button ${derivMultiplePositionsEnabled ? "enabled" : ""}`} disabled={derivAutoRunning || derivHalfBalanceRiskEnabled || derivContractType === "DIGITMATCH"} onClick={() => setDerivMultiplePositionsEnabled(!derivMultiplePositionsEnabled)}>{derivMultiplePositionsEnabled ? "ON" : "OFF"}</button></div>{derivMultiplePositionsEnabled && derivContractType !== "DIGITMATCH" && <div className="martingale-fields"><label>Nombre de positions<input type="number" min="2" max="10" step="1" disabled={derivAutoRunning} value={derivPositionCount} onChange={(event) => setDerivPositionCount(Math.min(10, Math.max(2, Math.trunc(Number(event.target.value) || 2))))}/></label><span>Par signal <b>{derivPositionCount} positions</b></span></div>}</div>
		            <div className="contract-category-picker" role="group" aria-label="Catégorie de contrat">
              <span>Catégorie du contrat</span>
              {(Object.keys(derivContractCategories) as DerivContractCategory[]).map((category) => (
                <button key={category} disabled={derivAutoRunning} className={derivContractCategory === category ? "selected" : ""} onClick={() => changeDerivContractCategory(category)}>
                  {derivContractCategories[category].name}
                </button>
	              ))}
	              <small>{selectedContractCategory.description}</small>
	            </div>
	            {isOverUnderCategory && <div className="match-strategy-card over-under-strategy-card">
	              <div>
	                <span>Stratégie Under/Over</span>
	                <b>{derivOverUnderStrategies[derivOverUnderStrategy].name}</b>
	                <small>{getOverUnderStrategySummary(derivOverUnderStrategy)} · {derivOverUnderStrategies[derivOverUnderStrategy].description}</small>
	              </div>
	              <div className="over-under-strategy-options" role="group" aria-label="Choix stratégie Under Over">
	                {(Object.entries(derivOverUnderStrategies) as [DerivOverUnderStrategy, typeof derivOverUnderStrategies[DerivOverUnderStrategy]][]).map(([key, strategy]) => <button key={key} type="button" disabled={derivAutoRunning} className={derivOverUnderStrategy === key ? "selected" : ""} onClick={() => changeDerivOverUnderStrategy(key)}>{strategy.name}</button>)}
	              </div>
	            </div>}
	            {isPairedOverUnder && <OverUnderPairPanel mode={pairMode} rows={pairSessionMatches ? derivPairRows : []} trades={pairSessionMatches ? derivPairTrades : []} stats={pairSessionMatches ? derivPairStats : EMPTY_PAIR_STATS} stake={derivStake} currency={derivCurrency} running={derivAutoRunning} onStake={(value) => { derivStakeRef.current = value; setDerivStake(value); setDerivProposal(null); }}/>}
	            {derivMode === "manual" ? <>
	              {isOverUnderCategory ? <div className="direction-control contract-options"><button className={`selected ${derivOverUnderStrategies[derivOverUnderStrategy].contractType === "DIGITOVER" ? "rise" : "fall"}`} disabled>{derivOverUnderStrategies[derivOverUnderStrategy].contractType === "DIGITOVER" ? <ArrowUp/> : <ArrowDown/>}{derivOverUnderStrategies[derivOverUnderStrategy].name}</button><button disabled><Target/>{getOverUnderStrategySummary(derivOverUnderStrategy)}</button></div> : <div className="direction-control contract-options">{selectedContractCategory.options.map((contractType) => <button key={contractType} className={`${derivContractType === contractType ? "selected" : ""} ${contractType === "CALL" || contractType === "DIGITOVER" || contractType === "DIGITEVEN" || contractType === "DIGITMATCH" || contractType === "ONETOUCH" ? "rise" : "fall"}`} onClick={() => changeDerivContractType(contractType)}>{contractType === "CALL" || contractType === "DIGITOVER" || contractType === "ONETOUCH" ? <ArrowUp/> : contractType === "PUT" || contractType === "DIGITUNDER" ? <ArrowDown/> : <Target/>}{derivContractLabels[contractType]}</button>)}</div>}
	              {needsDigitBarrier(derivContractType) && !isOverUnderCategory && <div className="digit-barrier"><label>Digit / barrière<input type="number" min={selectedContractBarrierOptions[0]} max={selectedContractBarrierOptions.at(-1)} step="1" value={derivDigitBarrier} onChange={(event) => changeDerivDigitBarrier(Number(event.target.value))}/></label><div className="digit-quick-pick" role="group" aria-label="Sélection rapide du digit">{selectedContractBarrierOptions.map((digit) => <button key={digit} className={derivDigitBarrier === digit ? "selected" : ""} onClick={() => changeDerivDigitBarrier(digit)}>{digit}</button>)}</div></div>}
              {needsTouchBarrier(derivContractType) && <div className="digit-barrier"><label>Barrière cible<input type="text" value={derivTouchBarrier} onChange={(event) => { setDerivTouchBarrier(event.target.value); setDerivProposal(null); }} onBlur={() => setDerivTouchBarrier(normalizeTouchBarrier(derivTouchBarrier))} placeholder="+1"/></label><small>Utilisez une barrière relative, par exemple +1 ou -1.5.</small></div>}
	              <div className="ticket-fields"><label>{derivHalfBalanceRiskEnabled ? "Mise fallback (USD)" : "Mise (USD)"}<input type="number" min="0.35" step="0.01" disabled={derivHalfBalanceRiskEnabled} value={derivStake} onChange={(event) => { derivDoubleRiskSeriesIndexRef.current = 0; setDerivDoubleRiskSeriesIndex(0); setDerivStake(Number(event.target.value)); setDerivProposal(null); }}/></label><div className="auto-duration"><span>Durée choisie par le bot</span><b>{derivDuration} ticks <small>{derivDurationDecision.label}</small></b><p>{derivDurationDecision.reason}</p></div></div>
              <Button className="quote-button" disabled={!derivConnected} onClick={requestDerivProposal}><RefreshCw/> Obtenir une proposition</Button>
              {derivProposal ? <div className="proposal-card"><span>Contrat<b>{formatDerivContract(derivProposal.contractType, derivProposal.barrier)}</b></span><span>Prix du contrat<b>{formatUsd(derivProposal.askPrice)}</b></span><span>Paiement potentiel<b>{formatUsd(derivProposal.payout)}</b></span><p>{derivProposal.longcode}</p><Button disabled={!derivTradeConnected} onClick={buyDerivContract}><LockKeyhole/> Acheter sur le compte {derivStatus === "real" ? "réel" : "démo"}</Button>{!derivTradeConnected && <small>Connectez un compte Options pour acheter.</small>}</div> : <div className="ticket-empty">Choisissez le type de contrat, l’action et la mise. Le bot calcule automatiquement la durée avant la proposition.</div>}
            </> : <>
		              {derivContractType === "DIGITOVER" || derivContractType === "DIGITUNDER" ? <div className="direction-control contract-options"><button className={`selected ${derivOverUnderStrategies[derivOverUnderStrategy].contractType === "DIGITOVER" ? "rise" : "fall"}`} disabled>{derivOverUnderStrategies[derivOverUnderStrategy].contractType === "DIGITOVER" ? <ArrowUp/> : <ArrowDown/>}{derivOverUnderStrategies[derivOverUnderStrategy].name}</button><button disabled><Target/>{getOverUnderStrategySummary(derivOverUnderStrategy)}</button></div> : derivContractType === "CALL" || derivContractType === "PUT" ? <div className="direction-control contract-options"><button className="selected rise" disabled><ArrowUp/>Hausse auto</button><button className="selected fall" disabled><ArrowDown/>Baisse auto</button></div> : <div className="direction-control contract-options">{selectedContractCategory.options.map((contractType) => <button key={contractType} disabled={derivAutoRunning} className={`${derivContractType === contractType ? "selected" : ""} ${contractType === "CALL" || contractType === "DIGITOVER" || contractType === "DIGITEVEN" || contractType === "DIGITMATCH" || contractType === "ONETOUCH" ? "rise" : "fall"}`} onClick={() => changeDerivContractType(contractType)}>{contractType === "CALL" || contractType === "DIGITOVER" || contractType === "ONETOUCH" ? <ArrowUp/> : contractType === "PUT" || contractType === "DIGITUNDER" ? <ArrowDown/> : <Target/>}{derivContractLabels[contractType]}</button>)}</div>}
	              <div className="auto-contract-summary"><span>Contrat automatique</span><b>{derivContractType === "DIGITOVER" || derivContractType === "DIGITUNDER" ? derivOverUnderStrategies[derivOverUnderStrategy].name : derivContractType === "CALL" || derivContractType === "PUT" ? "Direction et durée automatiques" : derivContractType === "DIGITMATCH" ? `Matches ${derivAutoDigitBarrierMode === "fixed" ? derivDigitBarrier : "dynamique"}` : derivContractType.startsWith("DIGIT") ? `${derivContractLabels[derivContractType]} ${needsDigitBarrier(derivContractType) && derivAutoDigitBarrierMode === "fixed" ? derivDigitBarrier : "dynamique"}` : needsTouchBarrier(derivContractType) ? `${derivContractLabels[derivContractType]} dynamique` : formatDerivContract(derivContractType, null)}</b>{derivContractType === "DIGITOVER" || derivContractType === "DIGITUNDER" ? <small>{derivOverUnderStrategies[derivOverUnderStrategy].description}</small> : derivContractType === "CALL" || derivContractType === "PUT" ? <small>Le modèle compare Hausse et Baisse sur 8, 21 et 55 ticks, puis contrôle le payout avant achat.</small> : derivContractType === "DIGITMATCH" ? <small>Le bot utilise la stratégie Matches importée ou le profil avancé par défaut, puis achète uniquement les signaux qualifiés.</small> : needsDigitBarrier(derivContractType) && <small>{derivAutoDigitBarrierMode === "fixed" ? `Le bot garde la barrière ${derivDigitBarrier} pour la série de trades.` : "Le bot choisit le digit au moment du signal."}</small>}{needsTouchBarrier(derivContractType) && <small>Le bot calcule une barrière relative selon la volatilité récente.</small>}</div>
	              {derivContractType === "DIGITMATCH" && <label className="strategy-select">Liste des stratégies Matches<select aria-label="Stratégie Matches" value={matchStrategySelection} disabled={derivAutoRunning} onChange={(event) => selectMatchStrategy(event.target.value)}><option value="advanced">Matches avancé</option><option value="dbx">{DBX_MATCH_CONFIG.name}</option><option value="dbx_dynamic">{DBX_DYNAMIC_MATCH_CONFIG.name}</option><option value="dbx_last_digit">{DBX_LAST_DIGIT_CONFIG.name}</option>{importedMatchProfile && <option value="imported">{importedMatchProfile.name} (importée)</option>}</select></label>}
              {isDbxGuarded && <div className="match-strategy-card">
                <b>Seuil d’entrée DBX V3.1</b>
                <div className="ticket-fields">
                  <label>Mode du seuil<select aria-label="Mode du seuil DBX V3.1" disabled={derivAutoRunning} value={matchStrategy.dbxMinimumProbability == null ? "auto" : "manual"} onChange={(event) => changeDbxThreshold(event.target.value === "auto" ? null : 0.1)}><option value="auto">Automatique selon le payout</option><option value="manual">Seuil manuel (%)</option></select></label>
                  {matchStrategy.dbxMinimumProbability != null && <label>Estimation prudente minimum (%)<input aria-label="Seuil manuel DBX V3.1 en pourcentage" type="number" min="0" max="100" step="0.1" disabled={derivAutoRunning} value={Number((matchStrategy.dbxMinimumProbability * 100).toFixed(4))} onChange={(event) => { if (event.target.value !== "") changeDbxThreshold(Number(event.target.value) / 100); }}/></label>}
                </div>
                <small>{matchStrategy.dbxMinimumProbability == null ? "Seuil automatique : équilibre du payout × 1,02 (marge de 2 % de la mise)." : "Le seuil manuel remplace le seuil automatique. Il peut autoriser une entrée sous le seuil d’équilibre du payout ; le budget de perte reste actif."}</small>
              </div>}
              {isDbxGuarded && <div className="match-strategy-card"><label>Budget de perte session (nombre de mises)<input type="number" min="1" max="100" step="1" disabled={derivAutoRunning} value={matchStrategy.lossBudgetStakes ?? DBX_V3_GUARD.defaultLossBudgetStakes} onChange={(event) => { const value = clampNumber(event.target.value, DBX_V3_GUARD.defaultLossBudgetStakes, 1, 100); const next = { ...matchStrategy, lossBudgetStakes: value }; derivMatchStrategyRef.current = next; setMatchStrategy(next); }}/></label><small>Budget : {((matchStrategy.lossBudgetStakes ?? DBX_V3_GUARD.defaultLossBudgetStakes) * derivStake).toFixed(2)} {derivCurrency}. Le bot réserve la prochaine mise avant achat et s’arrête si elle peut dépasser cette perte nette. Le budget repart au prochain Play.</small></div>}
              {derivContractType === "DIGITMATCH" && <div className="match-strategy-card"><div><span>Stratégie Matches</span><b>{matchStrategy.name}</b><small>{isDbxLastDigit ? "Dernier digit dans le Top 2 · 50 ticks · 1 contrat de 1 tick" : isDbxGuarded ? `Top 2 sur 50 ticks · contrôle sur 200 · seuil ${matchStrategy.dbxMinimumProbability == null ? "automatique" : (matchStrategy.dbxMinimumProbability * 100).toFixed(2) + "%"} · ${matchStrategy.durationTicks ?? 1} tick(s)` : isDbxMatch ? `Digit 1 fixe · ${matchStrategy.durationTicks ?? 1} tick(s) · Volatility 50 (1s) · sans filtre statistique` : matchStrategy.rules.selectionMode === "top_two_adaptive" ? `Top 2 adaptatif · ${matchStrategy.rules.windowSize} ticks · 1 contrat` : matchStrategy.rules.selectionMode === "top_two_frequency" ? `1er / 2e en alternance · ${matchStrategy.rules.windowSize} ticks · 1 contrat` : matchStrategy.rules.selectionMode === "frequency_window" ? `Fenêtre ${matchStrategy.rules.windowSize} ticks · seuil ${(matchStrategy.rules.minimumProbability * 100).toFixed(0)}%` : `Min ${(matchStrategy.rules.minimumProbability * 100).toFixed(1)}% · edge +${(matchStrategy.rules.minimumEdge * 100).toFixed(1)}% · accord ${matchStrategy.rules.minimumAgreementScore}/5`}{matchStrategy.takeProfit !== null ? ` · TP ${formatUsd(matchStrategy.takeProfit)}` : ""}{matchStrategy.stopLoss !== null ? ` · SL ${formatUsd(matchStrategy.stopLoss)}` : ""}{matchStrategy.maxRecoverySteps > 0 ? ` · récup x${matchStrategy.recoveryMultiplier}` : ""}</small></div><label className="match-strategy-import"><Upload/> Importer .md<input type="file" accept=".md,text/markdown,text/plain" disabled={derivAutoRunning} onChange={importMatchStrategyFile}/></label>{matchStrategyImportStatus && <small>{matchStrategyImportStatus}</small>}</div>}
		              {!isDbxMatch && needsDigitBarrier(derivContractType) && derivContractType !== "DIGITOVER" && derivContractType !== "DIGITUNDER" && <div className="contract-category-picker auto-barrier-mode" role="group" aria-label="Mode de barrière automatique"><span>Barrière en full automatique</span><button disabled={derivAutoRunning} className={derivAutoDigitBarrierMode === "dynamic" ? "selected" : ""} onClick={() => setDerivAutoDigitBarrierMode("dynamic")}>Dynamique</button><button disabled={derivAutoRunning} className={derivAutoDigitBarrierMode === "fixed" ? "selected" : ""} onClick={() => setDerivAutoDigitBarrierMode("fixed")}>Digit fixe</button><small>{derivAutoDigitBarrierMode === "fixed" ? `Tous les prochains trades ${derivContractLabels[derivContractType]} utiliseront la barrière ${derivDigitBarrier}.` : "L’IA adapte la barrière selon les ticks récents."}</small></div>}
	              {derivContractType === "DIGITMATCH" && <div className="martingale-panel enabled"><div className="martingale-toggle"><span><b>Contrats Matches</b><small>Nombre de contrats à prendre à chaque signal qualifié.</small></span></div><div className="martingale-fields"><label>Nombre de contrats<input type="number" min="1" max="10" step="1" disabled={derivAutoRunning || isDbxMatch} value={derivMatchPositionCount} onChange={(event) => setDerivMatchPositionCount(Math.min(10, Math.max(1, Math.trunc(Number(event.target.value) || 1))))}/></label><span>Par signal <b>{derivMatchPositionCount} contrat{derivMatchPositionCount > 1 ? "s" : ""}</b></span></div></div>}
	              <div className={`martingale-panel ${derivMaxSignals > 0 ? "enabled" : ""}`}><div className="martingale-toggle"><span><b>Limite signaux session</b><small>{derivMaxSignals > 0 ? `Stop automatique après ${derivMaxSignals} signal${derivMaxSignals > 1 ? "s" : ""}.` : "Illimité: le bot continue jusqu’au Stop manuel."}</small></span></div><div className="martingale-fields"><label>Nombre de signaux<input type="number" min="0" max="1000" step="1" disabled={derivAutoRunning} value={derivMaxSignals} onChange={(event) => setDerivMaxSignals(Math.min(1000, Math.max(0, Math.trunc(Number(event.target.value) || 0))))}/></label><span>Session <b>{derivMaxSignals > 0 ? `${derivSessionSignals}/${derivMaxSignals}` : "Illimité"}</b></span></div></div>
	              {!isDbxMatch && needsDigitBarrier(derivContractType) && derivContractType !== "DIGITOVER" && derivContractType !== "DIGITUNDER" && derivAutoDigitBarrierMode === "fixed" && <div className="digit-barrier auto-fixed-barrier"><label>Digit / barrière fixe<input type="number" min={selectedContractBarrierOptions[0]} max={selectedContractBarrierOptions.at(-1)} step="1" disabled={derivAutoRunning} value={derivDigitBarrier} onChange={(event) => changeDerivDigitBarrier(Number(event.target.value))}/></label><div className="digit-quick-pick" role="group" aria-label="Sélection du digit fixe">{selectedContractBarrierOptions.map((digit) => <button key={digit} disabled={derivAutoRunning} className={derivDigitBarrier === digit ? "selected" : ""} onClick={() => changeDerivDigitBarrier(digit)}>{digit}</button>)}</div></div>}
		              {derivContractType.startsWith("DIGIT") ? <div className="strategy-select auto-digit-strategy"><span>Stratégie automatique</span><b>{derivContractType === "DIGITOVER" || derivContractType === "DIGITUNDER" ? derivOverUnderStrategies[derivOverUnderStrategy].name : derivContractType === "DIGITMATCH" ? matchStrategy.name : "Filtre statistique des derniers chiffres"}</b><small>{derivContractType === "DIGITOVER" || derivContractType === "DIGITUNDER" ? `${getOverUnderStrategySummary(derivOverUnderStrategy)} · ${derivOverUnderStrategies[derivOverUnderStrategy].description}` : derivContractType === "DIGITMATCH" ? isDbxLastDigit ? "DBX V4 classe les digits sur les 50 derniers ticks et attend que le dernier digit reçu soit le premier ou le deuxième plus fréquent. Elle achète Matches sur ce même digit, après nouvelle vérification à réception de la cotation. Ce déclencheur ne garantit pas le prochain résultat." : isDbxDynamic ? "DBX V3.1 choisit parmi le Top 2 sur 50 ticks et contrôle le score prudent sur 200 ticks. Le seuil et la durée se règlent avant Play. Les estimations concernent le prochain tick et ne sont pas calibrées pour une échéance de plusieurs ticks. Cotations périmées ou digit modifié : achat annulé." : isDbxMatch ? "Répète Matches sur le digit 1 après chaque clôture, avec la mise saisie (5 par défaut). Martingale et multiplicateurs ignorés, comme le montant fixe du XML. La limite de session du bot reste applicable." : matchStrategy.rules.selectionMode === "top_two_adaptive" ? `Choisit entre les deux chiffres les plus fréquents sur ${matchStrategy.rules.windowSize} ticks, sans alternance forcée. Compare fréquence, récence et transitions sur les résultats passés ; estimation non garantie.` : matchStrategy.rules.selectionMode === "top_two_frequency" ? `Alterne entre le premier et le deuxième chiffre les plus fréquents des ${matchStrategy.rules.windowSize} derniers ticks. Un contrat à la fois ; les fréquences passées ne sont pas des probabilités de gain.` : matchStrategy.rules.selectionMode === "frequency_window" ? `Prend uniquement DIGITMATCH sur le digit le plus fréquent des ${matchStrategy.rules.windowSize} derniers ticks si sa fréquence atteint ${(matchStrategy.rules.minimumProbability * 100).toFixed(0)}%.` : "Sélectionne un digit dynamique seulement quand les fenêtres statistiques, le contexte et le payout confirment une Edge positive." : derivContractType === "DIGITDIFF" ? "Differs: le bot sélectionne un digit sous-représenté pour réduire le risque de sortie identique." : "Le bot adapte la barrière selon la distribution récente des derniers chiffres."}</small></div> : <label className="strategy-select">Stratégie automatique<select value={derivStrategy} disabled={derivAutoRunning} onChange={(event) => { const strategy = event.target.value as DerivStrategy; derivStrategyRef.current = strategy; setDerivStrategy(strategy); }}><option value="trend">Tendance multi-horizon</option><option value="momentum">Impulsion filtrée</option><option value="reversal">Retournement confirmé</option></select><small>{derivStrategies[derivStrategy].description}</small></label>}
	              <div className="ticket-fields auto-fields">{!isPairedOverUnder && <label>{derivHalfBalanceRiskEnabled ? "Mise fallback (USD)" : "Mise fixe (USD)"}<input type="number" min="0.35" step="0.01" disabled={derivAutoRunning || derivHalfBalanceRiskEnabled} value={derivStake} onChange={(event) => { derivDoubleRiskSeriesIndexRef.current = 0; setDerivDoubleRiskSeriesIndex(0); setDerivStake(Number(event.target.value)); }}/></label>}<div className="auto-duration"><span>{isPairedOverUnder || isDbxMatch ? "Durée par contrat" : "Durée adaptative"}</span>{isDbxMatch && !isDbxDynamic ? <><label>Durée en ticks<select aria-label="Durée DBX V2 en ticks" value={matchStrategy.durationTicks ?? DBX_MATCH_CONFIG.duration} disabled={derivAutoRunning} onChange={(event) => changeDbxDuration(Number(event.target.value))}>{Array.from({ length: 10 }, (_, i) => i + 1).map((duration) => <option key={duration} value={duration}>{duration} tick{duration > 1 ? "s" : ""}</option>)}</select></label><p>Matches digit 1 · durée appliquée à chaque contrat automatique.</p></>  : isDbxGuarded ? <><label>Durée en ticks<select aria-label="Durée DBX V3.1 en ticks" value={matchStrategy.durationTicks ?? DBX_MATCH_CONFIG.duration} disabled={derivAutoRunning} onChange={(event) => changeDbxDuration(Number(event.target.value))}>{Array.from({ length: 10 }, (_, i) => i + 1).map((duration) => <option key={duration} value={duration}>{duration} tick{duration > 1 ? "s" : ""}</option>)}</select></label><p>Un contrat à la fois · la durée s’applique aux prochains achats.</p></> : isDbxMatch ? <><b>1 tick <small>FIXE</small></b><p>{isDbxDynamic ? "Matches digit dynamique" : "Matches digit 1"} · un contrat à la fois.</p></> : isPairedOverUnder ? <><b>1 tick <small>FIXE</small></b><p>Deux contrats sur deux indices distincts.</p></> : derivContractType === "CALL" || derivContractType === "PUT" ? <><b>2 à 5 ticks <small>SIGNAL</small></b><p>Choisie selon la persistance ou l’accélération détectée.</p></> : <><b>{derivDuration} ticks <small>{derivDurationDecision.label}</small></b><p>{derivDurationDecision.reason}</p></>}</div></div>
	              <div className="auto-execution-status"><span className={derivAutoRunning ? "running" : ""}/><div><b>{derivAutoRunning ? "BOT EN MARCHE" : "BOT EN PAUSE"}</b><small>{derivAutoStatus}</small></div></div>
              <div className="auto-actions"><Button className="auto-play" disabled={derivAutoRunning || !derivTradeConnected} onClick={startDerivAuto}><Play/> Play</Button><Button className="auto-stop" disabled={!derivAutoRunning} onClick={stopDerivAuto}><Square/> Stop</Button></div>
	              <small className="auto-disclaimer">{isDbxMatch ? `DBX : ${isDbxDynamic ? "digit dynamique" : "digit 1 fixe"}, un contrat à la fois, mise constante. Répétition jusqu’au Stop ou à la limite de session choisie.` : isPairedOverUnder ? "Chaque paire ouvre deux contrats de 1 tick sur deux indices distincts. Stop annule les futures entrées ; les contrats engagés restent suivis." : `${derivMultiplePositionsEnabled ? `${derivPositionCount} positions par signal` : "Une seule position par signal"} · ${isMatchesDiffersContract(derivContractType) ? "aucun délai automatique pour Matches/Differs" : `pause entre trades ${derivTradePauseEnabled ? "ON: 8 ticks" : "OFF: aucun délai"}`} · arrêt manuel avec Stop. Martingale augmente fortement le risque.`} Aucune stratégie ne garantit un gain.</small>
            </>}
          </section>
        </div>
	      </section>;
    }

    if (activeView === "ai") return <section className="view-stack">
      <div className="view-heading"><div><p className="eyebrow">DERNIÈRE ANALYSE REÇUE</p><h2>{analysis?.request?.symbol ?? "Aucune analyse MT5"}</h2></div><div className="score-compact"><b>{analysis?.decision?.score ?? 0}</b><span>/100</span></div></div>
      <div className="split-view"><div className="panel"><p className="eyebrow">DÉCISION</p><h3 className="decision-title">{analysis?.decision ? (analysis.decision.approved ? `${analysis.decision.action} VALIDÉ` : "AUCUN TRADE") : "EN ATTENTE DU EA"}</h3><div className="model-details"><span>Timeframe<b>{analysis?.request?.timeframe ?? "-"}</b></span><span>Biais HTF<b>{displayBias(analysis?.request?.smc.htfBias)}</b></span><span>Confiance ML<b>{analysis?.request ? `${Math.round(analysis.request.ml.confidence * 100)}%` : "-"}</b></span><span>Score minimum<b>{config.minScore}/100</b></span></div></div><div className="panel"><p className="eyebrow">RÈGLES SMC</p><div className="rule-list">{analysis?.request?.smc ? Object.entries(analysis.request.smc).map(([name, valid]) => <span key={name}><i className={valid ? "valid" : ""}/>{name.replaceAll(/([A-Z])/g, " $1")} · {valid ? "Validé" : "Non confirmé"}</span>) : <div className="large-empty compact"><BrainCircuit/><small>L’EA n’a pas encore envoyé d’analyse.</small></div>}</div></div></div>
    </section>;

    if (activeView === "eastrategy") return <section className="view-stack">
      <div className="view-heading"><div><p className="eyebrow">MENU STRATÉGIE</p><h2>Expert Advisor MT5</h2></div><span className={`connection-chip ${mt5Online ? "online" : ""}`}><i/>{mt5Online ? `EA connecté · ${mt5ConnectedMode === "real" ? "réel" : mt5ConnectedMode === "demo" ? "démo" : "mode inconnu"}` : "EA hors ligne"}</span></div>
      <div className="ea-strategy-layout">
        <section className="panel ea-strategy-main">
          <div className="panel-head"><div><p className="eyebrow">PRESETS EA</p><h3>{eaStrategyPresets[eaStrategyPreset].name}</h3></div><Sparkles className="lime"/></div>
          <div className="ea-preset-grid" role="group" aria-label="Preset stratégie Expert Advisor">{(Object.entries(eaStrategyPresets) as [EaStrategyPreset, typeof eaStrategyPresets[EaStrategyPreset]][]).map(([key, strategy]) => <button key={key} className={eaStrategyPreset === key ? "selected" : ""} onClick={() => applyEaStrategyPreset(key)}><b>{strategy.name}</b><small>{strategy.description}</small></button>)}</div>
        </section>
        <section className="panel ea-strategy-summary">
          <p className="eyebrow">RÉSUMÉ ACTIF</p>
          <h3>{eaStrategyPresets[eaStrategyPreset].name}</h3>
          <div className="model-details"><span>Timeframe<b>{eaTimeframe}</b></span><span>Score cible<b>{riskDraft.minScore}/100</b></span><span>Positions max<b>{eaMaxPositions}</b></span><span>Compte cible<b>{mt5AccountMode === "real" ? "Réel" : "Démo"}</b></span></div>
        </section>
      </div>
      <div className="split-view ea-controls">
        <section className="panel">
          <div className="panel-head"><div><p className="eyebrow">FILTRES</p><h3>Conditions d’entrée</h3></div><BrainCircuit className="lime"/></div>
          <div className="settings-grid ea-toggle-grid">
            <div className="settings-block"><div><ShieldCheck/><span><b>Structure SMC</b><small>BOS, CHOCH, sweep et FVG</small></span></div><Switch checked={eaUseSmc} onCheckedChange={setEaUseSmc}/></div>
            <div className="settings-block"><div><Sparkles/><span><b>Filtre IA / ML</b><small>Confiance statistique minimale</small></span></div><Switch checked={eaUseMl} onCheckedChange={setEaUseMl}/></div>
            <div className="settings-block"><div><Activity/><span><b>Filtre tendance</b><small>Confirme la direction courte</small></span></div><Switch checked={eaUseTrendFilter} onCheckedChange={setEaUseTrendFilter}/></div>
            <div className="settings-block"><div><Gauge/><span><b>Filtre session</b><small>Évite les périodes bruitées</small></span></div><Switch checked={eaUseSessionFilter} onCheckedChange={setEaUseSessionFilter}/></div>
          </div>
        </section>
        <section className="panel ea-params">
          <div className="panel-head"><div><p className="eyebrow">PARAMÈTRES</p><h3>Réglages de décision</h3></div><Settings2 className="lime"/></div>
          <div className="form-panel ea-form"><label>Timeframe EA<select value={eaTimeframe} onChange={(event) => setEaTimeframe(event.target.value as EaTimeframe)}><option value="M5">M5</option><option value="M15">M15</option><option value="H1">H1</option></select></label><label>Score minimum<input type="number" min="50" max="100" value={riskDraft.minScore} onChange={(event) => setRiskDraft({ ...riskDraft, minScore: Number(event.target.value) })}/></label><label>Positions max<input type="number" min="1" max="10" value={eaMaxPositions} onChange={(event) => setEaMaxPositions(Math.max(1, Number(event.target.value)))}/></label></div>
          <div className="form-actions ea-actions"><Button onClick={saveRiskConfig}><ShieldCheck/> Enregistrer le score</Button><span className={configStatus.includes("refus") || configStatus.includes("invalide") ? "red" : "green"}>{configStatus || "Les filtres restent actifs côté dashboard"}</span></div>
        </section>
      </div>
      <div className="panel info-panel warning"><ShieldCheck/><div><b>Synchronisation EA</b><p>Ce menu prépare la stratégie côté dashboard. Pour appliquer ces filtres directement dans MetaTrader, il faudra ensuite transmettre ces valeurs dans le payload de l’EA et recompiler l’Expert Advisor.</p></div></div>
    </section>;

    if (activeView === "risk") return <section className="view-stack">
      <div className="view-heading"><div><p className="eyebrow">LIMITES DU MOTEUR</p><h2>Paramètres de protection</h2></div><span className="risk-ratio">Risque actuel <b>{((riskDraft.maxRiskUsd / riskDraft.referenceCapitalUsd) * 100).toFixed(1)}%</b></span></div>
      <div className="panel form-panel"><label>Capital de référence (USD)<input type="number" min="10" value={riskDraft.referenceCapitalUsd} onChange={(event) => setRiskDraft({ ...riskDraft, referenceCapitalUsd: Number(event.target.value) })}/></label><label>Perte maximale par trade (USD)<input type="number" min="0.01" step="0.01" value={riskDraft.maxRiskUsd} onChange={(event) => setRiskDraft({ ...riskDraft, maxRiskUsd: Number(event.target.value) })}/></label><label>Score minimum IA<input type="number" min="50" max="100" value={riskDraft.minScore} onChange={(event) => setRiskDraft({ ...riskDraft, minScore: Number(event.target.value) })}/></label><div className="form-actions"><Button onClick={saveRiskConfig}><ShieldCheck/> Enregistrer les limites</Button><span className={configStatus.includes("refus") || configStatus.includes("invalide") ? "red" : "green"}>{configStatus}</span></div></div>
      <div className="panel info-panel warning"><ShieldCheck/><div><b>Mode réel explicite</b><p>Le dashboard peut cibler un compte démo ou réel. Côté MT5, le réel exige aussi AllowRealTrading=true dans l’EA.</p></div></div>
    </section>;

    return <section className="view-stack">
      <div className="view-heading"><div><p className="eyebrow">CONNEXION ET AUTOMATISATION</p><h2>Configuration système</h2></div><span className={`connection-chip ${mt5Online ? "online" : ""}`}><i/>{mt5Online ? "EA connecté" : "EA hors ligne"}</span></div>
      <div className="settings-grid"><div className="panel settings-block"><div><Bot/><span><b>Trading automatique</b><small>Autoriser l’analyse continue du moteur</small></span></div><Switch checked={autoTrade && !stopped} disabled={stopped} onCheckedChange={setAutoTrade}/></div><div className="panel settings-block"><div><Radio/><span><b>Flux MT5</b><small>{liveSymbol || "Aucun symbole reçu"}</small></span></div><b className={mt5Online ? "green" : "red"}>{mt5Online ? "EN LIGNE" : "HORS LIGNE"}</b></div><div className="panel settings-block"><div><ShieldCheck/><span><b>Mode du compte</b><small>{mt5ConnectedMode ? `Terminal ${mt5ConnectedMode === "real" ? "réel" : "démo"}` : "Choix dashboard"}</small></span></div><b>{mt5AccountMode === "real" ? "RÉEL" : "DÉMO"}</b></div><div className="panel settings-block"><div><Gauge/><span><b>Fréquence du dashboard</b><small>Actualisation des données live</small></span></div><b>300 ms</b></div></div>
      <section className="download-band settings-download"><div><span className="download-icon"><Download/></span><span><b>Agent MT5 v0.36</b><small>Prix tick-by-tick, balance et positions live</small></span></div><div><a href="/INSTALLATION-MT5.txt" download>Guide</a><a className="primary-download" href="/DerivAITraderEA.mq5" download><Download/> Télécharger l’EA</a></div></section>
    </section>;
  }

  return <main className="app-shell"><div className="noise"/>
    <aside className={`sidebar ${sidebar ? "sidebar-open" : ""}`}>
      <div className="brand"><span className="brand-mark"><Zap size={18}/></span><span>JANJAWID <span>PRO</span></span></div>
      <button className="close-mobile" onClick={() => setSidebar(false)} aria-label="Fermer le menu"><X/></button>
      <nav><p>ESPACE DE TRAVAIL</p><button className={activeView === "overview" ? "active" : ""} onClick={() => navigate("overview")}><LayoutDashboard/> Vue d&apos;ensemble</button><button className={activeView === "markets" ? "active" : ""} onClick={() => navigate("markets")}><Activity/> Marchés <span className="nav-badge">2</span></button><button className={activeView === "positions" ? "active" : ""} onClick={() => navigate("positions")}><Target/> Positions {positions.length > 0 && <span className="nav-badge">{positions.length}</span>}</button><button className={activeView === "performance" ? "active" : ""} onClick={() => navigate("performance")}><BarChart3/> Performance</button><button className={activeView === "derivbot" ? "active" : ""} onClick={() => navigate("derivbot")}><Bot/> Deriv Bot <span className={`nav-status ${derivConnected ? "online" : ""}`}/></button><button className={activeView === "derivhistory" ? "active" : ""} onClick={() => navigate("derivhistory")}><WalletCards/> Historique gains</button><button className={activeView === "copytrading" ? "active" : ""} onClick={() => navigate("copytrading")}><Signal/> Copytrading <span className={`nav-status ${copyTradingEnabled ? "online" : ""}`}/></button><p>SYSTÈME</p><button className={activeView === "ai" ? "active" : ""} onClick={() => navigate("ai")}><BrainCircuit/> Modèle IA</button><button className={activeView === "eastrategy" ? "active" : ""} onClick={() => navigate("eastrategy")}><Settings2/> Stratégie EA</button><button className={activeView === "risk" ? "active" : ""} onClick={() => navigate("risk")}><ShieldCheck/> Gestion du risque</button><button className={activeView === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Settings2/> Configuration</button></nav>
      <div className="account-card"><div className="account-row"><span className={mt5Online ? "pulse-dot online" : "pulse-dot"}/><span><b>Deriv MT5</b><small>{mt5ConnectedMode ? `Compte ${mt5ConnectedMode === "real" ? "réel" : "démo"}` : "Démo ou réel"}</small></span></div><div className="account-meta"><span>API<b className="green">Prête</b></span><span>EA<b className={mt5Online ? "green" : ""}>{mt5Online ? "En ligne" : "Hors ligne"}</b></span></div></div>
    </aside>
    <section className="workspace">
      <header className="topbar"><button className="menu-mobile" onClick={() => setSidebar(true)} aria-label="Ouvrir le menu"><Menu/></button><div><p className="eyebrow">{viewTitles[activeView].eyebrow}</p><h1>{viewTitles[activeView].title}</h1></div>{activeView === "derivbot" || activeView === "derivhistory" ? <div className="top-actions"><div className={`system-pill ${derivStatus === "error" ? "danger" : ""}`}><span/><b>{derivStatus === "real" ? "DERIV RÉEL" : derivStatus === "demo" ? "DERIV DÉMO" : derivStatus === "public" ? "DERIV PUBLIC" : "CONNEXION DERIV"}</b></div><div className="avatar">PK</div></div> : <div className="top-actions"><div className={`system-pill ${stopped ? "danger" : ""}`}><span/><b>{status}</b></div><Button className="emergency" onClick={() => setStopped(!stopped)}><Octagon/> {stopped ? "Réactiver" : "Arrêt d'urgence"}</Button><div className="avatar">PK</div></div>}</header>
      <div className="content">{activeView === "overview" ? <>
        <section className="capital-band"><div className="capital-main"><p>CAPITAL DE RÉFÉRENCE</p><h2>{formatUsd(config.referenceCapitalUsd)}<span></span></h2><small><span>●</span> Configuration MVP</small></div><div className="capital-metric"><WalletCards/><span>Balance MT5<b>{mt5Balance === null ? "Non connecté" : `${formatUsd(mt5Balance)} ${mt5Currency}`}</b><small>Equity : {mt5Equity === null ? "-" : `${formatUsd(mt5Equity)} ${mt5Currency}`}</small></span></div><div className="capital-metric"><Gauge/><span>P/L ouvert<b className={mt5Profit !== null && mt5Profit < 0 ? "red" : "green"}>{mt5Profit === null ? "-" : `${formatUsd(mt5Profit)} ${mt5Currency}`}</b><small>Risque max : -{formatUsd(config.maxRiskUsd)}</small></span></div><div className="risk-warning"><ShieldCheck/><span><b>Risque élevé : {Math.round((config.maxRiskUsd / config.referenceCapitalUsd) * 100)}%</b><small>Le réel nécessite une activation explicite dans MT5</small></span></div></section>
        <div className="grid-main">
          <section className="panel market-panel"><div className="panel-head"><div><p className="eyebrow">ANALYSE DE MARCHÉ</p><h3>{symbol}</h3></div><div className="symbol-tabs">{(Object.keys(prices) as (keyof typeof prices)[]).map(s => <button key={s} onClick={() => setSymbol(s)} className={symbol === s ? "selected" : ""}>{s.replace("Volatility ", "V")}</button>)}</div></div><div className="price-row"><div><b>{marketPrice === null ? fallbackMarket.value : formatPrice(marketPrice)}</b><span className={tickChange !== null && tickChange < 0 ? "red" : ""}>{tickChange === null ? fallbackMarket.change : `${tickChange >= 0 ? "+" : ""}${tickChange.toFixed(2)}%`}</span></div><small>TIMEFRAME <b>{analysisMatchesSymbol ? analysis?.request?.timeframe : "LIVE"} · M15 · M5</b></small></div><MiniChart name={symbol} ticks={symbolTicks}/><div className="smc-row"><div><span>BIAIS HTF</span><b className={marketBias === "HAUSSIER" ? "green" : "muted"}>{marketBias}</b></div><div><span>STRUCTURE</span><b>{analysisMatchesSymbol && analysis?.request?.smc.choch ? "CHOCH CONFIRMÉ" : analysisMatchesSymbol && analysis?.request?.smc.bos ? "BOS CONFIRMÉ" : "EN ATTENTE"}</b></div><div><span>SETUP</span><b>{marketSetup}</b></div></div></section>
          <section className="panel ai-panel"><div className="panel-head"><div><p className="eyebrow">MOTEUR HYBRIDE</p><h3>Score IA + SMC</h3></div><Sparkles className="lime"/></div><div className="score-ring" style={{"--score":`${marketScore*3.6}deg`} as React.CSSProperties}><div><b>{marketScore}</b><span>/100</span></div></div><div className="decision"><span>DÉCISION ACTUELLE</span><b>{analysisMatchesSymbol ? (analysis?.decision?.approved ? `${analysis.decision.action} VALIDÉ` : "ATTENDRE") : marketScore >= config.minScore ? "SETUP VALIDÉ" : "ATTENDRE"}</b><small>Seuil d&apos;exécution : {config.minScore}/100</small></div><div className="factor"><span>Règles SMC</span><i><em style={{width:`${smcScore}%`}}/></i><b>{smcScore}%</b></div><div className="factor"><span>Confiance ML</span><i><em style={{width:`${mlConfidence}%`}}/></i><b>{mlConfidence}%</b></div></section>
        </div>
        <div className="grid-bottom"><section className="panel engine-panel"><div className="panel-head"><div><p className="eyebrow">AUTOMATISATION</p><h3>Moteur de trading</h3></div><Switch checked={autoTrade&&!stopped} disabled={stopped} onCheckedChange={setAutoTrade} aria-label="Activer le trading automatique"/></div><div className="engine-status"><Bot/><span><b>{stopped ? "Moteur arrêté" : autoTrade ? "Autonomie complète" : "Mode observation"}</b><small>{stopped ? "Aucun ordre ne peut être exécuté" : `Analyse continue · cible ${mt5AccountMode === "real" ? "réel" : "démo"}`}</small></span><span className="live"><Radio/> LIVE</span></div><div className="deriv-mode-switch account-mode-switch" role="group" aria-label="Type de compte MT5"><button className={mt5AccountMode === "demo" ? "selected" : ""} onClick={() => setMt5AccountMode("demo")}>MT5 démo</button><button className={mt5AccountMode === "real" ? "selected" : ""} onClick={() => setMt5AccountMode("real")}>MT5 réel</button></div><div className="manual-trade"><Button className="manual-sell" disabled={!mt5Online||stopped} onClick={sendManualSell}>SELL 0.5</Button><span>{manualTradeStatus || (mt5Online ? `EA prêt · terminal ${mt5ConnectedMode === "real" ? "réel" : mt5ConnectedMode === "demo" ? "démo" : "connecté"}` : "EA requis")}</span></div><div className="engine-grid"><span>Univers<b>V25 · V100</b></span><span>Stratégie EA<b>{eaStrategyPresets[eaStrategyPreset].name}</b></span><span>Positions max<b>{eaMaxPositions} / indice</b></span><span>Compte cible<b>{mt5AccountMode === "real" ? "Réel" : "Démo"}</b></span></div></section>
          <section className="panel positions-panel"><div className="panel-head"><div><p className="eyebrow">EXÉCUTION</p><h3>Positions actives</h3></div><button className="text-button" onClick={() => navigate("performance")}>Voir la performance <ChevronDown/></button></div>{positions.length ? <div className="positions-list">{positions.map((position) => <div className="position-row" key={position.ticket}><span><b className={position.type === "SELL" ? "red" : "green"}>{position.type}</b><small>{position.symbol}</small></span><span><small>Lot</small><b>{position.volume.toFixed(2)}</b></span><span><small>Entrée</small><b>{position.priceOpen}</b></span><span><small>P/L</small><b className={position.profit < 0 ? "red" : "green"}>{position.profit.toFixed(2)}</b></span></div>)}</div> : <div className="empty-state"><div><Signal/><span/></div><b>Aucune position ouverte</b><small>Le moteur attend un signal ≥ {config.minScore}/100 et une connexion EA active.</small></div>}</section></div>
        <section className="download-band"><div><span className="download-icon"><Download/></span><span><b>Agent MT5 v0.36 disponible</b><small>Prix tick-by-tick + positions live</small></span></div><div><a href="/INSTALLATION-MT5.txt" download>Guide</a><a className="primary-download" href="/DerivAITraderEA.mq5" download><Download/> Télécharger l’EA v0.36</a></div></section>
        <footer><span><span className="pulse-dot"/> API sécurisée prête · EA v0.36 disponible</span><span>Moteur SMC/Risk v0.3 · Exécution réelle verrouillée</span></footer>
        </> : renderSecondaryView()}
      </div>
      {activeView === "derivbot" && derivContractType !== "DIGITMATCH" && <DigitPredictionBalloon
        open={digitPredictionOpen}
        connected={derivConnected}
        marketName={DERIV_MARKETS[derivMarket]}
        pipSize={derivPipSize}
        price={derivPrice}
        selectedDigit={derivDigitBarrier}
        showOverUnderModel={derivContractType === "DIGITOVER" || derivContractType === "DIGITUNDER"}
        ticks={derivTicks}
        onClose={() => setDigitPredictionOpen(false)}
        onOpen={() => setDigitPredictionOpen(true)}
        onSelectDigit={changeDerivDigitBarrier}
      />}
      {activeView === "derivbot" && derivContractType === "DIGITMATCH" && <MatchPredictionBalloon
        open={matchPredictionOpen}
        connected={derivConnected}
        marketName={DERIV_MARKETS[derivMarket]}
        pipSize={derivPipSize}
        ticks={derivTicks}
        selectedDigit={derivDigitBarrier}
        strategyRules={matchStrategy.rules}
        fixedContract={matchStrategy.executionMode === "dbx_fixed" ? { digit: DBX_MATCH_CONFIG.barrier, duration: matchStrategy.durationTicks ?? DBX_MATCH_CONFIG.duration } : undefined}
        quoteGuard={matchStrategy.executionMode === "dbx_dynamic" ? { minimumTicks: DBX_V3_GUARD.minimumTicks, status: derivAutoStatus, duration: matchStrategy.durationTicks ?? 1, minimumProbability: matchStrategy.dbxMinimumProbability ?? null } : undefined}
        onClose={() => setMatchPredictionOpen(false)}
        onOpen={() => setMatchPredictionOpen(true)}
        onSelectDigit={changeDerivDigitBarrier}
      />}
    </section>
  </main>;
}
