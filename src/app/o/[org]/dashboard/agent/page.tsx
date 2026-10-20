import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { listReviews, listTransactions, profilesById } from "@/lib/data/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/app/page-header";
import { TransactionTable } from "@/components/app/transaction-table";
import { ReviewTable } from "@/components/app/review-table";

export const metadata: Metadata = { title: "Agent dashboard" };

export default async function AgentDashboard({ params }: PageProps<"/o/[org]/dashboard/agent">) {
  const { org: slug } = await params;
  const { supabase, org, userId } = await requireOrg(slug);

  const [transactions, myReviews] = await Promise.all([
    listTransactions(supabase, org.id, { agentId: userId }),
    listReviews(supabase, org.id, { requestedBy: userId }),
  ]);
  const open = transactions.filter((t) => t.status !== "closed" && t.status !== "cancelled");
  const awaiting = myReviews.filter((r) => r.state === "ready_for_broker" || r.state === "pending_analysis");
  const needsChanges = myReviews.filter((r) => r.state === "changes_requested");
  const people = await profilesById(supabase, myReviews.map((r) => r.requested_by));

  return (
    <>
      <PageHeader
        title="My dashboard"
        description="Your transactions and the documents you've sent for broker review."
        actions={
          <Button asChild>
            <Link href={`/o/${slug}/transactions/new`}>New transaction</Link>
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Open transactions" value={open.length} href={`/o/${slug}/transactions`} />
        <StatCard label="Awaiting broker review" value={awaiting.length} />
        <StatCard label="Changes requested" value={needsChanges.length} />
      </div>
      {needsChanges.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Changes requested</CardTitle>
          </CardHeader>
          <CardContent>
            <ReviewTable orgSlug={slug} reviews={needsChanges} people={people} empty="" />
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>Open transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionTable
            orgSlug={slug}
            transactions={open}
            empty={
              <>
                No open transactions. <Link className="underline" href={`/o/${slug}/transactions/new`}>Create one</Link>.
              </>
            }
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Awaiting broker review</CardTitle>
        </CardHeader>
        <CardContent>
          <ReviewTable orgSlug={slug} reviews={awaiting} people={people} empty="Nothing is waiting on your broker." />
        </CardContent>
      </Card>
    </>
  );
}
