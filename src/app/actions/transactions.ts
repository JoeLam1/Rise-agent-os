"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOrg } from "@/lib/auth";
import { friendlyDbError } from "@/lib/domain/db-errors";
import { isBrokerOrAdmin } from "@/lib/domain/roles";
import type { ActionState } from "./state";

const transactionSchema = z.object({
  propertyAddress: z.string().trim().min(3, "Enter the property address.").max(300),
  propertyCity: z.string().trim().max(120).optional(),
  side: z.enum(["buyer", "seller", "dual", "landlord", "tenant"]),
  expectedCloseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(2000).optional(),
  agentId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
});

export async function createTransaction(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = transactionSchema.safeParse({
    propertyAddress: formData.get("propertyAddress"),
    propertyCity: formData.get("propertyCity") || undefined,
    side: formData.get("side"),
    expectedCloseDate: formData.get("expectedCloseDate") ?? "",
    notes: formData.get("notes") || undefined,
    agentId: formData.get("agentId") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supabase, org, userId, role } = await requireOrg(orgSlug);
  // Agents always own what they create; brokers may assign another agent.
  const agentId = isBrokerOrAdmin(role) && parsed.data.agentId ? parsed.data.agentId : userId;

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      org_id: org.id,
      agent_id: agentId,
      created_by: userId,
      property_address: parsed.data.propertyAddress,
      property_city: parsed.data.propertyCity ?? null,
      side: parsed.data.side,
      expected_close_date: parsed.data.expectedCloseDate ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(`/o/${orgSlug}`, "layout");
  redirect(`/o/${orgSlug}/transactions/${data.id}`);
}

const statusSchema = z.enum(["draft", "active", "under_contract", "closed", "cancelled"]);

export async function updateTransactionStatus(
  orgSlug: string,
  transactionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const status = statusSchema.safeParse(formData.get("status"));
  if (!status.success) return { error: "Choose a valid status." };

  const { supabase, org } = await requireOrg(orgSlug);
  const { data, error } = await supabase
    .from("transactions")
    .update({ status: status.data })
    .eq("org_id", org.id)
    .eq("id", transactionId)
    .select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "You don't have permission to change this transaction." };

  revalidatePath(`/o/${orgSlug}/transactions/${transactionId}`);
  return { message: "Status updated." };
}

const keyDateSchema = z
  .object({
    kind: z.enum(["attorney_review_end", "inspection", "mortgage_commitment", "appraisal", "closing", "other"]),
    label: z.string().trim().max(120).optional(),
    dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date."),
  })
  .refine((d) => d.kind !== "other" || d.label, { message: "Describe the date.", path: ["label"] });

export async function addKeyDate(
  orgSlug: string,
  transactionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = keyDateSchema.safeParse({
    kind: formData.get("kind"),
    label: formData.get("label") || undefined,
    dueOn: formData.get("dueOn"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supabase, org } = await requireOrg(orgSlug);
  const { error } = await supabase.from("transaction_dates").insert({
    org_id: org.id,
    transaction_id: transactionId,
    kind: parsed.data.kind,
    label: parsed.data.label ?? null,
    due_on: parsed.data.dueOn,
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(`/o/${orgSlug}`, "layout");
  return { message: "Date added." };
}

/** Marks a key date done (the database stamps who and when) or reopens it. */
export async function setKeyDateDone(orgSlug: string, id: string, done: boolean): Promise<void> {
  const { supabase, org } = await requireOrg(orgSlug);
  const { error } = await supabase
    .from("transaction_dates")
    .update({ completed_at: done ? new Date().toISOString() : null })
    .eq("org_id", org.id)
    .eq("id", id);
  if (error) throw new Error(`Could not update the date: ${error.message}`);
  revalidatePath(`/o/${orgSlug}`, "layout");
}

export async function deleteKeyDate(orgSlug: string, id: string): Promise<void> {
  const { supabase, org } = await requireOrg(orgSlug);
  const { error } = await supabase.from("transaction_dates").delete().eq("org_id", org.id).eq("id", id);
  if (error) throw new Error(`Could not remove the date: ${error.message}`);
  revalidatePath(`/o/${orgSlug}`, "layout");
}
