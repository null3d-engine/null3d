// What proves each completed task on the milestone branch: the test or picture that a reader
// can open. The pull request marks a task done only when its commit is on the branch and this
// file names the evidence, so a tick always means the work is here and something checks it.
// The entries come from read-only audits of the branch on 23 October 2026.
export const TASK_EVIDENCE: Readonly<Record<string, string>> = {
	'M3-A4':
		'`bloomLevel` in `packages/engine/src/scene/effects.ts`; documented in `docs/api/post.md`',
	'M3-A6':
		'`setDrawRange` in `packages/engine/src/scene/scene.ts`; the ranges texture bound by the replay page',
	'M3-A8':
		'Grading controls in `packages/engine/src/scene/post.ts`; the Skyway pictures exercise them',
	'M3-G2':
		'`KHR_materials_iridescence` in `packages/engine/src/scene/gltf-parse.ts`; `iridescence.wgsl`, with pictures',
	'M3-G3':
		'`KHR_materials_anisotropy` in `packages/engine/src/scene/gltf-parse.ts`; `MATERIAL_PARAM_ANISOTROPY`, with pictures',
	'M3-A1':
		'Raycast and pick hits carry `uv`: `packages/engine/src/scene/queries.ts`, `docs/api/raycast.md`',
	'M3-A10':
		'The `sharpen` value runs the RCAS pass at render scale 1: `packages/engine/src/scene/post.ts`',
	'M3-A11': "D-206 refuses the temporal resolve for 0.1.0, with the study's figures",
	'M3-A2':
		'`textures.fromCanvas` and `texture.refresh(rect)` in `packages/engine/src/scene/textures.ts`; `docs/api/textures.md`',
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
		'A new kind of draw: `packages/engine/src/scene/features.ts`, `packages/engine/src/scene/scene.ts:4539`',
	'M3-E2': 'Add-on tasks on the job workers: `packages/engine/src/shared/tasks.ts`',
	'M3-E3': 'glTF extension handlers: `packages/engine/src/scene/gltf.ts`, `assets.ts`',
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
		'`packages/cli/src/assets/levels.js` (leaf cards); a material per level, `setLevelBias` and skinned levels in `packages/engine/src/scene/scene.ts`; levels as index ranges over the base vertices (`docs/concepts/lod.md:71`)',
	'M3-O1':
		'The script-tag build: `bun run build:cdn` (`tools/build-cdn.ts`); `docs/getting-started/cdn.md` shows the import map and the plain module',
	'M3-R1':
		'One feature description: `packages/engine/src/scene/features.ts`, `docs/api/features.md`',
	'M3-R6':
		'D-226 records the timings on Chrome and Safari: at most 0.29 ms in Safari, nothing measurable in Chrome, so the pattern stays',
	'M3-R18':
		'What ships contacts no server of its own: `docs/getting-started/network-use.md`, the guard `tools/lib/network-use.ts` and `docs/getting-started/third-party-notices.md`',
};
