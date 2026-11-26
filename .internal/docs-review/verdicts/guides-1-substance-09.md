# guides-1-substance-09

## Finding as given

- Page: guides/deterministic-simulation
- Anchor: "In a checkout of null3D, build the shader modules from the list" (line 215)
- Category: missing-prerequisite. Severity: medium.
- Claim: The steps need a checkout at the same release as the installed @null3d/engine and the tools that bun run shaders needs. The page names neither. The plugin uses the named folder as it is, with no version check, so a checkout at another version gives modules that do not match.
- Evidence: package.json:30 ('shaders': 'bun tools/shaders.ts'); packages/vite-plugin/src/engine-shaders.ts:37-41, :68-72.
- Proposed edit: Before step 1: "You need a checkout of the null3D repository at your engine's tag, such as git checkout 0.1.0, and the tools its contributor guide lists for a shader build." After step 3: "Build the set again after each engine upgrade."

Verdict: survives

## Evidence

- docs/guides/deterministic-simulation.md:215-216 say only "In a checkout of null3D" and name no version and no tools. The rest of the section (lines 218-224) does not add either.
- The linked section, docs/guides/assets-pipeline.md:485, says the recorder "runs from a checkout of this repository". It also names no version and no tools. No other docs page that names the two variables (network-use, assets-pipeline) covers this.
- packages/vite-plugin/src/engine-shaders.ts:68-72: when the folder variable is set, the plugin returns that folder if it holds shaders.ts. It checks no hash and no version. The hash check (readArtifact, ensureEngineShaders) runs only on the release-asset path, which the variable skips. packages/vite-plugin/src/index.ts:547-555 then resolves each module from that folder as is.
- tools/shaders.ts compiles the modules with the checkout's own compiler, so it needs the development tools. The README "Development" section (README.md:255-262) lists them: Bun, the Rust toolchain, Node.js, mkcert, then bun install.
- The release tag is "0.1.0" (git ls-remote shows refs/tags/0.1.0), so "git checkout 0.1.0" is correct.

## Note on the edit

The claim holds. One refinement: the docs have no "contributor guide", and docs must not link .dev/. Point to the README's Development section, which is published and lists the tools.

Corrected edit, before step 1: "You need a clone of the null3D repository at the tag of your installed engine, such as `git checkout 0.1.0`, with the tools that the README's Development section lists. Modules from another version may not match the engine, and the plugin does not check." After step 3: "Build the set again after each engine upgrade."
