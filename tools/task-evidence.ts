// What proves each completed task on the milestone branch: the test or picture that a reader
// can open. The pull request marks a task done only when its commit is on the branch and this
// file names the evidence, so a tick always means the work is here and something checks it.
// The entries come from read-only audits of the branch on 23 October 2026.
export const TASK_EVIDENCE: Readonly<Record<string, string>> = {
	'M3-R2':
		'The governor undoes a step that does not pay: `governor.ts` with `LOWER_TRIAL_MS` and `LOWER_LOSS_PERCENT`, 6 new tests in `governor.test.ts` including a replay of the resize page, 57 of 57; D-237',
	'M3-R21':
		"The gate reads its software-renderer pictures from the commit's own CI browser jobs: `bench/ci-browser-jobs.ts`, 12 tests in `bench/lib/gate.test.ts`; D-238",
	'M3-R3':
		"The memory register: `crates/null3d-core/src/memory.rs`, the overlay's `Memory by system` rows in `packages/engine/src/debug/overlay-look.ts`, and D-233's Battle figures, which match D-130 to the byte",
	'M3-A4':
		"`bloomLevel` in `packages/engine/src/scene/effects.ts`; the lens kit's streak reads level 3 of bloom's chain, with the `lens-streak` picture on both paths; `docs/api/post.md`",
	'M3-A6':
		'`setDrawRange` in `packages/engine/src/scene/scene.ts`; the `lod-range`, `lod-range-batch` and `lod-hide` pictures on every tier; D-211',
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
	'M3-A2':
		"`textures.fromCanvas` and `texture.refresh(rect)` in `packages/engine/src/scene/textures.ts`; `tests/image/canvas-texture.spec.ts` holds a 1024² canvas's 256² refresh inside the upload budget on both paths; D-204",
	'M3-A5':
		'`createVertexDraw` in `packages/engine/src/scene/scene.ts:4623-4702`; `examples/rain/sketch.ts`',
	'M3-A7': '`limit_hdr` maps NaN to zero: `crates/null3d-shaders/wgsl/lib/color.wgsl:35-38`',
	'M3-A9':
		'The `hero` shadow option and `setHeroShadow`: `packages/engine/src/scene/scene.ts`, `docs/api/lights.md:234-245`',
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
	'M3-D9': '`packages/cli/src/check-addon.js`',
	'M3-E1':
		"Splats draw through `scene.addFeatureInstances` (`packages/engine/src/scene/feature-instances.ts`); the `splats`, `splats-budget` and `splats-gltf` pictures on both paths; the draw's size in `tools/lib/size-report.ts`",
	'M3-E2': 'Add-on tasks on the job workers: `packages/engine/src/shared/tasks.ts`',
	'M3-E3':
		"`registerGltfExtension` in `packages/engine/src/scene/gltf-extensions.ts`; the `splats-gltf` picture, and E1417's hint for `KHR_gaussian_splatting` in `gltf-extensions.test.ts`",
	'M3-E4':
		'Scene inputs on a custom material (`sceneInputs`): `packages/engine/src/scene/resources.ts`, `docs/api/materials.md:542`',
	'M3-E6':
		'A feature declares its preset settings and figures: `packages/engine/src/scene/features.ts`; `docs/concepts/quality-presets.md:293-295`',
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
	'M3-L1':
		'`crates/null3d-core/src/levels.rs:256` (`distance`, nearest point of the bounds); `crates/null3d-shaders/wgsl/cull.wgsl:363` (`level_of`); `crates/null3d-shaders/wgsl/lib/mesh.wgsl:679-709` (a dither phase per copy); `docs/concepts/lod.md` (fade, distance, small objects, bands)',
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
		'What ships contacts no server of its own: `docs/getting-started/network-use.md`, the guard `tools/lib/network-use.ts` and `docs/getting-started/third-party-notices.md`',
};
