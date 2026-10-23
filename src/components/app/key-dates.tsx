import Link from "next/link";
import { deleteKeyDate, setKeyDateDone } from "@/app/actions/transactions";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DueBadge } from "@/components/app/badges";
import { EmptyState } from "@/components/app/page-header";
import type { UpcomingDate } from "@/lib/data/queries";
import { formatDate } from "@/lib/domain/labels";
import { KEY_DATE_LABELS, dueState } from "@/lib/domain/schedule";
import type { TransactionDate } from "@/lib/domain/types";

const what = (d: TransactionDate) =>
  d.kind === "other" ? (d.label ?? "Other") : d.label ? `${KEY_DATE_LABELS[d.kind]}: ${d.label}` : KEY_DATE_LABELS[d.kind];

/** A transaction's key dates, with done / reopen / remove. */
export function KeyDateList({ orgSlug, dates, today }: { orgSlug: string; dates: TransactionDate[]; today: string }) {
  if (dates.length === 0) return <EmptyState>No key dates yet.</EmptyState>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Due</TableHead>
          <TableHead>What</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {dates.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="tabular-nums">{formatDate(d.due_on)}</TableCell>
            <TableCell>{what(d)}</TableCell>
            <TableCell>
              <DueBadge due={dueState(d.due_on, Boolean(d.completed_at), today)} />
            </TableCell>
            <TableCell className="text-right">
              <div className="flex justify-end gap-2">
                <form action={setKeyDateDone.bind(null, orgSlug, d.id, !d.completed_at)}>
                  <Button type="submit" size="sm" variant="outline" aria-label={`${d.completed_at ? "Reopen" : "Mark done"}: ${what(d)}`}>
                    {d.completed_at ? "Reopen" : "Mark done"}
                  </Button>
                </form>
                <form action={deleteKeyDate.bind(null, orgSlug, d.id)}>
                  <Button type="submit" size="sm" variant="ghost" aria-label={`Remove: ${what(d)}`}>
                    Remove
                  </Button>
                </form>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** Open dates across transactions, for the dashboards. */
export function UpcomingDates({ orgSlug, dates, today }: { orgSlug: string; dates: UpcomingDate[]; today: string }) {
  if (dates.length === 0) return <EmptyState>Nothing due in the next two weeks.</EmptyState>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Due</TableHead>
          <TableHead>What</TableHead>
          <TableHead>Transaction</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {dates.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="tabular-nums">{formatDate(d.due_on)}</TableCell>
            <TableCell>{what(d)}</TableCell>
            <TableCell>
              <Link className="underline underline-offset-4" href={`/o/${orgSlug}/transactions/${d.transaction_id}`}>
                {d.transaction?.property_address}
              </Link>
            </TableCell>
            <TableCell>
              <DueBadge due={dueState(d.due_on, false, today)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
