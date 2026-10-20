import type { Metadata } from "next";
import Link from "next/link";
import { requireOrg } from "@/lib/auth";
import { listTransactions, profilesById } from "@/lib/data/queries";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { TransactionTable } from "@/components/app/transaction-table";
import { STATUS_LABELS } from "@/lib/domain/labels";
import { isBrokerOrAdmin } from "@/lib/domain/roles";
import type { TransactionStatus } from "@/lib/domain/types";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage({ params, searchParams }: PageProps<"/o/[org]/transactions">) {
  const { org: slug } = await params;
  const { status } = await searchParams;
  const { supabase, org, role } = await requireOrg(slug);

  const filter = typeof status === "string" && status in STATUS_LABELS ? (status as TransactionStatus) : undefined;
  // RLS limits agents to their own transactions; brokers and admins see all.
  const transactions = await listTransactions(supabase, org.id, { status: filter });
  const broker = isBrokerOrAdmin(role);
  const people = broker ? await profilesById(supabase, transactions.map((t) => t.agent_id)) : undefined;

  return (
    <>
      <PageHeader
        title="Transactions"
        description={broker ? "Every transaction in the brokerage." : "Transactions where you are the agent."}
        actions={
          <Button asChild>
            <Link href={`/o/${slug}/transactions/new`}>New transaction</Link>
          </Button>
        }
      />
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Filter by status">
        <Link href={`/o/${slug}/transactions`} className={!filter ? "font-semibold underline" : "underline-offset-4 hover:underline"}>
          All
        </Link>
        {(Object.keys(STATUS_LABELS) as TransactionStatus[]).map((s) => (
          <Link
            key={s}
            href={`/o/${slug}/transactions?status=${s}`}
            className={filter === s ? "font-semibold underline" : "underline-offset-4 hover:underline"}
          >
            {STATUS_LABELS[s]}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent>
          <TransactionTable
            orgSlug={slug}
            transactions={transactions}
            people={people}
            showAgent={broker}
            empty="No transactions match."
          />
        </CardContent>
      </Card>
    </>
  );
}
