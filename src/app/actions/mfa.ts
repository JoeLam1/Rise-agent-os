"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/domain/redirects";
import { friendlyDbError } from "@/lib/domain/db-errors";
import type { ActionState } from "./state";

const code = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

export type EnrollState = ActionState & { factorId?: string; qrCode?: string; secret?: string };

/**
 * Starts adding an authenticator app. Leftover unverified factors from an
 * abandoned attempt are removed first so a fresh QR code can be issued.
 */
export async function startTotpEnrollment(): Promise<EnrollState> {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect("/login");

  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) {
    if (f.factor_type === "totp" && f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
  if (error || !data) return { error: "Couldn't start two-step sign-in setup. Please try again." };
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/** Confirms the first code from a newly added app. The session becomes aal2. */
export async function confirmTotpEnrollment(factorId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = code.safeParse(formData.get("code"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: parsed.data });
  if (error) return { error: "That code didn't match. Check the time on your phone and try the newest code." };
  return { message: "Two-step sign-in is on." };
}

export type BackupCodesState = ActionState & { codes?: string[] };

/** New backup codes replace the old ones. Shown once; only hashes are stored. */
export async function createBackupCodes(): Promise<BackupCodesState> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_backup_codes");
  if (error) return { error: friendlyDbError(error) };
  return { codes: data as string[] };
}

/**
 * Lost phone: a backup code removes the authenticator app so a new one can be
 * set up. The session is refreshed so it no longer expects a code.
 */
export async function redeemBackupCode(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const value = String(formData.get("backupCode") ?? "").trim();
  if (!value) return { error: "Enter one of your backup codes." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("use_backup_code", { p_code: value });
  if (error) {
    return { error: error.code === "54000" ? "Too many tries. Wait 15 minutes and try again." : friendlyDbError(error) };
  }
  if (!data) return { error: "That backup code didn't work. Each code works once." };
  await supabase.auth.refreshSession();
  redirect("/account/security?reset=1");
}

/** Second step of signing in for accounts that have an authenticator app. */
export async function verifyTotp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = code.safeParse(formData.get("code"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp[0];
  if (!factor) redirect("/orgs");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: parsed.data });
  if (error) return { error: "That code didn't match. Try the newest code from your app." };
  redirect(safeNext(formData.get("next")));
}
