#!/usr/bin/env bash
# vendor/renderer: bedrock-renderer's WASM build with particle-sim inside (built from the renderer's checkout).
# Committed; rerun after the renderer, particle-sim or molang-rs change.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
built=${RENDERER_BUILD:-$here/../renderer-build}
rm -rf "$here/vendor/renderer" "$here/vendor/particle-sim" && mkdir -p "$here/vendor/renderer"
cp "$built/"* "$here/vendor/renderer/"
cat "$here/vendor/renderer/VERSION"
