import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { getVersion, type VersionWithDocument } from "@/lib/data/queries";
import { readPdfText } from "@/lib/analysis/pdf-text";
import { compareTexts, type Comparison } from "@/lib/compare/diff";
import { DOCUMENTS_BUCKET } from "@/lib/domain/upload";
import type { ServerSupabase } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/app/page-header";
import { formatDateTime } from "@/lib/domain/labels";

export const metadata: Metadata = { title: "Compare versions" };

const UUID = /^[0-9a-f-]{36}$/i;
// Any text at all; a scan with no text layer has none to compare.
const MIN_TEXT_CHARS = 1;

type Side = {
  version: VersionWithDocument;
  pages: string[] | null;
  problem?: string;
};

async function load(supabase: ServerSupabase, version: VersionWithDocument): Promise<Side> {
  if (version.mime_type !== "application/pdf") {
    return {
      version,
      pages: null,
      problem: "isn't a PDF, so its text can't be compared",
    };
  }
  // Downloaded with the viewer's own session, so Storage RLS decides access.
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).download(version.storage_path);
  if (error || !data) return { version, pages: null, problem: "couldn't be downloaded" };
  try {
    const pages = await readPdfText(new Uint8Array(await data.arrayBuffer()));
    if (pages.join("").replace(/\s/g, "").length < MIN_TEXT_CHARS) {
      return {
        version,
        pages: null,
        problem: "has little or no text layer (it may be a scan)",
      };
    }
    return { version, pages };
  } catch {
    return { version, pages: null, problem: "couldn't be opened as a PDF" };
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const label = (v: VersionWithDocument) => `${v.document?.title ?? "Document"} v${v.version_number}`;

export default async function ComparePage({ params, searchParams }: PageProps<"/o/[org]/compare">) {
  const { org: slug } = await params;
  const { before: beforeId, after: afterId } = await searchParams;
  if (typeof beforeId !== "string" || typeof afterId !== "string" || !UUID.test(beforeId) || !UUID.test(afterId)) {
    notFound();
  }
  const { supabase, org } = await requireOrg(slug);
  const [beforeVersion, afterVersion] = await Promise.all([
    getVersion(supabase, org.id, beforeId),
    getVersion(supabase, org.id, afterId),
  ]);
  if (!beforeVersion || !afterVersion) notFound();
  const transactionId = afterVersion.document?.transaction_id;
  if (!transactionId || beforeVersion.document?.transaction_id !== transactionId) notFound();

  let result: Comparison | null = null;
  let problem: string | null = null;
  if (beforeVersion.sha256 === afterVersion.sha256) {
    result = { status: "identical" };
  } else {
    const [before, after] = await Promise.all([load(supabase, beforeVersion), load(supabase, afterVersion)]);
    const bad = [before, after].find((s) => s.problem);
    if (bad) problem = `${label(bad.version)} ${bad.problem}. Compare the documents directly.`;
    else result = compareTexts(before.pages!, after.pages!);
  }

  return (
    <>
      <PageHeader
        title="Compare versions"
        description={
          <span>
            <Link className="underline" href={`/o/${slug}/transactions/${transactionId}`}>
              Back to the transaction
            </Link>
          </span>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>
            {label(beforeVersion)} → {label(afterVersion)}
          </CardTitle>
          <CardDescription>
            A word-by-word comparison of the text in the two files. It can&apos;t see changes in images, handwriting,
            initials or signatures, and it isn&apos;t a review. Read both documents before deciding.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm">
          <dl className="text-muted-foreground grid gap-x-6 gap-y-1 sm:grid-cols-[6rem_1fr]">
            <dt>Before</dt>
            <dd>
              <a
                className="underline"
                href={`/o/${slug}/documents/${beforeVersion.id}/download`}
                target="_blank"
                rel="noreferrer"
              >
                {beforeVersion.original_filename}
              </a>{" "}
              · uploaded {formatDateTime(beforeVersion.created_at)} ·{" "}
              <code className="text-xs">sha256 {beforeVersion.sha256.slice(0, 12)}…</code>
            </dd>
            <dt>After</dt>
            <dd>
              <a
                className="underline"
                href={`/o/${slug}/documents/${afterVersion.id}/download`}
                target="_blank"
                rel="noreferrer"
              >
                {afterVersion.original_filename}
              </a>{" "}
              · uploaded {formatDateTime(afterVersion.created_at)} ·{" "}
              <code className="text-xs">sha256 {afterVersion.sha256.slice(0, 12)}…</code>
            </dd>
          </dl>

          {problem ? <p role="note">{problem}</p> : null}
          {result?.status === "identical" ? (
            <p role="note" data-testid="compare-summary">
              No differences in the text.
              {beforeVersion.sha256 === afterVersion.sha256 ? " The two files are byte-for-byte identical." : ""}
            </p>
          ) : null}
          {result?.status === "too_different" ? (
            <p role="note" data-testid="compare-summary">
              These look like different documents: more than {result.editsOver.toLocaleString("en-US")} words would have
              to change. Compare them directly.
            </p>
          ) : null}
          {result?.status === "changed" ? (
            <>
              <p data-testid="compare-summary">
                {plural(result.hunks.length, "place")} changed: {plural(result.wordsRemoved, "word")} removed,{" "}
                {plural(result.wordsAdded, "word")} added.
              </p>
              <ol className="grid gap-3">
                {result.hunks.map((h, i) => (
                  <li key={i} className="grid gap-1 rounded-md border p-3" data-testid="compare-change">
                    <span className="text-muted-foreground text-xs">
                      Page {h.pageBefore} → page {h.pageAfter}
                    </span>
                    <p className="leading-relaxed">
                      {h.segments.map((s, j) => (
                        <Fragment key={j}>
                          {j > 0 ? " " : null}
                          {s.type === "equal" ? (
                            s.text
                          ) : s.type === "delete" ? (
                            <del className="bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" title="Removed">
                              {s.text}
                            </del>
                          ) : (
                            <ins
                              className="bg-green-100 text-green-900 no-underline dark:bg-green-950 dark:text-green-200"
                              title="Added"
                            >
                              {s.text}
                            </ins>
                          )}
                        </Fragment>
                      ))}
                    </p>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
