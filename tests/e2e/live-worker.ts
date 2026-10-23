/**
 * Live AI review run for the local stack. Same pipeline as `npm run worker`
 * (claim, Storage download, SHA-256 check, PDF text extraction, model call,
 * quote verification, complete/fail RPCs), plus per-run timing and token usage
 * so a test run can report cost. It never logs document content or the key.
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
 *   RISE_ANTHROPIC_API_KEY=... npx tsx --tsconfig tsconfig.json tests/e2e/live-worker.ts
 *
 * Prints one `LIVE_RUN {json}` line per run. Only runs against a local Supabase.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { NjContractEngine, anthropicModelCall, type ModelCall } from "@/lib/analysis/nj-engine";
import { processNextRun } from "@/lib/analysis/worker";

// List prices for the model the engine asks for, USD per million tokens.
const PRICE_PER_MTOK = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

const url = process.env.SUPABASE_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
  console.error("live-worker only runs against a local Supabase (SUPABASE_URL=http://127.0.0.1:54321).");
  process.exit(2);
}
// The cloud platform reserves ANTHROPIC_API_KEY for itself, so prefer the app's own name.
const apiKey = process.env.RISE_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Missing RISE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY). No model was called.");
  process.exit(2);
}

const db = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});
// Pin the public API: the platform may set ANTHROPIC_BASE_URL for its own use.
const anthropic = new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", maxRetries: 4 });
const live = anthropicModelCall(anthropic);

type Call = { model: string; ms: number; input: number; output: number; cacheWrite: number; cacheRead: number; stop: string | null };
let calls: Call[] = [];
const measured: ModelCall = async (params) => {
  const started = Date.now();
  const message = await live(params);
  const u = message.usage;
  calls.push({
    model: message.model,
    ms: Date.now() - started,
    input: u.input_tokens,
    output: u.output_tokens,
    cacheWrite: u.cache_creation_input_tokens ?? 0,
    cacheRead: u.cache_read_input_tokens ?? 0,
    stop: message.stop_reason,
  });
  return message;
};

function cost(c: Call): number {
  return (
    (c.input * PRICE_PER_MTOK.input +
      c.output * PRICE_PER_MTOK.output +
      c.cacheWrite * PRICE_PER_MTOK.cacheWrite +
      c.cacheRead * PRICE_PER_MTOK.cacheRead) /
    1e6
  );
}

async function main() {
  const engine = new NjContractEngine({ callModel: measured });
  for (;;) {
    calls = [];
    const started = Date.now();
    const outcome = await processNextRun({ db, engine, log: (l) => console.log(`[live-worker] ${l}`) });
    if (!outcome) break;
    const call = calls.at(-1);
    console.log(
      "LIVE_RUN " +
        JSON.stringify({
          run_id: outcome.runId,
          status: outcome.status,
          error: outcome.error ?? null,
          total_ms: Date.now() - started,
          model_calls: calls.length,
          model: call?.model ?? null,
          model_ms: call?.ms ?? null,
          stop_reason: call?.stop ?? null,
          tokens: call ? { input: call.input, output: call.output, cache_write: call.cacheWrite, cache_read: call.cacheRead } : null,
          cost_usd: Number(calls.reduce((s, c) => s + cost(c), 0).toFixed(4)),
        }),
    );
  }
  console.log("[live-worker] queue empty");
}

main().catch((err) => {
  console.error("[live-worker] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
