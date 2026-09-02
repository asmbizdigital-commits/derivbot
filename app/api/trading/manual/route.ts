import {
  getMt5ConnectionStatus,
  queueManualTradeCommand,
} from "@/lib/mt5-connection";

const SYMBOLS = ["Volatility 25 Index", "Volatility 100 Index"] as const;

type ManualTradeRequest = {
  action?: unknown;
  symbol?: unknown;
  volume?: unknown;
  accountMode?: unknown;
};

export async function POST(request: Request) {
  let payload: ManualTradeRequest;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  if (payload.action !== "BUY" && payload.action !== "SELL") {
    return Response.json({ error: "Action invalide" }, { status: 422 });
  }
  if (!SYMBOLS.includes(payload.symbol as (typeof SYMBOLS)[number])) {
    return Response.json({ error: "Symbole non autorisé" }, { status: 422 });
  }
  if (typeof payload.volume !== "number" || payload.volume <= 0) {
    return Response.json({ error: "Lot invalide" }, { status: 422 });
  }
  const requestedAccountMode = payload.accountMode === "real" ? "real" : "demo";

  const mt5 = getMt5ConnectionStatus();
  const mt5Payload = mt5.payload as { demo?: unknown } | null;
  if (!mt5.online) {
    return Response.json({ error: "EA MT5 hors ligne" }, { status: 409 });
  }
  if (typeof mt5Payload?.demo === "boolean") {
    const connectedMode = mt5Payload.demo ? "demo" : "real";
    if (connectedMode !== requestedAccountMode) {
      return Response.json({ error: `Le terminal MT5 connecté est en ${connectedMode === "demo" ? "démo" : "réel"}, pas en ${requestedAccountMode === "demo" ? "démo" : "réel"}` }, { status: 409 });
    }
  }

  const command = queueManualTradeCommand({
    action: payload.action,
    symbol: payload.symbol as (typeof SYMBOLS)[number],
    volume: payload.volume,
    accountMode: requestedAccountMode,
  });

  return Response.json({ ok: true, command });
}
