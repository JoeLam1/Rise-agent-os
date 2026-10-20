import type { Metadata } from "next";
import Link from "next/link";
import { requireBroker } from "@/lib/auth";
import { listAudit, listRecentDecisions, listReviews, listTransactions, profilesById, displayName } from "@/lib/data/queries";
import { Card, CardContent, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/app/page-header";
import { ReviewTable } from "@/components/app/review-table";
import { STATUS_LABELS, formatDateTime } from "@/lib/domain/labels";
import type { TransactionStatus } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Broker dashboard" };

export default async function BrokerDashboard({ params }: PageProps<"/o/[org]/dashboard/broker">) {
  const { org: slug } = await params;
  const { supabase, org } = await requireBroker(slug);

  const [transactions, waiting, decisions, audit] = await Promise.all([
    listTransactions(supabase, org.id),
    listReviews(supabase, org.id, { states: ["ready_for_broker"] }),
    listRecentDecisions(supabase, org.id, 8),
    listAudit(supabase, org.id, { limit: 8 }),
  ]);
  const people = await profilesById(supabase, [
    ...waiting.map((r) => r.requested_by),
    ...decisions.map((r) => r.decided_by),
    ...audit.map((a) => a.actor_id),
  ]);
  const preSig = waiting.filter((r) => r.review_type === "pre_signature");
  const postExec = waiting.filter((r) => r.review_type === "post_execution");
  const byStatus = transactions.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader title="Broker dashboard" description={`Compliance review and transaction oversight for ${org.name}.`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pre-signature queue" value={preSig.length} href={`/o/${slug}/queues/pre-signature`} />
        <StatCard label="Post-execution queue" value={postExec.length} href={`/o/${slug}/queues/post-execution`} />
        <StatCard label="Active transactions" value={(byStatus.active ?? 0) + (byStatus.under_contract ?? 0)} href={`/o/${slug}/transactions`} />
        <StatCard label="All transactions" value={transactions.length} href={`/o/${slug}/transactions`} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Awaiting your decision</CardTitle>
        </CardHeader>
        <CardContent>
          <ReviewTable orgSlug={slug} reviews={waiting} people={people} empty="No reviews are waiting." />
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent decisions</CardTitle>
          </CardHeader>
          <CardContent>
            <ReviewTable
              orgSlug={slug}
              reviews={decisions}
              people={people}
              timeColumn="decided"
              empty="No decisions yet."
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardAction>
              <Button asChild variant="link" size="sm">
                <Link href={`/o/${slug}/audit`}>Full audit log</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm">
              {audit.map((a) => (
                <li key={a.id} className="flex justify-between gap-4">
                  <span>
                    <span className="font-medium">{a.actor_id ? displayName(people.get(a.actor_id)) : "System"}</span>{" "}
                    <span className="text-muted-foreground">{a.action}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0">{formatDateTime(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Transactions by status</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-6 text-sm">
          {(Object.keys(STATUS_LABELS) as TransactionStatus[]).map((s) => (
            <div key={s}>
              <p className="text-muted-foreground">{STATUS_LABELS[s]}</p>
              <p className="text-xl font-semibold tabular-nums">{byStatus[s] ?? 0}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}
