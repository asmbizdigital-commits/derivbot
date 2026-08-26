import { analyzeSetup, isAnalyzeRequest } from "@/lib/trading-engine";

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-ea-api-key");
  const expected = process.env.EA_API_KEY;
  if (!expected || apiKey !== expected) return Response.json({ error: "EA non authentifié" }, { status: 401 });

  let payload: unknown;
  try { payload = await request.json(); }
  catch { return Response.json({ error: "Corps JSON invalide" }, { status: 400 }); }
  if (!isAnalyzeRequest(payload)) return Response.json({ error: "Données de marché incomplètes" }, { status: 422 });

  const decision = analyzeSetup(payload);
  return Response.json({ decision, generatedAt: new Date().toISOString(), executionMode: "demo" });
}
