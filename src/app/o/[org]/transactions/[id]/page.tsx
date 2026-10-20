import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { getTransaction, listDocumentsWithVersions, listReviews, profilesById, displayName } from "@/lib/data/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { PageHeader, EmptyState } from "@/components/app/page-header";
import { TransactionStatusBadge } from "@/components/app/badges";
import { ReviewTable } from "@/components/app/review-table";
import { StatusForm } from "@/components/forms/transaction-forms";
import { NewDocumentForm, NewVersionForm, RequestReviewForm } from "@/components/forms/document-forms";
import { DOCUMENT_KIND_LABELS, SIDE_LABELS, formatBytes, formatDate, formatDateTime } from "@/lib/domain/labels";

export const metadata: Metadata = { title: "Transaction" };

export default async function TransactionDetailPage({ params }: PageProps<"/o/[org]/transactions/[id]">) {
  const { org: slug, id } = await params;
  const { supabase, org } = await requireOrg(slug);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const transaction = await getTransaction(supabase, org.id, id);
  if (!transaction) notFound();

  const [documents, reviews] = await Promise.all([
    listDocumentsWithVersions(supabase, transaction.id),
    listReviews(supabase, org.id, { transactionId: transaction.id }),
  ]);
  const people = await profilesById(supabase, [
    transaction.agent_id,
    ...documents.flatMap((d) => d.versions.map((v) => v.uploaded_by)),
    ...reviews.map((r) => r.requested_by),
  ]);

  return (
    <>
      <PageHeader
        title={transaction.property_address}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <TransactionStatusBadge status={transaction.status} />
            <span>
              {SIDE_LABELS[transaction.side]} · Agent {displayName(people.get(transaction.agent_id))} · Expected close{" "}
              {formatDate(transaction.expected_close_date)}
            </span>
          </span>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">City / state</dt>
            <dd>
              {transaction.property_city ?? "—"}, {transaction.property_state}
            </dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{formatDateTime(transaction.created_at)}</dd>
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="whitespace-pre-wrap">{transaction.notes || "—"}</dd>
          </dl>
          <StatusForm orgSlug={slug} transactionId={transaction.id} status={transaction.status} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>
            Every upload is kept as a numbered version. Versions can&apos;t be edited or deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          {documents.length === 0 ? <EmptyState>No documents yet.</EmptyState> : null}
          {documents.map((doc) => (
            <section key={doc.id} className="grid gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{doc.title}</h3>
                <Badge variant="outline">{DOCUMENT_KIND_LABELS[doc.kind]}</Badge>
              </div>
              <ol className="grid gap-3">
                {doc.versions.map((v, i) => (
                  <li key={v.id} className="grid gap-2 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-medium">v{v.version_number}</span>
                      {i === 0 ? <Badge variant="secondary">Latest</Badge> : null}
                      <a
                        className="underline underline-offset-4"
                        href={`/o/${slug}/documents/${v.id}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {v.original_filename}
                      </a>
                      <span className="text-muted-foreground">
                        {formatBytes(v.size_bytes)} · {displayName(people.get(v.uploaded_by))} ·{" "}
                        {formatDateTime(v.created_at)}
                      </span>
                      <code className="text-muted-foreground text-xs" title={`SHA-256 ${v.sha256}`}>
                        sha256 {v.sha256.slice(0, 12)}…
                      </code>
                    </div>
                    {i === 0 ? <RequestReviewForm orgSlug={slug} transactionId={transaction.id} versionId={v.id} /> : null}
                  </li>
                ))}
              </ol>
              <Separator />
              <NewVersionForm orgSlug={slug} transactionId={transaction.id} documentId={doc.id} />
            </section>
          ))}
          <Separator />
          <div className="grid gap-3">
            <h3 className="font-medium">Add a document</h3>
            <NewDocumentForm orgSlug={slug} transactionId={transaction.id} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reviews</CardTitle>
          <CardDescription>
            Broker reviews for this transaction. <Link className="underline" href={`/o/${slug}/queues/pre-signature`}>Open the queues</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReviewTable orgSlug={slug} reviews={reviews} people={people} empty="No reviews requested yet." />
        </CardContent>
      </Card>
    </>
  );
}
