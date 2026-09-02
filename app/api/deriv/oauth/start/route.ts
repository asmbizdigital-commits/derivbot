import { cookies } from "next/headers";
import {
  DERIV_OAUTH_AUTH_URL,
  DERIV_LEGACY_OAUTH_AUTH_URL,
  DERIV_OAUTH_MODE_COOKIE,
  DERIV_OAUTH_STATE_COOKIE,
  DERIV_OAUTH_VERIFIER_COOKIE,
  createOAuthState,
  createPkcePair,
  derivOAuthCookieOptions,
  getDerivLegacyAppId,
  getDerivOAuthClientId,
  getDerivOAuthRedirectUri,
  parseAccountMode,
} from "@/lib/deriv-oauth";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const accountMode = parseAccountMode(requestUrl.searchParams.get("accountType"));
  const flow = requestUrl.searchParams.get("flow") === "legacy" ? "legacy" : "pkce";
  const state = createOAuthState();
  const { verifier, challenge } = createPkcePair();
  const redirectUri = getDerivOAuthRedirectUri(request.url);

  const cookieStore = await cookies();
  cookieStore.set(DERIV_OAUTH_STATE_COOKIE, state, { ...derivOAuthCookieOptions, maxAge: 10 * 60 });
  cookieStore.set(DERIV_OAUTH_MODE_COOKIE, accountMode, { ...derivOAuthCookieOptions, maxAge: 10 * 60 });

  if (flow === "legacy") {
    const appId = getDerivLegacyAppId();
    if (!appId) {
      return Response.json({ error: "DERIV_LEGACY_APP_ID ou DERIV_APP_ID doit être configuré côté serveur" }, { status: 500 });
    }
    const legacyAuthUrl = new URL(DERIV_LEGACY_OAUTH_AUTH_URL);
    legacyAuthUrl.searchParams.set("app_id", appId);
    legacyAuthUrl.searchParams.set("state", state);
    return Response.redirect(legacyAuthUrl, 302);
  }

  const clientId = getDerivOAuthClientId();
  if (!clientId) {
    return Response.json({ error: "DERIV_OAUTH_CLIENT_ID ou DERIV_APP_ID doit être configuré côté serveur" }, { status: 500 });
  }
  cookieStore.set(DERIV_OAUTH_VERIFIER_COOKIE, verifier, { ...derivOAuthCookieOptions, maxAge: 10 * 60 });

  const authUrl = new URL(DERIV_OAUTH_AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", "trade");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  return Response.redirect(authUrl, 302);
}
