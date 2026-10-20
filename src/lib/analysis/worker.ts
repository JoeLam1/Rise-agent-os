import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DOCUMENTS_BUCKET } from "@/lib/domain/upload";
import type { DocumentKind, ReviewType } from "@/lib/domain/types";
import type { ContractAnalysisEngine } from "./engine";
import { AnalysisFailure } from "./nj-engine";

/**
 * Background worker for AI review. Runs server-side only, with a service
 * credential, outside any request path. It never logs document content: log
 * lines carry run ids, statuses and error classes only.
 */

export type ClaimedRun = {
  run_id: string;
  org_id: string;
  review_id: string;
  review_type: ReviewType;
  document_kind: DocumentKind;
  document_version_id: string;
  storage_path: string;
  sha256: string;
  mime_type: string;
  size_bytes: number;
  attempts: number;
};

export type WorkerDeps = {
  /** A Supabase client created with the service-role key. */
  db: SupabaseClient;
  engine: ContractAnalysisEngine;
  log?: (line: string) => void;
};

export type RunOutcome = { runId: string; status: "completed" | "failed"; error?: string };

/** Claims and processes one run. Returns null when the queue is empty. */
export async function processNextRun({ db, engine, log = () => {} }: WorkerDeps): Promise<RunOutcome | null> {
  const { data, error } = await db.rpc("claim_analysis_run", { p_engine_version: engine.engineVersion });
  if (error) throw new Error(`claim_analysis_run failed: ${error.message}`);
  const run = (data as ClaimedRun[] | null)?.[0];
  if (!run) return null;
  log(`run ${run.run_id}: claimed (attempt ${run.attempts})`);

  let message: string;
  try {
    const file = await download(db, run);
    const result = await engine.analyze({
      reviewId: run.review_id,
      orgId: run.org_id,
      reviewType: run.review_type,
      documentKind: run.document_kind,
      version: { id: run.document_version_id, sha256: run.sha256, mimeType: run.mime_type, sizeBytes: run.size_bytes },
      file,
    });
    const { error: completeError } = await db.rpc("complete_analysis_run", { p_run: run.run_id, p_result: result });
    if (completeError) throw new Error(`complete_analysis_run failed: ${completeError.message}`);
    log(`run ${run.run_id}: completed`);
    return { runId: run.run_id, status: "completed" };
  } catch (err) {
    message = failureMessage(err);
    log(`run ${run.run_id}: failed (${errorClass(err)})`);
  }

  const { error: failError } = await db.rpc("fail_analysis_run", { p_run: run.run_id, p_error: message });
  if (failError) throw new Error(`fail_analysis_run failed: ${failError.message}`);
  return { runId: run.run_id, status: "failed", error: message };
}

async function download(db: SupabaseClient, run: ClaimedRun): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(DOCUMENTS_BUCKET).download(run.storage_path);
  if (error || !data) throw new AnalysisFailure("The stored file could not be read.");
  const file = new Uint8Array(await data.arrayBuffer());
  const sha = createHash("sha256").update(file).digest("hex");
  if (file.byteLength !== Number(run.size_bytes) || sha !== run.sha256) {
    throw new AnalysisFailure("The stored file does not match the recorded version (hash mismatch). It was not analyzed.");
  }
  return file;
}

/** A message that is safe to store and show to a broker. */
function failureMessage(err: unknown): string {
  if (err instanceof AnalysisFailure) return err.message;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return "AI review is not configured correctly (the AI service rejected the credentials). Review this document directly.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "The AI service is rate limiting requests. Review this document directly.";
  }
  if (err instanceof Anthropic.APIError) {
    return `The AI service returned an error${err.status ? ` (${err.status})` : ""}. Review this document directly.`;
  }
  return "AI analysis failed unexpectedly. Review this document directly.";
}

function errorClass(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `${err.constructor.name} ${err.status ?? ""}`.trim();
  if (err instanceof Error) return err.constructor.name;
  return "unknown";
}
