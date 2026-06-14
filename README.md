# screencomp-demo

A test consumer for the [screencomp](https://github.com/nickderobertis/screencomp)
visual-docs framework. It hosts a tiny static site, captures it with Playwright
inside a pinned Linux container, and uses `screencomp` to publish a screenshot
gallery and post screenshot-diff comments on pull requests — following
screencomp's recommended **single-container + image-free digest-manifest**
standard.

## How it works

`site/` holds the app. `capture.mjs` screenshots each page in each viewport into
`shots/current/linux-x86_64/<project>/<name>.png` — the layout screencomp
classifies (`<project>` is a viewport, `<name>` is a page).

Two ideas from the screencomp standard:

- **One pinned `linux/amd64` container.** A screenshot's bytes depend on the OS,
  CPU, fonts, and GPU that rendered it. Capturing inside one pinned Playwright
  image (with the deterministic Chromium flags in `capture.mjs`) makes a capture
  byte-reproducible run-to-run and machine-to-machine, so there is a single
  platform key, `linux-x86_64`. macOS can't run Linux containers natively, so
  `--platform=linux/amd64` reproduces the same pixels as CI under emulation.
- **Image-free baseline.** Only a tiny digest manifest is committed
  (`shots/baseline/linux-x86_64.sha256`) — never the baseline PNGs. screencomp
  compares by content digest, so the manifest is all `classify`/`comment` need,
  and the repo never accrues binary history.

[`.github/workflows/visual-docs.yml`](.github/workflows/visual-docs.yml) is the
**canonical, copy-paste setup**: it delegates the entire pipeline to screencomp's
**reusable workflow** (`visual-docs-reusable.yml`, new in **v0.1.11**) and supplies
only this repo's capture command. End to end:

- **push to `main`** → capture → `verify` reproducibility gate → classify →
  `gallery` → deploy to GitHub Pages root (the blessed "current state", and the
  baseline the PR comment links its "Before" to).
- **pull request** → capture → `verify` → classify against the committed manifest
  → deploy a preview under `pr-<n>/` → sticky before/after comment (Before = the
  deployed root gallery, After = the preview) → push a regenerated manifest to
  the PR branch (its text diff, old→new hash per shot, is the review record).
- **pull request close** → remove the `pr-<n>/` preview (the one step this repo
  still hand-rolls, since the reusable workflow has no close handler).

To copy this into your own project: lift `visual-docs.yml`, point its
`capture-command` at your stack (it must write `$SHOTS_OUT/<project>/<name>.png`),
set `container` to your Playwright image, and seed the manifest once (below). The
reusable workflow installs screencomp, runs the capture twice for the gate, and
handles the gallery/preview/comment/manifest for you. If your repo enforces
required status checks, set a `VISUAL_DOCS_PUSH_TOKEN` secret (a fine-grained PAT
or App token) so the manifest auto-push can re-trigger CI — otherwise the default
`GITHUB_TOKEN`'s push starts no runs and the PR stalls.

Locally, the same `screencomp` commands the reusable workflow runs in CI are
available to you directly — `doctor` preflights the `<project>/<name>.png` layout
and resolves the platform key, and `verify` is the dedicated reproducibility gate
(two captures of one build must be byte-identical). See [Local capture](#local-capture).

## Local capture

Use the same image as CI so captures match. On Apple Silicon, `--platform`
forces the amd64 image under emulation — enable Docker Desktop's **Rosetta**
("Use Rosetta for x86_64/amd64 emulation") for reliability; under the QEMU
fallback Chromium is unstable (`capture.mjs` works around this by launching one
browser per viewport, and the flag set drops `--use-angle=swiftshader`, which
QEMU cannot JIT — see the comments in `capture.mjs`).

### One-command check

[`scripts/verify-local.sh`](scripts/verify-local.sh) runs the whole verification
on the current machine: it captures twice in the pinned container, proves the
capture is byte-reproducible, and confirms it matches the committed baseline
manifest (i.e. this machine reproduces CI's amd64 bytes). Works on x86_64 Linux
(native) and on arm64 Linux / Apple Silicon (amd64 under emulation).

```sh
# screencomp must be on PATH (or pass SCREENCOMP=/path/to/screencomp). Install
# the checksum-verified prebuilt binary (v0.1.10's POSIX installer; it aborts
# rather than install a binary it cannot SHA-256 verify):
#   curl -fsSL https://raw.githubusercontent.com/nickderobertis/screencomp/main/scripts/install.sh | sh
./scripts/verify-local.sh
```

On arm64 Linux, amd64 runs under QEMU — if the script reports it cannot launch
`linux/amd64`, install binfmt once: `docker run --privileged --rm tonistiigi/binfmt --install amd64`.

The equivalent manual steps:

```sh
IMG=mcr.microsoft.com/playwright:v1.60.0-noble   # must match package.json

# Capture twice and prove the capture is byte-reproducible on this machine.
for out in shots/current shots/verify; do
  docker run --rm --platform=linux/amd64 --ipc=host --shm-size=2g \
    -v "$PWD:/work" -w /work "$IMG" \
    bash -lc "npm ci && node capture.mjs $out/linux-x86_64 site"
done

# Preflight the layout, then gate on byte-for-byte reproducibility (v0.1.10).
screencomp doctor --input shots/current --platform linux-x86_64 --exit-code
screencomp verify --first shots/current --second shots/verify \
  --platform linux-x86_64 --exit-code        # expect exit 0

# Compare against the committed baseline manifest (host is not linux-x86_64, so
# pass the key explicitly instead of `auto`).
screencomp classify --baseline-manifest shots/baseline/linux-x86_64.sha256 \
  --current shots/current --platform linux-x86_64
```

### Seeding / updating the manifest

```sh
screencomp manifest --input shots/current --platform linux-x86_64 \
  --output shots/baseline/linux-x86_64.sha256
```

CI regenerates and commits this on every PR; seed it once before the first PR.

### Pre-push guard (optional)

[`scripts/pre-push`](scripts/pre-push) catches drift *before* it is pushed. On
each push it asks `screencomp scope` whether any screenshot-relevant file changed
— the `[guard].paths` globs in [`screencomp.toml`](screencomp.toml) — and only
then runs the local check above. If the capture has drifted from the committed
manifest the push is **blocked**, so a screenshot change never lands without the
manifest update that records it.

```sh
cp scripts/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push
# Bypass once with: git push --no-verify
```

It no-ops when nothing relevant changed, when `screencomp` is not installed, and
inside CI (the reusable workflow already runs the full check). screencomp's
`examples/hooks/README.md` has equivalent wiring for husky, lefthook, and
simple-git-hooks.

## Configuration

[`screencomp.toml`](screencomp.toml) is read automatically from the repo root by
every `screencomp` invocation — both the reusable workflow's `comment` step in CI
and the `scope` check locally:

- **`[comment]`** styles the sticky PR comment (heading, the `marker` that makes
  re-runs upsert one comment, inline-thumbnail `embed_limit`, `show_unchanged`).
- **`[guard]`** lists the paths that make the local pre-push guard fire, plus the
  platform key, manifest, and review-gallery location it uses.

This is the same file `screencomp init` scaffolds (alongside the workflow and the
`.gitignore` block); it is committed here so the whole local + CI pipeline is
configured in one place.
