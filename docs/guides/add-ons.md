---
id: guides/add-ons
title: Building an add-on
status: experimental
since: "0.3"
summary: "One package with one entry; claim a namespace and the plugin interface range; import only the public entry points; compile the shaders on both paths; name a page; run the check."
---

# Building an add-on

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

An add-on is a package that adds a feature above the engine's public API. It has one install and one import, and it reaches the engine only through `@null3d/engine` and `@null3d/engine/stats`. The engine's own add-ons work the same way. `bunx @null3d/cli check-addon` runs these rules on a folder before a listing publishes it.

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

The name takes lowercase letters, digits and underscores, and starts with a letter. The package names the module that owns the add-on, and it gives the same value every time the add-on loads, so a development reload takes back its namespace. A second add-on that takes the name is refused. The engine owns `null3d`, and codes below 2000 are the engine's own. The engine refuses a name or a code that another add-on holds.

The plugin interface version changes only when a stable hook changes, so an add-on can span many engine releases. A page whose engine lies outside the declared range stops with [E1433](../errors/E1433.md) before it draws. The message names the add-on, the range and the engine's interface. The version is `PLUGIN_INTERFACE_VERSION` in the engine that the add-on builds against. Widen the range only after the add-on works with the wider interface.

The engine's own add-ons leave the range out and pin the engine version exactly with `checkAddonVersion`, because they ship in step with the engine.

## Import only the public entry points

Every shipped file may import `@null3d/engine` and `@null3d/engine/stats`. The check refuses any other engine entry point, and the engine's source files. When the add-on needs something that the API lacks, that is a hook to build in the engine, so another developer can build the same add-on.

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

A custom material's, a custom effect's and a custom tone curve's compiled builds load on first use, in files of their own. Those files take the budget for shader builds, which is larger than the budget for code. Not all compiled WGSL leaves the entry, though. A whole shader's or a sky layer's builds sit in the file that imports them, and so do an effect's pieces. The check counts those bytes as shader data, and holds them to the budget for shader builds. A file that holds both therefore answers both budgets. [Custom shaders](custom-shaders.md#where-a-custom-materials-builds-go) shows the files.

## Name a page

The browser gates open a page of the add-on's project. The check takes the page of the first test in `null3d.json`, or the page that `--page` names:

```json
{ "tests": [{ "name": "demo", "page": "/index.html", "hold": 1.5 }] }
```

Without a page, the browser gates are skipped with a reason, and the other gates still run. An add-on that only publishes data, such as a texture format, needs no page.

## Run the check

```sh
bunx @null3d/cli check-addon addons/splats
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

The allocation gate counts the bytes that the add-on's own code allocates in each frame, on each quality preset. It reads the heaps of the page's sketch worker and render worker, and names each function by its source file. A place counts as the add-on's own when its source file is in the add-on's folder, or in the add-on's copy under `node_modules`. The gate prints the page's figure beside it. A frame that allocates feeds the browser's garbage collector, so aim at zero. The gate fails only when it cannot measure the add-on's code, such as on a page that runs none of the add-on's files.

## Related pages

- [The `null3d` command](../cli/null3d.md#check-addon): the command's options and the gates it runs.
- [E1433](../errors/E1433.md): the error for an add-on built for another plugin interface.
- [Custom shaders](custom-shaders.md): the WGSL that an add-on can use.
- [Custom passes and render targets](custom-passes.md): the engine's public hooks for extra drawing.
