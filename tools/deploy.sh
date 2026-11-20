#!/usr/bin/env bash
# Publishes the built fork to stirante.com/snowstorm/ (bucket stirante.com behind CloudFront and nginx).
# Run `npx mix --production` (and tools/build-vendor.sh after renderer / particle-sim changes) first.
# Nothing is fingerprinted, so every file is revalidated on each visit.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=s3://stirante.com/snowstorm
CACHE="public, max-age=0, must-revalidate"
put() { aws s3 cp "$1" "$DEST/$1" --cache-control "$CACHE" --content-type "$2" --only-show-errors; }
put index.html "text/html; charset=utf-8"
put manifest.webmanifest "application/manifest+json"
put favicon.ico "image/x-icon"
put icon.png "image/png"
put icon_full.png "image/png"
put dist/app.js "text/javascript"
put vendor/renderer/bedrock_renderer_web.js "text/javascript"
put vendor/renderer/bedrock_renderer_web_bg.wasm "application/wasm"
put vendor/particle-sim/wasm_exec.js "text/javascript"
put vendor/particle-sim/particle-sim.wasm "application/wasm"
if [ -d dist/images ]; then
  aws s3 cp dist/images "$DEST/dist/images" --recursive --cache-control "$CACHE" --only-show-errors
fi
aws cloudfront create-invalidation --distribution-id EC6STGGIWB4OW --paths "/snowstorm/*" --query Invalidation.Status --output text
