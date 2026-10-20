import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

/**
 * Asks Supabase Auth to email a one-time link to an invited address. For a
 * new address Auth creates an unconfirmed account and sends the confirmation
 * email (invitation wording); for an existing one it sends a sign-in link.
 * Uses the publishable key with no session, so it can't act as the admin and
 * can't touch the admin's cookies. The link goes to /auth/confirm (see
 * supabase/templates/magic_link.html); confirming the address is what turns
 * the stored invitation into a membership (public.invitations).
 */
export async function sendInviteEmail(email: string): Promise<boolean> {
  const { url, key } = supabaseEnv();
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { error } = await client.auth.signInWithOtp({
    email,
    // Picks the invitation wording in supabase/templates/confirmation.html.
    options: { shouldCreateUser: true, data: { invited_to_rise: true } },
  });
  return !error;
}
