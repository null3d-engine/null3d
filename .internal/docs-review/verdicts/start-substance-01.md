# start-substance-01

## The finding as given

- Page: getting-started/cdn, getting-started/install
- Anchor: cdn "## Make the CDN build" lines 22-35; install line 13 "To try the engine in one HTML file with no install"
- Category: missing-prerequisite. Severity: high.
- Claim: The CDN page tells the reader to run `bun run build` and `bun run build:cdn`. These are scripts of the engine's own repository, not of the npm packages. `bun run build` compiles the Rust core, so it needs a clone and the Rust toolchain. No release publishes the CDN folder. The install page sends readers here with the words "no install".
- Evidence: package.json:27-29; tools/build-cdn.ts:4; README.md:260-265; .github/workflows/release.yml has no CDN build step.
- Proposed edit: Add a first section, "Before you start": "The CDN build comes from the engine's repository, not from npm. Clone it, install Bun and the Rust toolchain through rustup, as the repository's README says, and run the two commands in the clone." In install line 13, replace "with no install" with "with no bundler. That page builds the engine from its source once."

Verdict: survives

## Evidence

- cdn.md:22-35: the section gives `bun run build` and `bun run build:cdn` with no word about where to run them. Nothing on the page says a clone of the repository is needed.
- package.json:27 (`build` runs tools/build-wasm.ts) and :29 (`build:cdn` runs tools/build-cdn.ts). These are repository scripts. The npm packages do not ship them.
- tools/build-cdn.ts:4: "Run from the repository root, after `bun run build`".
- tools/lib/cdn.ts:184-197 and :490-493: the CDN build refuses to run without the built WebAssembly core and `lib/generated/shaders.js`, and tells the user to run `bun run build` first. It reads `packages/engine`, `packages/<addon>/src` and the vite-plugin source (line 36). So it can only run in a full clone.
- README.md:256-266: the engine build needs Bun, the Rust toolchain through rustup, `git clone` and `bun install`.
- .github/workflows/release.yml: no mention of "cdn". No release publishes the folder.
- install.md:13 says "with no install". The reader must in fact clone, install Bun and Rust, and build. That misleads a newcomer.
- No other page (hosting.md:62, deploying.md, start-time.md, debugging.md, performance.md, testing.md) says where the commands run.

## Corrected edit

The proposed edit holds, with one gap: the clone also needs `bun install` before `bun run build` (README.md:263). Give the steps as one code block, so a reader can copy them:

```sh
git clone https://github.com/null3d-engine/null3d.git
cd null3d
bun install
bun run build
bun run build:cdn
```

Put one sentence before it: "The CDN build comes from the engine's source, not from npm. Install Bun and the Rust toolchain through rustup, then run these commands." Link the README's Development section by its GitHub URL, not by a relative path. Keep the install.md change as proposed.
