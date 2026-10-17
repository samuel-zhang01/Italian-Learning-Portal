#!/bin/zsh
set -euo pipefail
setopt NULL_GLOB

cd "$(dirname "$0")"

BUNDLED_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
if [[ -x "$BUNDLED_NODE/node" ]]; then
  export PATH="$BUNDLED_NODE:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 22 or newer, then try again."
  read -r "?Press Return to close."
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 22 )); then
  echo "Parliamo needs Node 22 or newer. This Mac is using Node $(node -v)."
  read -r "?Press Return to close."
  exit 1
fi

# Local mode is intentionally free of metered AI calls, even if the shell that
# launched this file happens to contain an OpenAI API key.
unset OPENAI_API_KEY
export PARLIAMO_ENABLE_PAID_AI=false

echo ""
echo "  Parliamo! — Italian Learning Portal"
echo "  Starting your private study server…"
echo ""

if curl --silent --fail http://127.0.0.1:3000/api/content >/dev/null 2>&1 && \
   curl --silent --fail http://127.0.0.1:3000/api/progress >/dev/null 2>&1; then
  echo "Parliamo is already running. Opening the existing local app."
  open http://localhost:3000/
  exit 0
fi

if [[ ! -d node_modules ]]; then
  echo "First launch: preparing the app. This may take a minute."
  npm ci --no-audit --no-fund
fi

BACKUP_DIR="$PWD/backups/local-data"
mkdir -p "$BACKUP_DIR"
DATABASES=(.wrangler/state/v3/d1/**/*.sqlite)
TODAY="$(date +%Y-%m-%d)"
if (( ${#DATABASES[@]} > 0 )); then
  for DATABASE in "${DATABASES[@]}"; do
    [[ "${DATABASE:t}" == "metadata.sqlite" ]] && continue
    NAME="${DATABASE:h:t}-${DATABASE:t:r}"
    DESTINATION="$BACKUP_DIR/${NAME}-${TODAY}.sqlite"
    if [[ ! -f "$DESTINATION" ]]; then
      TEMP_DIR="$(mktemp -d "$BACKUP_DIR/.parliamo-backup.XXXXXX")"
      TEMP_BACKUP="$TEMP_DIR/learner.sqlite"
      if command -v sqlite3 >/dev/null 2>&1; then
        sqlite3 "$DATABASE" ".backup '$TEMP_BACKUP'"
        sqlite3 "$TEMP_BACKUP" "PRAGMA journal_mode=DELETE;" >/dev/null
        CHECK_RESULT="$(sqlite3 "$TEMP_BACKUP" "PRAGMA integrity_check;")"
        if [[ "$CHECK_RESULT" == "ok" ]]; then
          mv "$TEMP_BACKUP" "$DESTINATION"
        else
          FAILED_BACKUP="$BACKUP_DIR/${NAME}-${TODAY}.failed.sqlite"
          mv "$TEMP_BACKUP" "$FAILED_BACKUP"
          echo "Warning: a database backup failed its integrity check: $FAILED_BACKUP"
        fi
      else
        cp "$DATABASE" "$TEMP_BACKUP"
        mv "$TEMP_BACKUP" "$DESTINATION"
        echo "Warning: sqlite3 is unavailable, so this backup could not be integrity-checked."
      fi
      rm -f "$TEMP_BACKUP-wal" "$TEMP_BACKUP-shm"
      rmdir "$TEMP_DIR"
    fi
  done
fi

echo "Your private local app will open at http://localhost:3000."
echo "Paid AI calls are disabled. Progress stays on this Mac."
echo "Press Control-C here when you want to stop."
echo ""

npm run local &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

for ATTEMPT in {1..60}; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
    exit $?
  fi
  if curl --silent --fail http://127.0.0.1:3000/api/content >/dev/null 2>&1 && \
     curl --silent --fail http://127.0.0.1:3000/api/progress >/dev/null 2>&1; then
    open http://localhost:3000/
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.5
done

echo "Parliamo did not become ready within 30 seconds. See the messages above."
exit 1
