/**
 * Measures the AI review against fictional NJ contracts with known answers
 * (src/lib/eval/corpus.ts). Calls the model directly; no database involved.
 *
 *   npm run eval:ai                      # list the cases and estimated cost; calls nothing
 *   npm run eval:ai -- --live            # run every case against the live model (costs money)
 *   npm run eval:ai -- --live --only pre-0   # cases whose id starts with "pre-0"
 *   npm run eval:ai -- --pdfs            # write the contract PDFs to the output folder only
 *
 * Needs RISE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) for --live. Writes
 * report.md and results.json to test-results/eval-<timestamp>/ or --out <dir>.
 * Runs on the worker host or a developer machine, never in the web app or CI.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { AnalysisFailure, NJ_ENGINE_VERSION, NJ_MODEL, NjContractEngine, anthropicModelCall } from "@/lib/analysis/nj-engine";
import { EVAL_CASES, casePdf, type EvalCase } from "@/lib/eval/corpus";
import { renderReport, score, type CaseOutcome, type Usage } from "@/lib/eval/score";

const CONCURRENCY = 4;
// From the 2026-10-20 live run: about $0.05 to $0.07 for a one-page contract.
const EST_PER_CASE_USD = 0.08;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runCase(anthropic: Anthropic, c: EvalCase): Promise<CaseOutcome> {
  let usage: Usage | undefined;
  let model: string | undefined;
  const call = anthropicModelCall(anthropic);
  const engine = new NjContractEngine({
    callModel: async (params) => {
      const message = await call(params);
      usage = message.usage;
      model = message.model;
      return message;
    },
  });
  const file = casePdf(c);
  const started = Date.now();
  try {
    const result = await engine.analyze({
      reviewId: `eval-${c.id}`,
      orgId: "eval",
      reviewType: c.reviewType,
      documentKind: "purchase_agreement",
      version: { id: c.id, sha256: "", mimeType: "application/pdf", sizeBytes: file.length },
      file,
    });
    return { case: c, result, usage, model, seconds: (Date.now() - started) / 1000 };
  } catch (err) {
    const reason = err instanceof AnalysisFailure ? err.message : `error: ${err instanceof Error ? err.message : String(err)}`;
    return { case: c, failure: reason, usage, model, seconds: (Date.now() - started) / 1000 };
  }
}

async function main() {
  const only = arg("--only");
  const cases = EVAL_CASES.filter((c) => !only || c.id.startsWith(only));
  const out = arg("--out") ?? join("test-results", `eval-${new Date().toISOString().replace(/[:.]/g, "-")}`);

  if (process.argv.includes("--pdfs")) {
    mkdirSync(out, { recursive: true });
    for (const c of cases) writeFileSync(join(out, `${c.id}.pdf`), casePdf(c));
    console.log(`Wrote ${cases.length} PDFs to ${out}`);
    return;
  }

  if (!process.argv.includes("--live")) {
    for (const c of cases) console.log(`${c.id.padEnd(36)} ${c.reviewType.padEnd(15)} ${c.description}`);
    console.log(
      `\n${cases.length} cases. A live run calls ${NJ_MODEL} once per case, roughly $${(cases.length * EST_PER_CASE_USD).toFixed(2)}. ` +
        "Add --live to run it.",
    );
    return;
  }

  const apiKey = process.env.RISE_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Missing RISE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY). Nothing was run.");
    process.exit(2);
  }
  const anthropic = new Anthropic({
    apiKey,
    baseURL: process.env.RISE_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    maxRetries: 4,
  });

  mkdirSync(out, { recursive: true });
  const outcomes: CaseOutcome[] = new Array(cases.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, cases.length) }, async () => {
      while (next < cases.length) {
        const i = next++;
        const o = await runCase(anthropic, cases[i]);
        outcomes[i] = o;
        const wrong = o.result
          ? Object.entries(o.case.expected).filter(
              ([id, want]) => want && !want.includes(o.result!.items.find((x) => x.id === id)?.status ?? "not_evaluated"),
            ).length
          : null;
        console.log(
          `${o.case.id.padEnd(36)} ${o.result ? (wrong ? `${wrong} wrong` : "all correct") : `no result: ${o.failure}`} (${Math.round(o.seconds ?? 0)} s)`,
        );
      }
    }),
  );

  const card = score(outcomes);
  const date = new Date().toISOString().slice(0, 10);
  const report = renderReport(card, { model: NJ_MODEL, engineVersion: NJ_ENGINE_VERSION, date });
  writeFileSync(join(out, "report.md"), report);
  writeFileSync(
    join(out, "results.json"),
    JSON.stringify(
      outcomes.map((o) => ({
        case: o.case.id,
        description: o.case.description,
        expected: o.case.expected,
        model: o.model,
        usage: o.usage,
        seconds: o.seconds,
        failure: o.failure,
        result: o.result,
      })),
      null,
      2,
    ),
  );
  for (const c of cases) writeFileSync(join(out, `${c.id}.pdf`), casePdf(c));
  console.log(`\n${report}\nWrote ${out}/report.md and results.json`);
}

main().catch((err) => {
  console.error("[eval-ai-review] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
