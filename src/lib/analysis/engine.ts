import type { AnalysisResult } from "./schema";
import type { DocumentKind, ReviewType } from "@/lib/domain/types";

/**
 * Contract for the Sprint 002 NJ contract review engine.
 *
 * Sprint 001 has no TypeScript engine: the mock result is generated inside
 * public.request_review so that clients can never supply analysis content.
 * Sprint 002 adds a server-side worker that implements this interface,
 * reads the version from private storage with a service credential, and
 * writes an `analysis_runs` row with engine = 'nj_contract_ai'. See
 * docs/ARCHITECTURE.md ("Sprint 002 seams") for the full flow.
 */
export interface ContractAnalysisEngine {
  readonly engine: "nj_contract_ai";
  readonly engineVersion: string;
  analyze(input: AnalysisInput): Promise<AnalysisResult>;
}

export type AnalysisInput = {
  reviewId: string;
  orgId: string;
  reviewType: ReviewType;
  documentKind: DocumentKind;
  /** Version metadata; the engine verifies the hash after download. */
  version: { id: string; sha256: string; mimeType: string; sizeBytes: number };
  /** Raw file bytes fetched by the worker, never by the browser. */
  file: Uint8Array;
};
