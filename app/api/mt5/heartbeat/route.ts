import { markMt5Heartbeat } from "@/lib/mt5-connection";

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-ea-api-key");
  const expected = process.env.EA_API_KEY;
  if (!expected || apiKey !== expected) return Response.json({ error: "EA non authentifié" }, { status: 401 });
  let payload: unknown = null;
  try { payload = await request.json(); } catch { /* heartbeat may be empty */ }
  markMt5Heartbeat(payload);
  return Response.json({ ok: true, receivedAt: new Date().toISOString(), payload });
}
