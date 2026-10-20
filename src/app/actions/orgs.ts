"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/domain/db-errors";
import type { ActionState } from "./state";

const orgSchema = z.object({
  name: z.string().trim().min(2, "Name is too short.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/, "Use 3–63 lowercase letters, numbers or dashes."),
});

export async function createOrganization(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = orgSchema.safeParse({ name: formData.get("name"), slug: formData.get("slug") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supabase } = await requireUser();
  const { error } = await supabase.rpc("create_organization", { p_name: parsed.data.name, p_slug: parsed.data.slug });
  if (error) {
    return { error: error.code === "23505" ? "That URL name is taken." : friendlyDbError(error) };
  }
  redirect(`/o/${parsed.data.slug}`);
}

const memberSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  role: z.enum(["agent", "broker", "admin"]),
});

export async function addMember(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = memberSchema.safeParse({ email: formData.get("email"), role: formData.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supabase, org } = await requireAdmin(orgSlug);
  const { error } = await supabase.rpc("add_org_member", {
    p_org: org.id,
    p_email: parsed.data.email,
    p_role: parsed.data.role,
  });
  if (error) {
    if (error.code === "P0002") return { error: "No account exists for that email yet. Ask them to sign up first." };
    if (error.code === "23505") return { error: "That person is already a member." };
    return { error: friendlyDbError(error) };
  }
  revalidatePath(`/o/${orgSlug}/members`);
  return { message: `Added ${parsed.data.email}.` };
}

export async function setAiReview(orgSlug: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const enabled = formData.get("enabled") === "true";
  const { supabase, org } = await requireAdmin(orgSlug);
  const { error } = await supabase.rpc("set_ai_review", { p_org: org.id, p_enabled: enabled });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath(`/o/${orgSlug}`, "layout");
  return { message: enabled ? "AI review is on for new review requests." : "AI review is off. New requests use the mock." };
}
