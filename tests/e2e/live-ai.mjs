// Live AI review test against a running app and a local Supabase stack.
// Creates a fresh fictional brokerage, turns AI review on, uploads three
// fictional NJ agreements of sale (complete, incomplete, scanned/no text),
// requests pre-signature reviews, runs tests/e2e/live-worker.ts against the
// real model, then records what the broker sees. All people, addresses and
// documents are fictional.
//
//   npx supabase start && npm run build && npm start      # app on :3000
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... \
//   RISE_ANTHROPIC_API_KEY=... node tests/e2e/live-ai.mjs
//
// `--stub` runs tests/e2e/stub-worker.ts instead (no model call) to check the
// harness itself. Output: test-results/live-ai/report.{json,md} and screenshots.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.env.LIVE_OUT ?? "test-results/live-ai";
const STUB = process.argv.includes("--stub");
mkdirSync(OUT, { recursive: true });
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the local stack.");
  process.exit(2);
}

// --- fictional fixtures ------------------------------------------------------
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
/** pages: array of string arrays (text pages) or null (a page with only drawn boxes, like a scan). */
function pdf(pages) {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", null, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const kids = [];
  for (const lines of pages) {
    const stream = lines
      ? `BT /F1 10 Tf 13 TL 60 740 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`
      : Array.from({ length: 40 }, (_, i) => `0.${(i % 7) + 2} g 60 ${720 - i * 16} ${200 + ((i * 37) % 280)} 9 re f`).join("\n");
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const contents = objs.length;
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contents} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    kids.push(`${objs.length} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = objs.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const HEADER = ["FICTIONAL TEST DOCUMENT - NOT A REAL TRANSACTION", ""];
const completePages = [
  [
    ...HEADER,
    "AGREEMENT OF SALE - NEW JERSEY RESIDENTIAL",
    "1. PARTIES. Buyer: Pat Example, 1 Sample Road, Testville, NJ. Seller: Sam Sample,",
    "   44 Placeholder Avenue, Mocktown, NJ 07999.",
    "2. PROPERTY. 44 Placeholder Avenue, Mocktown, NJ 07999, Block 101, Lot 7,",
    "   on the tax map of the Township of Mocktown, Example County.",
    "3. PURCHASE PRICE. The purchase price is $512,000.",
    "4. DEPOSITS. Initial deposit of $5,000 due within 3 business days of acceptance.",
    "   Additional deposit of $20,600 due within 10 days after attorney review ends.",
    "   Deposits are held in trust by Example Title Agency LLC.",
    "5. MORTGAGE CONTINGENCY. Buyer will apply for a mortgage of $409,600, 30-year fixed.",
    "   The mortgage commitment date is December 1, 2026.",
    "6. CLOSING DATE. Closing will take place on or before December 18, 2026.",
    "7. INSPECTION CONTINGENCY. Buyer may have the property inspected. All inspections",
    "   must be completed and any report delivered to Seller within 10 days after the",
    "   end of the attorney review period.",
  ],
  [
    ...HEADER,
    "8. LEAD-BASED PAINT. The house was built in 1962. The Lead-Based Paint Disclosure and",
    "   Acknowledgment Form is attached and signed by Buyer and Seller. Buyer has a 10-day",
    "   opportunity to conduct a lead-based paint risk assessment.",
    "9. SELLER'S PROPERTY CONDITION DISCLOSURE. Buyer acknowledges receipt of the Seller's",
    "   Property Condition Disclosure Statement dated October 2, 2026, before signing.",
    "10. CONSUMER INFORMATION STATEMENT. By signing below, Buyer and Seller acknowledge",
    "   they received the Consumer Information Statement on New Jersey Real Estate",
    "   Relationships from the brokerage firms involved in this transaction prior to",
    "   the first showing of the property.",
    "11. ATTORNEY REVIEW.",
    "   1. Study by Attorney. The Buyer or the Seller may choose to have an attorney",
    "   study this contract. If an attorney is consulted, the attorney must complete his",
    "   or her review of the contract within a three-day period. This contract will be",
    "   legally binding at the end of this three-day period unless an attorney for the",
    "   Buyer or the Seller reviews and disapproves of the contract.",
    "   2. Counting the Time. You count the three days from the date of delivery of the",
    "   signed contract to the Buyer and the Seller. You do not count Saturdays, Sundays",
    "   or legal holidays.",
    "",
    "Buyer: ______________________  Date: ________",
    "Seller: _____________________  Date: ________",
  ],
];
const incompletePages = [
  [
    ...HEADER,
    "AGREEMENT OF SALE - NEW JERSEY RESIDENTIAL",
    "1. PARTIES. Buyer: Riley Placeholder. Seller: Morgan Fictional.",
    "2. PROPERTY. 9 Demo Court, Sampleboro, NJ 07998. Block ____ Lot ____.",
    "3. PURCHASE PRICE. The purchase price is $389,000.",
    "4. DEPOSITS. Initial deposit: $________. Due date: ____________.",
    "5. MORTGAGE CONTINGENCY. Buyer will apply for a mortgage. Commitment date: ________.",
    "6. CLOSING DATE. Closing will take place on ________________.",
    "7. INSPECTIONS. Buyer may inspect the property. Deadline: to be agreed.",
    "8. CONDITION OF PROPERTY. The house was built in 1955 and is sold in its present",
    "   condition. No disclosure forms are attached to this agreement.",
    "9. ENTIRE AGREEMENT. This agreement is the entire agreement between the parties",
    "   and may only be changed in writing signed by both parties.",
    "",
    "Buyer: ______________________  Date: ________",
    "Seller: _____________________  Date: ________",
  ],
];
const FIXTURES = [
  { key: "complete", address: "44 Placeholder Avenue", file: "live-complete.pdf", bytes: pdf(completePages) },
  { key: "incomplete", address: "9 Demo Court", file: "live-incomplete.pdf", bytes: pdf(incompletePages) },
  { key: "scanned", address: "12 Specimen Street", file: "live-scanned.pdf", bytes: pdf([null, null]) },
];
for (const f of FIXTURES) writeFileSync(join(OUT, f.file), f.bytes);

// --- browser flow ------------------------------------------------------------
const run = Date.now().toString(36);
const slug = `live-ai-${run}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let shots = 0;
const shot = (page, label) => page.screenshot({ path: join(OUT, `${String(++shots).padStart(2, "0")}-${label}.png`), fullPage: true });

async function newUser(name, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("fictional-pass-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/orgs/);
  return page;
}

const admin = await newUser("Dana Live-Admin", `admin-${run}@live-ai.test`);
await admin.getByLabel("Brokerage name").fill("Live AI Test Brokerage (fictional)");
await admin.getByLabel("URL name").fill(slug);
await admin.getByRole("button", { name: "Create brokerage" }).click();
await admin.waitForURL(new RegExp(`/o/${slug}/dashboard/broker`));
const broker = await newUser("Bo Live-Broker", `broker-${run}@live-ai.test`);
const agent = await newUser("Ava Live-Agent", `agent-${run}@live-ai.test`);
await admin.goto(`${BASE}/o/${slug}/members`);
for (const [email, role] of [[`broker-${run}@live-ai.test`, "broker"], [`agent-${run}@live-ai.test`, "agent"]]) {
  await admin.getByLabel("Email").fill(email);
  await admin.getByLabel("Role").selectOption(role);
  await admin.getByRole("button", { name: "Add member" }).click();
  await admin.getByText(`Added ${email}.`).waitFor();
}
await admin.goto(`${BASE}/o/${slug}/settings`);
await admin.getByRole("button", { name: "Turn on AI review" }).click();
await admin.getByText("AI review is on for new review requests.").waitFor();

for (const f of FIXTURES) {
  await agent.goto(`${BASE}/o/${slug}/transactions/new`);
  await agent.getByLabel("Property address").fill(f.address);
  await agent.getByLabel("Representing").selectOption("buyer");
  await agent.getByRole("button", { name: "Create transaction" }).click();
  await agent.waitForURL(/\/transactions\/[0-9a-f-]{36}$/);
  await agent.getByLabel("Title").fill(`Agreement of sale (${f.key})`);
  await agent.locator('input[name="file"]').last().setInputFiles(join(OUT, f.file));
  await agent.getByRole("button", { name: "Upload document" }).click();
  await agent.getByText(`Uploaded ${f.file}.`).waitFor();
  await agent.reload();
  await agent.getByRole("button", { name: "Request pre-signature review" }).click();
  await agent.waitForURL(/\/reviews\/[0-9a-f-]{36}$/);
  f.reviewUrl = agent.url();
  f.reviewId = f.reviewUrl.split("/").at(-1);
}
console.log(`Queued ${FIXTURES.length} reviews in brokerage ${slug}.`);

// --- worker ------------------------------------------------------------------
const workerScript = STUB ? "tests/e2e/stub-worker.ts" : "tests/e2e/live-worker.ts";
const started = Date.now();
let workerOut = "";
try {
  workerOut = execFileSync("npx", ["tsx", "--tsconfig", "tsconfig.json", workerScript], { env: process.env, encoding: "utf8", timeout: 20 * 60_000 });
} catch (e) {
  workerOut = `${e.stdout ?? ""}${e.stderr ?? ""}`;
  console.error("Worker exited with an error:\n" + workerOut);
}
const wallMs = Date.now() - started;
const liveRuns = Object.fromEntries(
  workerOut.split("\n").filter((l) => l.startsWith("LIVE_RUN ")).map((l) => JSON.parse(l.slice(9))).map((r) => [r.run_id, r]),
);

// --- results -------------------------------------------------------------------
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const report = { worker: STUB ? "stub (no model call)" : "live", brokerage: slug, wall_ms: wallMs, documents: [] };
for (const f of FIXTURES) {
  const { data: runs, error } = await db
    .from("analysis_runs")
    .select("id,status,error,result,created_at,completed_at")
    .eq("review_id", f.reviewId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const r = runs?.[0];
  const items = r?.result?.items ?? [];
  const counts = {};
  for (const i of items) counts[i.status] = (counts[i.status] ?? 0) + 1;
  const visible = await broker.goto(f.reviewUrl).then(async () => {
    await broker.waitForLoadState("networkidle");
    await shot(broker, `broker-${f.key}`);
    return {
      draft_banner: (await broker.getByText("Draft AI checklist, not a decision").count()) > 0,
      approve_button: (await broker.getByRole("button", { name: "Approve" }).count()) > 0,
    };
  });
  report.documents.push({
    fixture: f.key,
    review_url: f.reviewUrl,
    run_status: r?.status ?? "none",
    error: r?.error ?? null,
    model: r?.result?.model ?? null,
    is_mock: r?.result?.is_mock ?? null,
    verification: r?.result?.verification ?? null,
    item_status_counts: counts,
    items: items.map((i) => ({ id: i.id, status: i.status, quotes: (i.evidence ?? []).length, note: i.note ?? "" })),
    broker_view: visible,
    usage: r ? liveRuns[r.id] ?? null : null,
  });
}
await browser.close();

writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
const md = [
  `# Live AI review test (${report.worker})`,
  "",
  `Brokerage \`${slug}\`, worker wall time ${(wallMs / 1000).toFixed(1)} s.`,
  "",
  "| Document | Run | Model | Quotes verified | Items (present / missing / attention / not evaluated) | Model time | Tokens in / out | Cost |",
  "|---|---|---|---|---|---|---|---|",
  ...report.documents.map((d) => {
    const c = d.item_status_counts;
    const v = d.verification ? `${d.verification.quotes_verified} of ${d.verification.quotes_returned}` : "-";
    const u = d.usage;
    return `| ${d.fixture} | ${d.run_status}${d.error ? `: ${d.error}` : ""} | ${d.model ?? "-"} | ${v} | ${c.present ?? 0} / ${c.missing ?? 0} / ${c.needs_attention ?? 0} / ${c.not_evaluated ?? 0} | ${u?.model_ms ? `${(u.model_ms / 1000).toFixed(1)} s` : "-"} | ${u?.tokens ? `${u.tokens.input} / ${u.tokens.output}` : "-"} | ${u ? `$${u.cost_usd.toFixed(4)}` : "-"} |`;
  }),
  "",
  ...report.documents.flatMap((d) => [
    `## ${d.fixture}`,
    "",
    ...d.items.map((i) => `- \`${i.id}\`: ${i.status}${i.quotes ? ` (${i.quotes} verified quote${i.quotes > 1 ? "s" : ""})` : ""}${i.note ? `. ${i.note}` : ""}`),
    "",
  ]),
].join("\n");
writeFileSync(join(OUT, "report.md"), md);
console.log("\n" + md);
