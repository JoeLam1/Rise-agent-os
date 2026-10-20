import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { checklistFor } from "./checklist";
import type { AnalysisInput } from "./engine";
import { AnalysisFailure, NJ_ENGINE_VERSION, NjContractEngine } from "./nj-engine";
import { parseAnalysisResult } from "./schema";
import { findQuotePage, normalizeForMatch, verifyItems } from "./verify";

// Fictional contract text. No real parties or properties.
const PAGES = [
  "AGREEMENT OF SALE. Buyer: Pat Example. Seller: Sam Sample. Property: 10 Example Lane, Sampletown, NJ. Block 1 Lot 2. " +
    "Purchase price $500,000. Initial deposit $5,000 due within 3 days. ".repeat(2),
  "ATTORNEY REVIEW. Study by Attorney. The Buyer or the Seller may choose to have an attorney study this contract. " +
    "If an attorney is consulted, the attorney must complete his or her review of the contract within a three-day period. " +
    "Closing date: ________. Mortgage commitment date: March 1, 2027.",
];

const input = (overrides: Partial<AnalysisInput> = {}): AnalysisInput => ({
  reviewId: "r",
  orgId: "o",
  reviewType: "pre_signature",
  documentKind: "purchase_agreement",
  version: { id: "v", sha256: "x", mimeType: "application/pdf", sizeBytes: 10 },
  file: new Uint8Array([1, 2, 3]),
  ...overrides,
});

function fakeMessage(body: unknown, stop_reason = "end_turn"): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    stop_reason,
    content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
  } as unknown as BetaMessage;
}

function engineReturning(body: unknown, stop_reason?: string) {
  const calls: MessageCreateParamsNonStreaming[] = [];
  const engine = new NjContractEngine({
    callModel: async (p) => {
      calls.push(p);
      return fakeMessage(body, stop_reason);
    },
    readText: async () => PAGES,
  });
  return { engine, calls };
}

describe("quote matching", () => {
  it("tolerates curly quotes, line breaks, hyphenation and case", () => {
    expect(normalizeForMatch("Study  by\nAttor-\nney “quoted”")).toBe('study by attorney "quoted"');
    expect(findQuotePage("study by ATTORNEY", PAGES)).toBe(2);
  });

  it("finds a quote on another page when the cited page is wrong", () => {
    expect(findQuotePage("Purchase price $500,000", PAGES, 2)).toBe(1);
  });

  it("rejects invented and trivially short quotes", () => {
    expect(findQuotePage("The seller warrants the roof is new", PAGES)).toBeNull();
    expect(findQuotePage("Buyer", PAGES)).toBeNull();
  });
});

describe("verifyItems", () => {
  const checklist = checklistFor("pre_signature");

  it("drops unverifiable quotes and downgrades findings with no evidence left", () => {
    const { items, stats } = verifyItems(
      checklist,
      [
        { id: "nj.attorney_review_clause", status: "present", evidence: [{ page: 2, quote: "Study by Attorney." }], note: "" },
        { id: "core.closing_date", status: "needs_attention", evidence: [{ page: 2, quote: "Closing date: ________." }], note: "The closing date field is blank." },
        { id: "disclosure.lead_paint", status: "present", evidence: [{ page: 1, quote: "Lead paint disclosure attached" }], note: "" },
      ],
      PAGES,
    );
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId["nj.attorney_review_clause"]).toMatchObject({ status: "present", evidence: [{ page: 2 }] });
    expect(byId["core.closing_date"].status).toBe("needs_attention");
    expect(byId["disclosure.lead_paint"].status).toBe("not_evaluated");
    expect(byId["disclosure.lead_paint"].evidence).toBeUndefined();
    expect(byId["core.price_and_deposits"]).toMatchObject({ status: "not_evaluated", note: expect.stringMatching(/no answer/) });
    expect(stats).toEqual({ quotes_returned: 3, quotes_verified: 2, items_downgraded: 1 });
  });

  it("keeps checklist order, ignores unknown ids and duplicates", () => {
    const { items } = verifyItems(
      checklist,
      [
        { id: "made.up", status: "present", evidence: [], note: "" },
        { id: "core.closing_date", status: "missing", evidence: [], note: "Looked on pages 1-2." },
        { id: "core.closing_date", status: "present", evidence: [], note: "" },
      ],
      PAGES,
    );
    expect(items.map((i) => i.id)).toEqual(checklist.map((c) => c.id));
    expect(items.find((i) => i.id === "core.closing_date")).toMatchObject({ status: "missing", note: "Looked on pages 1-2." });
  });

  it("never evaluates the pre-signature comparison yet", () => {
    const { items } = verifyItems(
      checklistFor("post_execution"),
      [{ id: "exec.changes_since_presignature", status: "present", evidence: [{ page: 1, quote: "Purchase price $500,000" }], note: "" }],
      PAGES,
    );
    expect(items.find((i) => i.id === "exec.changes_since_presignature")?.status).toBe("not_evaluated");
  });
});

describe("NjContractEngine", () => {
  const goodAnswer = {
    summary: "A fictional agreement of sale for a residential property.",
    items: [
      { id: "nj.attorney_review_clause", status: "present", evidence: [{ page: 2, quote: "ATTORNEY REVIEW. Study by Attorney." }], note: "" },
      { id: "core.closing_date", status: "needs_attention", evidence: [{ page: 2, quote: "Closing date: ________." }], note: "The closing date field is blank." },
    ],
  };

  it("sends the PDF with the checklist and returns a verified, schema-valid result", async () => {
    const { engine, calls } = engineReturning(goodAnswer);
    const result = await engine.analyze(input());

    expect(calls).toHaveLength(1);
    const p = calls[0] as MessageCreateParamsNonStreaming & { fallbacks?: unknown; betas?: string[] };
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.thinking).toEqual({ type: "adaptive" });
    expect(p.output_config?.effort).toBe("high");
    expect(p.output_config?.format?.type).toBe("json_schema");
    expect(p.fallbacks).toBe("default");
    expect(p.betas).toEqual(["server-side-fallback-2026-07-01"]);
    const content = p.messages[0].content as { type: string }[];
    expect(content[0].type).toBe("document");

    expect(result.engine).toBe("nj_contract_ai");
    expect(result.engine_version).toBe(NJ_ENGINE_VERSION);
    expect(result.is_mock).toBe(false);
    expect(result.disclaimer).toMatch(/not yet been validated/);
    expect(result.items).toHaveLength(checklistFor("pre_signature").length);
    expect(parseAnalysisResult(result)).not.toBeNull();
  });

  it("refuses non-PDF files and PDFs without a text layer", async () => {
    const { engine } = engineReturning(goodAnswer);
    await expect(engine.analyze(input({ version: { id: "v", sha256: "x", mimeType: "image/png", sizeBytes: 1 } }))).rejects.toBeInstanceOf(
      AnalysisFailure,
    );
    const scanned = new NjContractEngine({ callModel: async () => fakeMessage(goodAnswer), readText: async () => ["", " "] });
    await expect(scanned.analyze(input())).rejects.toThrow(/scan/);
  });

  it("fails cleanly on a refusal, truncation or malformed output", async () => {
    await expect(engineReturning(goodAnswer, "refusal").engine.analyze(input())).rejects.toThrow(/declined/);
    await expect(engineReturning(goodAnswer, "max_tokens").engine.analyze(input())).rejects.toThrow(/cut off/);
    await expect(engineReturning("not json").engine.analyze(input())).rejects.toBeInstanceOf(AnalysisFailure);
    await expect(engineReturning({ summary: "x", items: [{ id: "a" }] }).engine.analyze(input())).rejects.toBeInstanceOf(
      AnalysisFailure,
    );
  });
});

describe("parseAnalysisResult", () => {
  it("rejects an AI result that calls itself mock", async () => {
    const result = await engineReturning({ summary: "x", items: [] }).engine.analyze(input());
    expect(parseAnalysisResult({ ...result, is_mock: true })).toBeNull();
  });
});
