import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "./auto-refresh";
import { MockBadge } from "./badges";
import { parseAnalysisResult, type AnalysisItem } from "@/lib/analysis/schema";
import type { AnalysisRun } from "@/lib/domain/types";
import { formatDateTime } from "@/lib/domain/labels";

const STATUS_TEXT = {
  not_evaluated: "Not evaluated",
  present: "Present",
  missing: "Missing",
  needs_attention: "Needs attention",
} as const;

const STATUS_VARIANT = {
  not_evaluated: "outline",
  present: "secondary",
  missing: "warning",
  needs_attention: "warning",
} as const;

const ENGINE_NAME = { mock: "Mock", nj_contract_ai: "NJ contract AI (draft)" } as const;

export function AnalysisPanel({ run }: { run: AnalysisRun | undefined }) {
  if (!run) return <p className="text-muted-foreground text-sm">No analysis has run for this review.</p>;

  if (run.status === "queued" || run.status === "running") {
    return (
      <div className="grid gap-1 text-sm" aria-live="polite">
        <AutoRefresh />
        <p className="font-medium">Analyzing the document…</p>
        <p className="text-muted-foreground">
          {run.status === "queued" ? "Waiting for the analysis worker." : "The AI checklist is being prepared."} This page
          updates on its own. The review reaches the broker when analysis finishes.
        </p>
      </div>
    );
  }

  if (run.status === "failed") {
    return (
      <Alert variant="warning">
        <AlertTitle>No AI analysis for this version</AlertTitle>
        <AlertDescription>
          {run.error ?? "Analysis failed."} The broker reviews the document directly.
        </AlertDescription>
      </Alert>
    );
  }

  const result = parseAnalysisResult(run.result);
  if (!result) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Unreadable analysis result</AlertTitle>
        <AlertDescription>The stored result didn&apos;t match the expected format, so it isn&apos;t shown.</AlertDescription>
      </Alert>
    );
  }

  const groups = Map.groupBy(result.items, (i) => i.category);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {run.is_mock ? <MockBadge /> : <Badge variant="secondary">{ENGINE_NAME[run.engine]}</Badge>}
        <span className="text-muted-foreground">
          {run.engine_version}
          {result.model ? ` · ${result.model}` : ""} · {formatDateTime(run.completed_at)}
        </span>
      </div>
      <Alert variant="warning">
        <AlertTitle>{run.is_mock ? "This is not a review result" : "Draft AI checklist, not a decision"}</AlertTitle>
        <AlertDescription>{result.disclaimer}</AlertDescription>
      </Alert>
      <p className="text-sm">{result.summary}</p>
      {[...groups.entries()].map(([category, items]) => (
        <div key={category} className="grid gap-2">
          <h4 className="text-sm font-medium">{category}</h4>
          <ul className="grid gap-1">
            {items.map((item) => (
              <ChecklistRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      ))}
      {result.verification ? (
        <p className="text-muted-foreground text-xs">
          {result.verification.quotes_verified} of {result.verification.quotes_returned} quotes were found in the
          document text; unverified quotes are not shown.
          {result.verification.items_downgraded
            ? ` ${result.verification.items_downgraded} item(s) were set to "Not evaluated" for lack of verified evidence.`
            : ""}
        </p>
      ) : null}
    </div>
  );
}

function ChecklistRow({ item }: { item: AnalysisItem }) {
  return (
    <li className="grid gap-2 rounded-md border px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-4">
        <span>{item.label}</span>
        <Badge variant={STATUS_VARIANT[item.status]}>{STATUS_TEXT[item.status]}</Badge>
      </div>
      {item.note ? <p className="text-muted-foreground">{item.note}</p> : null}
      {item.evidence?.length ? (
        <ul className="grid gap-1">
          {item.evidence.map((e, i) => (
            <li key={i} className="border-l-2 pl-3 text-xs">
              <q className="italic">{e.quote}</q>
              {e.page ? <span className="text-muted-foreground"> · page {e.page}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
