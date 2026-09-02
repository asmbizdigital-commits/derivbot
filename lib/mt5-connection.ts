type Mt5ConnectionState = {
  lastSeenAt: number | null;
  payload: unknown;
  analysis: unknown;
  ticks: Mt5Tick[];
  pendingCommand: ManualTradeCommand | null;
};

const ONLINE_WINDOW_MS = 10_000;
const COMMAND_TTL_MS = 30_000;
const MAX_TICKS = 80;

type Mt5Tick = {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  receivedAt: string;
};

export type ManualTradeCommand = {
  id: string;
  action: "BUY" | "SELL";
  symbol: "Volatility 25 Index" | "Volatility 100 Index";
  volume: number;
  accountMode: "demo" | "real";
  createdAt: string;
};

const globalState = globalThis as typeof globalThis & {
  __mt5ConnectionState?: Mt5ConnectionState;
};

const state =
  globalState.__mt5ConnectionState ??
  (globalState.__mt5ConnectionState = {
    lastSeenAt: null,
    payload: null,
    analysis: null,
    ticks: [],
    pendingCommand: null,
  });

state.analysis ??= null;
state.ticks = Array.isArray(state.ticks) ? state.ticks : [];
state.pendingCommand ??= null;

export function markMt5Seen(payload: unknown = null) {
  state.lastSeenAt = Date.now();
  if (payload !== null) state.payload = payload;
  recordTick(payload);
}

export function markMt5Heartbeat(payload: unknown = null) {
  markMt5Seen(payload);
}

export function markMt5Analysis(payload: unknown) {
  state.analysis = payload;
}

export function getMt5ConnectionStatus() {
  const now = Date.now();
  const lastSeenAt = state.lastSeenAt;
  const ageMs = lastSeenAt ? now - lastSeenAt : null;
  const online = ageMs !== null && ageMs <= ONLINE_WINDOW_MS;

  return {
    online,
    lastSeenAt: lastSeenAt ? new Date(lastSeenAt).toISOString() : null,
    ageMs,
    payload: state.payload,
    analysis: state.analysis,
    ticks: Array.isArray(state.ticks) ? state.ticks : [],
    pendingCommand: state.pendingCommand,
  };
}

function recordTick(payload: unknown) {
  if (!payload || typeof payload !== "object") return;
  const data = payload as {
    symbol?: unknown;
    last?: unknown;
    price?: unknown;
    bid?: unknown;
    ask?: unknown;
  };
  const symbol = typeof data.symbol === "string" ? data.symbol : "";
  const rawPrice = typeof data.last === "number" ? data.last : data.price;
  if (!symbol || typeof rawPrice !== "number" || rawPrice <= 0) return;

  const previousTicks = Array.isArray(state.ticks) ? state.ticks : [];
  state.ticks = [
    ...previousTicks,
    {
      symbol,
      price: rawPrice,
      bid: typeof data.bid === "number" ? data.bid : undefined,
      ask: typeof data.ask === "number" ? data.ask : undefined,
      receivedAt: new Date().toISOString(),
    },
  ].slice(-MAX_TICKS);
}

export function queueManualTradeCommand(command: Omit<ManualTradeCommand, "id" | "createdAt">) {
  const nextCommand: ManualTradeCommand = {
    ...command,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(),
  };
  state.pendingCommand = nextCommand;
  return nextCommand;
}

export function consumeManualTradeCommand() {
  const command = state.pendingCommand;
  if (!command) return null;

  const ageMs = Date.now() - Date.parse(command.createdAt);
  state.pendingCommand = null;
  return ageMs <= COMMAND_TTL_MS ? command : null;
}
