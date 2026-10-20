import { createHash, randomUUID } from "node:crypto";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Private bucket created in supabase/migrations. */
export const DOCUMENTS_BUCKET = "transaction-documents";

const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // %PDF
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) =>
    b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04, // ZIP container
  "application/msword": (b) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0, // OLE2
  "image/png": (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};

export const ALLOWED_MIME_TYPES = Object.keys(SIGNATURES);

export type UploadCheck = { ok: true; mimeType: string } | { ok: false; error: string };

/**
 * Validates an upload before it reaches storage: size limits, an allow-listed
 * type, and file contents that match the declared type.
 */
export function validateUpload(file: { name: string; size: number; type: string }, head: Uint8Array): UploadCheck {
  if (file.size === 0) return { ok: false, error: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Files must be 10 MB or smaller." };
  const check = SIGNATURES[file.type];
  if (!check) return { ok: false, error: "Upload a PDF, Word document, PNG or JPEG." };
  if (head.length < 4 || !check(head)) {
    return { ok: false, error: "The file contents don't match its type." };
  }
  return { ok: true, mimeType: file.type };
}

/** Keeps a readable, path-safe version of the original file name. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(-100);
  return cleaned.replace(/^\.+/, "") || "file";
}

/**
 * Object key layout the storage policies depend on:
 * <org_id>/<transaction_id>/<document_id>/<unique-file-name>
 */
export function buildStoragePath(orgId: string, transactionId: string, documentId: string, fileName: string): string {
  return `${orgId}/${transactionId}/${documentId}/${randomUUID()}-${safeFileName(fileName)}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
