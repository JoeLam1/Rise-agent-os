type PgLikeError = { code?: string; message?: string } | null | undefined;

/**
 * Turns a PostgREST/Postgres error into a message that's safe to show. Known
 * messages raised by our own functions pass through; anything else is generic
 * so internal details don't leak.
 */
export function friendlyDbError(error: PgLikeError, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  switch (error.code) {
    case "42501":
      return "You don't have permission to do that.";
    case "P0002":
      return "That item wasn't found, or you don't have access to it.";
    case "23505":
      return "That already exists. An open review of this type may already be in progress for this version.";
    case "22023":
    case "23514":
      return error.message ?? fallback;
    default:
      return fallback;
  }
}
