// End-to-end walkthrough against a running app and a local Supabase stack.
// All people, addresses and files are fictional.
//
//   npx supabase start && npx supabase db reset   # fresh, empty database
//   npm run build && npm start                    # app on :3000 with .env.local
//   npm run test:e2e                              # screenshots -> test-results/e2e
//
// The AI review steps also need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for
// the local stack (from `npx supabase status`); they run tests/e2e/stub-worker.ts,
// which uses the real worker pipeline with a stubbed model call. Without those
// variables the AI steps are reported as SKIP.
//
// Uses the repo's playwright dependency; set CHROMIUM_PATH to reuse a local
// browser instead of `npx playwright install chromium`.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.env.E2E_OUT ?? "test-results/e2e";
mkdirSync(OUT, { recursive: true });

function samplePdf(text) {
  const lines = Array.isArray(text) ? text : [text];
  const stream = `BT /F1 12 Tf 16 TL 72 720 Td ${lines.map((l) => `(${l}) Tj T*`).join(" ")} ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
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
const DIR = OUT;
writeFileSync(join(OUT, "contract-v1.pdf"), samplePdf("SAMPLE PURCHASE AGREEMENT v1 - FICTIONAL TEST DATA"));
writeFileSync(join(OUT, "contract-v2.pdf"), samplePdf("SAMPLE PURCHASE AGREEMENT v2 - FICTIONAL TEST DATA"));
writeFileSync(
  join(OUT, "contract-v3-signed.pdf"),
  samplePdf(["SAMPLE PURCHASE AGREEMENT v2 - FICTIONAL TEST DATA", "Closing on June 30. Signed: /s/ Pat Example /s/ Sam Sample"]),
);
writeFileSync(join(OUT, "fake.pdf"), "<html>not a pdf</html>");
writeFileSync(
  join(OUT, "ai-contract.pdf"),
  samplePdf([
    "AGREEMENT OF SALE - FICTIONAL TEST DOCUMENT",
    "Buyer: Pat Example. Seller: Sam Sample.",
    "Property: 20 Example Lane, Sampletown, NJ. Block 1 Lot 2.",
    "Purchase price: $500,000. Initial deposit: $5,000.",
    "Closing date: ________",
    "ATTORNEY REVIEW: Study by Attorney. The Buyer or the Seller may choose to have an",
    "attorney study this contract within a three-day period.",
  ]),
);
writeFileSync(join(OUT, "no-text.pdf"), samplePdf([""]));
const results = [];
let n = 0;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
    console.log("PASS", name);
  } catch (e) {
    results.push(["FAIL", name, String(e.message).split("\n")[0]]);
    console.log("FAIL", name, "-", String(e.message).split("\n").slice(0, 3).join(" | "));
  }
}
async function shot(page, label) {
  n += 1;
  await page.screenshot({ path: `${DIR}/${String(n).padStart(2, "0")}-${label}.png`, fullPage: true });
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}
// Emails (sign-up confirmation, invitations, password reset) are read from the
// local stack's Mailpit; nothing leaves the machine.
const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
async function emailLink(to, since) {
  for (let i = 0; i < 40; i += 1) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const list = res.ok ? await res.json() : { messages: [] };
    const msg = (list.messages ?? []).find((m) => new Date(m.Created) >= since);
    if (msg) {
      const body = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
      const href = /href="([^"]*\/auth\/confirm\?[^"]+)"/.exec(body.HTML ?? "")?.[1];
      expect(href, `no /auth/confirm link in the email to ${to}`);
      return href.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email to ${to} arrived`);
}
// RFC 6238 codes for the authenticator-app steps. A code is used at most once
// per 30-second window, as a real app would show a fresh one each time.
const usedSteps = new Map();
async function totp(secret) {
  let step = Math.floor(Date.now() / 30000);
  if ((usedSteps.get(secret) ?? -1) >= step) {
    await new Promise((r) => setTimeout(r, (step + 1) * 30000 - Date.now() + 250));
    step += 1;
  }
  usedSteps.set(secret, step);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
async function enrollMfa(page) {
  await page.goto(`${BASE}/account/security`);
  await page.getByRole("button", { name: "Set up two-step sign-in" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent()).trim();
  await shot(page, "mfa-setup");
  await page.getByLabel("Code").fill(await totp(secret));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  // The page re-renders once the session is upgraded and shows the "On" state.
  await page.getByText(/asked for a code from your authenticator app/).waitFor();
  return secret;
}
async function newUser(name, email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByLabel("Full name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("fictional-pass-123");
  const since = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByText("Check your email to confirm your account").waitFor();
  await page.goto(await emailLink(email, since));
  await page.waitForURL(/\/orgs/);
  return { ctx, page };
}

let admin, broker, agent, other;
const slug = "rise-demo";

await step("Admin signs up and creates a brokerage", async () => {
  admin = await newUser("Dana Demo-Admin", "admin@rise-demo.test");
  await shot(admin.page, "orgs-empty");
  await admin.page.getByLabel("Brokerage name").fill("RISE Demo Brokerage (fictional)");
  await admin.page.getByLabel("URL name").fill(slug);
  await admin.page.getByRole("button", { name: "Create brokerage" }).click();
  await admin.page.waitForURL(new RegExp(`/o/${slug}/dashboard/broker`));
  await shot(admin.page, "admin-broker-dashboard-empty");
});

await step("Broker, agent and an outsider sign up", async () => {
  broker = await newUser("Bo Demo-Broker", "broker@rise-demo.test");
  agent = await newUser("Ava Demo-Agent", "agent@rise-demo.test");
  other = await newUser("Oscar Other-Brokerage", "broker@other-demo.test");
});

await step("Admin can't manage members until two-step sign-in is on, then turns it on", async () => {
  const p = admin.page;
  await p.goto(`${BASE}/o/${slug}/members`);
  await p.getByText("Turn on two-step sign-in").waitFor();
  await p.getByLabel("Email").fill("broker@rise-demo.test");
  await p.getByRole("button", { name: "Add member" }).click();
  await p.getByText("This needs two-step sign-in").waitFor();
  admin.secret = await enrollMfa(p);
  await p.goto(`${BASE}/o/${slug}/members`);
  expect((await p.getByText("Turn on two-step sign-in").count()) === 0, "banner still shown");
});

await step("Admin adds broker and agent as members", async () => {
  const p = admin.page;
  await p.goto(`${BASE}/o/${slug}/members`);
  for (const [email, role] of [["broker@rise-demo.test", "broker"], ["agent@rise-demo.test", "agent"]]) {
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Role", { exact: true }).selectOption(role);
    await p.getByRole("button", { name: "Add member" }).click();
    await p.getByText(`Added ${email}.`).waitFor();
  }
  await p.reload();
  await shot(p, "members");
  expect((await p.getByRole("row").count()) === 4, "expected 3 members + header");
});

let txnUrl;
await step("Agent creates a transaction", async () => {
  const p = agent.page;
  await p.goto(`${BASE}/orgs`);
  await p.waitForURL(new RegExp(`/o/${slug}/dashboard/agent`));
  await shot(p, "agent-dashboard-empty");
  await p.goto(`${BASE}/o/${slug}/transactions/new`);
  await p.getByLabel("Property address").fill("10 Example Lane");
  await p.getByLabel("City").fill("Sampletown");
  await p.getByLabel("Representing").selectOption("buyer");
  await p.getByLabel("Expected close date").fill("2026-12-15");
  await p.getByLabel("Notes").fill("Fictional test transaction.");
  await shot(p, "new-transaction-form");
  await p.getByRole("button", { name: "Create transaction" }).click();
  await p.waitForURL(/\/transactions\/[0-9a-f-]{36}$/);
  txnUrl = p.url();
});

await step("Upload is refused when the file isn't really a PDF", async () => {
  const p = agent.page;
  await p.getByLabel("Title").fill("Fake");
  await p.locator('input[name="file"]').last().setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: readFileSync(`${DIR}/fake.pdf`) });
  await p.getByRole("button", { name: "Upload document" }).click();
  await p.getByText("The file contents don't match its type.").waitFor();
});

await step("Agent uploads a document (v1) and a second version (v2)", async () => {
  const p = agent.page;
  await p.goto(txnUrl);
  await p.getByLabel("Title").fill("Purchase agreement");
  await p.locator('input[name="file"]').last().setInputFiles(`${DIR}/contract-v1.pdf`);
  await p.getByRole("button", { name: "Upload document" }).click();
  await p.getByText("Uploaded contract-v1.pdf.").waitFor();
  await p.reload();
  await p.locator('input[name="file"]').first().setInputFiles(`${DIR}/contract-v2.pdf`);
  await p.getByRole("button", { name: "Upload new version" }).click();
  await p.getByText("Uploaded contract-v2.pdf.").waitFor();
  await p.reload();
  expect((await p.getByText("v1", { exact: true }).count()) === 1, "v1 missing");
  expect((await p.getByText("v2", { exact: true }).count()) === 1, "v2 missing");
  await shot(p, "transaction-with-versions");
});

let versionHref;
await step("Download returns the exact bytes that were uploaded", async () => {
  const p = agent.page;
  versionHref = await p.getByRole("link", { name: "contract-v2.pdf" }).getAttribute("href");
  const res = await p.request.get(`${BASE}${versionHref}`);
  expect(res.ok(), `download status ${res.status()}`);
  const got = createHash("sha256").update(await res.body()).digest("hex");
  const want = createHash("sha256").update(readFileSync(`${DIR}/contract-v2.pdf`)).digest("hex");
  expect(got === want, `hash mismatch ${got} vs ${want}`);
  const shown = await p.locator("code", { hasText: "sha256" }).first().textContent();
  expect(shown.includes(want.slice(0, 12)), "displayed hash doesn't match");
});

let reviewUrl;
await step("Agent requests a pre-signature review on v2", async () => {
  const p = agent.page;
  await p.getByRole("button", { name: "Request pre-signature review" }).click();
  await p.waitForURL(/\/reviews\/[0-9a-f-]{36}$/);
  reviewUrl = p.url();
  await p.getByText("This is not a review result").waitFor();
  await shot(p, "agent-review-page-mock");
  expect((await p.getByRole("button", { name: "Approve" }).count()) === 0, "agent sees Approve");
});

await step("A second pre-signature request on the same version is refused", async () => {
  const p = agent.page;
  await p.goto(txnUrl);
  await p.getByRole("button", { name: "Request pre-signature review" }).click();
  await p.getByText(/already exists/).waitFor();
});

await step("Broker sees it in the pre-signature queue and on the dashboard", async () => {
  const p = broker.page;
  await p.goto(`${BASE}/o/${slug}`);
  await p.waitForURL(new RegExp(`/o/${slug}/dashboard/broker`));
  await p.getByText("Turn on two-step sign-in").waitFor();
  await shot(p, "broker-dashboard");
  await p.goto(`${BASE}/o/${slug}/queues/pre-signature`);
  await p.getByRole("link", { name: /Purchase agreement · v2/ }).first().waitFor();
  await shot(p, "pre-signature-queue");
});

await step("Broker can't approve without two-step sign-in, then turns it on", async () => {
  const p = broker.page;
  await p.goto(reviewUrl);
  await p.getByRole("button", { name: "Approve" }).click();
  await p.getByText("This needs two-step sign-in").waitFor();
  broker.secret = await enrollMfa(p);
});

await step("Request changes without a note is refused", async () => {
  const p = broker.page;
  await p.goto(reviewUrl);
  await p.getByRole("button", { name: "Request changes" }).click();
  await p.getByText("Add a note explaining what needs to change.").waitFor();
});

await step("Broker approves with a note", async () => {
  const p = broker.page;
  await p.goto(reviewUrl);
  await shot(p, "broker-review-before-decision");
  await p.getByLabel("Decision note").fill("Read v2 directly. Fictional test approval.");
  await p.getByRole("button", { name: "Approve" }).click();
  // The page re-renders into its decided state, replacing the form.
  await p.getByText(/by Bo Demo-Broker on/).waitFor();
  await p.reload();
  expect((await p.getByRole("button", { name: "Approve" }).count()) === 0, "form still shown after decision");
  await shot(p, "broker-review-approved");
});

await step("Audit log records the whole trail", async () => {
  const p = broker.page;
  await p.goto(`${BASE}/o/${slug}/audit`);
  for (const a of ["organization.created", "membership.created", "transaction.created", "document.created", "document_version.created", "review.created", "analysis_run.created", "review.ready_for_broker", "review.approved"]) {
    expect((await p.getByText(a, { exact: true }).count()) > 0, `missing ${a}`);
  }
  await shot(p, "audit-log");
});

// ---------------------------------------------------------------------------
// Sprint 006: key dates, review turnaround, comparing versions
// ---------------------------------------------------------------------------
const njDate = (offsetDays) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return new Date(Date.parse(`${today}T00:00:00Z`) + offsetDays * 86_400_000).toISOString().slice(0, 10);
};

await step("Agent records key dates; they show on both dashboards until done", async () => {
  const p = agent.page;
  await p.goto(txnUrl);
  await p.getByLabel("Date for").selectOption("other");
  await p.getByLabel("Due on").fill(njDate(5));
  await p.getByRole("button", { name: "Add date" }).click();
  await p.getByText("Describe the date.").waitFor();
  await p.getByLabel("Date for").selectOption("inspection");
  await p.getByLabel("Due on").fill(njDate(3));
  await p.getByRole("button", { name: "Add date" }).click();
  await p.getByText("In 3 days").waitFor();
  await shot(p, "key-dates");

  await p.goto(`${BASE}/o/${slug}/dashboard/agent`);
  const agentRow = p.getByRole("row").filter({ hasText: "Inspection" });
  await agentRow.getByRole("link", { name: "10 Example Lane" }).waitFor();

  const b = broker.page;
  await b.goto(`${BASE}/o/${slug}/dashboard/broker`);
  await b.getByRole("row").filter({ hasText: "Inspection" }).getByText("In 3 days").waitFor();
  await b.goto(txnUrl);
  await b.getByRole("button", { name: "Mark done: Inspection" }).click();
  await b.getByRole("button", { name: "Reopen: Inspection" }).waitFor();
  await b.goto(`${BASE}/o/${slug}/dashboard/broker`);
  await b.getByText("Nothing due in the next two weeks.").waitFor();
  await b.goto(`${BASE}/o/${slug}/audit`);
  await b.getByText("key_date.completed", { exact: true }).first().waitFor();
});

await step("Broker dashboard shows review turnaround", async () => {
  const p = broker.page;
  await p.goto(`${BASE}/o/${slug}/dashboard/broker`);
  const card = p.getByTestId("turnaround");
  await card.waitFor();
  const text = await card.textContent();
  expect(/Decisions \(last 30 days\)\s*1/.test(text), `turnaround shows: ${text}`);
  expect(!/Median time to a decision \(last 30 days\)\s*—/.test(text), `no median: ${text}`);
  await shot(p, "broker-dashboard-turnaround");
});

await step("Versions compare word by word; the post-execution review links to the approved draft", async () => {
  const p = agent.page;
  await p.goto(txnUrl);
  await p.getByRole("link", { name: "Compare with v1" }).click();
  await p.getByTestId("compare-summary").getByText("1 place changed: 1 word removed, 1 word added.").waitFor();
  await p.locator("del", { hasText: "v1" }).waitFor();
  await p.locator("ins", { hasText: "v2" }).waitFor();

  await p.goto(txnUrl);
  await p.locator('input[name="file"]').first().setInputFiles(`${DIR}/contract-v3-signed.pdf`);
  await p.getByRole("button", { name: "Upload new version" }).click();
  await p.getByText("Uploaded contract-v3-signed.pdf.").waitFor();
  await p.reload();
  await p.getByRole("button", { name: "Request post-execution review" }).click();
  await p.waitForURL(/\/reviews\/[0-9a-f-]{36}$/);
  const postUrl = p.url();

  const b = broker.page;
  await b.goto(postUrl);
  await b.getByText(/Purchase agreement v2 was approved by Bo Demo-Broker/).waitFor();
  await b.getByRole("link", { name: "Compare it with this version" }).click();
  await b.getByText("Purchase agreement v2 → Purchase agreement v3").waitFor();
  await b.getByTestId("compare-summary").getByText(/1 place changed: 0 words removed, \d+ words added\./).waitFor();
  await b.locator("ins", { hasText: "Closing on June 30." }).waitFor();
  await shot(b, "compare-post-execution");
});

await step("Agent can't open the audit log or broker dashboard", async () => {
  const p = agent.page;
  await p.goto(`${BASE}/o/${slug}/audit`);
  expect(p.url().endsWith(`/o/${slug}/dashboard/agent`), `agent landed on ${p.url()}`);
  await p.goto(`${BASE}/o/${slug}/dashboard/broker`);
  expect(p.url().endsWith(`/o/${slug}/dashboard/agent`), `agent landed on ${p.url()}`);
  await shot(p, "agent-dashboard-after");
});

await step("Outsider from another brokerage gets nothing", async () => {
  const p = other.page;
  for (const url of [`${BASE}/o/${slug}`, txnUrl, reviewUrl]) {
    const res = await p.goto(url);
    expect(res.status() === 404, `${url} returned ${res.status()}`);
  }
  await shot(p, "outsider-404");
  const dl = await p.request.get(`${BASE}${versionHref}`, { maxRedirects: 0 });
  expect(dl.status() === 404, `download returned ${dl.status()}`);
});

await step("Signed-out visitor is sent to login", async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(reviewUrl);
  expect(p.url().includes("/login"), `landed on ${p.url()}`);
});

// ---------------------------------------------------------------------------
// Sprint 002: AI review (model call stubbed; see tests/e2e/stub-worker.ts)
// ---------------------------------------------------------------------------
const canRunWorker = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
function runStubWorker() {
  return execFileSync("npx", ["tsx", "--tsconfig", "tsconfig.json", "tests/e2e/stub-worker.ts"], {
    env: process.env,
    encoding: "utf8",
  });
}
async function aiStep(name, fn) {
  if (!canRunWorker && process.env.E2E_REQUIRE_AI_STEPS) {
    results.push(["FAIL", name, "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set but E2E_REQUIRE_AI_STEPS is"]);
    console.log("FAIL", name);
    return;
  }
  if (!canRunWorker) {
    results.push(["SKIP", name, "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set"]);
    console.log("SKIP", name);
    return;
  }
  await step(name, fn);
}
async function newTransactionWithPdf(p, address, file) {
  await p.goto(`${BASE}/o/${slug}/transactions/new`);
  await p.getByLabel("Property address").fill(address);
  await p.getByLabel("Representing").selectOption("buyer");
  await p.getByRole("button", { name: "Create transaction" }).click();
  await p.waitForURL(/\/transactions\/[0-9a-f-]{36}$/);
  await p.getByLabel("Title").fill("Agreement of sale");
  await p.locator('input[name="file"]').last().setInputFiles(`${DIR}/${file}`);
  await p.getByRole("button", { name: "Upload document" }).click();
  await p.getByText(`Uploaded ${file}.`).waitFor();
  await p.reload();
  await p.getByRole("button", { name: "Request pre-signature review" }).click();
  await p.waitForURL(/\/reviews\/[0-9a-f-]{36}$/);
  return p.url();
}

await aiStep("Only an admin sees Settings; admin turns on AI review", async () => {
  await agent.page.goto(`${BASE}/o/${slug}/settings`);
  expect(!agent.page.url().endsWith("/settings"), "agent reached settings");
  const p = admin.page;
  await p.goto(`${BASE}/o/${slug}/settings`);
  await p.getByRole("button", { name: "Turn on AI review" }).click();
  await p.getByText("AI review is on for new review requests.").waitFor();
  await shot(p, "settings-ai-on");
});

let aiReviewUrl;
await aiStep("A PDF review waits for analysis and can't be decided yet", async () => {
  aiReviewUrl = await newTransactionWithPdf(agent.page, "20 Example Lane", "ai-contract.pdf");
  await agent.page.getByText("Analyzing the document…").waitFor();
  await shot(agent.page, "ai-review-analyzing");
  await broker.page.goto(aiReviewUrl);
  await broker.page.getByText("Analyzing the document…").waitFor();
  expect((await broker.page.getByRole("button", { name: "Approve" }).count()) === 0, "broker can approve before analysis");
});

await aiStep("Worker analyzes it; the page shows the draft checklist with verified quotes only", async () => {
  const out = runStubWorker();
  expect(/-> completed/.test(out), `worker output: ${out}`);
  const p = agent.page; // still on the review page; AutoRefresh picks up the result
  await p.getByText("Draft AI checklist, not a decision").waitFor({ timeout: 20000 });
  await p.getByText("ATTORNEY REVIEW: Study by Attorney.").waitFor();
  await p.getByText("· page 1").first().waitFor();
  expect((await p.getByText("Exhibit Z").count()) === 0, "unverified quote was shown");
  await p.getByText(/2 of 3 quotes were found/).waitFor();
  await p.getByText("stub-model-for-tests", { exact: false }).waitFor();
  await shot(p, "ai-review-result");
});

await aiStep("Broker approves the AI-reviewed document with a note", async () => {
  const p = broker.page;
  await p.goto(aiReviewUrl);
  await p.getByLabel("Decision note").fill("Read the document myself. Fictional test approval.");
  await p.getByRole("button", { name: "Approve" }).click();
  await p.getByText(/by Bo Demo-Broker on/).waitFor();
  await shot(p, "ai-review-approved");
});

await aiStep("A PDF with no text fails analysis but still reaches the broker", async () => {
  const url = await newTransactionWithPdf(agent.page, "30 Example Lane", "no-text.pdf");
  const out = runStubWorker();
  expect(/-> failed/.test(out), `worker output: ${out}`);
  const p = broker.page;
  await p.goto(url);
  await p.getByText("No AI analysis for this version").waitFor();
  await p.getByText(/little or no text layer/).waitFor();
  await shot(p, "ai-review-failed");
  await p.getByLabel("Decision note").fill("Scanned copy; please upload a text PDF.");
  await p.getByRole("button", { name: "Request changes" }).click();
  await p.getByText(/by Bo Demo-Broker on/).waitFor();
});

await aiStep("Audit log records the AI switch and the run lifecycle", async () => {
  const p = broker.page;
  await p.goto(`${BASE}/o/${slug}/audit`);
  for (const a of ["organization.ai_review_enabled", "analysis_run.updated"]) {
    expect((await p.getByText(a, { exact: true }).count()) > 0, `missing ${a}`);
  }
});

// ---------------------------------------------------------------------------
// Sprint 003: email invitations and password reset
// ---------------------------------------------------------------------------
async function setPassword(p, password) {
  await p.waitForURL(/\/account\/password/);
  await p.getByLabel("New password").fill(password);
  await p.getByLabel("Confirm password").fill(password);
  await p.getByRole("button", { name: "Save password" }).click();
  await p.getByText("Password saved.").waitFor();
}

await step("Admin invites someone without an account; they join from the emailed link", async () => {
  const p = admin.page;
  const email = "invitee@rise-demo.test";
  const since = new Date(Date.now() - 1000);
  await p.goto(`${BASE}/o/${slug}/members`);
  await p.getByLabel("Email").fill(email);
  await p.getByLabel("Role", { exact: true }).selectOption("agent");
  await p.getByRole("button", { name: "Add member" }).click();
  await p.getByText(`Invited ${email}.`).waitFor();
  await p.reload();
  await p.getByRole("cell", { name: email, exact: true }).waitFor();
  await shot(p, "members-pending-invitation");

  const link = await emailLink(email, since);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const ip = await ctx.newPage();
  await ip.goto(link);
  await setPassword(ip, "fictional-invitee-456");
  await shot(ip, "invitee-password-set");
  await ip.goto(`${BASE}/o/${slug}`);
  await ip.waitForURL(new RegExp(`/o/${slug}/`));
  expect(!(await ip.getByText("Page not found").count()), "invitee can't open the brokerage");

  await p.reload();
  expect((await p.getByText("Pending invitations").count()) === 0, "invitation still pending");
  expect((await p.getByRole("cell", { name: email, exact: true }).count()) > 0, "invitee not listed as a member");
  await ctx.close();
});

await step("Admin revokes an invitation", async () => {
  const p = admin.page;
  const email = "revoked@rise-demo.test";
  await p.getByLabel("Email").fill(email);
  await p.getByRole("button", { name: "Add member" }).click();
  await p.getByText(`Invited ${email}.`).waitFor();
  await p.reload();
  await p.getByRole("button", { name: `Revoke invitation for ${email}` }).click();
  await p.getByText("Pending invitations").waitFor({ state: "detached" });
});

await step("Forgotten password: reset by email, then sign in with the new one", async () => {
  const email = "broker@other-demo.test";
  const since = new Date(Date.now() - 1000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/login`);
  await p.getByRole("button", { name: "Forgot your password?" }).click();
  await p.getByLabel("Email").fill(email);
  await p.getByRole("button", { name: "Send reset link" }).click();
  await p.getByText("If an account exists for that email").waitFor();
  await shot(p, "reset-requested");

  await p.goto(await emailLink(email, since));
  await setPassword(p, "fictional-new-pass-789");
  await ctx.close();

  const fresh = await browser.newContext();
  const f = await fresh.newPage();
  await f.goto(`${BASE}/login`);
  await f.getByLabel("Email").fill(email);
  await f.getByLabel("Password").fill("fictional-pass-123");
  await f.getByRole("button", { name: "Sign in" }).click();
  await f.getByText("Email or password is incorrect.").waitFor();
  // React resets the form after an action, so fill both fields again.
  await f.getByLabel("Email").fill(email);
  await f.getByLabel("Password").fill("fictional-new-pass-789");
  await f.getByRole("button", { name: "Sign in" }).click();
  await f.waitForURL(/\/orgs/);
  await fresh.close();
});

await step("Signing in again asks for the authenticator code", async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/o/${slug}/members`);
  await p.getByLabel("Email").fill("admin@rise-demo.test");
  await p.getByLabel("Password").fill("fictional-pass-123");
  await p.getByRole("button", { name: "Sign in" }).click();
  await p.waitForURL(/\/login\/verify/);
  await shot(p, "mfa-verify");
  // A password-only session can't reach the app before the code.
  await p.goto(`${BASE}/o/${slug}/members`);
  await p.waitForURL(/\/login\/verify/);
  await p.getByLabel("Code").fill("000000");
  await p.getByRole("button", { name: "Verify" }).click();
  await p.getByText("That code didn't match").waitFor();
  await p.getByLabel("Code").fill(await totp(admin.secret));
  await p.getByRole("button", { name: "Verify" }).click();
  await p.waitForURL(new RegExp(`/o/${slug}/members`));
  await ctx.close();
});

// ---------------------------------------------------------------------------
// Sprint 004: managing members and recovering two-step sign-in
// ---------------------------------------------------------------------------
await step("Admin sees who has two-step sign-in, changes a role and removes a member", async () => {
  const p = admin.page;
  await p.goto(`${BASE}/o/${slug}/members`);
  const row = (name) => p.getByRole("row").filter({ hasText: name });
  await row("Bo Demo-Broker").getByText("On", { exact: true }).waitFor();
  await row("Ava Demo-Agent").getByText("Off", { exact: true }).waitFor();
  await shot(p, "members-two-step");

  // The only admin can't step down.
  await p.getByLabel("Role for Dana Demo-Admin", { exact: true }).selectOption("broker");
  await p.getByRole("button", { name: "Save role for Dana Demo-Admin" }).click();
  await p.getByText("a brokerage needs at least one admin").waitFor();

  const who = "invitee@rise-demo.test";
  await p.getByLabel(`Role for ${who}`, { exact: true }).selectOption("broker");
  await p.getByRole("button", { name: `Save role for ${who}` }).click();
  await p.getByText("Role saved.").waitFor();
  await p.reload();
  expect((await p.getByLabel(`Role for ${who}`, { exact: true }).inputValue()) === "broker", "role not saved");

  await p.getByRole("button", { name: `Remove ${who}` }).click();
  await p.getByRole("button", { name: "Confirm remove" }).click();
  // Wait for the row itself to go: the Remove button disappears as soon as
  // the confirm form opens, before the removal has been saved.
  await p.getByRole("cell", { name: who, exact: true }).first().waitFor({ state: "detached" });
  await p.goto(`${BASE}/o/${slug}/audit`);
  await p.getByText("membership.removed", { exact: true }).first().waitFor();
});

await step("Broker loses their phone and recovers with a backup code", async () => {
  const p = broker.page;
  await p.goto(`${BASE}/account/security`);
  await p.getByRole("button", { name: "Create backup codes" }).click();
  await p.getByTestId("backup-codes").waitFor();
  const codes = (await p.getByTestId("backup-codes").locator("li").allTextContents()).map((c) => c.trim());
  expect(codes.length === 10, `got ${codes.length} codes`);
  await shot(p, "backup-codes");

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const f = await ctx.newPage();
  await f.goto(`${BASE}/login`);
  await f.getByLabel("Email").fill("broker@rise-demo.test");
  await f.getByLabel("Password").fill("fictional-pass-123");
  await f.getByRole("button", { name: "Sign in" }).click();
  await f.waitForURL(/\/login\/verify/);
  await f.getByRole("button", { name: "Lost your phone? Use a backup code" }).click();
  await f.getByLabel("Backup code").fill("0000-0000-0000");
  await f.getByRole("button", { name: "Use backup code" }).click();
  await f.getByText("That backup code didn't work").waitFor();
  await f.getByLabel("Backup code").fill(codes[0]);
  await f.getByRole("button", { name: "Use backup code" }).click();
  await f.waitForURL(/\/account\/security\?reset=1/);
  await f.getByText("Your old authenticator app was removed").waitFor();
  await shot(f, "recovered-with-backup-code");
  broker.secret = await enrollMfa(f);
  await f.goto(`${BASE}/o/${slug}`);
  await f.waitForURL(new RegExp(`/o/${slug}/dashboard/broker`));
  expect((await f.getByText("Turn on two-step sign-in").count()) === 0, "still asked to set up two-step sign-in");
  await ctx.close();
});

// ---------------------------------------------------------------------------
// Sprint 005: a removed agent's transactions go to someone still here
// ---------------------------------------------------------------------------
await step("Admin removes the agent and hands their transactions to the broker", async () => {
  const p = admin.page;
  await p.goto(`${BASE}/o/${slug}/members`);
  const who = "Ava Demo-Agent";
  await p.getByRole("button", { name: `Remove ${who}` }).click();
  await p.getByRole("button", { name: "Confirm remove" }).click();
  await p.getByLabel(`New agent for ${who}'s transactions`).waitFor();
  await shot(p, "former-member-transactions");
  await p.getByLabel(`New agent for ${who}'s transactions`).selectOption({ label: "Bo Demo-Broker" });
  await p.getByRole("button", { name: `Reassign ${who}'s transactions` }).click();
  // Once nothing is left to reassign, the whole section goes away.
  await p.getByText("Transactions of former members").waitFor({ state: "detached" });
  await p.reload();
  expect((await p.getByText("Transactions of former members").count()) === 0, "former member still listed");
  await p.goto(`${BASE}/o/${slug}/audit`);
  await p.getByText("transaction.reassigned", { exact: true }).first().waitFor();

  // The removed agent no longer sees it; the brokerage still does.
  await agent.page.goto(txnUrl);
  expect((await agent.page.getByText("10 Example Lane").count()) === 0, "removed agent still sees the transaction");
  await p.goto(txnUrl);
  await p.getByText("10 Example Lane").first().waitFor();
});

await step("A used or broken email link is refused", async () => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/auth/confirm?token_hash=not-a-real-token&type=recovery&next=/account/password`);
  await p.waitForURL(/\/login\?error=link/);
  await p.getByText(/link/i).first().waitFor();
  await ctx.close();
});

await browser.close();
console.log(
  "\nSUMMARY",
  results.filter((r) => r[0] === "PASS").length, "passed,",
  results.filter((r) => r[0] === "FAIL").length, "failed,",
  results.filter((r) => r[0] === "SKIP").length, "skipped",
);
for (const r of results) console.log(r.join(" | "));
process.exitCode = results.some((r) => r[0] === "FAIL") ? 1 : 0;
