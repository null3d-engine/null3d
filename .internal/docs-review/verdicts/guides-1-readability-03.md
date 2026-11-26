# guides-1-readability-03

## Finding as given

- page: guides/assets-pipeline, guides/deterministic-simulation
- anchor: "## Build only the shader permutations you draw with" (assets-pipeline line 465); "## A production build of a game's engine files" (deterministic-simulation lines 212-222)
- category: structure. severity: high
- claim: The last H2 of the assets page is a build of the engine's shader set from a null3D checkout, not an assets command, so readers will not find it there. It holds notes for the repository's own demos and changelog wording. The deterministic-simulation page repeats the same steps with its own figures.
- proposedEdit: Move the section to a new page guides/shader-permutations, written as numbered steps (record, build the shader modules, build the project, record again after a new feature). Put the device bits (471), the HTTPS note (481) and the --extra word format (503) in a details block. Cut the island note and the repository dev-server note. Replace "as before" with "compiles every permutation". On deterministic-simulation keep only the click-started game case and link to the new page. On assets-pipeline keep line 505 as one sentence with the link.

Verdict: partly

## Evidence

What holds, and is stronger than the finding says:
- The assets page is titled "The asset pipeline (the `assets` command)". Its PAGES summary in tools/lib/docs.ts:167 is "optimize, env, convert; LODs; texture compression; budget reports". The shader permutation build is none of these.
- The section's commands work only in a null3D checkout. Only the repository's tools read the list variable: tools/lib/shader-modules.ts:320, and examples/vite.build.config.ts:37-38 sets it for the demos. In package.json, `build` is tools/build-wasm.ts (line 27) and `examples:build` is the demos' Vite build (line 66). A game project's build reads only the folder variable (packages/vite-plugin/src/engine-shaders.ts:41, NULL3D_ENGINE_SHADERS). The assets page never names that variable. A reader who runs line 492 in their own project gets a full build with no warning. That misleads, so high severity holds.
- Repository-only notes: line 485 ("/examples/ for this repository's own dev server", "The island's pages record with its highest walker count", "runs from a checkout of this repository"). The commands at lines 476-478 build and preview the repository's own demos (`--pages demos`).
- Changelog wording: "as before" at lines 469 and 495.

What does not hold:
- "The deterministic-simulation page repeats the same steps" is wrong for its steps. Steps 2 and 3 (lines 215-216: `bun run shaders` in a checkout, then `NULL3D_ENGINE_SHADERS` in the game's build) are not on the assets page. They are the only path for a project outside the repository. Step 1 (line 214) already links to the assets section and does not repeat it. Only two parts repeat: the click-started game paragraph (line 218 repeats assets line 487) and "record again after a new feature" (line 222 repeats assets line 497).
- The finding misses a repeat inside the deterministic-simulation page. Lines 218 and 222 give figures for the same game twice, and the figures differ: "300 files and 26 MB ... 762 files and 226 MB" against "297 files and 26,057,130 bytes ... 759 files and 225,683,678 bytes".
- The proposed edit for deterministic-simulation is backwards. "Keep only the click-started game case" keeps the duplicate and drops what that page alone holds. It drops steps 2 and 3, and line 220, the reason that matters for an engine folder: the release asset's full set can exceed the folder's file and byte limits.
- "Replace 'as before' with 'compiles every permutation'" fails at line 495. That line already says "the build compiles every permutation", so the phrase would repeat. Delete "as before" there. At line 469, replace "stays a full build, as before" with "compiles every permutation".
- A new page is a PAGES entry in tools/lib/docs.ts, because docs/pages.md is generated from it. So generatedSource should name that file. The link at deterministic-simulation line 214 must change to the new page, and so must any skill reference to the old anchor (AGENTS.md, "Docs and skills stay in sync").

## Corrected claim

The assets page's last H2 does not belong on that page. It tells how the null3D repository narrows its own shader build: the commands work only in a checkout, and it holds notes about the repository's demos and the changelog phrase "as before". It never names the folder variable that a game project's build reads, so a reader can run it in their own project and silently get a full build. The deterministic-simulation page holds the only path for a project outside the repository (steps 2 and 3). It repeats the assets page only in the click-started game paragraph (line 218) and the re-record sentence (line 222). It also gives the same game's figures twice with different numbers (lines 218 and 222).

## Corrected edit

Move the assets section to a new page, guides/shader-permutations (add it to PAGES in tools/lib/docs.ts). Write the page for a project outside the repository, as numbered steps:
1. Serve your pages and record the list from a null3D checkout with `--page <path>` (and `--live` / `--click` for a page that starts on a click, against a development build).
2. Build the shader modules in the checkout with `NULL3D_SHADER_PERMUTATIONS=<list> bun run shaders`.
3. Build the project with `NULL3D_ENGINE_SHADERS=<checkout>/packages/engine/src/generated`.
4. Record again after a new feature, or add a word with `--extra`.

Put the device bits (line 471), the HTTPS note (line 481) and the `--extra` word format (line 503) in one `<details>` block. Cut the island note, the `/examples/` dev-server note and the demo build commands (lines 476-478, 485, 492), or move them to the maintainer guides. Delete "as before" on line 495, and on line 469 replace "stays a full build, as before" with "compiles every permutation".

On deterministic-simulation, replace steps 1-3 with one link to the new page. Keep line 220 (the release asset's full set can exceed the folder's limits) and one set of figures. Delete the repeated click paragraph (line 218) and the second figure paragraph (line 222), or merge them into one. On assets-pipeline, keep line 505 as one sentence that links to the new page.
