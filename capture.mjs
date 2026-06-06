// Capture deterministic screenshots into <outRoot>/<project>/<name>.png, the
// layout screencomp classifies. Usage: node capture.mjs [outRoot] [siteDir]
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const outRoot = process.argv[2] ?? "shots/current";
const siteDir = process.argv[3] ?? "site";

// Each project is a viewport variant; each name is a page.
const projects = [
  ["desktop", { width: 1280, height: 800 }],
  ["mobile", { width: 390, height: 844 }],
];
const pages = [
  ["home", "index.html"],
  ["about", "about.html"],
];

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
