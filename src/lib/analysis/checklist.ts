import type { ReviewType } from "@/lib/domain/types";

/**
 * NJ checklist v0. IDs match docs/NJ_CONTRACT_REVIEW_SPEC.md and the Sprint 001
 * mock. The wording was written by engineering and has NOT been validated by
 * RISE's broker of record or New Jersey counsel; every AI result says so.
 */
export const CHECKLIST_VERSION = "nj-checklist-v0";

export type ChecklistItem = {
  id: string;
  category: string;
  label: string;
  /** What the model should look for. Descriptive, never a legal conclusion. */
  guidance: string;
  /** Items the engine does not evaluate yet; they are returned as not_evaluated. */
  notEvaluatedReason?: string;
};

const PRE_SIGNATURE: ChecklistItem[] = [
  {
    id: "nj.attorney_review_clause",
    category: "NJ requirements",
    label: "Attorney review clause present",
    guidance:
      "Look for a section titled or describing attorney review: a period (commonly three business days) during which either party's attorney may review or disapprove the contract. Quote the clause heading or its first sentence.",
  },
  {
    id: "nj.consumer_information_statement",
    category: "NJ requirements",
    label: "Consumer Information Statement acknowledgment",
    guidance:
      "Look for language acknowledging receipt of the New Jersey Consumer Information Statement (on brokerage relationships) by the buyer and/or seller.",
  },
  {
    id: "core.parties_and_property",
    category: "Core terms",
    label: "Parties, property address, block and lot",
    guidance:
      "Check that buyer name(s), seller name(s), the property street address and municipality, and the tax block and lot are all filled in. Blank or placeholder fields are needs_attention.",
  },
  {
    id: "core.price_and_deposits",
    category: "Core terms",
    label: "Purchase price, deposits and due dates",
    guidance:
      "Find the purchase price, initial and additional deposits with their due dates, and the mortgage amount and balance if stated. If the amounts are shown, check that deposits + mortgage + balance add up to the price; a mismatch is needs_attention and the note gives the figures.",
  },
  {
    id: "core.mortgage_contingency",
    category: "Contingencies",
    label: "Mortgage contingency terms and commitment date",
    guidance:
      "Find whether the sale is contingent on a mortgage, the loan amount or type if stated, and the mortgage commitment date. A contingency with a blank commitment date is needs_attention.",
  },
  {
    id: "core.inspection_contingency",
    category: "Contingencies",
    label: "Inspection contingency terms and deadlines",
    guidance:
      "Find the home inspection (and any radon, wood-destroying insect, or other) contingency and the number of days or the date for inspections and notice.",
  },
  {
    id: "core.closing_date",
    category: "Core terms",
    label: "Closing date",
    guidance: "Find the closing date or the way it is to be set. A blank date is needs_attention.",
  },
  {
    id: "disclosure.lead_paint",
    category: "Disclosures",
    label: "Lead-based paint disclosure (pre-1978 housing)",
    guidance:
      "Look for a lead-based paint disclosure or addendum and for the year the home was built. If the year built is not in the document, use not_evaluated and say so, unless a lead-based paint disclosure is present.",
  },
  {
    id: "disclosure.seller_property_condition",
    category: "Disclosures",
    label: "Seller property condition disclosure",
    guidance:
      "Look for a reference to, or acknowledgment of, a seller's property condition disclosure statement.",
  },
];

const POST_EXECUTION: ChecklistItem[] = [
  {
    id: "exec.signatures_complete",
    category: "Execution",
    label: "All parties signed and dated",
    guidance:
      "Check the signature blocks for each named buyer and seller. Signatures in a PDF may be images; if you cannot tell whether a block is signed, use not_evaluated. Quote the signature-block labels and any printed dates.",
  },
  {
    id: "nj.attorney_review_period",
    category: "NJ requirements",
    label: "Attorney review period start and end recorded",
    guidance:
      "Report any dates the document gives for delivery of the signed contract or the start or end of attorney review. Do not compute legal deadlines yourself; if the dates are not written in the document, use missing.",
  },
  {
    id: "exec.deposit_receipt",
    category: "Execution",
    label: "Deposit receipt documented",
    guidance: "Look for an acknowledgment or receipt of the initial deposit, with the amount and who holds it.",
  },
  {
    id: "exec.deadlines_calendared",
    category: "Execution",
    label: "Contingency deadlines calendared",
    guidance:
      "List the contingency deadlines that are written in the document (inspection, mortgage commitment, closing) in the note, each with its quote. Do not compute dates that are not written.",
  },
  {
    id: "exec.changes_since_presignature",
    category: "Execution",
    label: "Changes since pre-signature review identified",
    guidance: "",
    notEvaluatedReason:
      "The AI doesn't compare versions. Use \"Changes since the approved pre-signature version\" on this page, which compares the text word by word.",
  },
];

export function checklistFor(reviewType: ReviewType): ChecklistItem[] {
  return reviewType === "pre_signature" ? PRE_SIGNATURE : POST_EXECUTION;
}
