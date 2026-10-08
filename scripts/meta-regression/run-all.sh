#!/usr/bin/env bash
# Usage: scripts/meta-regression/run-all.sh <tree-root> <out.json>
# Runs every scenario of run.tsx in its own process inside <tree-root> and merges the JSON.
set -euo pipefail
ROOT="$1"; OUT="$2"; TMP="$(mktemp -d)"
for S in IN_guest IN_logged_in UK_guest UK_logged_in US_guest US_logged_in AE_guest AE_logged_in; do
  (cd "$ROOT" && SCENARIO="$S" npx tsx --tsconfig scripts/meta-regression/tsconfig.json scripts/meta-regression/run.tsx "$TMP/$S.json" >"$TMP/$S.log" 2>&1) \
    || { echo "scenario $S failed"; tail -20 "$TMP/$S.log"; exit 1; }
done
node -e 'const fs=require("fs");const d=process.argv[1];const o={};for(const f of fs.readdirSync(d).filter(f=>f.endsWith(".json")).sort())Object.assign(o,JSON.parse(fs.readFileSync(d+"/"+f,"utf8")));fs.writeFileSync(process.argv[2],JSON.stringify(o,null,1))' "$TMP" "$OUT"
echo "wrote $OUT"
