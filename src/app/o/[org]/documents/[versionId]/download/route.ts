import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DOCUMENTS_BUCKET } from "@/lib/domain/upload";

/**
 * Issues a short-lived signed URL for one document version. Both lookups use
 * the caller's session, so RLS on document_versions and storage.objects
 * decides access; nobody gets a permanent or public link.
 */
export async function GET(_req: Request, ctx: RouteContext<"/o/[org]/documents/[versionId]/download">) {
  const { versionId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Not signed in", { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return new NextResponse("Not found", { status: 404 });

  const { data: version } = await supabase
    .from("document_versions")
    .select("storage_path, original_filename")
    .eq("id", versionId)
    .maybeSingle<{ storage_path: string; original_filename: string }>();
  if (!version) return new NextResponse("Not found", { status: 404 });

  const { data, error } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(version.storage_path, 60, { download: version.original_filename });
  if (error || !data) return new NextResponse("Not found", { status: 404 });

  const res = NextResponse.redirect(data.signedUrl);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
