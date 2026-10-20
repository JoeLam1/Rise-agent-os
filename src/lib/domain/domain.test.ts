import { describe, expect, it } from "vitest";
import { canDecideReview, canWithdrawReview, dashboardPath } from "./roles";
import { REVIEW_TRANSITIONS, canTransition, decisionNeedsNote, isDecision } from "./review-state";
import { MAX_UPLOAD_BYTES, buildStoragePath, safeFileName, sha256Hex, validateUpload } from "./upload";
import { friendlyDbError } from "./db-errors";
import { parseAnalysisResult } from "../analysis/schema";

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);

describe("review permissions (UI mirror)", () => {
  const review = { state: "ready_for_broker" as const, requested_by: "agent-1" };

  it("only brokers and admins who didn't request the review can decide", () => {
    expect(canDecideReview("broker", "broker-1", review)).toBe(true);
    expect(canDecideReview("admin", "admin-1", review)).toBe(true);
    expect(canDecideReview("agent", "agent-2", review)).toBe(false);
    expect(canDecideReview("broker", "agent-1", review)).toBe(false);
    expect(canDecideReview("broker", "broker-1", { ...review, state: "approved" })).toBe(false);
  });

  it("requesters and brokers can withdraw open reviews only", () => {
    expect(canWithdrawReview("agent", "agent-1", review)).toBe(true);
    expect(canWithdrawReview("agent", "agent-2", review)).toBe(false);
    expect(canWithdrawReview("broker", "x", review)).toBe(true);
    expect(canWithdrawReview("broker", "x", { ...review, state: "approved" })).toBe(false);
  });

  it("routes each role to its dashboard", () => {
    expect(dashboardPath("rise", "agent")).toBe("/o/rise/dashboard/agent");
    expect(dashboardPath("rise", "broker")).toBe("/o/rise/dashboard/broker");
    expect(dashboardPath("rise", "admin")).toBe("/o/rise/dashboard/broker");
  });
});

describe("review state machine", () => {
  it("decisions are terminal", () => {
    for (const s of ["approved", "changes_requested", "rejected", "withdrawn"] as const) {
      expect(REVIEW_TRANSITIONS[s]).toEqual([]);
    }
  });

  it("brokers can only decide from ready_for_broker", () => {
    expect(canTransition("ready_for_broker", "approved")).toBe(true);
    expect(canTransition("pending_analysis", "approved")).toBe(false);
    expect(canTransition("approved", "ready_for_broker")).toBe(false);
  });

  it("validates decisions and note requirements", () => {
    expect(isDecision("approved")).toBe(true);
    expect(isDecision("ready_for_broker")).toBe(false);
    expect(decisionNeedsNote("approved")).toBe(false);
    expect(decisionNeedsNote("rejected")).toBe(true);
  });
});

describe("upload validation", () => {
  const pdf = { name: "contract.pdf", size: 2048, type: "application/pdf" };

  it("accepts a real PDF", () => {
    expect(validateUpload(pdf, PDF_HEAD)).toEqual({ ok: true, mimeType: "application/pdf" });
  });

  it("rejects empty, oversized, unknown and mislabelled files", () => {
    expect(validateUpload({ ...pdf, size: 0 }, PDF_HEAD).ok).toBe(false);
    expect(validateUpload({ ...pdf, size: MAX_UPLOAD_BYTES + 1 }, PDF_HEAD).ok).toBe(false);
    expect(validateUpload({ ...pdf, type: "text/html" }, PDF_HEAD).ok).toBe(false);
    expect(validateUpload(pdf, new TextEncoder().encode("<html>")).ok).toBe(false);
  });

  it("builds tenant-scoped storage paths with safe names", () => {
    const path = buildStoragePath("org", "txn", "doc", "../../etc/Contract Final (v2).pdf");
    const parts = path.split("/");
    expect(parts).toHaveLength(4);
    expect(parts.slice(0, 3)).toEqual(["org", "txn", "doc"]);
    expect(parts[3]).toMatch(/^[0-9a-f-]{36}-etcContract-Final-v2.pdf$/);
    expect(safeFileName("...")).toBe("file");
  });

  it("hashes with SHA-256", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("error messages", () => {
  it("does not leak unknown database errors", () => {
    expect(friendlyDbError({ code: "XX000", message: "internal detail" })).not.toContain("internal");
    expect(friendlyDbError({ code: "42501", message: "x" })).toMatch(/permission/);
  });
});

describe("analysis result parsing", () => {
  const base = {
    schema_version: 1,
    engine: "mock",
    engine_version: "mock-0.1.0",
    is_mock: true,
    review_type: "pre_signature",
    document_kind: "purchase_agreement",
    disclaimer: "MOCK ANALYSIS.",
    summary: "",
    items: [{ id: "a", category: "c", label: "l", status: "not_evaluated" }],
  };

  it("accepts a mock result", () => {
    expect(parseAnalysisResult(base)).not.toBeNull();
  });

  it("refuses a mock result that claims findings or hides that it is mock", () => {
    expect(parseAnalysisResult({ ...base, is_mock: false })).toBeNull();
    expect(parseAnalysisResult({ ...base, items: [{ ...base.items[0], status: "present" }] })).toBeNull();
    expect(parseAnalysisResult({ nope: true })).toBeNull();
  });
});
