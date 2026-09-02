import crypto from "node:crypto";

export const DERIV_OAUTH_AUTH_URL = "https://auth.deriv.com/oauth2/auth";
export const DERIV_LEGACY_OAUTH_AUTH_URL = "https://oauth.deriv.com/oauth2/authorize";
export const DERIV_OAUTH_TOKEN_URL = "https://auth.deriv.com/oauth2/token";
export const DERIV_OAUTH_TOKEN_COOKIE = "deriv_oauth_access_token";
export const DERIV_OAUTH_ACCOUNT_ID_COOKIE = "deriv_oauth_account_id";
export const DERIV_OAUTH_STATE_COOKIE = "deriv_oauth_state";
export const DERIV_OAUTH_VERIFIER_COOKIE = "deriv_oauth_code_verifier";
export const DERIV_OAUTH_MODE_COOKIE = "deriv_oauth_account_mode";

export type DerivAccountMode = "demo" | "real";

export function getDerivOAuthClientId() {
  return process.env.DERIV_OAUTH_CLIENT_ID?.trim() || process.env.DERIV_APP_ID?.trim() || "";
}

export function getDerivLegacyAppId() {
  return process.env.DERIV_LEGACY_APP_ID?.trim() || process.env.DERIV_APP_ID?.trim() || "";
}

export function getDerivOAuthRedirectUri(requestUrl: string) {
  const configuredRedirectUri = process.env.DERIV_OAUTH_REDIRECT_URI?.trim();
  if (configuredRedirectUri) return configuredRedirectUri;

  const url = new URL(requestUrl);
  return `${url.origin}/deriv-oauth/callback`;
}

export function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(64));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOAuthState() {
  return base64Url(crypto.randomBytes(32));
}

export function parseAccountMode(value: unknown): DerivAccountMode {
  return value === "real" ? "real" : "demo";
}

export const derivOAuthCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function base64Url(input: Buffer) {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
