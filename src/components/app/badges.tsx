import { Badge } from "@/components/ui/badge";
import { REVIEW_STATE_LABELS, REVIEW_TYPE_LABELS, STATUS_LABELS } from "@/lib/domain/labels";
import type { ReviewState, ReviewType, TransactionStatus } from "@/lib/domain/types";
import type { DueState } from "@/lib/domain/schedule";

const REVIEW_VARIANT: Record<ReviewState, React.ComponentProps<typeof Badge>["variant"]> = {
  pending_analysis: "secondary",
  ready_for_broker: "warning",
  changes_requested: "warning",
  approved: "success",
  rejected: "destructive",
  withdrawn: "outline",
};

export function ReviewStateBadge({ state }: { state: ReviewState }) {
  return <Badge variant={REVIEW_VARIANT[state]}>{REVIEW_STATE_LABELS[state]}</Badge>;
}

export function ReviewTypeBadge({ type }: { type: ReviewType }) {
  return <Badge variant="outline">{REVIEW_TYPE_LABELS[type]}</Badge>;
}

export function TransactionStatusBadge({ status }: { status: TransactionStatus }) {
  return (
    <Badge variant={status === "cancelled" ? "outline" : status === "closed" ? "secondary" : "default"}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export function MockBadge() {
  return (
    <Badge variant="warning" title="Placeholder output. The document was not analyzed.">
      Mock analysis
    </Badge>
  );
}

const DUE_VARIANT: Record<DueState["kind"], React.ComponentProps<typeof Badge>["variant"]> = {
  done: "success",
  overdue: "destructive",
  today: "warning",
  soon: "secondary",
  later: "outline",
};

export function DueBadge({ due }: { due: DueState }) {
  return <Badge variant={DUE_VARIANT[due.kind]}>{due.label}</Badge>;
}
