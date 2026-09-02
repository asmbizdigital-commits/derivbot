import { cookies } from "next/headers";
import { DERIV_OAUTH_ACCOUNT_ID_COOKIE, DERIV_OAUTH_TOKEN_COOKIE, getDerivOAuthClientId, getDerivOAuthRedirectUri } from "@/lib/deriv-oauth";

type ConnectPayload = {
  accountId?: unknown;
  appId?: unknown;
  token?: unknown;
  accountType?: unknown;
};

export async function POST(request: Request) {
  let payload: ConnectPayload;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const appId = getDerivOAuthClientId();
  const cookieStore = await cookies();
  let accountId = (typeof payload.accountId === "string" ? payload.accountId.trim() : "") || cookieStore.get(DERIV_OAUTH_ACCOUNT_ID_COOKIE)?.value || process.env.DERIV_OPTIONS_ACCOUNT_ID?.trim() || "";
  const token = cookieStore.get(DERIV_OAUTH_TOKEN_COOKIE)?.value || process.env.DERIV_API?.trim() || "";
  const requestedAccountType = payload.accountType === "real" ? "real" : "demo";

  if (!appId || appId.length > 128) {
    return Response.json({ error: "Deriv App ID invalide" }, { status: 422 });
  }
  if (!token || token.length > 4096) {
    return Response.json({ error: "Jeton OAuth Deriv manquant" }, { status: 422 });
  }

  const authHeaders = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "Deriv-App-ID": appId,
  };
  const accountsResponse = await fetch("https://api.derivws.com/trading/v1/options/accounts", { headers: authHeaders, cache: "no-store" });
  const accountsData = await accountsResponse.json().catch(() => null) as { data?: Array<{ account_id?: unknown; account_type?: unknown }> } | null;
  if (!accountsResponse.ok) {
    return Response.json({ error: "Le jeton Deriv ou l’App ID est invalide" }, { status: accountsResponse.status });
  }
  const selectedAccount = accountsData?.data?.find((account) => account.account_type === requestedAccountType && typeof account.account_id === "string" && (!accountId || account.account_id === accountId));
  accountId = typeof selectedAccount?.account_id === "string" ? selectedAccount.account_id : "";
  if (!accountId) {
    return Response.json({ error: `Aucun compte Deriv Options ${requestedAccountType === "demo" ? "démo" : "réel"} disponible` }, { status: 422 });
  }

  const response = await fetch(`https://api.derivws.com/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: "POST",
    headers: authHeaders,
    cache: "no-store",
  });

  const data = await response.json().catch(() => null) as { url?: unknown; data?: { url?: unknown }; message?: unknown } | null;
  if (!response.ok) {
    return Response.json({ error: typeof data?.message === "string" ? data.message : "Connexion Deriv refusée" }, { status: response.status });
  }

  const url = typeof data?.data?.url === "string" ? data.data.url : typeof data?.url === "string" ? data.url : "";
  let validUrl = false;
  try {
    const parsed = new URL(url);
    validUrl = parsed.protocol === "wss:" && parsed.hostname === "api.derivws.com" && parsed.pathname.startsWith("/trading/v1/options/ws/") && parsed.searchParams.has("otp");
  } catch {
    validUrl = false;
  }
  if (!validUrl) {
    return Response.json({ error: "URL de session Deriv invalide" }, { status: 403 });
  }

  return Response.json({ ok: true, url, accountId, accountType: requestedAccountType });
}

export async function GET(request: Request) {
  const tokenConfigured = Boolean(process.env.DERIV_API?.trim());
  const appIdConfigured = Boolean(getDerivOAuthClientId());
  return Response.json({
    tokenConfigured,
    appIdConfigured,
    accountIdConfigured: Boolean(process.env.DERIV_OPTIONS_ACCOUNT_ID?.trim()),
    accountAutoDiscovery: appIdConfigured,
    oauthConfigured: appIdConfigured,
    oauthSessionActive: Boolean((await cookies()).get(DERIV_OAUTH_TOKEN_COOKIE)?.value),
    oauthRedirectUri: getDerivOAuthRedirectUri(request.url),
  });
}
