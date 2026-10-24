// What proves each completed task on the milestone branch: the test or picture that a reader
// can open. The pull request marks a task done only when its commit is on the branch and this
// file names the evidence, so a tick always means the work is here and something checks it.
// The entries come from read-only audits of the branch on 23 October 2026. The audit of 24
// October 2026 removed the entries of the tasks that fell short of their own "Done when"; each
// returns when its gap closes, and the removed lines stay in git history meanwhile.
export const TASK_EVIDENCE: Readonly<Record<string, string>> = {
	'M3-R13':
		'Three checks, each with a test seen to fail without it: the `ktx2-etc2` picture stands in for an ETC2-only device and failed with E1412 when the format was mislabelled; the shared replay skips a pending compute pass for an add-on shader too, in `packages/engine/src/gpu/webgpu/backend.test.ts`; the skinning pass checks the device limit, from b3187c44b',
	'M3-B3':
		"In-world screens drawn on a canvas: one canvas-backed texture per screen, a refresh rate per screen, changed-rectangle uploads, the LCD look by distance, and clicks mapped back to canvas pixels: `examples/addons/screens/`, with 11 unit tests of the coordinate mapping; the control room draws panels at four rates, the picking demo's wall plan is a screen, the showroom has a tablet, and Skyway's hero car carries two deck panels and a navigation panel in `examples/showcase/skyway/cockpit.ts`; 18 image tests across the demos and 6 for Skyway, in both reference sets; D-253",
	'M3-A4':
		"`bloomLevel` in `packages/engine/src/scene/effects.ts`; the lens kit's streak reads level 3 of bloom's chain, and the `lens-streak` picture on both paths shows the glow and the sideways streak; `demo-post-effects` reads the same level; `FrameGraph::bloom_source` binds the chain to the scene's colour, which `a_lone_effect_that_reads_bloom_keeps_the_whole_chain_and_the_glow` checks; `docs/api/post.md`",
	'M3-A6':
		'`setDrawRange` on a mesh and on an instance batch in `packages/engine/src/scene/scene.ts`; the `lod-range` and `lod-range-batch` pictures on every tier; D-211',
	'M3-A3':
		'A custom material declares `texture_2d_array<f32>` and picks the layer in each texture function: `packages/vite-plugin/src/shader-types.ts`, the docs `docs/guides/custom-shaders.md` and `custom-passes.md`; D-239',
	'M3-A5':
		'`createVertexDraw` in `packages/engine/src/scene/scene.ts:4848`; `examples/rain/sketch.ts`',
	'M3-A7': '`limit_hdr` maps NaN to zero: `crates/null3d-shaders/wgsl/lib/color.wgsl:35-38`',
	'M3-D2':
		'Version check in each foundation add-on (`packages/engine/src/shared/version.ts`); `packages/cli/src/upgrade.js`',
	'M3-D3': "E1417's message names the add-on: `packages/engine/src/errors/codes.ts:417`",
	'M3-D4': "The particle buffer's record layout and limits: `docs/concepts/particle-buffer.md`",
	'M3-D5': '`examples/addons/README.md` and the four add-ons in that layout',
	'M3-D6': 'The plugin interface version check: `packages/engine/src/shared/version.ts`',
	'M3-D9':
		"`bunx @null3d/cli check-addon` runs the engine's gates on one add-on: `packages/cli/src/check-addon.js`, which refuses `tests/fixtures/d9-addon-internal` for importing `@null3d/engine/internal`; D-225 records the run over every foundation add-on and the fixture's page and cost gates",
	'M3-D9a':
		"The allocation gate of `check-addon`: the engine's profiler now lives once in `packages/cli/src/heap-profile.js`, `devtools.js` and `source-names.js`, and the benchmarks import it; the gate reports the add-on's own bytes per frame on each preset, and fails when the page runs none of the add-on's code; D-225's addendum records the figures that the two fixtures gave on 24 October 2026",
	'M3-E1':
		"Splats draw through `scene.addFeatureInstances` (`packages/engine/src/scene/feature-draws.ts`); the `splats` and `splats-budget` pictures on both paths; H3's start code adds 2,182 bytes of TypeScript without comment lines, which Brotli compresses alone to 536 bytes, and its adapter loads on first use as `page-feature-draws.js` at 1,114 bytes after Brotli; D-173's hooks addendum",
	'M3-F6':
		"Video textures: `engine.registerVideo` and `textures.fromVideo`, held by `tests/pages/video-texture.ts`, which passes on both GPU paths in Chrome on the Mac, on the software renderer, and in Safari 26.6.2 and Firefox 158 — a 512 by 288 frame uploads 577 KiB against the Low preset's 2 MiB budget, upright, within two steps of a data texture; the page's video support loads at its first call; the guide `guides/video-textures` and the mapping entry",
	'M3-F7':
		"The three-compat add-on in `packages/three-compat/`: Reinhard and Cineon as named tone curves through the core's tone-curve setting, and the outline pass's glow, pulse and blurred edge, with `tone-reinhard` and the outline pictures on every tier and strict comparisons against three.js's formulas",
	'M3-F2':
		"Splat streaming: `createSplats` reads a stream index and downloads only the chunks that the view needs, in `packages/splats/src/stream.ts`; `tests/image/splats-stream.spec.ts` checks that a capped view downloads a part of the cloud; the 24 October device runs loaded 34% of the cloud on the Galaxy S24 and 61% on the iPad's WebGL2 path; the version 4 SPZ reader has its own test in `packages/splats/src/spz.test.ts`",
	'M3-E3':
		"`registerGltfExtension` in `packages/engine/src/scene/gltf-extensions.ts`; the `splats-gltf` picture, and E1417's hint for `KHR_gaussian_splatting` in `gltf-extensions.test.ts`; H9's start code adds 1,562 bytes of TypeScript without comment lines, which Brotli compresses alone to 589 bytes; D-173's hooks addendum",
	'M3-E4':
		"Water's soft shores read the scene depth on every path: the `water-shores` picture on WebGPU, compatibility mode and WebGL2, in both reference sets, shows the pale band and foam where the water meets the sand and the island's base; without the depth copy the sheet draws its deep colour everywhere. That page is a test sheet; the first user on the branch is the splats add-on's depth mixing. D-202's addendum names M3-E4a for the case of depth beside textures",
	'M3-E5':
		'One stable file format for baked probe grids and light maps: `packages/engine/src/scene/baked-light.ts`, `assets.loadLightProbeGrid`, `assets.loadLightMap` and `assets.lightProbeGridFile`, with every fault named as E1434; the guide `docs/guides/baked-light-data.md` is `status: stable` and states that version 1 holds the listed members, that a reader ignores unknown members, and that a change an earlier reader would misread takes a new version; a round-trip test and two fixtures; D-243',
	'M3-G4':
		"`transmissionMap` and `thicknessMap`: `packages/engine/src/scene/resources.ts`, the shaders' thickness reads",
	'M3-K1': '`scene.createView({ camera, rect })`: `packages/engine/src/scene/scene.ts`',
	'M3-K3':
		'Spot-light cookies, `light.map`: `packages/engine/src/scene/scene.ts`, `docs/api/lights.md`',
	'M3-K4':
		"three.js r186's css3d_periodictable example is ported and compared against three.js's own CSS3DRenderer draw of the same 118 cells: `tests/pages/lib/css3d-periodictable.ts`, the sketch and the two-stage page, and `tests/image/css3d-periodictable.spec.ts`, which screenshots both stages in one run. A probe with zero tolerance passed, so the two draws had no differing pixel on the GPU; the committed tolerance is a tenth of a per cent for a slower rasteriser. The mapping's css-renderers note and the port skill name it, and D-208 carries an addendum",
	'M3-K5': '`scene.overrideMaterial`: `packages/engine/src/scene/scene.ts`, `docs/api/scene.md`',
	'M3-F8':
		"`probe.capture()` again on request, with the moved object's reflection settling: `crates/null3d-render/tests/probes.rs` and the `probe-capture` picture on every tier; `docs/api/scene.md`. The compatibility-mode picture had failed three full runs against a reference drawn on a slow run; the page now pins the frame-budget governor (d3dda9e72), and the full run on 57a0a08ed passed that picture on every tier",
	'M3-E2':
		"The hook carries the add-on's selection, nearest first, and the engine's transparent pass sorts the chosen rows: `tests/image/addon-tasks.spec.ts` proves a task runs on a job worker, the `--splats` switch proves the whole path, and `.dev/benchmarks.md`'s `--splats` bullet records the bytes a frame on the Mac's WebGL2 (653.5 on the sketch worker, 163.8 on the render worker) and on the software renderer (1,119.1 and 91.9), each inside its budget; D-173's addendum rules why the per-splat sort is the engine's",
	'M3-R20':
		"A frame the GPU still holds after its completion record is lost counts as a held frame, so a software GPU's step below the whole scale is judged and undone: 67 governor tests, three of them failing without their part of the fix, and the trap page passing 10 of 10 on the software renderer in five thread modes on both paths; D-237 records the CI figures, the cause and what the line means",
	'M3-R6':
		'D-226 records the timings on Chrome and Safari: at most 0.29 ms in Safari, nothing measurable in Chrome, so the pattern stays',
	'M3-R10':
		"A sky map redraws only past a visible step: `cargo test -p null3d-render --test sky_maps a_day_cycle -- --nocapture` prints the frames that drew a stage for five sun speeds, and one fill every 20 frames gives the fills a minute (10 for a still sun, 70 for a ten-minute day, 179 for the showcase's 80-second day, all on 25 October 2026); `tests/image/sky-step.spec.ts` keeps every step within 8 levels of 255 on every tier; D-118's addendum records the same table",
	'M3-K2':
		"`TransformControls` and `DragControls` in `packages/controls/`: `transform-controls.ts`, `gizmo-drag.ts` and `drag-controls.ts`; `gizmo-drag.test.ts` compares a move and a scale with three.js's own results; `tests/image/gizmos.spec.ts` drags the move, turn and scale gizmos with the mouse and with a finger through Chrome's input",
	'M3-D1':
		"`tools/lib/packages.ts` compiles each add-on's WGSL when it packs, so no tarball ships a raw `.wgsl`; `bun run build:cdn` carries each foundation add-on under `addons/<name>/` with its engine import made relative, and writes the packages' notices at the build's root; `tests/image/cdn-script-tag.spec.ts` draws a terrain from that build on WebGPU, compatibility mode and WebGL2, threaded, and single-threaded on WebGL2, and all four passed on the Mac on 25 October 2026; D-54's addendum records the layout",
	'M3-R16':
		"The starter template's agent hook runs for Claude Code and for Codex: `packages/cli/src/create.js` writes `.claude/settings.json`, `.claude/agent-hook.mjs` and `.codex/hooks.json`; `create.test.ts` makes a project from the template and runs each configured hook command in it, which allows the project's own sketch and build command and refuses a forbidden command and a DOM edit; the hook reads a Codex patch file by file; D-230's addendum records the change",
	'M3-R17':
		"The develop skill's evaluation: all ten cases with and without the skill, and the twenty trigger queries, recorded in `.dev/skill-evaluations.md`; the skill met 55 of 60 expectations against the baseline's 51, and the trigger queries chose the right skill 20 of 20",
	'M3-R18':
		"Shipped code contacts no server of its own: `docs/getting-started/network-use.md`, the guard `tools/lib/network-use.ts` and its 13 passing tests, and each package's `THIRD-PARTY-NOTICES.txt` with `docs/getting-started/third-party-notices.md`; when a call was added to `packages/terrain/src/index.ts`, the repository check named the call and its host, so one test failed and not the list. D-227 and its addenda record the audit and the controls package's three.js notice",
};
