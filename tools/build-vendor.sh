#!/usr/bin/env bash
# vendor/renderer: bedrock-renderer's WASM build with particle-sim inside (the renderer's README, "Web", builds it
# into examples/web/pkg). Committed; rerun after the renderer, particle-sim or molang-rs change and that build.
# Usage: tools/build-vendor.sh [renderer checkout, default ../bedrock-renderer with particle-sim and molang-rs beside it]
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
renderer=${1:-$here/../bedrock-renderer}
pkg=$renderer/examples/web/pkg
[ -f "$pkg/bedrock_renderer_web_bg.wasm" ] || { echo "no renderer build in $pkg" >&2; exit 1; }
rm -rf "$here/vendor/renderer" "$here/vendor/particle-sim" && mkdir -p "$here/vendor/renderer"
cp "$pkg/bedrock_renderer_web.js" "$pkg/bedrock_renderer_web_bg.wasm" "$here/vendor/renderer/"
for name in bedrock-renderer particle-sim molang-rs; do
	echo "$name $(git -C "$renderer/../$name" rev-parse HEAD)"
done > "$here/vendor/renderer/VERSION"
cat "$here/vendor/renderer/VERSION"
