import { CONFIG } from "@/lib/trading-engine";
export async function GET() {
  return Response.json({
    status: "ready",
    executionEnabled: false,
    reason: "EA MT5 non connecté",
    config: CONFIG,
    version: "0.2.0",
  });
}
