// What proves each completed task on the milestone branch: the test or picture that a reader
// can open. The pull request marks a task done only when its commit is on the branch and this
// file names the evidence, so a tick always means the work is here and something checks it.
// The entries come from read-only audits of the branch on 23 October 2026.
export const TASK_EVIDENCE: Readonly<Record<string, string>> = {
	'M3-R13':
		'Three checks, each with a test seen to fail without it: the `ktx2-etc2` picture stands in for an ETC2-only device and failed with E1412 when the format was mislabelled; the shared replay skips a pending compute pass for an add-on shader too, in `packages/engine/src/gpu/webgpu/backend.test.ts`; the skinning pass checks the device limit, from b3187c44b',
	'M3-R2':
		'The governor undoes a step that does not pay: `governor.ts` with `LOWER_TRIAL_MS` and `LOWER_LOSS_PERCENT`, 6 new tests in `governor.test.ts` including a replay of the resize page, 57 of 57; D-237',
	'M3-R21':
		"The gate reads its software-renderer pictures from the commit's own CI browser jobs: `bench/ci-browser-jobs.ts`, 12 tests in `bench/lib/gate.test.ts`; D-238",
	'M3-R17':
		"The develop skill's intake section and its `Search before you hand-roll` table over all eleven foundation add-ons, mirrored in the starter template's AGENTS.md, with three evaluation cases; 22 of 22 skill checks pass",
	'M3-R3':
		"The memory register: `crates/null3d-core/src/memory.rs`, the overlay's `Memory by system` rows in `packages/engine/src/debug/overlay-look.ts`, and D-233's Battle figures, which match D-130 to the byte",
	'M3-A4':
		"`bloomLevel` in `packages/engine/src/scene/effects.ts`; the lens kit's streak reads level 3 of bloom's chain, with the `lens-streak` picture on both paths; `docs/api/post.md`",
	'M3-A6':
		'`setDrawRange` in `packages/engine/src/scene/scene.ts`; the `lod-range`, `lod-range-batch` and `lod-hide` pictures on every tier; D-211',
	'M3-A3':
		'A custom material declares `texture_2d_array<f32>` and picks the layer in each texture function: `packages/vite-plugin/src/shader-types.ts`, the docs `packages/engine/docs/guides/custom-shaders.md` and `custom-passes.md`; D-239',
	'M3-A8':
		'Grading controls in `packages/engine/src/scene/post.ts`; the Skyway pictures exercise them',
	'M3-G2':
		'`KHR_materials_iridescence` in `packages/engine/src/scene/gltf-parse.ts`; `iridescence.wgsl`, with pictures',
	'M3-G3':
		'`KHR_materials_anisotropy` in `packages/engine/src/scene/gltf-parse.ts`; `MATERIAL_PARAM_ANISOTROPY`, with pictures',
	'M3-A1':
		'Raycast and pick hits carry `uv`: `packages/engine/src/scene/queries.ts`, `docs/api/raycast.md`',
	'M3-A10':
		"The `sharpen` value runs the RCAS pass at render scale 1: `packages/engine/src/scene/post.ts`; D-205's cost table, measured 24 October 2026: it adds 0.393 ms on WebGPU, 0.459 in compatibility mode and 0.382 on WebGL2 at full scale, and nothing at half scale",
	'M3-A11':
		'D-206 records the measurement: the resolve fails shimmer, smear, sharpness and error against the presets at every tier on both paths, so it does not ship; `tests/image/taa-quality.spec.ts` repeats the figures',
	'M3-A2':
		"`textures.fromCanvas` and `texture.refresh(rect)` in `packages/engine/src/scene/textures.ts`; `tests/image/canvas-texture.spec.ts` holds a 1024² canvas's 256² refresh inside the upload budget on both paths; D-204",
	'M3-A5':
		'`createVertexDraw` in `packages/engine/src/scene/scene.ts:4623-4702`; `examples/rain/sketch.ts`',
	'M3-A7': '`limit_hdr` maps NaN to zero: `crates/null3d-shaders/wgsl/lib/color.wgsl:35-38`',
	'M3-A9':
		'The `hero` shadow option and `setHeroShadow`: `packages/engine/src/scene/scene.ts`, `docs/api/lights.md:234-245`; the cost spec `tests/image/hero-cost.spec.ts`, with the figures in D-219',
	'M3-B6':
		'`examples/addons/traffic-lanes/` (instanced vehicles moved in the vertex shader); `examples/instances/traffic.ts` and `examples/showcase/skyway/traffic.ts`',
	'M3-D1': "`tools/lib/packages.ts` compiles each add-on's WGSL when it packs",
	'M3-D2':
		'Version check in each foundation add-on (`packages/engine/src/shared/version.ts`); `packages/cli/src/upgrade.js`',
	'M3-D3': "E1417's message names the add-on: `packages/engine/src/errors/codes.ts:417`",
	'M3-D4': "The particle buffer's record layout and limits: `docs/concepts/particle-buffer.md`",
	'M3-D5': '`examples/addons/README.md` and two add-ons in that layout',
	'M3-D6': 'The plugin interface version check: `packages/engine/src/shared/version.ts`',
	'M3-D7': 'The WebGL2 texture-unit allocator: `packages/engine/src/gpu/webgl2/`',
	'M3-D8':
		"Namespaces for an add-on's shader library, error codes and quality keys: `packages/engine/src/scene/namespaces.ts`",
	'M3-E1':
		"Splats draw through `scene.addFeatureInstances` (`packages/engine/src/scene/feature-instances.ts`); the `splats`, `splats-budget` and `splats-gltf` pictures on both paths; the draw's size in `tools/lib/size-report.ts`",
	'M3-E3':
		"`registerGltfExtension` in `packages/engine/src/scene/gltf-extensions.ts`; the `splats-gltf` picture, and E1417's hint for `KHR_gaussian_splatting` in `gltf-extensions.test.ts`",
	'M3-E4':
		"Water's soft shores read the scene depth on every path: the `water-shores` picture on WebGPU, compatibility mode and WebGL2, in both reference sets, shows the pale band and foam where the water meets the sand and the island's base; without the depth copy the sheet draws its deep colour everywhere. D-202's addendum names M3-E4a for the case of depth beside textures",
	'M3-L4':
		'Staged loading, coarse first: `StageWatches` in `crates/null3d-render/src/levels.rs` holds each stage until a view has picked the level the mesh draws over a 120-frame warm-up, and drops it and every finer stage when none is picked; `tests/image/staged-levels.spec.ts` passes 6 of 6, and its `?far` test shows a stage that never draws is never downloaded; D-228',
	'M3-F2':
		"Streaming within budget on a cloud phone and an iPad: `tests/pages/splats-stream.ts` and the `splats` plan in `tests/lib/plans.ts`, with the runs in `.dev/tested-devices/` — the Galaxy S24 held 37,500 of Low's 50,000 and the iPad Pro 13 drew 100,000 on WebGPU and 50,000 on WebGL2, every draw inside the budget",
	'M3-E5':
		'One file format for baked probe grids and light maps: `packages/engine/src/scene/baked-light.ts`, `assets.loadLightProbeGrid`, `assets.loadLightMap` and `assets.lightProbeGridFile`, with every fault named as E1434; the guide `docs/guides/baked-light-data.md`, a round-trip test and two fixtures; D-243',
	'M3-G1':
		'`KHR_animation_pointer`: `packages/engine/src/scene/gltf-animation.ts`, `property-animation.ts`',
	'M3-G4':
		"`transmissionMap` and `thicknessMap`: `packages/engine/src/scene/resources.ts`, the shaders' thickness reads",
	'M3-K1': '`scene.createView({ camera, rect })`: `packages/engine/src/scene/scene.ts`',
	'M3-K2':
		'`TransformControls` and `DragControls`: `packages/controls/src/transform-controls.ts`, `packages/controls/src/drag-controls.ts`',
	'M3-K3':
		'Spot-light cookies, `light.map`: `packages/engine/src/scene/scene.ts`, `docs/api/lights.md`',
	'M3-K4':
		'CSS3D labels: `packages/engine/src/sketch/ui.ts`, `packages/engine/src/page/label-loop.ts`, `packages/engine/src/shared/labels.ts`',
	'M3-K5': '`scene.overrideMaterial`: `packages/engine/src/scene/scene.ts`, `docs/api/scene.md`',
	'M3-K6':
		'`toneMapped = false`: `packages/engine/src/scene/resources.ts`, `docs/api/materials.md`',
	'M3-L2':
		"`crates/null3d-render/tests/levels.rs` (40,000 copies of four levels take one copy each); levels draw the base mesh's indices over its shared vertices; `lod-material`, `lod-bias` and the skinned-level pictures; D-137's addenda",
	'M3-F8':
		"`probe.capture()` again on request, with the moved object's reflection settling: `crates/null3d-render/tests/probes.rs` and the `probe-capture` picture on every tier; `docs/api/scene.md`",
	'M3-O1':
		'The script-tag build: `bun run build:cdn` (`tools/build-cdn.ts`); `docs/getting-started/cdn.md` shows the import map and the plain module',
	'M3-R1':
		'One feature description: `packages/engine/src/scene/features.ts`, `docs/api/features.md`',
	'M3-R6':
		'D-226 records the timings on Chrome and Safari: at most 0.29 ms in Safari, nothing measurable in Chrome, so the pattern stays',
	'M3-R10':
		"A sky map redraws only past a visible step: `crates/null3d-render/tests/sky_maps.rs` counts the fills a day cycle records; `tests/image/sky-step.spec.ts` keeps every step within 8 levels of 255 on every tier; D-118's addendum records the fills a minute",
	'M3-R16':
		'The starter template and the agent hook it ships: `packages/cli/src/create.js`, `packages/cli/templates/empty/AGENTS.md`, `docs/getting-started/project-structure.md`',
	'M3-R18':
		"What ships contacts no server of its own: `docs/getting-started/network-use.md`, the guard `tools/lib/network-use.ts` and `docs/getting-started/third-party-notices.md`. The guard's 13 tests were seen failing on an added `globalThis.fetch`, and D-227's addendum records the audit",
};
