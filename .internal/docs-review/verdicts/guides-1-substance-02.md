# guides-1-substance-02

## Finding as given

- page: guides/assets-pipeline
- anchor: "## Build only the shader permutations you draw with" (lines 465-505)
- category: internal-note, severity: high
- claim: The section is a maintainer procedure, not part of the assets command. It tells users to run bun run examples:build, examples:preview and bun tools/shader-permutations.ts --pages demos, which exist only in the engine repository, names examples/shader-permutations.txt, "this repository's own dev server" and "the island's pages", and uses changelog wording "as before" (lines 469, 495). A project developer fails at the first command.
- evidence: package.json:66-67; examples/vite.build.config.ts:37-38; tools/lib/shader-modules.ts:316-333; docs/guides/deterministic-simulation.md:212-222 is the only user flow that needs it.
- proposedEdit: Move the section to deterministic-simulation's "A production build of a game's engine files" (or its own page). Rewrite for a reader with a checkout at their release tag: record against the game's pages with --page, build the set, point NULL3D_ENGINE_SHADERS at it. Delete the demo, island and examples/ references and both "as before". Leave one linking sentence beside "The shader list". Put the device-bit detail in a "Technical details: what a permutation word holds" block.

Verdict: partly

## Evidence

Holds:
- The section's three code blocks are the engine repository's own flow. `examples:build` and `examples:preview` are repo scripts (package.json:66-67). `--pages demos` records the engine's demos, not the reader's pages. examples/vite.build.config.ts:35-38 reads examples/shader-permutations.txt by default, which is what line 485 describes.
- Line 485 names "this repository's own dev server", "A demo that draws more ..." and "The island's pages". These are about the engine's examples, not a user project.
- "as before" appears at line 469 and line 495. It is changelog wording.
- The build command at line 492 (`bun run build`) is tools/build-wasm.ts (package.json:27), the engine checkout's full build. deterministic-simulation.md:215 gives a different command for the same step (`bun run shaders`, package.json:30). Readers get two commands for one job.
- The section has nothing to do with the `assets` command, which is the page's subject (page title, line 9).

Does not hold, or is overstated:
- "A project developer fails at the first command" is too strong. Line 485 does say the recorder runs from a checkout of the engine, and that an outside project names its pages with one `--page <path>` each. In a checkout, `bun run examples:build` succeeds. The real failure is quieter: a reader who follows the code blocks records the engine's demos, not their own pages, and gets a list that does not match their scenes. Severity high still fits, because the visible procedure misleads.
- "deterministic-simulation is the only user flow that needs it" is wrong. Narrowing works for any build that uses the Vite plugin: NULL3D_ENGINE_SHADERS is a general plugin setting (getting-started/network-use.md:55-67), and nothing ties it to a game whose page module another build makes. deterministic-simulation.md:180-222 is one case. Its step 1 already links to this section (line 214).

## Corrected claim

The section is written for engine maintainers. Its commands record the engine's demos (`examples:build`, `examples:preview`, `--pages demos`). It names the repo's examples file, dev server, demos and island, and it uses "as before" twice (lines 469, 495). Line 485 does mention, in one sentence, that an outside project records with `--page` from an engine checkout. But a reader who follows the code blocks records the wrong pages. The build command (`bun run build`, line 492) also differs from the one in deterministic-simulation.md:215 (`bun run shaders`). The section is not about the assets command. Any project that builds with the Vite plugin can use it, not only the deterministic-simulation flow.

## Corrected edit

Do not move the section into deterministic-simulation. That guide's subject (games whose page module another build makes) is narrower than the feature. Give it its own guide, for example guides/shader-permutations.md (add it to PAGES in tools/lib/docs.ts so pages.md lists it), or put it on getting-started/hosting.md beside the size limits it helps with. Write it for a project developer:

1. In a checkout of null3D at the project's release tag, record the project's pages: `bun tools/shader-permutations.ts --base <the project's preview URL> --page <path> ...` (or `--live <path>`, with `--click <selector>` for a page that starts on a click). Record both GPU paths and the low and high presets.
2. Build the shader modules from the list with one command, the same one deterministic-simulation uses (`NULL3D_SHADER_PERMUTATIONS=<list> bun run shaders`).
3. Build the project with NULL3D_ENGINE_SHADERS set to the checkout's packages/engine/src/generated.

Keep `--extra` for words a recording cannot reach. Delete `--pages demos`, examples/shader-permutations.txt, "this repository's own dev server", the demo and island sentences, and both "as before". State the default in the present tense ("Without the list, the build compiles every permutation"). Move the device-bit paragraph (line 471), the cache-key sentence (line 495) and the alpha-mask example word into a block:

<details>
<summary>Technical details: what a permutation word holds</summary>

(device bits left out of a word; per-path bits for WebGL2 and WebGPU; how the list joins the build's cache keys; the alpha-mask bit as an example `--extra` word)

</details>

Leave one sentence beside "The shader list" (line 266) that links to the new page and says how the two lists differ. Change deterministic-simulation.md:214 to link to the new page.
