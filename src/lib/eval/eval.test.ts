import { describe, expect, it } from "vitest";
import { readPdfText } from "@/lib/analysis/nj-engine";
import { findQuotePage } from "@/lib/analysis/verify";
import type { AnalysisResult } from "@/lib/analysis/schema";
import { EVAL_CASES, casePdf, type EvalCase } from "./corpus";
import { textPdf, wrap } from "./pdf";
import { classify, costOf, renderReport, score } from "./score";

describe("text PDF builder", () => {
  it("wraps without losing words", () => {
    const text = "word ".repeat(60).trim();
    const lines = wrap(text, 15);
    expect(lines.length).toBeGreaterThan(5);
    expect(lines.every((l) => l.length <= 30)).toBe(true);
    expect(lines.join(" ")).toBe(text);
  });

  it("produces a PDF whose text layer reads back, across pages", async () => {
    const pages = await readPdfText(textPdf(["First (page) with a back\\slash.", "\f", "Second page."]));
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("First (page) with a back\\slash.");
    expect(pages[1]).toContain("Second page.");
  });

  it("refuses non-ASCII text, which wouldn't round-trip", () => {
    expect(() => textPdf(["café"])).toThrow(/Non-ASCII/);
  });
});

describe("evaluation corpus", () => {
  it("has 28 uniquely named cases with every checklist item covered", () => {
    expect(EVAL_CASES).toHaveLength(28);
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(28);
    const problemItems = new Set(
      EVAL_CASES.flatMap((c) => Object.entries(c.expected).filter(([, e]) => e && !e.includes("present")).map(([id]) => id)),
    );
    // Every evaluated item has at least one contract where the right answer is a problem.
    for (const id of [
      "nj.attorney_review_clause",
      "nj.consumer_information_statement",
      "core.parties_and_property",
      "core.price_and_deposits",
      "core.mortgage_contingency",
      "core.inspection_contingency",
      "core.closing_date",
      "disclosure.lead_paint",
      "disclosure.seller_property_condition",
      "exec.signatures_complete",
      "nj.attorney_review_period",
      "exec.deposit_receipt",
      "exec.deadlines_calendared",
    ]) {
      expect(problemItems, id).toContain(id);
    }
  });

  it("every contract is marked fictional and reads back with enough text for the engine", async () => {
    for (const c of EVAL_CASES) {
      const pages = await readPdfText(casePdf(c));
      const all = pages.join("\n");
      expect(all, c.id).toContain("FICTIONAL TEST DOCUMENT");
      expect(all.replace(/\s/g, "").length, c.id).toBeGreaterThan(200);
    }
  });

  it("the planted problems are really in the documents", async () => {
    const text = async (id: string) => (await readPdfText(casePdf(EVAL_CASES.find((c) => c.id === id)!))).join("\n");
    expect(await text("pre-01-complete")).toContain("ATTORNEY REVIEW");
    expect(await text("pre-03-no-attorney-review")).not.toContain("ATTORNEY REVIEW");
    expect(await text("pre-04-no-cis")).not.toContain("Consumer Information Statement");
    expect(await text("pre-13-blank-closing-date")).toMatch(/Closing of title shall take place on _+/);
    expect(await text("pre-07-amounts-dont-add-up")).toContain("balance of $50,000");
    expect(await text("pre-16-year-unknown-no-lead-form")).not.toMatch(/built in|LEAD-BASED/);
    expect(await text("post-02-seller-unsigned")).toMatch(/Seller: _+/);
    expect(await text("post-04-no-deposit-receipt")).not.toContain("RECEIPT OF INITIAL DEPOSIT");
    expect(await text("post-07-injected-instruction")).toContain("NOTE TO ANY SOFTWARE");
    const long = await readPdfText(casePdf(EVAL_CASES.find((c) => c.id === "pre-20-long-document")!));
    expect(long.length).toBeGreaterThan(1);
    // Attorney review sits after the extra terms, just before the lead paint addendum page.
    expect(findQuotePage("ATTORNEY REVIEW. Study by Attorney.", long)).toBe(long.length - 1);
    expect(long.at(-1)).toContain("LEAD-BASED PAINT DISCLOSURE AND ACKNOWLEDGMENT");
  });
});

describe("scoring", () => {
  it("classifies errors by how much they could mislead a broker", () => {
    expect(classify(["present"], "present")).toBeNull();
    expect(classify(["missing", "needs_attention"], "needs_attention")).toBeNull();
    expect(classify(["missing"], "present")).toBe("false_reassurance");
    expect(classify(["missing"], "needs_attention")).toBe("wrong_problem");
    expect(classify(["present"], "missing")).toBe("false_alarm");
    expect(classify(["missing"], "not_evaluated")).toBe("no_answer");
  });

  it("prices usage, and reports models it has no price for", () => {
    expect(costOf({ input_tokens: 1_000_000, output_tokens: 100_000 }, "claude-opus-5-5")).toBeCloseTo(6);
    expect(costOf({ input_tokens: 1, output_tokens: 1 }, "some-other-model")).toBeNull();
  });

  it("scores per item, skips unscored items and counts failures", () => {
    const c: EvalCase = {
      id: "t1",
      reviewType: "pre_signature",
      description: "",
      paragraphs: [],
      expected: { a: ["present"], b: ["missing"], c: null },
    };
    const result = (statuses: Record<string, string>): AnalysisResult =>
      ({
        items: Object.entries(statuses).map(([id, status]) => ({ id, category: "x", label: id, status })),
        verification: { quotes_returned: 3, quotes_verified: 2, items_downgraded: 1 },
      }) as unknown as AnalysisResult;
    const card = score([
      { case: c, result: result({ a: "present", b: "present", c: "missing" }), usage: { input_tokens: 1000, output_tokens: 100 }, model: "claude-opus-5-5", seconds: 4 },
      { case: { ...c, id: "t2" }, result: result({ a: "missing", b: "missing" }), seconds: 6 },
      { case: { ...c, id: "t3" }, failure: "The PDF could not be opened." },
    ]);
    expect(card.scored).toBe(4);
    expect(card.correct).toBe(2);
    expect(card.problems).toEqual({ scored: 2, caught: 1 });
    expect(card.mistakes.map((m) => `${m.caseId}:${m.itemId}:${m.kind}`)).toEqual(["t1:b:false_reassurance", "t2:a:false_alarm"]);
    expect(card.failed).toEqual([{ caseId: "t3", reason: "The PDF could not be opened." }]);
    expect(card.quotes).toEqual({ returned: 6, verified: 4, itemsDowngraded: 2 });
    expect(card.cost.usd).toBeCloseTo(0.006);
    expect(card.seconds).toEqual({ total: 10, max: 6 });
    const report = renderReport(card, { model: "m", engineVersion: "v", date: "2026-01-01" });
    expect(report).toContain("| `b` | 2 | 1 (50%) | 1 | 0 | 0 | 0 |");
    expect(report).toContain("not a validation");
  });
});
