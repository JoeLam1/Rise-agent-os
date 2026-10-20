import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ReviewStateBadge, ReviewTypeBadge } from "./badges";
import { EmptyState } from "./page-header";
import { formatDateTime } from "@/lib/domain/labels";
import type { ReviewListItem } from "@/lib/data/queries";
import type { Profile } from "@/lib/domain/types";
import { displayName } from "@/lib/data/queries";

export function ReviewTable({
  orgSlug,
  reviews,
  people,
  empty,
  showType = true,
  timeColumn = "requested",
}: {
  orgSlug: string;
  reviews: ReviewListItem[];
  people: Map<string, Profile>;
  empty: string;
  showType?: boolean;
  timeColumn?: "requested" | "decided";
}) {
  if (reviews.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Document</TableHead>
          <TableHead>Property</TableHead>
          {showType ? <TableHead>Type</TableHead> : null}
          <TableHead>State</TableHead>
          <TableHead>{timeColumn === "requested" ? "Requested by" : "Decided by"}</TableHead>
          <TableHead>{timeColumn === "requested" ? "Requested" : "Decided"}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {reviews.map((r) => (
          <TableRow key={r.id}>
            <TableCell>
              <Link className="font-medium underline-offset-4 hover:underline" href={`/o/${orgSlug}/reviews/${r.id}`}>
                {r.version?.document?.title ?? "Document"} · v{r.version?.version_number}
              </Link>
            </TableCell>
            <TableCell className="max-w-64 truncate">{r.transaction?.property_address}</TableCell>
            {showType ? (
              <TableCell>
                <ReviewTypeBadge type={r.review_type} />
              </TableCell>
            ) : null}
            <TableCell>
              <ReviewStateBadge state={r.state} />
            </TableCell>
            <TableCell>
              {displayName(people.get(timeColumn === "requested" ? r.requested_by : (r.decided_by ?? "")))}
            </TableCell>
            <TableCell>{formatDateTime(timeColumn === "requested" ? r.requested_at : r.decided_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
