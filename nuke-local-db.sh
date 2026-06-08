#!/usr/bin/env bash
#
# nuke-local-db.sh — wipe the LOCAL Slaw instance database so you can start
# clean with a fresh instance + new squad on the next `pnpm dev`.
#
# SCOPE (DB-only): deletes the embedded Postgres data and instance runtime
# data (backups, storage, logs). It KEEPS:
#   - your instance config (config.json + .env)  → tower URL / ports / adapters
#   - the secrets master key (secrets/master.key)
#   - the machine identity (~/.slaw/machine.json)
#   - the botfather enrollment (instances/<id>/botfather/credentials.json)
# so a control-tower-connected instance resumes its SAME identity (it does not
# re-enroll as a brand-new pending machine). Note: the tower keeps its own copy
# of previously-ingested data; wiping locally does not delete tower-side history.
#
# Honors SLAW_HOME (default ~/.slaw) and SLAW_INSTANCE_ID (default "default").
#
# Usage:
#   ./nuke-local-db.sh             # interactive: prints what it will do, asks to confirm
#   ./nuke-local-db.sh --yes       # no prompt (for scripting)
#   SLAW_INSTANCE_ID=staging ./nuke-local-db.sh
#
set -euo pipefail

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# --- Resolve paths (mirror packages/shared/src/home-paths.ts) ---------------
SLAW_HOME_DIR="${SLAW_HOME:-$HOME/.slaw}"
INSTANCE_ID="${SLAW_INSTANCE_ID:-default}"
INSTANCE_ROOT="$SLAW_HOME_DIR/instances/$INSTANCE_ID"
CONFIG_FILE="$INSTANCE_ROOT/config.json"

DB_DIR="$INSTANCE_ROOT/db"
DATA_DIR="$INSTANCE_ROOT/data"      # backups + storage live here
LOGS_DIR="$INSTANCE_ROOT/logs"

# --- Resolve the embedded Postgres port (config override → default 54329) ---
PORT=54329
if [[ -f "$CONFIG_FILE" ]]; then
  CFG_PORT="$(grep -oE '"embeddedPostgresPort"[[:space:]]*:[[:space:]]*[0-9]+' "$CONFIG_FILE" 2>/dev/null | grep -oE '[0-9]+$' || true)"
  [[ -n "${CFG_PORT:-}" ]] && PORT="$CFG_PORT"
fi

echo "Slaw local DB nuke"
echo "  SLAW_HOME      : $SLAW_HOME_DIR"
echo "  instance       : $INSTANCE_ID"
echo "  instance root  : $INSTANCE_ROOT"
echo "  Postgres port  : $PORT"
echo
echo "WILL DELETE:"
echo "  - $DB_DIR        (embedded Postgres data — the database itself)"
echo "  - $DATA_DIR      (backups + storage)"
echo "  - $LOGS_DIR      (logs)"
echo
echo "WILL KEEP:"
echo "  - $CONFIG_FILE  (+ .env)"
echo "  - $INSTANCE_ROOT/secrets/master.key"
echo "  - $INSTANCE_ROOT/botfather/credentials.json  (enrollment)"
echo "  - $SLAW_HOME_DIR/machine.json                (machine identity)"
echo

if [[ ! -d "$INSTANCE_ROOT" ]]; then
  echo "Nothing to do — instance root does not exist: $INSTANCE_ROOT"
  echo "A fresh instance will be created on your next \`pnpm dev\`."
  exit 0
fi

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Proceed? This is destructive and cannot be undone. [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

# --- 1. Stop any process holding the embedded Postgres port -----------------
echo "==> Stopping any process on port $PORT ..."
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti ":$PORT" 2>/dev/null || true)"
  if [[ -n "${PIDS:-}" ]]; then
    echo "    killing PIDs: $PIDS"
    # shellcheck disable=SC2086
    kill $PIDS 2>/dev/null || true
    sleep 2
    STILL="$(lsof -ti ":$PORT" 2>/dev/null || true)"
    if [[ -n "${STILL:-}" ]]; then
      echo "    forcing kill: $STILL"
      # shellcheck disable=SC2086
      kill -9 $STILL 2>/dev/null || true
      sleep 1
    fi
  else
    echo "    nothing listening on $PORT."
  fi
else
  echo "    (lsof not found — if the DB fails to delete, stop the Slaw server first.)"
fi

# Safety: also stop a lingering embedded postgres via its pg_ctl if present.
if [[ -d "$DB_DIR" ]] && command -v pg_ctl >/dev/null 2>&1; then
  pg_ctl -D "$DB_DIR" stop -m fast >/dev/null 2>&1 || true
fi

# --- 2. Remove the data directories -----------------------------------------
echo "==> Removing database + runtime data ..."
rm -rf "$DB_DIR"   && echo "    removed db/"      || echo "    (db/ not present)"
rm -rf "$DATA_DIR" && echo "    removed data/"    || echo "    (data/ not present)"
rm -rf "$LOGS_DIR" && echo "    removed logs/"    || echo "    (logs/ not present)"

echo
echo "Done. The local Slaw database has been nuked."
echo "Start clean with:  pnpm dev"
echo "On boot Slaw will recreate an empty DB, run all migrations, and seed a"
echo "fresh instance — then create your new Squad + Squad Lead from the UI."
