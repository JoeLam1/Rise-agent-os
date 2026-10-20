/**
 * AI review worker. Runs server-side, never in the Next.js request path.
 *
 *   npm run worker            # poll the queue until stopped
 *   npm run worker -- --once  # drain the queue, then exit
 *
 * Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 * and RISE_ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY) in the environment. The
 * RISE_ name exists because some hosts, including Claude cloud environments,
 * reserve ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL for themselves. See
 * docs/SPRINT_002.md.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { NjContractEngine, anthropicModelCall } from "@/lib/analysis/nj-engine";
import { processNextRun } from "@/lib/analysis/worker";

const POLL_MS = 5000;

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined);
  if (!value) {
    console.error(`Missing ${name}${fallback ? ` (or ${fallback})` : ""}. The worker did not start.`);
    process.exit(2);
  }
  return value;
}

async function main() {
  const once = process.argv.includes("--once");
  const db = createClient(requireEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anthropic = new Anthropic({
    apiKey: requireEnv("RISE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
    // Explicit, so a host-level ANTHROPIC_BASE_URL never redirects document traffic.
    baseURL: process.env.RISE_ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    maxRetries: 4,
  });
  const engine = new NjContractEngine({ callModel: anthropicModelCall(anthropic) });
  const log = (line: string) => console.log(`[analysis-worker] ${new Date().toISOString()} ${line}`);

  log(`started (${engine.engineVersion}, ${once ? "drain once" : "polling"}); server-side model fallback is enabled`);
  let stopping = false;
  process.on("SIGINT", () => (stopping = true));
  process.on("SIGTERM", () => (stopping = true));

  while (!stopping) {
    const outcome = await processNextRun({ db, engine, log });
    if (outcome) continue;
    if (once) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  log("stopped");
}

main().catch((err) => {
  console.error("[analysis-worker] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
