// End-to-end walkthrough of Sprint 001 against a running app and a local
// Supabase stack. All people, addresses and files are fictional.
//
//   npx supabase start && npx supabase db reset   # fresh, empty database
//   npm run build && npm start                    # app on :3000 with .env.local
//   npm run test:e2e                              # screenshots -> test-results/e2e
//
// Uses the repo's playwright dependency; set CHROMIUM_PATH to reuse a local
// browser instead of `npx playwright install chromium`.
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.env.E2E_OUT ?? "test-results/e2e";
mkdirSync(OUT, { recursive: true });

function samplePdf(text) {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
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
writeFileSync(join(OUT, "fake.pdf"), "<html>not a pdf</html>");
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

await step("Admin adds broker and agent as members", async () => {
  const p = admin.page;
  await p.goto(`${BASE}/o/${slug}/members`);
  for (const [email, role] of [["broker@rise-demo.test", "broker"], ["agent@rise-demo.test", "agent"]]) {
    await p.getByLabel("Email").fill(email);
    await p.getByLabel("Role").selectOption(role);
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
  await shot(p, "broker-dashboard");
  await p.goto(`${BASE}/o/${slug}/queues/pre-signature`);
  await p.getByRole("link", { name: /Purchase agreement · v2/ }).first().waitFor();
  await shot(p, "pre-signature-queue");
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

await browser.close();
console.log("\nSUMMARY", results.filter((r) => r[0] === "PASS").length, "passed,", results.filter((r) => r[0] === "FAIL").length, "failed");
for (const r of results) console.log(r.join(" | "));
process.exitCode = results.some((r) => r[0] === "FAIL") ? 1 : 0;
