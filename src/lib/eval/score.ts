import type { AnalysisResult } from "@/lib/analysis/schema";
import type { EvalCase, Status } from "./corpus";

/** One case's outcome: the engine's result, or the reason it produced none. */
export type CaseOutcome = {
  case: EvalCase;
  result?: AnalysisResult;
  failure?: string;
  usage?: Usage;
  model?: string;
  seconds?: number;
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/**
 * Kinds of error, from worst to least bad for a broker relying on the draft:
 *  - false_reassurance: said "present" when there is a problem.
 *  - wrong_problem: flagged a problem, but the wrong kind (missing vs needs attention).
 *  - false_alarm: flagged a problem where there isn't one.
 *  - no_answer: said "not evaluated" where an answer was expected.
 */
export type ErrorKind = "false_reassurance" | "wrong_problem" | "false_alarm" | "no_answer";

export function classify(expected: Status[], got: Status): ErrorKind | null {
  if (expected.includes(got)) return null;
  if (got === "present") return "false_reassurance";
  if (got === "not_evaluated") return "no_answer";
  if (expected.includes("present")) return "false_alarm";
  return "wrong_problem";
}

export type ItemScore = {
  id: string;
  scored: number;
  correct: number;
  errors: Record<ErrorKind, number>;
};

export type Mistake = { caseId: string; itemId: string; expected: Status[]; got: Status; kind: ErrorKind; note?: string };

export type Scorecard = {
  cases: number;
  failed: { caseId: string; reason: string }[];
  scored: number;
  correct: number;
  items: ItemScore[];
  /** Accuracy only on items where the right answer is a problem. */
  problems: { scored: number; caught: number };
  mistakes: Mistake[];
  quotes: { returned: number; verified: number; itemsDowngraded: number };
  cost: { usd: number; inputTokens: number; outputTokens: number; unpricedModels: string[] };
  seconds: { total: number; max: number };
};

const emptyErrors = (): Record<ErrorKind, number> => ({
  false_reassurance: 0,
  wrong_problem: 0,
  false_alarm: 0,
  no_answer: 0,
});

/** USD per million tokens. Cache writes are billed at 1.25x input. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
};

export function costOf(usage: Usage, model: string): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (
    (usage.input_tokens * p.input +
      (usage.cache_creation_input_tokens ?? 0) * p.input * 1.25 +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      usage.output_tokens * p.output) /
    1_000_000
  );
}

export function score(outcomes: CaseOutcome[]): Scorecard {
  const items = new Map<string, ItemScore>();
  const card: Scorecard = {
    cases: outcomes.length,
    failed: [],
    scored: 0,
    correct: 0,
    items: [],
    problems: { scored: 0, caught: 0 },
    mistakes: [],
    quotes: { returned: 0, verified: 0, itemsDowngraded: 0 },
    cost: { usd: 0, inputTokens: 0, outputTokens: 0, unpricedModels: [] },
    seconds: { total: 0, max: 0 },
  };

  for (const o of outcomes) {
    if (o.usage) {
      card.cost.inputTokens += o.usage.input_tokens;
      card.cost.outputTokens += o.usage.output_tokens;
      const usd = costOf(o.usage, o.model ?? "");
      if (usd === null) {
        if (!card.cost.unpricedModels.includes(o.model ?? "unknown")) card.cost.unpricedModels.push(o.model ?? "unknown");
      } else {
        card.cost.usd += usd;
      }
    }
    if (o.seconds !== undefined) {
      card.seconds.total += o.seconds;
      card.seconds.max = Math.max(card.seconds.max, o.seconds);
    }
    if (!o.result) {
      card.failed.push({ caseId: o.case.id, reason: o.failure ?? "no result" });
      continue;
    }
    const v = o.result.verification;
    if (v) {
      card.quotes.returned += v.quotes_returned;
      card.quotes.verified += v.quotes_verified;
      card.quotes.itemsDowngraded += v.items_downgraded;
    }
    const byId = new Map(o.result.items.map((i) => [i.id, i]));
    for (const [itemId, expected] of Object.entries(o.case.expected)) {
      if (!expected) continue;
      let s = items.get(itemId);
      if (!s) {
        s = { id: itemId, scored: 0, correct: 0, errors: emptyErrors() };
        items.set(itemId, s);
      }
      const item = byId.get(itemId);
      const got: Status = item?.status ?? "not_evaluated";
      const kind = classify(expected, got);
      s.scored += 1;
      card.scored += 1;
      const isProblem = !expected.includes("present");
      if (isProblem) card.problems.scored += 1;
      if (kind === null) {
        s.correct += 1;
        card.correct += 1;
        if (isProblem) card.problems.caught += 1;
      } else {
        s.errors[kind] += 1;
        card.mistakes.push({ caseId: o.case.id, itemId, expected, got, kind, note: item?.note });
      }
    }
  }
  card.items = [...items.values()];
  return card;
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${Math.round((100 * a) / b)}%`);

export function renderReport(card: Scorecard, meta: { model: string; engineVersion: string; date: string }): string {
  const lines: string[] = [];
  lines.push(`# AI review evaluation, ${meta.date}`);
  lines.push("");
  lines.push(
    "Fictional New Jersey contracts with known answers (`src/lib/eval/corpus.ts`), run through the same engine the worker uses. " +
      "This measures the draft checklist against a small synthetic set. It is not a validation of the checklist or of accuracy on real NJ forms.",
  );
  lines.push("");
  lines.push(`- Model requested: \`${meta.model}\`; engine \`${meta.engineVersion}\``);
  lines.push(`- Cases: ${card.cases} (${card.failed.length} produced no result)`);
  lines.push(`- Checklist answers scored: ${card.scored}; correct: ${card.correct} (${pct(card.correct, card.scored)})`);
  lines.push(
    `- Problems planted: ${card.problems.scored}; caught with an acceptable status: ${card.problems.caught} (${pct(card.problems.caught, card.problems.scored)})`,
  );
  const errs = emptyErrors();
  for (const m of card.mistakes) errs[m.kind] += 1;
  lines.push(
    `- Errors: ${errs.false_reassurance} false reassurance, ${errs.wrong_problem} wrong kind of problem, ${errs.false_alarm} false alarm, ${errs.no_answer} not evaluated`,
  );
  lines.push(
    `- Quotes: ${card.quotes.verified} of ${card.quotes.returned} verified against the text; ${card.quotes.itemsDowngraded} items downgraded for unverifiable quotes`,
  );
  const unpriced = card.cost.unpricedModels.length ? ` (plus unpriced calls to ${card.cost.unpricedModels.join(", ")})` : "";
  lines.push(
    `- Cost: $${card.cost.usd.toFixed(2)}${unpriced}, ${card.cost.inputTokens.toLocaleString("en-US")} input and ${card.cost.outputTokens.toLocaleString("en-US")} output tokens; ` +
      `$${(card.cost.usd / Math.max(1, card.cases)).toFixed(3)} per contract`,
  );
  lines.push(`- Time: ${Math.round(card.seconds.total)} s total, slowest ${Math.round(card.seconds.max)} s`);
  lines.push("");
  lines.push("## By checklist item");
  lines.push("");
  lines.push("| Item | Scored | Correct | False reassurance | Wrong problem | False alarm | Not evaluated |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const s of card.items) {
    lines.push(
      `| \`${s.id}\` | ${s.scored} | ${s.correct} (${pct(s.correct, s.scored)}) | ${s.errors.false_reassurance} | ${s.errors.wrong_problem} | ${s.errors.false_alarm} | ${s.errors.no_answer} |`,
    );
  }
  lines.push("");
  lines.push("## Mistakes");
  lines.push("");
  if (card.mistakes.length === 0) lines.push("None.");
  for (const m of card.mistakes) {
    const note = m.note ? ` Note: "${m.note.replace(/\s+/g, " ").slice(0, 240)}"` : "";
    lines.push(`- **${m.caseId}** \`${m.itemId}\`: expected ${m.expected.join(" or ")}, got ${m.got} (${m.kind.replace(/_/g, " ")}).${note}`);
  }
  if (card.failed.length) {
    lines.push("");
    lines.push("## No result");
    lines.push("");
    for (const f of card.failed) lines.push(`- **${f.caseId}**: ${f.reason}`);
  }
  lines.push("");
  return lines.join("\n");
}
