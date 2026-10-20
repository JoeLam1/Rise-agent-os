"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/auth";
import { friendlyDbError } from "@/lib/domain/db-errors";
import { DOCUMENTS_BUCKET, buildStoragePath, sha256Hex, validateUpload } from "@/lib/domain/upload";
import type { ActionState } from "./state";



const newDocumentSchema = z.object({
  title: z.string().trim().min(1, "Give the document a title.").max(200),
  kind: z.enum(["purchase_agreement", "listing_agreement", "addendum", "disclosure", "lease", "other"]),
});

/**
 * Uploads a file as a new document (version 1) or as the next version of an
 * existing document. The upload uses the caller's session, so storage RLS
 * decides whether it's allowed; the database then records an immutable
 * version row with the hash computed here on the server.
 */
export async function uploadDocument(
  orgSlug: string,
  transactionId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "Choose a file to upload." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload({ name: file.name, size: file.size, type: file.type }, bytes.subarray(0, 8));
  if (!check.ok) return { error: check.error };

  const { supabase, org, userId } = await requireOrg(orgSlug);

  let documentId = formData.get("documentId");
  if (typeof documentId !== "string" || documentId === "") {
    const parsed = newDocumentSchema.safeParse({ title: formData.get("title"), kind: formData.get("kind") });
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    const { data, error } = await supabase
      .from("documents")
      .insert({ org_id: org.id, transaction_id: transactionId, title: parsed.data.title, kind: parsed.data.kind, created_by: userId })
      .select("id")
      .single();
    if (error) return { error: friendlyDbError(error) };
    documentId = data.id as string;
  } else if (!z.string().uuid().safeParse(documentId).success) {
    return { error: "Unknown document." };
  }

  const path = buildStoragePath(org.id, transactionId, documentId, file.name);
  const upload = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, bytes, { contentType: check.mimeType, upsert: false });
  if (upload.error) {
    return { error: "The file couldn't be stored. You may not have access to this transaction." };
  }

  const { error } = await supabase.rpc("add_document_version", {
    p_document: documentId,
    p_storage_path: path,
    p_sha256: sha256Hex(bytes),
    p_size_bytes: bytes.byteLength,
    p_mime_type: check.mimeType,
    p_original_filename: file.name.slice(0, 255),
  });
  if (error) return { error: friendlyDbError(error) };

  revalidatePath(`/o/${orgSlug}/transactions/${transactionId}`);
  return { message: `Uploaded ${file.name}.` };
}
