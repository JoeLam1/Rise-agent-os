import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { getReview, listAnalysisRuns, listAudit, profilesById, displayName } from "@/lib/data/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { ReviewStateBadge, ReviewTypeBadge } from "@/components/app/badges";
import { AnalysisPanel } from "@/components/app/analysis-panel";
import { DecisionForm, WithdrawForm } from "@/components/forms/review-forms";
import { DOCUMENT_KIND_LABELS, formatBytes, formatDateTime } from "@/lib/domain/labels";
import { canDecideReview, canWithdrawReview, isBrokerOrAdmin } from "@/lib/domain/roles";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage({ params }: PageProps<"/o/[org]/reviews/[id]">) {
  const { org: slug, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { supabase, org, role, userId } = await requireOrg(slug);

  const review = await getReview(supabase, org.id, id);
  if (!review || !review.version) notFound();

  const [runs, audit] = await Promise.all([
    listAnalysisRuns(supabase, review.id),
    isBrokerOrAdmin(role) ? listAudit(supabase, org.id, { entityIds: [review.id] }) : Promise.resolve([]),
  ]);
  const people = await profilesById(supabase, [
    review.requested_by,
    review.decided_by,
    review.version.uploaded_by,
    review.transaction?.agent_id,
    ...audit.map((a) => a.actor_id),
  ]);
  const v = review.version;

  return (
    <>
      <PageHeader
        title={`${v.document?.title ?? "Document"} · v${v.version_number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <ReviewTypeBadge type={review.review_type} />
            <ReviewStateBadge state={review.state} />
            {review.transaction ? (
              <Link className="underline" href={`/o/${slug}/transactions/${review.transaction.id}`}>
                {review.transaction.property_address}
              </Link>
            ) : null}
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Analysis</CardTitle>
            <CardDescription>
              Sprint 001 uses a placeholder engine. The NJ contract review engine replaces it in Sprint 002.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AnalysisPanel run={runs[0]} />
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Document version</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <a className="underline underline-offset-4" href={`/o/${slug}/documents/${v.id}/download`} target="_blank" rel="noreferrer">
                {v.original_filename}
              </a>
              <p className="text-muted-foreground">
                {v.document ? DOCUMENT_KIND_LABELS[v.document.kind] : ""} · {formatBytes(v.size_bytes)}
              </p>
              <p className="text-muted-foreground">
                Uploaded by {displayName(people.get(v.uploaded_by))} on {formatDateTime(v.created_at)}
              </p>
              <code className="text-muted-foreground text-xs break-all">sha256 {v.sha256}</code>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Decision</CardTitle>
              <CardDescription>
                Requested by {displayName(people.get(review.requested_by))} on {formatDateTime(review.requested_at)}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm">
              {review.decided_by ? (
                <div className="grid gap-1">
                  <p>
                    <ReviewStateBadge state={review.state} /> by {displayName(people.get(review.decided_by))} on{" "}
                    {formatDateTime(review.decided_at)}
                  </p>
                  {review.decision_note ? <p className="whitespace-pre-wrap">{review.decision_note}</p> : null}
                </div>
              ) : canDecideReview(role, userId, review) ? (
                <DecisionForm orgSlug={slug} reviewId={review.id} />
              ) : review.state === "ready_for_broker" ? (
                <p className="text-muted-foreground">
                  {review.requested_by === userId && isBrokerOrAdmin(role)
                    ? "You requested this review, so another broker or admin must decide it."
                    : "Waiting for a broker decision."}
                </p>
              ) : (
                <p className="text-muted-foreground">No decision was recorded.</p>
              )}
              {canWithdrawReview(role, userId, review) ? <WithdrawForm orgSlug={slug} reviewId={review.id} /> : null}
            </CardContent>
          </Card>

          {isBrokerOrAdmin(role) ? (
            <Card>
              <CardHeader>
                <CardTitle>Audit trail</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm">
                  {audit.map((a) => (
                    <li key={a.id}>
                      <span className="font-medium">{a.action}</span>{" "}
                      <span className="text-muted-foreground">
                        {a.actor_id ? displayName(people.get(a.actor_id)) : "System"} · {formatDateTime(a.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
