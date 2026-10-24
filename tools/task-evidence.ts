// What proves each completed task on the milestone branch: the test or picture that a reader
// can open. The pull request marks a task done only when its commit is on the branch and this
// file names the evidence, so a tick always means the work is here and something checks it.
// The entries come from read-only audits of the branch on 23 October 2026. The audit of 24
// October 2026 removed the entries of the tasks that fell short of their own "Done when"; each
// returns when its gap closes, and the removed lines stay in git history meanwhile.
export const TASK_EVIDENCE: Readonly<Record<string, string>> = {
	'M3-R13':
		'Three checks, each with a test seen to fail without it: the `ktx2-etc2` picture stands in for an ETC2-only device and failed with E1412 when the format was mislabelled; the shared replay skips a pending compute pass for an add-on shader too, in `packages/engine/src/gpu/webgpu/backend.test.ts`; the skinning pass checks the device limit, from b3187c44b',
	'M3-A4':
		"`bloomLevel` in `packages/engine/src/scene/effects.ts`; the lens kit's streak reads level 3 of bloom's chain, with the `lens-streak` picture on both paths; `docs/api/post.md`",
	'M3-A6':
		'`setDrawRange` in `packages/engine/src/scene/scene.ts`; the `lod-range`, `lod-range-batch` and `lod-hide` pictures on every tier; D-211',
	'M3-A3':
		'A custom material declares `texture_2d_array<f32>` and picks the layer in each texture function: `packages/vite-plugin/src/shader-types.ts`, the docs `packages/engine/docs/guides/custom-shaders.md` and `custom-passes.md`; D-239',
	'M3-A5':
		'`createVertexDraw` in `packages/engine/src/scene/scene.ts:4623-4702`; `examples/rain/sketch.ts`',
	'M3-A7': '`limit_hdr` maps NaN to zero: `crates/null3d-shaders/wgsl/lib/color.wgsl:35-38`',
	'M3-D2':
		'Version check in each foundation add-on (`packages/engine/src/shared/version.ts`); `packages/cli/src/upgrade.js`',
	'M3-D3': "E1417's message names the add-on: `packages/engine/src/errors/codes.ts:417`",
	'M3-D4': "The particle buffer's record layout and limits: `docs/concepts/particle-buffer.md`",
	'M3-D5': '`examples/addons/README.md` and two add-ons in that layout',
	'M3-D6': 'The plugin interface version check: `packages/engine/src/shared/version.ts`',
	'M3-D9':
		"`bunx @null3d/cli check-addon` runs the engine's gates on one add-on: `packages/cli/src/check-addon.js`, which refuses `tests/fixtures/d9-addon-internal` for importing `@null3d/engine/internal`; D-225 records the run over every foundation add-on and the fixture's page and cost gates",
	'M3-D9a':
		"The allocation gate of `check-addon`: the engine's profiler now lives once in `packages/cli/src/heap-profile.js`, `devtools.js` and `source-names.js`, and the benchmarks import it; the gate reports the add-on's own bytes per frame on each preset, and fails when the page runs none of the add-on's code; D-225's addendum records the figures that the two fixtures gave on 24 October 2026",
	'M3-E1':
		"Splats draw through `scene.addFeatureInstances` (`packages/engine/src/scene/feature-instances.ts`); the `splats`, `splats-budget` and `splats-gltf` pictures on both paths; the draw's size in `tools/lib/size-report.ts`",
	'M3-F6':
		"Video textures: `engine.registerVideo` and `textures.fromVideo`, held by `tests/pages/video-texture.ts`, which passes on both GPU paths in Chrome on the Mac, on the software renderer, and in Safari 26.6.2 and Firefox 158 — a 512 by 288 frame uploads 577 KiB against the Low preset's 2 MiB budget, upright, within two steps of a data texture; the page's video support loads at its first call; the guide `guides/video-textures` and the mapping entry",
	'M3-F7':
		"The three-compat add-on in `packages/three-compat/`: Reinhard and Cineon as named tone curves through the core's tone-curve setting, and the outline pass's glow, pulse and blurred edge, with `tone-reinhard` and the outline pictures on every tier and strict comparisons against three.js's formulas",
	'M3-E3':
		"`registerGltfExtension` in `packages/engine/src/scene/gltf-extensions.ts`; the `splats-gltf` picture, and E1417's hint for `KHR_gaussian_splatting` in `gltf-extensions.test.ts`",
	'M3-E4':
		"Water's soft shores read the scene depth on every path: the `water-shores` picture on WebGPU, compatibility mode and WebGL2, in both reference sets, shows the pale band and foam where the water meets the sand and the island's base; without the depth copy the sheet draws its deep colour everywhere. D-202's addendum names M3-E4a for the case of depth beside textures",
	'M3-E5':
		'One file format for baked probe grids and light maps: `packages/engine/src/scene/baked-light.ts`, `assets.loadLightProbeGrid`, `assets.loadLightMap` and `assets.lightProbeGridFile`, with every fault named as E1434; the guide `docs/guides/baked-light-data.md`, a round-trip test and two fixtures; D-243',
	'M3-G4':
		"`transmissionMap` and `thicknessMap`: `packages/engine/src/scene/resources.ts`, the shaders' thickness reads",
	'M3-K1': '`scene.createView({ camera, rect })`: `packages/engine/src/scene/scene.ts`',
	'M3-K3':
		'Spot-light cookies, `light.map`: `packages/engine/src/scene/scene.ts`, `docs/api/lights.md`',
	'M3-K5': '`scene.overrideMaterial`: `packages/engine/src/scene/scene.ts`, `docs/api/scene.md`',
	'M3-F8':
		"`probe.capture()` again on request, with the moved object's reflection settling: `crates/null3d-render/tests/probes.rs` and the `probe-capture` picture on every tier; `docs/api/scene.md`",
	'M3-R6':
		'D-226 records the timings on Chrome and Safari: at most 0.29 ms in Safari, nothing measurable in Chrome, so the pattern stays',
	'M3-R10':
		"A sky map redraws only past a visible step: `crates/null3d-render/tests/sky_maps.rs` counts the fills a day cycle records; `tests/image/sky-step.spec.ts` keeps every step within 8 levels of 255 on every tier; D-118's addendum records the fills a minute",
};
