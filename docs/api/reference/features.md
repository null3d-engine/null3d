---
id: api/reference/features
title: "Add-on feature descriptions: API reference"
status: generated
since: "0.3"
summary: "Every export of the Add-on feature descriptions API, from the engine's doc comments."
---

# Add-on feature descriptions: API reference

> [Add-on feature descriptions](../features.md) explains these exports. The engine's doc comments make this page.

## `AddonNamespace`

Interface `AddonNamespace`.

The names that an add-on claims as its module loads. The engine refuses a name that its own code or another add-on holds.

| Member | Description |
| --- | --- |
| `readonly name: string` | The add-on's name, from 1 to 32 lowercase letters, digits or underscores, starting with a letter. It names the add-on in errors and prefixes the budgets of its features. The engine reserves `null3d`. |
| `readonly package: string` | The package or module that owns the add-on, such as its npm package name. It tells a module that loads again, as a development reload does, from a second add-on. Give the same value every time the add-on loads. |
| `readonly shaderLibrary?: string` | The WGSL library name that the add-on owns, from 1 to 32 lowercase letters, digits or underscores, starting with a letter. It is the name by default, and the engine reserves it so that another add-on cannot take it. The engine reserves `null3d` too. |
| `readonly errorCodes?: readonly [number, number]` | The range of error codes that the add-on's own errors use, as its first and last code. Codes from 2000 to 9999 belong to the add-ons, and the engine's own codes lie below 2000. |
| `readonly qualityKeys?: readonly string[]` | The keys that the add-on adds to the quality settings that a sketch reads. They must not be keys of the engine's own quality table or another add-on's. |
| `readonly pluginInterface?: PluginInterfaceRange` | The plugin interface versions that the add-on was built for, both included. The engine refuses a page whose interface lies outside the range, with E1433, which names the add-on and both versions. An add-on that ships with the engine leaves it out and keeps its exact version pin through `checkAddonVersion`. |

## `addonNamespaces`

```ts
function addonNamespaces(): AddonNamespaces
```

The namespace registry of this thread, which every add-on of the thread claims in.

## `AddonNamespaces`

Class `AddonNamespaces`.

The namespaces that the add-ons of one thread claim, with the names that each of them exports. `claim` registers an add-on's own names, and `claimFeature` registers the names of one of its features. Each refuses a name that the engine or another add-on holds, and names both owners.

| Member | Description |
| --- | --- |
| `readonly size: number` | The number of claimed namespaces. |
| `claim(description: AddonNamespace): AddonNamespace` | Checks a namespace and registers it. Throws E1225 for an option that a namespace does not take, a name, package or shader library that is invalid or that another add-on holds, an error-code range outside 2000 to 9999 or over another add-on's, and a quality key of the engine's own quality table or another add-on's. Throws E1433 for a plugin interface range that the engine's interface lies outside. |
| `get(name: string): AddonNamespace \| undefined` | The namespace that `name` claimed, or undefined. |
| `release(name: string): boolean` | Removes the namespace `name` and every name that it exported. Returns false for a name that no add-on claimed. |
| `claimFeature(addon: string, names: ExportedNames): void` | Registers the names that one feature of `addon` exports. Throws E1225 for a feature name, output or lighting slot that another add-on registers, before it registers any of them. |
| `releaseFeature(addon: string, names: ExportedNames): void` | Removes the names that one feature of `addon` registered. |

## `declareAddonNamespace`

```ts
function declareAddonNamespace(description: AddonNamespace): AddonNamespace
```

Claims the names in `description` for one add-on, and returns the frozen namespace. An add-on calls it once, as its module loads, beside `checkAddonVersion`. It throws E1225 for a name that the engine or another add-on holds, and a module that loads again under the same package gets the namespace that it claimed.

## `defineFeature`

```ts
function defineFeature(description: FeatureDescription): FeatureDescription
```

Declares one add-on render feature. The engine checks the description and fills its neutral defaults, and returns a frozen copy: the `'normal'` band with order 0, empty reads and writes, no outputs or lighting slots, and the main view, for a feature that records a frame point. Throws E1223 for an option that a description does not take, a name that is empty or longer than 64 characters, a frame point or kind that does not exist or does not go together, an order outside its band, an unknown resource, slot or view, an output with no neutral default, a setting with a value outside its own range or a governor without a budget, a budget whose presets are not four times above 0, or a GPU scope pass that `render.addPass` did not return.

## `ExportedNames`

Interface `ExportedNames`.

The names that one feature exports to the whole thread, which another add-on may not also export.

| Member | Description |
| --- | --- |
| `readonly feature: string` | The feature's name. |
| `readonly outputs: readonly string[]` | The outputs that the feature publishes, by name. |
| `readonly slots: readonly FeatureSlot[]` | The lighting slots that the feature provides. |
| `readonly debugViews: readonly string[]` | The debug views that the feature adds, by name. |

## `FeatureBand`

```ts
type FeatureBand = 'before' | 'normal' | 'after';
```

The band that orders a feature against the engine's own work at its frame point.

## `FeatureBudget`

Interface `FeatureBudget`.

A feature's time budget per frame, at full quality, on each quality preset. The frame-budget governor lowers the budget's share of full quality when frames take too long, and the feature reads that share to lighten its own work.

| Member | Description |
| --- | --- |
| `readonly presets: readonly [number, number, number, number]` | The time in ms that the feature may take in each frame at full quality, from Low to Ultra. |
| `readonly min?: number` | The lowest share of full quality that the governor gives the feature, from 0 to 1. The default is 0. |

## `FeatureDebugView`

Interface `FeatureDebugView`.

A debug view that an add-on adds. `debug.view` and the page's `?view=` switch pick it by name, and the engine tells the add-on when it starts and stops. The add-on draws the view itself, with its own materials or its own debug drawing, so the engine needs no shader for it.

| Member | Description |
| --- | --- |
| `readonly name: string` | The name that `debug.view` and `?view=` take, from 1 to 64 characters without a line break. It must not name one of the engine's own views, or another add-on's view. |
| `readonly set: (active: boolean) => void` | Called with `true` when this view becomes the active one, and with `false` when another view replaces it or the engine stops. |

## `FeatureDescription`

Interface `FeatureDescription`.

One add-on render feature, as the engine reads it. Every add-on hook that records frame work declares a description of this shape: the frame point where it records, what it reads and writes, what it publishes, the lighting slot it provides, its order band and view mask, and the callbacks that the engine calls. `defineFeature` fills the neutral defaults and checks the description.

| Member | Description |
| --- | --- |
| `readonly name: string` | The feature's name, from 1 to 64 characters without a line break. It names the feature in errors, in `render.dumpGraph()` and in the stats overlay's GPU scope. |
| `readonly frame?: FeatureFrame` | The frame point where the feature records. Leave it out for a feature that publishes data and records no frame work, such as a loader or a bake. |
| `readonly kind?: FeatureKind` | How the feature records: `'draw'` for scene objects, `'compute'` for compute shaders, or `'fullscreen'` for a triangle over a texture. A feature with a frame gives its kind. A compute feature publishes its results as outputs and writes no scene resource. |
| `readonly band?: FeatureBand` | The band that orders the feature against the engine's own work at its frame point: `'before'`, `'normal'` with it, or `'after'` it. It is `'normal'` by default. |
| `readonly order?: number` | The feature's place inside its band, as a whole number in the band's range. A lower number runs first. It is the band's first place by default, which is 0 for `'normal'`. |
| `readonly reads?: readonly FeatureResource[]` | The scene resources that the feature reads. The graph runs it after their writers. |
| `readonly writes?: readonly FeatureResource[]` | The scene resources that the feature writes. The graph runs its readers after it. |
| `readonly outputs?: Readonly<Record<string, FeatureOutput>>` | The textures that the feature publishes to materials, effects and passes, by name, each with the neutral value that readers see while the feature is absent or not ready. Output names are unique across the engine's features. |
| `readonly provides?: readonly FeatureSlot[]` | The lighting slots that the feature provides. One feature provides each slot. |
| `readonly debugViews?: readonly FeatureDebugView[]` | The debug views that the feature adds, each with the name that `debug.view` and `?view=` take and the callback that hears when it starts and stops. An add-on draws such a view itself, so `debug.view` reaches it without the engine building a shader for it. |
| `readonly views?: readonly FeatureView[]` | The views that the feature records in, as its view mask: the main camera's view, a scene pass's view, or a reflection pass's view. It is `['main']` by default. A feature with no frame records in no view. |
| `readonly ready?: () => boolean` | Called when the engine needs to know whether the feature draws. False means no cost at all: no pass, no target, and none of its code or shaders downloads. It is ready by default. |
| `readonly settings?: Readonly<Record<string, FeatureSetting>>` | The feature's own settings, by name, each with a value on every preset and the values it takes. The engine resolves them for the preset and the GPU path in use, applies the governor's steps, and gives them to the `quality` callback. Names are the feature's own: two features may use the same name. |
| `readonly budget?: FeatureBudget` | The feature's time budget per frame on each preset. The frame-budget governor lowers its share of full quality with the sketch's other budgets, and the feature reads the share from its `quality` callback. A feature that gives settings a `governor` needs a budget. |
| `readonly gpu?: FeatureGpu` | Where the feature's GPU time comes from: the render passes that carry its frame work. The stats overlay shows the sum of their GPU time as the feature's own. Leave it out for a feature whose work records inside a pass of the engine's own. |
| `readonly memory?: () => number` | Returns the GPU bytes that the feature's own objects hold now, which the stats overlay shows beside the engine's own memory. The engine calls it when a figure of the feature changes, never in a frame. |
| `readonly quality?: (preset: QualityPreset, settings: Readonly<QualitySettings>, feature: FeatureQuality) => void` | Called when the preset or its settings change, with the preset and the settings in use, and with the feature's own resolved settings and budget share. The feature maps the engine's quality onto its own settings here. |
| `readonly resize?: (size: FeatureSize) => void` | Called when the render size changes, after the engine takes the new size. |
| `readonly reset?: (reason: FeatureReset) => void` | Called when the feature must drop the history that it keeps from earlier frames. |
| `readonly destroy?: () => void` | Called once when the feature is removed or the engine stops. Free the feature's own objects. |

## `FeatureFrame`

```ts
type FeatureFrame = 'shadow' | 'background' | 'opaque' | 'transparent' | 'resolve' | 'post';
```

The point of a frame where a feature records its work, from the shadow passes to the display. A feature declares one point. A `'draw'` at `'resolve'` blends after the scene's other blended surfaces: with MSAA, the engine draws it back to front into a layer of one sample per pixel and blends that layer over the scene, so many overlapping blended surfaces, such as Gaussian splats, blend once per pixel instead of once per sample.

## `FeatureGovernor`

```ts
type FeatureGovernor = 'none' | 'scale' | 'double';
```

What each of the frame-budget governor's steps does to a feature's setting.

## `FeatureGpu`

Interface `FeatureGpu`.

Where a feature's GPU time comes from: the render passes that carry its frame work. A feature that records inside a pass of the engine's own, such as a draw among the transparent objects, gives no scope, and the overlay then reads `gpu not measured` for it.

| Member | Description |
| --- | --- |
| `readonly passes: readonly FeatureGpuPass[]` | The passes whose GPU time, added up, is the feature's own GPU time. |

## `FeatureGpuPass`

Interface `FeatureGpuPass`.

One render pass that carries a feature's frame work. The engine adds up the GPU time of the feature's passes, so the stats overlay shows what the feature costs. The add-on gives the pass that it made, such as the reflection pass that its water draws the scene into.

| Member | Description |
| --- | --- |
| `readonly name: string` | The pass's name in the render graph. |

## `FeatureHandle`

Interface `FeatureHandle`.

A feature that a host registered: the values that its own code reads in each frame, and the figures that the stats overlay shows.

| Member | Description |
| --- | --- |
| `readonly name: string` | The feature's name. |
| `readonly settings: Readonly<Record<string, FeatureValue>>` | The feature's own settings, as the engine resolved them now. Read a value by its name in each frame: the object stays the same and its values change in place. |
| `readonly budgetScale: number` | The budget's share of full quality, from 0 to 1, or 1 without a budget. |
| `readonly budgetMs: number` | The time in ms that the feature may take in each frame now, or 0 without a budget. |
| `readonly stats: FeatureStats` | The feature's figures, as the stats overlay shows them. |
| `refresh(): void` | Reads the feature's figures afresh and sends them to the stats overlay. Call it when a figure changes outside the engine's own changes of quality, such as the memory that the feature's `memory` callback reports. It allocates, so call it between frames, never in a frame. |
| `remove(): void` | Removes the feature and its budget. It does not call the feature's `destroy`. |

## `FeatureHost`

Class `FeatureHost`.

One add-on's features, kept in step with the sketch's quality. `add` registers a feature, resolves its settings for the preset and the GPU path in use, and registers its budget with the sketch's budgets, so that the frame-budget governor's steps reach it. The host calls the feature's `quality` callback when a value changes, and reports the features' figures to the page's stats overlay. Call `destroy` when the add-on stops, so that its budgets and its change handler go away.

| Member | Description |
| --- | --- |
| `add(description: FeatureDescription): FeatureHandle` | Checks a description, registers it, and returns the feature's handle. Throws E1223 for a description that `defineFeature` refuses, and for a feature or output name that another feature of this host has. Throws E1225 for a feature name, output or lighting slot that another add-on registers. |
| `remove(name: string): boolean` | Removes the feature `name` and its budget. Returns false when the host has no such feature. |
| `get(name: string): FeatureHandle \| undefined` | The handle of the feature `name`, or undefined. |
| `features(): readonly FeatureHandle[]` | The features of this host, in the order that they were added. |
| `readonly stats: readonly FeatureStats[]` | The features' figures, as the stats overlay shows them. |
| `refresh(): void` | Reads each feature's figures afresh and sends them to the stats overlay. Call it when a figure changes outside the engine's own changes of quality, such as a memory figure. It allocates, so call it between frames, never in a frame. |
| `destroy(): void` | Stops following the sketch's quality and removes every budget. |

## `FeatureHostOptions`

Interface `FeatureHostOptions`.

What a feature host reads, and where its figures go.

| Member | Description |
| --- | --- |
| `readonly quality: Quality` | The sketch's `quality`, which gives the preset, the settings and the budgets' scale. |
| `readonly tier?: Tier` | The GPU path, which picks a setting's WebGL2 values where it gives them. |
| `readonly page?: { post(type: string, data?: unknown): void; }` | The sketch's channel to the page, which carries the figures to the stats overlay. A host without it keeps its figures to itself. |
| `readonly namespace: AddonNamespace` | The add-on's namespace, which `declareAddonNamespace` claims as the add-on loads. Its name scopes the features' budgets, and the names that the features export are checked against every other add-on of the thread. |
| `readonly namespaces?: AddonNamespaces` | The thread's registry of add-on namespaces. It is the thread's own by default, which every add-on shares. Give another one only to keep a test's names to itself. |

## `FeatureKind`

```ts
type FeatureKind = 'draw' | 'compute' | 'fullscreen';
```

How a feature records at its frame point.

## `FeatureNeutral`

```ts
type FeatureNeutral = 'black' | 'white' | 'transparent';
```

The value that readers see from an output while its feature is absent, switched off or not ready.

## `FeatureOutput`

Interface `FeatureOutput`.

A texture that a feature publishes to materials, effects and passes, by name. The neutral default fills readers while the feature is absent or not ready, so a missing feature breaks nothing downstream.

| Member | Description |
| --- | --- |
| `readonly default: FeatureNeutral` | The value that readers see while the feature is absent, switched off or not ready: `'black'` for zeros, `'white'` for ones, or `'transparent'` for zeros in every channel, alpha included. |

## `FeatureQuality`

Interface `FeatureQuality`.

What a feature reads while its quality callback runs: its own settings, as the engine resolved them, and its budget's share of full quality after the governor's steps.

| Member | Description |
| --- | --- |
| `readonly settings: Readonly<Record<string, FeatureValue>>` | The feature's own settings for the preset and GPU path in use, by name. |
| `readonly budgetScale: number` | The budget's share of full quality, from 0 to 1, or 1 without a budget. |
| `readonly budgetMs: number` | The time in ms that the feature may take in each frame now, or 0 without a budget. |

## `FeatureRegistry`

Class `FeatureRegistry`.

The features that an add-on registers, with the rules that one feature alone cannot check: a name that is unique, output names that are unique, and one provider for each lighting slot. A registered feature holds the declarations that the engine turns into a render graph node.

| Member | Description |
| --- | --- |
| `readonly size: number` | The number of registered features. |
| `add(description: FeatureDescription): FeatureDescription` | Checks a description, registers it and returns the frozen description. Throws E1223 for a description that `defineFeature` refuses, a feature name that is registered already, an output name that another feature publishes, or a lighting slot that another feature provides. |
| `remove(name: string): boolean` | Removes the feature with `name`, and gives its output names and lighting slots to other features. Returns false when no feature has that name. It does not call the feature's `destroy`: stop the feature before it is removed. |
| `get(name: string): FeatureDescription \| undefined` | The feature with `name`, or undefined. |
| `outputDefault(name: string): FeatureNeutral \| undefined` | The neutral default of the output that `name` publishes, or undefined while no feature publishes it. A material or effect that reads the output shows this value in the meantime. |
| `provider(slot: FeatureSlot): string \| undefined` | The feature that provides `slot`, or undefined while no feature provides it. |

## `FeatureReset`

```ts
type FeatureReset = 'resize' | 'camera' | 'exposure';
```

Why a feature must drop the history that it keeps from earlier frames.

## `FeatureResource`

```ts
type FeatureResource = SceneInput | 'history' | 'shadowAtlas';
```

A scene resource that a feature reads or writes. The render graph orders the feature around the passes that write and read the same resource. `history` is the image of an earlier frame that a temporal effect keeps, and `shadowAtlas` holds the sun's cascades and the point and spot lights' shadow tiles.

## `FeatureSetting`

Interface `FeatureSetting`.

One setting of a feature's own, with a value on each quality preset, like the engine's own rows of the quality table. The engine checks each preset value against `values`, resolves the row for the preset and the GPU path in use, and applies the governor's steps to it.

| Member | Description |
| --- | --- |
| `readonly presets: readonly [FeatureValue, FeatureValue, FeatureValue, FeatureValue]` | The value on each preset, from Low to Ultra. |
| `readonly webgl2?: readonly [FeatureValue, FeatureValue, FeatureValue, FeatureValue]` | The value on each preset on WebGL2, from Low to Ultra, where WebGL2 differs. A preset without a value here takes the row's own value. |
| `readonly values: 'flag' \| readonly (string \| number)[] \| { readonly min: number; readonly max: number; readonly whole?: boolean; }` | The values the setting takes: `'flag'` for true or false, a list of choices, or a range from a minimum to a maximum, where `whole` keeps it to whole numbers. The engine checks every preset value against them. |
| `readonly governor?: FeatureGovernor` | What each of the governor's budget steps does to the setting. `'scale'` takes the budget's share of the value, for a count that costs its number. `'double'` multiplies the value by two for each step taken, up to the highest value of its range, for an interval whose work happens less often. `'none'` keeps the preset's value. It is `'none'` by default. A setting that the governor steps needs the feature's `budget`, whose steps are what reach the setting. |

## `FeatureSize`

Interface `FeatureSize`.

The render size in device pixels, which the engine gives a feature when it changes.

| Member | Description |
| --- | --- |
| `readonly width: number` | The render size's width in device pixels. |
| `readonly height: number` | The render size's height in device pixels. |
| `readonly renderScale: number` | The share of the canvas that the engine draws, from the quality settings. |

## `FeatureSlot`

```ts
type FeatureSlot = 'shadow' | 'ambient' | 'sky' | 'ao' | 'reflection' | 'fog';
```

A lighting slot that a feature provides. One feature provides each slot: a second provider would give the scene two answers for one kind of light.

## `FeatureStats`

Interface `FeatureStats`.

One feature's figures, as the stats overlay shows them beside the engine's own. A feature that records frame work has one GPU timing scope, and `gpuMs` is that scope's time.

| Member | Description |
| --- | --- |
| `readonly name: string` | The feature's name. |
| `readonly settings: Readonly<Record<string, FeatureValue>>` | The feature's own settings, as the engine resolved them now. |
| `readonly gpuMs: number \| null` | The GPU time per frame of the feature's scope, in ms, or null until the engine times a frame that records the feature's work. The page fills it from the frame's GPU timings, because only the page reads them; the copy that `FeatureHost.stats` gives the sketch holds null. A pass that draws in some frames only keeps the figure of the window that last timed it. |
| `readonly scope: readonly FeatureGpuPass[]` | The render passes that carry the feature's frame work, as its description gave them, or an empty list for a feature with no scope. |
| `readonly bytes: number \| null` | The GPU bytes that the feature's own objects hold, or null where it reports none. |
| `readonly budgetMs: number \| null` | The time in ms that the feature may take in each frame at full quality, or null without a budget. |
| `readonly allowedMs: number \| null` | The time in ms that the feature may take in each frame now, or null without a budget. |

## `FeatureValue`

```ts
type FeatureValue = number | string | boolean;
```

The value of a feature's own setting: a number, a word or a flag. The engine resolves the value from the setting's row for the preset, the GPU path and the governor's steps.

## `FeatureView`

```ts
type FeatureView = 'main' | 'scenePass' | 'reflection';
```

A view that a feature records in, as its view mask.

## `SceneInput`

```ts
type SceneInput = 'sceneColor' | 'sceneDepth' | 'normals' | 'motionVectors';
```

A scene resource that a custom material or a feature reads: the scene's color before the tone curve, its depth, its surface normals, or how far each pixel's surface moved since the last frame. A reader declares the input, and the engine binds what the frame makes.
