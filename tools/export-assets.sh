#!/bin/sh
# Export finalized brand.html assets to pixel-exact PNGs via headless Chrome.
# Usage: tools/export-assets.sh [icon-a|icon-b]   (default icon variant: icon-a)
set -e

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PAGE="file://$ROOT/store-assets/brand.html"
ICON="${1:-icon}"

# headless Chrome reliably writes the screenshot but does not always exit,
# so each shot runs in its own profile with a watchdog kill
shot() { # query WxH outfile
  rm -f "$3"
  P="$(mktemp -d)"
  "$CHROME" --headless --disable-gpu --no-first-run --no-default-browser-check \
    --user-data-dir="$P" --default-background-color=00000000 --window-size="$2" \
    --screenshot="$3" "$PAGE?$1" >/dev/null 2>&1 &
  PID=$!
  i=0
  while [ $i -lt 60 ] && [ ! -s "$3" ]; do sleep 0.5; i=$((i+1)); done
  sleep 1
  kill "$PID" 2>/dev/null || true
  wait "$PID" 2>/dev/null || true
  rm -rf "$P"
  if [ -s "$3" ]; then echo "wrote $3"; else echo "FAILED $3"; exit 1; fi
}

for px in 128 48 32 16; do
  shot "asset=$ICON&px=$px" "$px,$px" "$ROOT/icons/icon$px.png"
done
shot "asset=promo" "440,280" "$ROOT/store-assets/promo-tile-440x280.png"
shot "asset=marquee" "1400,560" "$ROOT/store-assets/marquee-1400x560.png"

echo "done — reload the extension to pick up new icons"
