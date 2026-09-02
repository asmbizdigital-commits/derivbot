import { CONFIG } from "@/lib/trading-engine";
import { getMt5ConnectionStatus } from "@/lib/mt5-connection";

export async function GET() {
  const mt5 = getMt5ConnectionStatus();

  return Response.json({
    status: "ready",
    executionEnabled: false,
    reason: mt5.online ? "EA MT5 connecté" : "EA MT5 non connecté",
    config: CONFIG,
    mt5,
    version: "0.3.0",
  });
}
