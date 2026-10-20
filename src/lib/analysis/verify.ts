import type { ChecklistItem } from "./checklist";
import type { AnalysisItem } from "./schema";

/** What the model returned for one checklist item, before verification. */
export type RawItem = {
  id: string;
  status: "present" | "missing" | "needs_attention" | "not_evaluated";
  evidence: { page: number; quote: string }[];
  note: string;
};

export const MIN_QUOTE_CHARS = 8;
const MAX_QUOTE_CHARS = 600;
const MAX_NOTE_CHARS = 800;

/**
 * Normalizes text so a quote copied by the model matches the PDF's extracted
 * text despite ligatures, curly quotes, line breaks and hyphenation.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/­/g, "")
    .replace(/-\s+(?=[a-z])/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const squash = (s: string) => s.replace(/\s+/g, "");

/** Returns the 1-based page where the quote appears, preferring the cited page. */
export function findQuotePage(quote: string, pages: string[], citedPage?: number): number | null {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_CHARS) return null;
  const normalized = pages.map(normalizeForMatch);
  const order = [...normalized.keys()];
  if (citedPage && citedPage >= 1 && citedPage <= pages.length) {
    order.splice(order.indexOf(citedPage - 1), 1);
    order.unshift(citedPage - 1);
  }
  for (const i of order) if (normalized[i].includes(q)) return i + 1;
  // PDF text layers often add or drop spaces inside words.
  const qs = squash(q);
  for (const i of order) if (squash(normalized[i]).includes(qs)) return i + 1;
  return null;
}

export type Verification = {
  items: AnalysisItem[];
  stats: { quotes_returned: number; quotes_verified: number; items_downgraded: number };
};

/**
 * Applies the behavior contract in docs/NJ_CONTRACT_REVIEW_SPEC.md §3 to the
 * model's answer:
 *   - one answer per checklist item, in checklist order; unknown IDs dropped;
 *   - every quote must appear in the extracted text, otherwise it is dropped;
 *   - present / needs_attention without a verified quote become not_evaluated;
 *   - items the engine doesn't handle yet are always not_evaluated.
 */
export function verifyItems(checklist: ChecklistItem[], raw: RawItem[], pages: string[]): Verification {
  const byId = new Map<string, RawItem>();
  for (const r of raw) if (!byId.has(r.id)) byId.set(r.id, r);

  const stats = { quotes_returned: 0, quotes_verified: 0, items_downgraded: 0 };
  const items = checklist.map((c): AnalysisItem => {
    const base = { id: c.id, category: c.category, label: c.label };
    if (c.notEvaluatedReason) return { ...base, status: "not_evaluated", note: c.notEvaluatedReason };

    const r = byId.get(c.id);
    if (!r) return { ...base, status: "not_evaluated", note: "The engine returned no answer for this item." };

    stats.quotes_returned += r.evidence.length;
    const evidence: { page: number; quote: string }[] = [];
    for (const e of r.evidence) {
      const quote = e.quote.trim().slice(0, MAX_QUOTE_CHARS);
      const page = findQuotePage(quote, pages, e.page);
      if (page !== null) evidence.push({ page, quote });
    }
    stats.quotes_verified += evidence.length;
    const note = r.note.trim().slice(0, MAX_NOTE_CHARS);

    if ((r.status === "present" || r.status === "needs_attention") && evidence.length === 0) {
      stats.items_downgraded += 1;
      return {
        ...base,
        status: "not_evaluated",
        note:
          `The engine marked this "${r.status === "present" ? "present" : "needs attention"}", but none of its quotes ` +
          "could be found in the document text, so it is not shown as a finding.",
      };
    }
    return {
      ...base,
      status: r.status,
      ...(evidence.length ? { evidence } : {}),
      ...(note ? { note } : {}),
    };
  });
  return { items, stats };
}
