import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { MockBadge } from "./badges";
import { parseAnalysisResult } from "@/lib/analysis/schema";
import type { AnalysisRun } from "@/lib/domain/types";
import { formatDateTime } from "@/lib/domain/labels";

const STATUS_TEXT = {
  not_evaluated: "Not evaluated",
  present: "Present",
  missing: "Missing",
  needs_attention: "Needs attention",
} as const;

export function AnalysisPanel({ run }: { run: AnalysisRun | undefined }) {
  if (!run) return <p className="text-muted-foreground text-sm">No analysis has run for this review.</p>;
  if (run.status !== "completed") {
    return <p className="text-muted-foreground text-sm">Analysis status: {run.status}.</p>;
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
        {run.is_mock ? <MockBadge /> : <Badge variant="secondary">{run.engine}</Badge>}
        <span className="text-muted-foreground">
          {run.engine_version} · {formatDateTime(run.completed_at)}
        </span>
      </div>
      {run.is_mock ? (
        <Alert variant="warning">
          <AlertTitle>This is not a review result</AlertTitle>
          <AlertDescription>{result.disclaimer}</AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm">{result.summary}</p>
      {[...groups.entries()].map(([category, items]) => (
        <div key={category} className="grid gap-2">
          <h4 className="text-sm font-medium">{category}</h4>
          <ul className="grid gap-1">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm">
                <span>{item.label}</span>
                <Badge variant="outline">{STATUS_TEXT[item.status]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
