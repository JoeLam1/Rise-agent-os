#!/usr/bin/env bash
# Runs a command with DATABASE_URL pointing at a throwaway PostgreSQL cluster.
# If DATABASE_URL is already set (e.g. a CI service container), it is used as is.
set -euo pipefail

if [[ -n "${DATABASE_URL:-}" ]]; then
  exec "$@"
fi

PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
if [[ -z "$PG_BIN" || ! -x "$PG_BIN/initdb" ]]; then
  echo "PostgreSQL server binaries not found. Install PostgreSQL or set DATABASE_URL." >&2
  exit 1
fi

PORT="${PGPORT_TEST:-54329}"
DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rise-pg-XXXXXX")"
RUN_AS=()
if [[ "$(id -u)" == "0" ]]; then
  # PostgreSQL refuses to run as root.
  chown postgres "$DATA_DIR"
  RUN_AS=(runuser -u postgres --)
fi

cleanup() {
  "${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PG_BIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PG_BIN/pg_ctl" -D "$DATA_DIR" -l "$DATA_DIR/server.log" \
  -o "-p $PORT -k $DATA_DIR -c listen_addresses=127.0.0.1" -w start >/dev/null

export DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/postgres"
"$@"
