#!/usr/bin/env bash
# vendor/renderer: bedrock-renderer's WASM build (built from the renderer's checkout);
# vendor/particle-sim: particle-sim's js/wasm module. Both are committed; rerun after either project changes.
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
built=${RENDERER_BUILD:-$here/../renderer-build}
sim=${PARTICLE_SIM:-$here/../particle-sim}
rm -rf "$here/vendor/renderer" && mkdir -p "$here/vendor/renderer" "$here/vendor/particle-sim"
cp "$built/"* "$here/vendor/renderer/"
(cd "$sim" && GOOS=js GOARCH=wasm go build -trimpath -ldflags='-s -w' -o "$here/vendor/particle-sim/particle-sim.wasm" ./cmd/particle-wasm)
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" "$here/vendor/particle-sim/"
echo "particle-sim $(git -C "$sim" rev-parse HEAD)" > "$here/vendor/particle-sim/VERSION"
cat "$here/vendor/renderer/VERSION" "$here/vendor/particle-sim/VERSION"
