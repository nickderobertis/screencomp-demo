// Capture deterministic screenshots into <outRoot>/<project>/<name>.png, the
// layout screencomp classifies. Usage: node capture.mjs [outRoot] [siteDir]
//
// This is the capture half of the single-container standard: it MUST run inside
// the pinned linux/amd64 Playwright image (see README) so the rendered bytes are
// reproducible run-to-run and machine-to-machine. The launch flags below force a
// CPU-independent, software-rendered, hinting-free path; `--disable-skia-runtime-opts`
// is the key one (it stops Skia picking SIMD kernels by runtime CPU features, so
// emulated amd64 on Apple Silicon matches native amd64 in CI).
import { chromium } from "playwright";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const outRoot = process.argv[2] ?? "shots/current";
const siteDir = process.argv[3] ?? "site";

// Deterministic-rendering flags, adapted from the screencomp standard so the
// SAME capture runs on native-amd64 CI *and* under amd64 emulation on an Apple
// Silicon dev box. `--disable-skia-runtime-opts` is the key one: it forces the
// portable (non-SIMD) Skia raster path, so the emulated CPU and the native CPU
// produce identical bytes.
//
// Deviation from the standard's flag list (and why): the standard recommends
// `--use-gl=angle --use-angle=swiftshader`, but SwiftShader's JIT crashes Chromium
// under Docker Desktop's QEMU amd64 emulation (`qemu: uncaught target signal`).
// For this static-HTML site, CPU rasterization via `--disable-gpu` is equivalent
// and survives emulation; `--single-process` + `--disable-dev-shm-usage` keep
// Chromium stable under QEMU. All three are no-ops for correctness on native CI.
// (With Docker Desktop's Rosetta emulation enabled, the swiftshader path can be
// used instead — see README.)
const DETERMINISTIC_ARGS = [
  "--no-sandbox",
  "--single-process",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-gpu-rasterization",
  "--disable-partial-raster",
  "--disable-skia-runtime-opts",
  "--force-color-profile=srgb",
  "--font-render-hinting=none",
  "--disable-lcd-text",
  "--hide-scrollbars",
];

// Each project is a viewport variant.
const projects = [
  ["desktop", { width: 1280, height: 800 }],
  ["mobile", { width: 390, height: 844 }],
];

// Discover pages from the site directory so adding or removing a page needs no
// change here — and so a base-vs-head capture naturally surfaces added/removed
// pages (whichever side lacks the file simply has no shot for it).
const pages = (await readdir(siteDir))
  .filter((file) => file.endsWith(".html"))
  .sort()
  .map((file) => [file === "index.html" ? "home" : path.basename(file, ".html"), file]);

// Launch a fresh browser per project (one context each). This is deliberate:
// under Docker Desktop's QEMU amd64 emulation on Apple Silicon, a single browser
// juggling multiple contexts crashes (`qemu: uncaught target signal`); one
// context per launch is stable. It is equally correct on native CI.
for (const [project, viewport] of projects) {
  const browser = await chromium.launch({ args: DETERMINISTIC_ARGS });
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const [name, file] of pages) {
      const dir = path.join(outRoot, project);
      await mkdir(dir, { recursive: true });
      await page.goto("file://" + path.resolve(siteDir, file), { waitUntil: "networkidle" });
      await page.screenshot({
        path: path.join(dir, `${name}.png`),
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      });
    }
    await context.close();
  } finally {
    await browser.close();
  }
}
console.log(`captured ${projects.length * pages.length} screenshots into ${outRoot}`);
