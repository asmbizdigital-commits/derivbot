import { cookies } from "next/headers";
import { DERIV_OAUTH_ACCOUNT_ID_COOKIE, DERIV_OAUTH_TOKEN_COOKIE } from "@/lib/deriv-oauth";

export async function DELETE() {
  const cookieStore = await cookies();
  cookieStore.delete(DERIV_OAUTH_TOKEN_COOKIE);
  cookieStore.delete(DERIV_OAUTH_ACCOUNT_ID_COOKIE);
  return Response.json({ ok: true });
}
