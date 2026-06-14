#!/usr/bin/env bash
# Verify the screencomp single-container standard reproduces the committed
# linux-x86_64 baseline ON THIS MACHINE — the same image and capture as CI.
#
#   Run from the repo root:   ./scripts/verify-local.sh
#   Override the binary:      SCREENCOMP=/path/to/screencomp ./scripts/verify-local.sh
#   Override the image:       IMG=mcr.microsoft.com/playwright:vX.Y.Z-noble ./scripts/verify-local.sh
#
# Captures are ALWAYS amd64 (forced with --platform=linux/amd64). On a non-amd64
# host (arm64 Linux, Apple Silicon) that runs under QEMU emulation, so every
# comparison uses the explicit `linux-x86_64` key, never `auto` (which would
# resolve to the host's own arch). The decisive result is check 3: does this
# machine reproduce the committed amd64 bytes that CI generated?
set -uo pipefail

KEY="${KEY:-linux-x86_64}"
IMG="${IMG:-mcr.microsoft.com/playwright:v1.60.0-noble}"   # keep in lockstep with package.json
MANIFEST="shots/baseline/${KEY}.sha256"
SC="${SCREENCOMP:-screencomp}"
ROOT="$(pwd -P)"   # physical path: Docker Desktop won't bind-mount a symlinked dir (e.g. /tmp)
fail=0
note() { printf '\n=== %s ===\n' "$*"; }

# --- preflight ---------------------------------------------------------------
note "host / tooling"
uname -msr
command -v "$SC" >/dev/null 2>&1 || { echo "ERROR: screencomp not found on PATH (set SCREENCOMP=/path/to/screencomp)"; exit 2; }
"$SC" --version
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found"; exit 2; }
docker version --format 'docker server {{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}' || true
[ -f capture.mjs ] && [ -f "$MANIFEST" ] || { echo "ERROR: run from the repo root (need capture.mjs and $MANIFEST)"; exit 2; }

note "amd64 emulation available?"
emu_arch="$(docker run --rm --platform=linux/amd64 "$IMG" uname -m 2>/dev/null || true)"
echo "linux/amd64 container reports: ${emu_arch:-<failed to launch>}"
if [ "$emu_arch" != "x86_64" ]; then
  echo "ERROR: cannot run linux/amd64 here. On arm64 Linux, install QEMU binfmt and retry:"
  echo "         docker run --privileged --rm tonistiigi/binfmt --install amd64"
  exit 2
fi

cap() { # cap <outRoot>  -> captures amd64 into <outRoot>/<KEY>/<project>/<name>.png
  docker run --rm --platform=linux/amd64 --ipc=host --shm-size=2g \
    -v "$ROOT:/work" -w /work "$IMG" \
    bash -lc "set -euo pipefail; npm ci --no-audit --no-fund; node capture.mjs $1/${KEY} site"
}

# --- 1. capture twice --------------------------------------------------------
note "1/3 capture twice in the pinned linux/amd64 container (slow under emulation)"
cap shots/current || { echo "FAIL: capture (current) crashed — see log above"; exit 1; }
cap shots/verify  || { echo "FAIL: capture (verify) crashed — see log above"; exit 1; }
find "shots/current/${KEY}" -name '*.png' | sort

# --- 2. reproducibility gate -------------------------------------------------
note "2/3 reproducibility gate: two independent captures must be byte-identical"
# `doctor` (v0.1.10) preflights the <project>/<name>.png layout and resolves the
# platform key before the gate, turning a mislaid capture into a clear message.
"$SC" doctor --input shots/current --platform "$KEY" --exit-code || true
# `verify` (v0.1.10) is the purpose-built reproducibility gate (replaces the old
# `classify --baseline/--current`): two captures of one build must match exactly.
if "$SC" verify --first shots/current --second shots/verify --platform "$KEY"; then
  echo "PASS: capture is reproducible run-to-run on this machine"
else
  echo "FAIL: capture is NOT reproducible here (nondeterministic rendering)"; fail=1
fi

# --- 3. parity vs the committed baseline (decisive) --------------------------
note "3/3 parity: a fresh capture must match the committed baseline manifest"
echo "(does THIS machine reproduce the amd64 bytes CI committed?)"
if "$SC" classify --baseline-manifest "$MANIFEST" --current shots/current --platform "$KEY" --exit-code; then
  echo "PASS: in parity with the committed baseline (== CI)"
else
  echo "DIVERGE: this machine does not reproduce the committed amd64 bytes."
  echo "  The single-key standard does not hold here. Inspect the difference:"
  echo "    $SC manifest --input shots/current --platform $KEY"
  echo "  vs committed $MANIFEST. If emulation is the cause, fall back to a native"
  echo "  per-arch baseline (capture linux-arm64 natively as its own key)."
  fail=1
fi

note "verdict"
if [ "$fail" -eq 0 ]; then
  echo "✅ ALL CHECKS PASSED — local captures match CI byte-for-byte on $(uname -m)"
else
  echo "❌ one or more checks failed (see above)"
fi
exit "$fail"
