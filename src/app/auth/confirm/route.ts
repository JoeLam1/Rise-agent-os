import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/domain/redirects";

const ALLOWED_TYPES: EmailOtpType[] = ["email", "signup", "magiclink", "recovery", "invite", "email_change"];

/**
 * Landing page for links in Supabase Auth emails (invite / sign-in, signup
 * confirmation, password recovery). The token is verified on the server and
 * the session cookie is set before redirecting.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type)) return redirectTo("/login?error=link");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return redirectTo("/login?error=link");
  return redirectTo(next);
}

// A relative Location keeps the browser on the host it used, so the session
// cookie set here is sent on the next request. (request.url can name a
// different host, e.g. localhost vs 127.0.0.1, behind a proxy or in dev.)
function redirectTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}
