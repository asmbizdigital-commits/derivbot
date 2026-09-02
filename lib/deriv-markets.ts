export const DERIV_MARKETS = {
  R_10: "Volatility 10",
  R_25: "Volatility 25",
  R_50: "Volatility 50",
  R_75: "Volatility 75",
  R_100: "Volatility 100",
  "1HZ10V": "Volatility 10 (1s)",
  "1HZ25V": "Volatility 25 (1s)",
  "1HZ50V": "Volatility 50 (1s)",
  "1HZ75V": "Volatility 75 (1s)",
  "1HZ100V": "Volatility 100 (1s)",
} as const;

export type DerivMarketSymbol = keyof typeof DERIV_MARKETS;

export const DERIV_MARKET_PIP_SIZES: Record<DerivMarketSymbol, number> = {
  R_10: 3,
  R_25: 3,
  R_50: 4,
  R_75: 4,
  R_100: 2,
  "1HZ10V": 2,
  "1HZ25V": 2,
  "1HZ50V": 2,
  "1HZ75V": 2,
  "1HZ100V": 2,
};

export function isDerivMarketSymbol(value: string): value is DerivMarketSymbol {
  return value in DERIV_MARKETS;
}
