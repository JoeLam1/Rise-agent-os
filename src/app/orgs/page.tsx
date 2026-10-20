import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { signOut } from "@/app/actions/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreateOrgForm } from "@/components/forms/org-forms";
import { ROLE_LABELS } from "@/lib/domain/labels";
import { dashboardPath } from "@/lib/domain/roles";
import type { OrgRole, Organization } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Brokerages" };

export default async function OrgsPage({ searchParams }: PageProps<"/orgs">) {
  const { supabase, user } = await requireUser();
  const { data } = await supabase
    .from("memberships")
    .select("role, organization:organizations(id, name, slug, created_at)")
    .eq("user_id", user.id);
  const memberships = ((data ?? []) as unknown as { role: OrgRole; organization: Organization | null }[]).filter(
    (m) => m.organization,
  );

  const { new: showNew } = await searchParams;
  if (memberships.length === 1 && !showNew) {
    const m = memberships[0];
    redirect(dashboardPath(m.organization!.slug, m.role));
  }

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your brokerages</h1>
        <form action={signOut}>
          <Button variant="ghost" size="sm">
            Sign out
          </Button>
        </form>
      </div>

      {memberships.length > 0 ? (
        <ul className="grid gap-3">
          {memberships.map(({ organization: org, role }) => (
            <li key={org!.id}>
              <Link
                href={dashboardPath(org!.slug, role)}
                className="bg-card hover:bg-accent flex items-center justify-between rounded-lg border p-4"
              >
                <span className="font-medium">{org!.name}</span>
                <Badge variant="secondary">{ROLE_LABELS[role]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          You aren&apos;t a member of a brokerage yet. Ask your broker&apos;s admin to add {user.email}, or create a new
          brokerage below.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create a brokerage</CardTitle>
          <CardDescription>You&apos;ll be its first admin and can add brokers and agents.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrgForm />
        </CardContent>
      </Card>
    </main>
  );
}
