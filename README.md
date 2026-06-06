# screencomp-demo

A test consumer for the [screencomp](https://github.com/nickderobertis/screencomp)
visual-docs framework. It hosts a tiny static site, captures it with Playwright,
and uses `screencomp` to publish a screenshot gallery and post screenshot-diff
comments on pull requests.

## How it works

`site/` holds the app. `capture.mjs` screenshots each page in each viewport into
`shots/current/<project>/<name>.png` — the layout screencomp classifies (here
`<project>` is a viewport, `<name>` is a page).

[`.github/workflows/visual-docs.yml`](.github/workflows/visual-docs.yml):

- **push to `main`** → capture → `screencomp gallery` → deploy to GitHub Pages.
- **pull request** → capture this branch *and* its base branch in the same run
  (so unchanged pages are byte-identical), then `screencomp comment` posts a
  sticky diff comment. Change a page in a PR and the comment lists it as changed.

The CLI is installed via the composite action; baselines are recomputed per run
rather than committed, so there are no screenshot binaries in git.

## Local capture

```sh
npm install
npx playwright install chromium
node capture.mjs shots/current site
```
