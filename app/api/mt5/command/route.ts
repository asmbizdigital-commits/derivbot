import { consumeManualTradeCommand } from "@/lib/mt5-connection";

export async function GET(request: Request) {
  const apiKey = request.headers.get("x-ea-api-key");
  const expected = process.env.EA_API_KEY;
  if (!expected || apiKey !== expected) {
    return Response.json({ error: "EA non authentifié" }, { status: 401 });
  }

  return Response.json({ command: consumeManualTradeCommand() });
}
