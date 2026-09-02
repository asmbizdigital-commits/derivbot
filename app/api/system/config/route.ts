import { CONFIG, updateTradingConfig } from "@/lib/trading-engine";

type ConfigPayload = {
  referenceCapitalUsd?: unknown;
  maxRiskUsd?: unknown;
  minScore?: unknown;
};

export async function POST(request: Request) {
  let payload: ConfigPayload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const referenceCapitalUsd = Number(payload.referenceCapitalUsd);
  const maxRiskUsd = Number(payload.maxRiskUsd);
  const minScore = Number(payload.minScore);

  if (!Number.isFinite(referenceCapitalUsd) || referenceCapitalUsd < 10 || referenceCapitalUsd > 1_000_000) {
    return Response.json({ error: "Capital de référence invalide" }, { status: 422 });
  }
  if (!Number.isFinite(maxRiskUsd) || maxRiskUsd <= 0 || maxRiskUsd > referenceCapitalUsd) {
    return Response.json({ error: "Risque maximal invalide" }, { status: 422 });
  }
  if (!Number.isFinite(minScore) || minScore < 50 || minScore > 100) {
    return Response.json({ error: "Le seuil IA doit être compris entre 50 et 100" }, { status: 422 });
  }

  const config = updateTradingConfig({ referenceCapitalUsd, maxRiskUsd, minScore: Math.round(minScore) });
  return Response.json({ ok: true, config });
}

export async function GET() {
  return Response.json({ config: CONFIG });
}
