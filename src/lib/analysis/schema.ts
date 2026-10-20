import { z } from "zod";

/**
 * Shape of `analysis_runs.result`. Sprint 001 only produces mock results
 * (every item `not_evaluated`). Sprint 002's NJ contract engine fills the
 * same shape with real statuses, evidence and citations.
 */
export const analysisItemStatus = z.enum([
  "not_evaluated",
  "present",
  "missing",
  "needs_attention",
]);

export const analysisItemSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  label: z.string().min(1),
  status: analysisItemStatus,
  // Sprint 002 fields: where in the document the engine found support.
  evidence: z
    .array(z.object({ page: z.number().int().positive().optional(), quote: z.string() }))
    .optional(),
  note: z.string().optional(),
});

export const analysisResultSchema = z.object({
  schema_version: z.literal(1),
  engine: z.enum(["mock", "nj_contract_ai"]),
  engine_version: z.string().min(1),
  is_mock: z.boolean(),
  review_type: z.enum(["pre_signature", "post_execution"]),
  document_kind: z.string(),
  disclaimer: z.string().min(1),
  summary: z.string(),
  items: z.array(analysisItemSchema),
});

export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type AnalysisItem = z.infer<typeof analysisItemSchema>;

/** Parses a stored result; returns null rather than rendering unknown data. */
export function parseAnalysisResult(value: unknown): AnalysisResult | null {
  const parsed = analysisResultSchema.safeParse(value);
  if (!parsed.success) return null;
  // A mock result must say so and must not contain evaluated items.
  if (parsed.data.engine === "mock") {
    if (!parsed.data.is_mock) return null;
    if (parsed.data.items.some((i) => i.status !== "not_evaluated")) return null;
  }
  return parsed.data;
}
