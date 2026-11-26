---
id: guides/add-ons
title: Building an add-on
summary: "One package with one entry; claim a namespace and the plugin interface range; import only the public entry points; compile the shaders on both paths; name a page; run the check."
---

# Building an add-on

An add-on is a package that adds a feature above the engine's public API. It has one install and one import, and it reaches the engine only through the engine's public entry points. The engine's own add-ons work the same way.

`bunx @null3d/cli check-addon` runs gates on a folder before a listing publishes it. [The `null3d` command](../cli/null3d.md#check-addon) lists them. The sections on names, entry points, shaders, file sizes and the preset cost each have a gate. The sections on Rust and levels of detail are advice that no gate checks.

## Choose a way to add drawing

| What you want to draw | The call | Where in the frame it runs | GPU paths | The page |
| --- | --- | --- | --- | --- |
| A surface's look, with the engine's lighting | a surface function | in the material's draw | both | [Surface functions](../shaders/surface-functions.md) |
| A material with WGSL of its own from end to end | `materials.shader` | in the object's draw | both | [Custom shaders](custom-shaders.md) |
| A full-screen effect over the scene color | `post.addEffect` | after the scene passes, before bloom | both | [Custom passes and render targets](custom-passes.md) |
| A scene drawn from another camera | `render.addPass` with `kind: 'scene'` | before the passes that show its texture | both | [Render graph API](../api/render.md) |
| A full-screen pass into a texture | `render.addPass` with `kind: 'fullscreen'` | before the passes that read its texture | both | [Render graph API](../api/render.md#full-screen-passes) |
| A compute pass | `render.addPass` with `kind: 'compute'` | before the passes that read its texture | WebGPU, with a WebGL2 fallback | [Render graph API](../api/render.md#compute-passes) |
| A draw from a vertex count | `scene.createVertexDraw` | with the scene's draws | both | [Vertex draws](../api/vertex-draws.md) |
| A draw from a feature | `scene.addFeatureDraw` | with the scene's draws | both | [Feature draws](../api/feature-draws.md) |
| A full-screen pass from a feature | `post.addFeatureEffect` | after the scene passes | both | [Feature effects](../api/feature-effects.md) |
| Instances whose count the GPU writes | `scene.addComputeInstances` | with the scene's draws | WebGPU | [Feature instances](../api/feature-instances.md) |

Tasks (`runTask`) are the CPU side, not a draw: they run on the job workers ([Tasks on the job workers](../api/tasks.md)).

## Claim the add-on's names

An add-on calls `declareAddonNamespace` once, as its module loads. The call claims the add-on's name, its package, its shader library name, its range of error codes and its quality keys. It also declares the plugin interface versions that the add-on was built for.

```ts
// src/index.ts
import { declareAddonNamespace, PLUGIN_INTERFACE_VERSION } from '@null3d/engine';

declareAddonNamespace({
	name: 'splats',
	package: '@acme/splats',
	shaderLibrary: 'splats',
	errorCodes: [3100, 3199],
	qualityKeys: ['splatBudget'],
	pluginInterface: { min: PLUGIN_INTERFACE_VERSION, max: PLUGIN_INTERFACE_VERSION },
});
```

The name rules:

- lowercase letters, digits and underscores, starting with a letter;
- `null3d` belongs to the engine;
- error codes from 2000 to 9999, with the engine's codes below 2000;
- a held name, package or code range throws [E1225](../errors/E1225.md);
- a reload with the same package takes back its namespace.

A second add-on that takes a name is refused. [Namespaces](../api/features.md#namespaces) gives the full rules.

The plugin interface version changes only when a stable hook changes, so an add-on can span many engine releases. A page whose engine lies outside the declared range stops with [E1433](../errors/E1433.md) before it draws.

The message names the add-on, the range and the engine's interface. The version is `PLUGIN_INTERFACE_VERSION` in the engine that the add-on builds against. Widen the range only after the add-on works with the wider interface.

The engine's own add-ons leave the range out and pin the engine version exactly with `checkAddonVersion`, because they ship in step with the engine.

## Import only the public entry points

Every shipped file may import `@null3d/engine`, `@null3d/engine/stats` and the maths entry: `@null3d/engine/math` and its sub-paths `/vec3`, `/quat`, `/mat4` and `/math`. The check refuses any other engine entry point, and the engine's source files. When the add-on needs something that the API lacks, that is a hook to build in the engine, so another developer can build the same add-on.

## Put the hot path in Rust

An add-on's hot path is the code that its frames run. Where that work runs on the CPU, write it in Rust, compiled to WebAssembly. Run it on the job workers through `runTask` ([Tasks on the job workers](../api/tasks.md)). The add-on's TypeScript is the interface: it declares the task, passes the shared buffers, and reads the answers between frames.

Use the engine's own calls first. The engine's per-frame loops already run in Rust, and many of them cover every object in one call. A loop of TypeScript over the scene costs more than the same work in Rust. Add a task for the loops that no engine call covers.

Keep setup, options, the public API and event handling in TypeScript. They run once or rarely, and TypeScript is the flexible place for them.

## Give every mesh levels of detail

An add-on's meshes get levels of detail as a page's meshes do, with no call of the add-on's own. A far copy then draws a few dozen triangles instead of its full mesh. The engine hides a copy that covers less than a pixel.

The engine plans a mesh's levels when it holds 4,096 triangles or more. It plans a smaller mesh when it holds at least 256 and its copies hold 65,536 together. A mesh from `geometry.fromArrays` or a generator plans them at its first draw. The levels keep the mesh's vertex and triangle order, which raycasts and `updateVertices` read ([Levels of detail](../concepts/lod.md#levels-of-meshes-made-in-code)).

<details>
<summary>Technical details: when a mesh plans its levels</summary>

The plan runs on the job workers with the asset tool's planner. The levels keep their measured errors, so they switch in at once while the threshold stays small. They fade once the governor raises it past about one and a half pixels.

</details>

So make every mesh through `fromArrays` or a generator, and leave its `levels` option out. Arrays that a task of the add-on builds on a job worker go to `fromArrays` too, and the mesh then plans as any other. An add-on that returns arrays, such as a shape generator, leaves the mesh, and its levels, to the page.

Do not ask for levels mesh by mesh. The default picks the meshes whose levels save GPU time.

`levels: true` and `await mesh.buildLevels()` plan at any size. Use `buildLevels()` to plan again after `updateVertices` gives a mesh a new shape, or to await the levels in a test. The one exception is a mesh of separate leaf cards. It asks for `levels: { cards: true }`, so each level thins its cards rather than dropping whole small pieces.

Opt a mesh out with `levels: false` only where levels are wrong for it, and say why in a comment beside the mesh:

| The mesh | Why it takes no levels | In the engine's add-ons |
| --- | --- | --- |
| A shader gives it its shape or its place | The levels would simplify a shape that never draws | Water surfaces, grass tufts, splat parts |
| It has a level system of its own | The two systems would switch apart | Terrain blocks, which are the ground's quadtree and morph toward their parent block |
| It is the far stand-in of other meshes | It is already the coarsest level | Impostor cards, merged far cells |
| It keeps one size on the screen | Its levels would never switch | Gizmo handles |
| Its vertices change in every frame | The levels would measure a shape that the next frame replaces | None |

The engine refuses planned levels by itself in some cases:

- a mesh with joints, morph targets or a vertex record (`targets`);
- a flat mesh;
- a mesh that a material with a displacement map or a custom `vertexOffset` draws;
- the first `updateVertices`;
- levels that `mesh.setLevels` gives.

A mesh that `mesh.setLevels` gives hand-made levels gets no planned levels on top, such as a generated plant's. Still pass `levels: false` for a mesh of the table, so the code states the decision where the mesh is made.

A mesh made in code gets pieces with its planned levels, so an add-on that takes the default gets them with no change. Each copy skips the pieces that the view leaves out or that face away. A mesh with `levels: false` gets none. A large mesh that takes no levels but spans the view, such as a merged far cell, asks for `levels: 'pieces'`, which sorts it into pieces by space alone ([Pieces of a large level](../concepts/lod.md#pieces-of-a-large-level)).

<details>
<summary>Technical details: which meshes get pieces</summary>

A smaller mesh that many copies draw, such as a building kit's walls, gets a piece for each way it faces. It gets them even when its levels are set by hand or come from a file that holds it once.

</details>

## Follow the preset and show the cost

A feature declares the value that each quality preset gives it, and the engine resolves the value for the preset in use. The frame-budget governor's steps reach it too, so an add-on that costs too much lightens its own work. `FeatureHost` carries these values from the sketch's quality, and reports the feature's figures to the stats overlay. A page that imports no add-on feature downloads none of that code.

```ts
const host = new FeatureHost({
	quality: ctx.quality,
	tier: ctx.engine.capabilities.tier,
	page: ctx.page,
	namespace: NAMESPACE, // the add-on's namespace, from declareAddonNamespace()
});

host.add(
	defineFeature({
		name: 'water',
		settings: {
			reflectionEvery: {
				presets: [2, 2, 1, 1],
				values: { min: 1, max: 16, whole: true },
				governor: 'double',
			},
		},
		budget: { presets: [1.7, 1.7, 3.4, 3.4], min: 0.25 },
		quality: (_preset, _settings, own) => {
			// own.settings.reflectionEvery holds the cadence for this preset and the governor's steps.
		},
	}),
);
```

The overlay gives the feature a row of its own, such as `water  gpu not measured  reflectionEvery 2  budget 1.7 of 1.7 ms`. The row shows the feature's settings, its budget and the memory that it reports. The water add-on draws its reflection every other frame on Low and Medium, so that pass costs half as much on average there. Call `host.destroy()` when the add-on stops.

[Preset settings and the frame-budget governor](../api/features.md#preset-settings-and-the-frame-budget-governor) gives every option.

## Compile the shaders on both paths

The null3D Vite plugin compiles each `.wgsl` file that the add-on imports, for WebGPU and for WebGL2. An add-on that draws has shader code that both paths run, or its README states the fallback. A shader file that fails to compile stops the build.

## Keep the files that load after the start small

The engine's start stays small, and so does an add-on's. The files that the add-on loads after the first frame hold to a budget in each of three columns: raw bytes, gzip and Brotli. The check warns about each file that goes over its budget, with each column and its figure. An add-on is a choice, so an over-budget file does not fail the check.

A custom material's, a custom effect's and a custom tone curve's compiled builds load on first use in files of their own. Those files take the budget for shader builds, which is larger than the budget for code ([Custom shaders](custom-shaders.md#where-the-builds-go)).

<details>
<summary>Technical details: how the size gate counts shader bytes</summary>

Not all compiled WGSL leaves the entry, though. A whole shader's or a sky layer's builds sit in the file that imports them, and so do an effect's pieces. The check counts those bytes as shader data, and holds them to the budget for shader builds. A file that holds both therefore answers both budgets.

</details>

## Name a page

The page, cost and allocation gates open a page of the add-on's project in a browser. The check takes the page of the first test in `null3d.json`, or the page that `--page` names:

```json
{ "tests": [{ "name": "demo", "page": "/index.html", "hold": 1.5 }] }
```

Without a page, the browser gates are skipped with a reason, and the other gates still run. An add-on that only publishes data, such as a texture format, needs no page.

## Run the check

```sh
bunx @null3d/cli check-addon                    # the add-on in the current folder
bunx @null3d/cli check-addon packages/my-addon
```

It prints one line for each gate, and exits with 1 when one fails:

```text
PASS  package: @acme/splats
PASS  public API: 6 files import only the engine's public entry points
PASS  interface: declares plugin interface 1, and this engine has 1
PASS  shaders: 2 files built with WGSL for WebGPU and WebGL2
PASS  sizes: the largest file is 41.2 KB raw, 11.4 KB gzip, 9.8 KB brotli, within budget
PASS  page: the page starts from another origin under the strict policy, threaded and single-threaded
PASS  cost per preset: low 0.42 ms of GPU time, medium 0.51 ms of GPU time, high 0.63 ms of GPU time, ultra 0.71 ms of GPU time per frame, on Chrome 141
PASS  allocation per preset: low 0 bytes, medium 0 bytes, high 0 bytes, ultra 0 bytes per frame in the add-on's own code, on Chrome 141
```

Use `--skip-browser` on a machine that has no GPU or no browser. Use `--skip-cost` when the machine is loaded, since a cost figure would then measure the load: the page and allocation gates still run, and the cost gate stays owed. The shader build and the size gate need the add-on's own Vite and null3D plugin.

The cost figures are measured, and the check prints them; it does not compare them with a number that the add-on claims. The page builds for production, so the figures match what a user gets.

The allocation gate counts the bytes that the add-on's own code allocates in each frame, on each quality preset. Aim at zero, since a frame that allocates feeds the garbage collector. The gate fails only when it cannot measure the add-on's code.

<details>
<summary>Technical details: how the allocation gate measures</summary>

It reads the heaps of the page's sketch worker and render worker, and names each function by its source file. A place counts as the add-on's own when its source file is in the add-on's folder, or in the add-on's copy under `node_modules`. The gate prints the page's figure beside it.

</details>

## Related pages

- [The `null3d` command](../cli/null3d.md#check-addon): the command's options and the gates it runs.
- [E1433](../errors/E1433.md): the error for an add-on built for another plugin interface.
- [Custom shaders](custom-shaders.md): the WGSL that an add-on can use.
- [Custom passes and render targets](custom-passes.md): the engine's public hooks for extra drawing.
- [Feature descriptions](../api/features.md): one description of the render work.
- [Feature draws](../api/feature-draws.md): a draw from a feature.
- [Feature effects](../api/feature-effects.md): a full-screen pass from a feature.
- [Feature instances](../api/feature-instances.md): instances whose count the GPU writes.
- [Tasks on the job workers](../api/tasks.md): work on the job workers.
- [Terrain blocks with their own level system](https://github.com/null3d-engine/null3d/tree/main/examples/terrain): a 1.2 km valley whose far hills draw as coarser blocks.
- [Impostor cards as far stand-ins](https://github.com/null3d-engine/null3d/tree/main/examples/impostors): a forest whose far trees are cards from an atlas made in code.
