# start-readability-02

## Finding as given

- page: getting-started/cdn
- anchor: ## Make the CDN build (line 22); ## One HTML file (line 66)
- category: missing-prerequisite
- severity: high
- claim: The 'try it' page asks the reader to run bun run build and bun run build:cdn, which are scripts of the engine repository, and never says to clone it. The HTML file that is the point of the page comes third, after six paragraphs on the two entries.
- evidence: cdn.md lines 26 to 29; package.json lines 27 and 29 map them to tools/build-wasm.ts and tools/build-cdn.ts. The HTML starts at line 70, after lines 45 to 64.
- proposedEdit: Open 'Make the CDN build' with one sentence: the commands run in a clone of the null3D repository, with a link to what that build needs. Reorder: Make the CDN build (steps only), One HTML file, Production and development entries, Start the core early, then the rest. Add an 'In short' numbered list under the intro: build the folder, upload it with the headers, save the HTML file, switch to the development entry while you work.

Verdict: survives

## Evidence

- cdn.md lines 26 to 34 run `bun run build`, `bun run build:cdn` and `bun run build:cdn --out`. No line on the page says to clone the repository, run `bun install` first, or install Bun and the Rust toolchain. A search of docs/ for "clone" finds nothing.
- package.json maps `build` to `bun tools/build-wasm.ts` and `build:cdn` to `bun tools/build-cdn.ts`. These are repository tools. The npm package does not ship them, and cdn.md line 24 itself says the npm package leaves the built shaders out.
- The release workflow publishes no prebuilt CDN folder (no CDN step in .github/workflows/release.yml). So the reader has no way to get the folder except to build it.
- The prerequisites exist only in README.md "Development" (Bun 1.4.3+, Rust through rustup, `git clone`, `bun install`, `bun run build`). The CDN page does not link there.
- The gap is made worse by install.md line 13: "To try the engine in one HTML file with no install, see Try null3D from a CDN". The reader arrives expecting no install, then meets repository build commands.
- Order: the HTML block starts at line 70. Before it come the build section (lines 22 to 43) and the entries section (lines 45 to 64: one table and seven paragraphs, not six). The entries section is reference detail (address switches, the threads-off test, the benchmark build) that a first-time reader does not need before the HTML. Line 113 already tells the reader when to switch to the development entry, so the HTML section stands without the entries section before it.

## Corrections to the edit

- The count is seven paragraphs plus a table, not six. This does not change the finding.
- The opening sentence should name the full steps, not only "a clone". `bun run build` fails without `bun install` and the Rust toolchain. Show `git clone https://github.com/null3d-engine/null3d.git`, `cd null3d` and `bun install` before the two build commands, and link to the README's Development section for Bun and Rust.
- "Steps only" must keep the CORS, content-type and cache headers in Make the CDN build. Start the core early (line 127) links back to that section for the headers, and the proposed "In short" list says "upload it with the headers".
- After the reorder, line 113 refers to "the development checks" before the entries section. Give it a link to #production-and-development-entries.
- Fix install.md line 13 in the same change: the page has no build step, but the engine folder is built once from the repository. "with no install" misleads.
- The "In short" list is optional. The real cost to the reader is the missing clone and install steps and the late HTML; the list is polish.
