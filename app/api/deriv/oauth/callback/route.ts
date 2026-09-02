import { cookies } from "next/headers";
import {
  DERIV_OAUTH_ACCOUNT_ID_COOKIE,
  DERIV_OAUTH_MODE_COOKIE,
  DERIV_OAUTH_STATE_COOKIE,
  DERIV_OAUTH_TOKEN_COOKIE,
  DERIV_OAUTH_TOKEN_URL,
  DERIV_OAUTH_VERIFIER_COOKIE,
  derivOAuthCookieOptions,
  getDerivOAuthClientId,
  getDerivOAuthRedirectUri,
  parseAccountMode,
} from "@/lib/deriv-oauth";

type DerivTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
  error?: unknown;
  error_description?: unknown;
};

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const appUrl = new URL("/", request.url);
  const cookieStore = await cookies();
  const storedState = cookieStore.get(DERIV_OAUTH_STATE_COOKIE)?.value ?? "";
  const verifier = cookieStore.get(DERIV_OAUTH_VERIFIER_COOKIE)?.value ?? "";
  const accountMode = parseAccountMode(cookieStore.get(DERIV_OAUTH_MODE_COOKIE)?.value);
  const returnedState = requestUrl.searchParams.get("state") ?? "";
  const code = requestUrl.searchParams.get("code") ?? "";
  const oauthError = requestUrl.searchParams.get("error") ?? "";
  const legacyAccount = getLegacyOAuthAccount(requestUrl.searchParams, accountMode);

  cookieStore.delete(DERIV_OAUTH_STATE_COOKIE);
  cookieStore.delete(DERIV_OAUTH_VERIFIER_COOKIE);
  cookieStore.delete(DERIV_OAUTH_MODE_COOKIE);

  if (oauthError) {
    appUrl.searchParams.set("deriv_oauth", "error");
    appUrl.searchParams.set("message", requestUrl.searchParams.get("error_description") ?? oauthError);
    return Response.redirect(appUrl, 302);
  }
  if (legacyAccount) {
    if (!storedState || returnedState !== storedState) {
      appUrl.searchParams.set("deriv_oauth", "error");
      appUrl.searchParams.set("message", "Connexion OAuth Deriv expirée ou invalide");
      return Response.redirect(appUrl, 302);
    }
    cookieStore.set(DERIV_OAUTH_TOKEN_COOKIE, legacyAccount.token, { ...derivOAuthCookieOptions, maxAge: 24 * 60 * 60 });
    cookieStore.set(DERIV_OAUTH_ACCOUNT_ID_COOKIE, legacyAccount.accountId, { ...derivOAuthCookieOptions, maxAge: 24 * 60 * 60 });
    appUrl.searchParams.set("deriv_oauth", "connected");
    appUrl.searchParams.set("account_type", accountMode);
    return Response.redirect(appUrl, 302);
  }
  if (!code || !storedState || !verifier || returnedState !== storedState) {
    appUrl.searchParams.set("deriv_oauth", "error");
    appUrl.searchParams.set("message", "Connexion OAuth Deriv expirée ou invalide");
    return Response.redirect(appUrl, 302);
  }

  const clientId = getDerivOAuthClientId();
  if (!clientId) {
    appUrl.searchParams.set("deriv_oauth", "error");
    appUrl.searchParams.set("message", "Client OAuth Deriv non configuré");
    return Response.redirect(appUrl, 302);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: getDerivOAuthRedirectUri(request.url),
  });
  const tokenResponse = await fetch(DERIV_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
    cache: "no-store",
  });
  const data = (await tokenResponse.json().catch(() => null)) as DerivTokenResponse | null;
  const token = typeof data?.access_token === "string" ? data.access_token : "";

  if (!tokenResponse.ok || !token) {
    appUrl.searchParams.set("deriv_oauth", "error");
    appUrl.searchParams.set("message", typeof data?.error_description === "string" ? data.error_description : "Échange OAuth Deriv refusé");
    return Response.redirect(appUrl, 302);
  }

  const expiresIn = typeof data?.expires_in === "number" && Number.isFinite(data.expires_in) ? Math.max(60, Math.trunc(data.expires_in)) : 3600;
  cookieStore.set(DERIV_OAUTH_TOKEN_COOKIE, token, { ...derivOAuthCookieOptions, maxAge: expiresIn });
  cookieStore.delete(DERIV_OAUTH_ACCOUNT_ID_COOKIE);
  appUrl.searchParams.set("deriv_oauth", "connected");
  appUrl.searchParams.set("account_type", accountMode);
  return Response.redirect(appUrl, 302);
}

function getLegacyOAuthAccount(params: URLSearchParams, accountMode: "demo" | "real") {
  const accounts: Array<{ accountId: string; token: string }> = [];
  for (let index = 1; index <= 20; index += 1) {
    const accountId = params.get(`acct${index}`)?.trim() ?? "";
    const token = params.get(`token${index}`)?.trim() ?? "";
    if (accountId && token) accounts.push({ accountId, token });
  }
  return accounts.find((account) => isRequestedAccount(account.accountId, accountMode)) ?? accounts[0] ?? null;
}

function isRequestedAccount(accountId: string, accountMode: "demo" | "real") {
  const isDemo = accountId.toUpperCase().startsWith("VRTC");
  return accountMode === "demo" ? isDemo : !isDemo;
}
