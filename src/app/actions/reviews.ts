"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrg } from "@/lib/auth";
import { friendlyDbError } from "@/lib/domain/db-errors";
import { decisionNeedsNote, isDecision } from "@/lib/domain/review-state";
import type { ActionState } from "./state";

export async function requestReview(
  orgSlug: string,
  transactionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const versionId = z.string().uuid().safeParse(formData.get("versionId"));
  const type = z.enum(["pre_signature", "post_execution"]).safeParse(formData.get("reviewType"));
  if (!versionId.success || !type.success) return { error: "Choose a document version and review type." };

  const { supabase } = await requireOrg(orgSlug);
  const { data, error } = await supabase
    .rpc("request_review", { p_document_version: versionId.data, p_review_type: type.data })
    .single<{ id: string }>();
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(`/o/${orgSlug}`, "layout");
  redirect(`/o/${orgSlug}/reviews/${data.id}`);
}

export async function decideReview(orgSlug: string, reviewId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const decision = formData.get("decision");
  const note = String(formData.get("note") ?? "").trim();
  if (!isDecision(decision)) return { error: "Choose a decision." };
  if (decisionNeedsNote(decision) && !note) {
    return { error: "Add a note explaining what needs to change." };
  }

  const { supabase } = await requireOrg(orgSlug);
  const { error } = await supabase.rpc("decide_review", { p_review: reviewId, p_decision: decision, p_note: note || null });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(`/o/${orgSlug}`, "layout");
  return { message: "Decision recorded." };
}

export async function withdrawReview(orgSlug: string, reviewId: string): Promise<ActionState> {
  const { supabase } = await requireOrg(orgSlug);
  const { error } = await supabase.rpc("withdraw_review", { p_review: reviewId });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/o/${orgSlug}`, "layout");
  return { message: "Review withdrawn." };
}
