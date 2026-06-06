// Capture deterministic screenshots into <outRoot>/<project>/<name>.png, the
// layout screencomp classifies. Usage: node capture.mjs [outRoot] [siteDir]
import { chromium } from "playwright";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const outRoot = process.argv[2] ?? "shots/current";
const siteDir = process.argv[3] ?? "site";

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

const browser = await chromium.launch();
try {
  for (const [project, viewport] of projects) {
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
  }
} finally {
  await browser.close();
}
console.log(`captured ${projects.length * pages.length} screenshots into ${outRoot}`);
