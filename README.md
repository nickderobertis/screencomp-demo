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

[`.github/workflows/visual-docs.yml`](.github/workflows/visual-docs.yml):

- **push to `main`** → capture → `screencomp doctor` preflight → `screencomp
  verify` reproducibility gate → `screencomp gallery` → deploy to GitHub Pages
  (the blessed "current state", also the *before* pixels for PR previews).
- **pull request** → capture → `doctor` + `verify` → classify against the
  committed manifest → deploy a **before/after** preview under `pr/<n>/`
  (before = main's deployed gallery) → `screencomp comment` posts a sticky
  comment → push a regenerated manifest to the PR branch (its text diff,
  old→new hash per shot, is the review record).
- **pull request close** → remove the `pr/<n>/` preview.

The pipeline tracks screencomp ≥ **v0.1.10**. Two of its commands are
purpose-built for the two gates above: `screencomp doctor` preflights the
`<project>/<name>.png` layout and resolves the platform key (catching an empty
tree or a wrong `--platform` early), and `screencomp verify` is the dedicated
reproducibility gate — two independent captures of one build must be
byte-identical (it replaces the earlier `classify --baseline/--current` trick).

The PR preview is a **diff gallery** (`gallery --baseline before`), so its images
live under `pr/<n>/baseline/…` and `pr/<n>/current/…`. Because the comment
classifies against the image-free manifest (`--baseline-manifest`, no baseline
PNGs), `screencomp comment` is given explicit `--baseline-url`/`--current-url`
overrides pointing at those two subtrees — otherwise it would point "After" at a
plain-layout URL and drop the "Before" link. `--gallery-url` remains the
"View full gallery" link.

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
