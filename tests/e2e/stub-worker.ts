/**
 * Test-only analysis worker for the E2E walkthrough. It runs the real worker
 * pipeline (claim, Storage download, SHA-256 check, PDF text extraction, quote
 * verification, complete/fail RPCs) against a local Supabase stack, but the
 * model call is replaced by a stub. No AI model is called and the summary says so.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx tests/e2e/stub-worker.ts
 *
 * Never point this at a shared or production project.
 */
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { createClient } from "@supabase/supabase-js";
import { NjContractEngine, readPdfText, type ModelCall } from "@/lib/analysis/nj-engine";
import { processNextRun } from "@/lib/analysis/worker";

const url = process.env.SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error("stub-worker only runs against a local Supabase (SUPABASE_URL=http://127.0.0.1:54321).");
  process.exit(2);
}
const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Answers from the PDF's own text: one real quote, and one invented quote that verification must drop. */
const stubModel: ModelCall = async (params) => {
  const doc = (params.messages[0].content as { type: string; source?: { data: string } }[])[0];
  const pages = await readPdfText(Buffer.from(doc.source!.data, "base64"));
  const page = pages.findIndex((p) => p.includes("ATTORNEY REVIEW"));
  const answer = {
    summary: "TEST STUB: no AI model was called. Fixed answers for the E2E walkthrough.",
    items: [
      page >= 0
        ? { id: "nj.attorney_review_clause", status: "present", evidence: [{ page: page + 1, quote: "ATTORNEY REVIEW: Study by Attorney." }], note: "" }
        : { id: "nj.attorney_review_clause", status: "missing", evidence: [], note: "Stub did not find the heading." },
      {
        id: "disclosure.lead_paint",
        status: "present",
        evidence: [{ page: 1, quote: "Lead-based paint disclosure is attached as Exhibit Z." }],
        note: "",
      },
      { id: "core.closing_date", status: "needs_attention", evidence: [{ page: 1, quote: "Closing date: ________" }], note: "The closing date field is blank." },
    ],
  };
  return {
    id: "msg_stub",
    type: "message",
    role: "assistant",
    model: "stub-model-for-tests",
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(answer) }],
  } as unknown as BetaMessage;
};

async function main() {
  const engine = new NjContractEngine({ callModel: stubModel });
  let outcome;
  let count = 0;
  while ((outcome = await processNextRun({ db, engine, log: (l) => console.log(`[stub-worker] ${l}`) }))) {
    count += 1;
    console.log(`[stub-worker] ${outcome.runId} -> ${outcome.status}${outcome.error ? `: ${outcome.error}` : ""}`);
  }
  console.log(`[stub-worker] processed ${count} run(s)`);
}

main().catch((err) => {
  console.error("[stub-worker] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
