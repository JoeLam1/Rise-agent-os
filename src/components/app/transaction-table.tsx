import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TransactionStatusBadge } from "./badges";
import { EmptyState } from "./page-header";
import { SIDE_LABELS, formatDate } from "@/lib/domain/labels";
import type { Profile, Transaction } from "@/lib/domain/types";
import { displayName } from "@/lib/data/queries";

export function TransactionTable({
  orgSlug,
  transactions,
  people,
  showAgent,
  empty,
}: {
  orgSlug: string;
  transactions: Transaction[];
  people?: Map<string, Profile>;
  showAgent?: boolean;
  empty: React.ReactNode;
}) {
  if (transactions.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Property</TableHead>
          <TableHead>Representing</TableHead>
          <TableHead>Status</TableHead>
          {showAgent ? <TableHead>Agent</TableHead> : null}
          <TableHead>Expected close</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {transactions.map((t) => (
          <TableRow key={t.id}>
            <TableCell>
              <Link className="font-medium underline-offset-4 hover:underline" href={`/o/${orgSlug}/transactions/${t.id}`}>
                {t.property_address}
              </Link>
              {t.property_city ? <span className="text-muted-foreground">, {t.property_city}</span> : null}
            </TableCell>
            <TableCell>{SIDE_LABELS[t.side]}</TableCell>
            <TableCell>
              <TransactionStatusBadge status={t.status} />
            </TableCell>
            {showAgent ? <TableCell>{displayName(people?.get(t.agent_id))}</TableCell> : null}
            <TableCell>{formatDate(t.expected_close_date)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
