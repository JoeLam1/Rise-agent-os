import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { OrgRole, Organization } from "@/lib/domain/types";
import { isBrokerOrAdmin } from "@/lib/domain/roles";

/** The signed-in user, verified with the Supabase Auth server. */
export const requireUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
});

export type OrgContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string | undefined;
  org: Organization;
  role: OrgRole;
};

/**
 * Resolves the organization in the URL and the caller's role in it. RLS hides
 * organizations the user doesn't belong to, so a foreign slug is a 404.
 */
export const requireOrg = cache(async (slug: string): Promise<OrgContext> => {
  const { supabase, user } = await requireUser();
  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, slug, created_at")
    .eq("slug", slug)
    .maybeSingle<Organization>();
  if (!org) notFound();

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle<{ role: OrgRole }>();
  if (!membership) notFound();

  return { supabase, userId: user.id, email: user.email, org, role: membership.role };
});

/** Broker/admin-only pages. Agents are sent to their own dashboard. */
export async function requireBroker(slug: string): Promise<OrgContext> {
  const ctx = await requireOrg(slug);
  if (!isBrokerOrAdmin(ctx.role)) redirect(`/o/${slug}/dashboard/agent`);
  return ctx;
}

export async function requireAdmin(slug: string): Promise<OrgContext> {
  const ctx = await requireOrg(slug);
  if (ctx.role !== "admin") redirect(`/o/${slug}`);
  return ctx;
}
