import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth";
import { listMembers, displayName } from "@/lib/data/queries";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { NewTransactionForm } from "@/components/forms/transaction-forms";
import { isBrokerOrAdmin } from "@/lib/domain/roles";

export const metadata: Metadata = { title: "New transaction" };

export default async function NewTransactionPage({ params }: PageProps<"/o/[org]/transactions/new">) {
  const { org: slug } = await params;
  const { supabase, org, role, userId } = await requireOrg(slug);

  const agents = isBrokerOrAdmin(role)
    ? (await listMembers(supabase, org.id))
        .filter((m) => m.user_id !== userId)
        .map((m) => ({ id: m.user_id, name: displayName(m.profile) }))
    : undefined;

  return (
    <>
      <PageHeader title="New transaction" description="Start a file for a listing, purchase or lease." />
      <Card className="max-w-2xl">
        <CardContent>
          <NewTransactionForm orgSlug={slug} agents={agents} />
        </CardContent>
      </Card>
    </>
  );
}
