import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { listReviews, profilesById } from "@/lib/data/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader } from "@/components/app/page-header";
import { ReviewTable } from "@/components/app/review-table";
import { QUEUE_SLUGS, REVIEW_TYPE_LABELS, type QueueSlug } from "@/lib/domain/labels";
import { isBrokerOrAdmin } from "@/lib/domain/roles";

export const metadata: Metadata = { title: "Review queue" };

const DESCRIPTIONS = {
  pre_signature: "Contracts and documents to check before anyone signs.",
  post_execution: "Fully executed documents to check after signing.",
} as const;

export default async function QueuePage({ params }: PageProps<"/o/[org]/queues/[queue]">) {
  const { org: slug, queue } = await params;
  if (!(queue in QUEUE_SLUGS)) notFound();
  const type = QUEUE_SLUGS[queue as QueueSlug];
  const { supabase, org, role } = await requireOrg(slug);

  const [open, closed] = await Promise.all([
    listReviews(supabase, org.id, { type, states: ["pending_analysis", "ready_for_broker"] }),
    listReviews(supabase, org.id, { type, states: ["approved", "changes_requested", "rejected", "withdrawn"], limit: 50 }),
  ]);
  const people = await profilesById(supabase, [...open, ...closed].flatMap((r) => [r.requested_by, r.decided_by]));
  closed.sort((a, b) => (b.decided_at ?? b.requested_at).localeCompare(a.decided_at ?? a.requested_at));

  return (
    <>
      <PageHeader
        title={`${REVIEW_TYPE_LABELS[type]} review queue`}
        description={
          isBrokerOrAdmin(role)
            ? DESCRIPTIONS[type]
            : `${DESCRIPTIONS[type]} You see reviews on your own transactions.`
        }
      />
      <Alert variant="warning">
        <AlertTitle>Analysis is mocked in this version</AlertTitle>
        <AlertDescription>
          No document is read or evaluated by software yet. Every checklist shown is a placeholder, and every decision is
          made by a broker reviewing the document directly.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>Open</CardTitle>
          <CardDescription>Oldest first.</CardDescription>
        </CardHeader>
        <CardContent>
          <ReviewTable orgSlug={slug} reviews={open} people={people} showType={false} empty="The queue is empty." />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Closed</CardTitle>
        </CardHeader>
        <CardContent>
          <ReviewTable
            orgSlug={slug}
            reviews={closed}
            people={people}
            showType={false}
            timeColumn="decided"
            empty="No closed reviews yet."
          />
        </CardContent>
      </Card>
    </>
  );
}
