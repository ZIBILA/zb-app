#!/bin/zsh
# Catalogue-route regression test: runs the production build against a fake Shopify Admin API
# and checks the behaviours that broke or were at risk in the 2026-10-29 performance work.
#
#   npm run build && scripts/catalog-cache-test/run.sh
#
# Checks (exit 1 on any failure):
#   - a product WITH a GID metafield renders 200 with its data (the case that returned 500 live)
#   - products with several / single variants render with the right prices and sizes
#   - a numeric product id resolves; unknown / draft / malformed handles are 404, never 500
#   - a collection page is cached (ISR MISS then HIT) and lists exactly its members, no drafts
#   - a Shopify outage (HTTP 500) never gets cached as product/collection data; recovery works
#   - the server log contains no "static to dynamic" / "Dynamic server usage" / unhandled errors
set -u
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
PORT=${CATALOG_TEST_PORT:-3021}
FAKE=${CATALOG_TEST_FAKE_PORT:-8451}
TMP=$(mktemp -d)
BASE=http://127.0.0.1:$PORT
CTL="https://127.0.0.1:$FAKE/__control"
fail=0
cleanup() { kill ${NEXT_PID:-0} ${FAKE_PID:-0} 2>/dev/null; pkill -f "next.* start -H 127.0.0.1 -p $PORT" 2>/dev/null; wait ${NEXT_PID:-0} ${FAKE_PID:-0} 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

[ -d "$ROOT/.next/server" ] || { echo "no production build found — run 'npm run build' first"; exit 2; }
pkill -f "next.* start -H 127.0.0.1 -p $PORT" 2>/dev/null; sleep 1
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -days 2 -subj "/CN=127.0.0.1" >/dev/null 2>&1
FAKE_CERT_DIR=$TMP FAKE_PORT=$FAKE node "$ROOT/scripts/catalog-cache-test/fake-shopify.cjs" > "$TMP/fake.log" 2>&1 & FAKE_PID=$!
cd "$ROOT"
NODE_TLS_REJECT_UNAUTHORIZED=0 SHOPIFY_STORE_DOMAIN=127.0.0.1:$FAKE SHOPIFY_ADMIN_ACCESS_TOKEN=catalog-test-token \
  PORT=$PORT node "$ROOT/node_modules/next/dist/bin/next" start -H 127.0.0.1 -p $PORT > "$TMP/next.log" 2>&1 & NEXT_PID=$!
curl -s --retry 30 --retry-delay 2 --retry-connrefused --retry-all-errors -o /dev/null "$BASE/cart" || { echo "server did not start"; cat "$TMP/next.log" | tail -20; exit 2; }

check() { # check <name> <cond-exit-code>
  if [ "$2" -eq 0 ]; then echo "PASS  $1"; else echo "FAIL  $1"; fail=1; fi
}
get() { curl -s -o "$TMP/body.html" -D "$TMP/head.txt" -w '%{http_code}' --max-time 90 "$BASE$1"; }
body_has() { grep -q -- "$1" "$TMP/body.html"; }
cache_hdr() { grep -i '^x-nextjs-cache:' "$TMP/head.txt" | tr -d '\r' | awk '{print $2}'; }

st=$(get /products/alpha-tee); check "product with GID metafield: HTTP 200 (got $st)" $([ "$st" = 200 ]; echo $?)
body_has "Alpha Tee" && body_has "1,999" && body_has "2,999" && body_has '>S<' && body_has '>M<' && body_has "size-chart.png"; check "product with GID metafield: title, price, compare-at, sizes, resolved metafield URL" $?
st=$(get /products/alpha-tee); check "repeat visit: HTTP 200 (got $st)" $([ "$st" = 200 ]; echo $?)
st=$(get /products/beta-denim); grep -q '<title>Beta Denim' "$TMP/body.html" && body_has "4,499" && body_has '>28<' && body_has '>30<' && ! grep -q '<title>Alpha Tee' "$TMP/body.html"; check "second product: its own title, price and sizes (HTTP $st)" $?
st=$(get /products/gamma-hoodie); body_has "Gamma Hoodie" && body_has "3,499"; check "single-variant product (HTTP $st)" $?
st=$(get /products/1001); body_has "Alpha Tee"; check "numeric product id resolves (HTTP $st)" $?
for u in /products/nope-zzz /products/delta-draft /products/foo.json /collections/nope-zzz; do st=$(get "$u"); check "$u → 404 (got $st)" $([ "$st" = 404 ]; echo $?); done

st=$(get /collections/new-arrivals); c1=$(cache_hdr); body_has "/products/alpha-tee" && body_has "/products/beta-denim" && ! body_has "/products/gamma-hoodie" && ! body_has "delta-draft"; check "collection lists exactly its members, no drafts (HTTP $st, $c1)" $?
st=$(get /collections/new-arrivals); c2=$(cache_hdr); check "collection second visit served from cache (got '$c2')" $([ "$c2" = HIT ] || [ "$c2" = STALE ]; echo $?)

curl -sk "$CTL?mode=fail" >/dev/null
st=$(get /products/gamma-hoodie); check "Shopify outage: uncached product is not a cached error (HTTP $st, must not be 200-with-wrong-data; 500 or 404 acceptable)" $([ "$st" != 200 ] || grep -q "Gamma Hoodie" "$TMP/body.html"; echo $?)
st=$(get /collections/new-arrivals); body_has "/products/alpha-tee"; check "Shopify outage: cached collection keeps serving (HTTP $st)" $?
curl -sk "$CTL?mode=ok" >/dev/null
st=$(get /products/gamma-hoodie); body_has "Gamma Hoodie"; check "after recovery: product renders again (HTTP $st)" $?

s2d=$(grep -c 'static to dynamic' "$TMP/next.log"); dsu=$(grep -c 'Dynamic server usage' "$TMP/next.log"); unh=$(grep -c '⨯' "$TMP/next.log")
check "server log: no static→dynamic errors ($s2d)" $([ "$s2d" -eq 0 ]; echo $?)
check "server log: no dynamic-server-usage errors ($dsu)" $([ "$dsu" -eq 0 ]; echo $?)
check "server log: no unhandled errors ($unh)" $([ "$unh" -eq 0 ]; echo $?)
[ "$unh" -ne 0 ] && grep '⨯' "$TMP/next.log" | cut -c1-200
[ $fail -eq 0 ] && echo "ALL PASSED" || { echo "FAILURES — next.log tail:"; tail -20 "$TMP/next.log"; }
exit $fail
