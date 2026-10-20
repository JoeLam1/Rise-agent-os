/**
 * Production health check. Exits 1 (and prints why) when something needs a
 * person: the app is down, the database can't be reached, or AI reviews are
 * piling up or failing. Runs on a schedule on the worker host, next to the
 * worker and with the same environment; see docs/DEPLOYMENT.md.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [APP_URL=https://...] \
 *   [HEARTBEAT_URL=https://hc-ping.com/<uuid>] npm run health
 *
 * HEARTBEAT_URL is a dead man's switch (Healthchecks.io-style): each run pings
 * it, or <url>/fail on a problem, so the monitoring service alerts when the
 * checks fail *or stop arriving* (host down).
 *
 * Read-only. Uses the service role because it looks across all brokerages;
 * it only reads analysis run status and timestamps, never documents.
 */
import { createClient } from "@supabase/supabase-js";
import { evaluateRuns, type RunSnapshot } from "@/lib/ops/health";

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(2);
  }
  const problems: string[] = [];
  const notes: string[] = [];

  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      const res = await fetch(new URL("/login", appUrl), { redirect: "manual", signal: AbortSignal.timeout(15000) });
      if (res.status !== 200) problems.push(`App returned HTTP ${res.status} for /login.`);
      else notes.push("App is up.");
    } catch (err) {
      problems.push(`App unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const { data, error } = await db
    .from("analysis_runs")
    .select("status, engine, created_at, started_at, completed_at")
    .or(`status.in.(queued,running),completed_at.gte.${since}`)
    .limit(5000);
  if (error) {
    problems.push(`Database query failed: ${error.message}`);
  } else {
    const report = evaluateRuns((data ?? []) as RunSnapshot[], new Date());
    problems.push(...report.problems);
    notes.push(...report.notes);
  }

  for (const n of notes) console.log(`ok: ${n}`);
  for (const p of problems) console.log(`PROBLEM: ${p}`);

  const heartbeat = process.env.HEARTBEAT_URL;
  if (heartbeat) {
    const target = problems.length ? `${heartbeat.replace(/\/$/, "")}/fail` : heartbeat;
    await fetch(target, { method: "POST", body: [...problems, ...notes].join("\n"), signal: AbortSignal.timeout(10000) }).catch(
      (err) => console.log(`PROBLEM: heartbeat ping failed: ${err instanceof Error ? err.message : err}`),
    );
  }
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error("health check crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
