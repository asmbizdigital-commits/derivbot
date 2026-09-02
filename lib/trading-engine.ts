export type TradingConfig = {
  referenceCapitalUsd: number;
  maxRiskUsd: number;
  minScore: number;
  allowedSymbols: readonly ["Volatility 25 Index", "Volatility 100 Index"];
  maxOpenPositionsPerSymbol: number;
  demoOnly: boolean;
};

export const CONFIG: TradingConfig = {
  referenceCapitalUsd: 100,
  maxRiskUsd: 10,
  minScore: 75,
  allowedSymbols: ["Volatility 25 Index", "Volatility 100 Index"] as const,
  maxOpenPositionsPerSymbol: 1,
  demoOnly: false,
};

export function updateTradingConfig(input: Partial<Pick<TradingConfig, "referenceCapitalUsd" | "maxRiskUsd" | "minScore">>) {
  if (typeof input.referenceCapitalUsd === "number") CONFIG.referenceCapitalUsd = input.referenceCapitalUsd;
  if (typeof input.maxRiskUsd === "number") CONFIG.maxRiskUsd = input.maxRiskUsd;
  if (typeof input.minScore === "number") CONFIG.minScore = input.minScore;
  return CONFIG;
}

export type AnalyzeRequest = {
  symbol: string;
  timeframe: "M5" | "M15" | "H1";
  proposedRiskUsd: number;
  accountType: "demo" | "real";
  openPositions: number;
  smc: {
    htfBias: "bullish" | "bearish" | "neutral";
    bos: boolean;
    choch: boolean;
    liquiditySweep: boolean;
    orderBlock: boolean;
    fairValueGap: boolean;
    premiumDiscountAligned: boolean;
    ltfConfirmation: boolean;
  };
  ml: { confidence: number; direction: "buy" | "sell" | "none" };
};

export type TradingDecision = {
  approved: boolean;
  action: "BUY" | "SELL" | "NO_TRADE";
  score: number;
  reasons: string[];
  risk: { requestedUsd: number; approvedUsd: number; capitalPercent: number };
};

export function analyzeSetup(input: AnalyzeRequest): TradingDecision {
  const reasons: string[] = [];
  const symbolAllowed = CONFIG.allowedSymbols.includes(input.symbol as typeof CONFIG.allowedSymbols[number]);
  if (!symbolAllowed) reasons.push("Symbole non autorisé");
  if (CONFIG.demoOnly && input.accountType !== "demo") reasons.push("Le moteur autorise uniquement un compte démo");
  if (input.proposedRiskUsd <= 0 || input.proposedRiskUsd > CONFIG.maxRiskUsd) reasons.push(`Risque demandé supérieur à la limite de ${CONFIG.maxRiskUsd} USD`);
  if (input.openPositions >= CONFIG.maxOpenPositionsPerSymbol) reasons.push("Une position est déjà ouverte sur cet indice");

  let score = 0;
  if (input.smc.htfBias !== "neutral") score += 15;
  if (input.smc.bos || input.smc.choch) score += 15;
  if (input.smc.liquiditySweep) score += 20;
  if (input.smc.orderBlock || input.smc.fairValueGap) score += 15;
  if (input.smc.premiumDiscountAligned) score += 10;
  if (input.smc.ltfConfirmation) score += 15;
  score += Math.round(Math.max(0, Math.min(1, input.ml.confidence)) * 10);

  const smcDirection = input.smc.htfBias === "bullish" ? "buy" : input.smc.htfBias === "bearish" ? "sell" : "none";
  if (input.ml.direction !== smcDirection || smcDirection === "none") reasons.push("La direction IA ne confirme pas le biais SMC");
  if (score < CONFIG.minScore) reasons.push(`Score ${score}/100 inférieur au seuil ${CONFIG.minScore}`);

  const approved = reasons.length === 0;
  return {
    approved,
    action: approved ? (smcDirection === "buy" ? "BUY" : "SELL") : "NO_TRADE",
    score,
    reasons: approved ? ["Règles SMC, IA et risque validés"] : reasons,
    risk: {
      requestedUsd: input.proposedRiskUsd,
      approvedUsd: approved ? Math.min(input.proposedRiskUsd, CONFIG.maxRiskUsd) : 0,
      capitalPercent: Number(((input.proposedRiskUsd / CONFIG.referenceCapitalUsd) * 100).toFixed(2)),
    },
  };
}

export function isAnalyzeRequest(value: unknown): value is AnalyzeRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<AnalyzeRequest>;
  return typeof v.symbol === "string" && ["M5", "M15", "H1"].includes(v.timeframe ?? "") &&
    typeof v.proposedRiskUsd === "number" && typeof v.openPositions === "number" &&
    (v.accountType === "demo" || v.accountType === "real") && !!v.smc && !!v.ml;
}
