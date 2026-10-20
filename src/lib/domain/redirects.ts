/** Only same-site relative paths are allowed as post-login destinations. */
export function safeNext(value: unknown, fallback = "/orgs"): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}
