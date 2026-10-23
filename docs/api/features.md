---
id: api/features
title: Add-on feature descriptions
status: experimental
since: "0.3"
summary: "One description for an add-on's render work: the frame point, the reads and writes, the callbacks, the outputs with neutral defaults, the lighting slots, the order band and the view mask."
---

# Add-on feature descriptions

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions. A description with `kind: 'draw'` can become a draw with [`scene.addFeatureDraw`](feature-draws.md). The other kinds do not reach the frame yet: each arrives with the add-on hook that first uses it. Until then, a registration checks the shape and changes nothing that draws. A feature's preset settings, budget and stats work today. Its GPU time reads as not measured until the engine records its frame work.

```mermaid
flowchart LR
    description["defineFeature<br/>frame point, reads, writes"] --> registry["FeatureRegistry<br/>one owner for each name"]
    registry --> outputs[("published outputs<br/>a neutral value for readers")]
    registry --> slots["lighting slots<br/>one provider each"]
    registry --> draw["scene.addFeatureDraw<br/>a draw feature"]
    draw --> frame["The frame's draw list"]
    registry -.-> graph["The render graph<br/>other hooks are not built yet"]
    registry --> host["FeatureHost<br/>preset values, budget, figures"]
    host --> overlay["The stats overlay<br/>one row for each feature"]
```

A feature description is one object that describes an add-on's part of a frame. It names the point where the feature records and the scene resources that it reads and writes. It also names the textures that it publishes, the lighting slot that it provides, and the callbacks that keep it in step with the engine. Every add-on hook that records frame work uses this one shape. An add-on learns one API, and the engine documents and versions one shape.

## Writing a description

`defineFeature` checks a description and fills its defaults. `FeatureRegistry.add` registers it and checks the rules that one feature alone cannot check.

```ts
import { defineFeature, FeatureRegistry } from '@null3d/engine';

const registry = new FeatureRegistry();

const lensFlare = registry.add(
  defineFeature({
    name: 'lens-flare',
    frame: 'resolve',
    kind: 'fullscreen',
    band: 'after',
    reads: ['sceneColor', 'sceneDepth'],
    writes: ['sceneColor'],
    outputs: { flare: { default: 'transparent' } },
    views: ['main'],
    ready: () => true,
    quality: (preset, settings) => {
      // Map the engine's quality onto the feature's own settings.
    },
    resize: (size) => {
      // The render size changed. Make targets of the new size.
    },
    reset: (reason) => {
      // Drop history that the reason makes stale.
    },
    destroy: () => {
      // Free the feature's own objects.
    },
  }),
);
```

A description is data, apart from its callbacks. The engine can send the declarations to the thread that records the frame. The callbacks run on the sketch's thread, where the add-on's code runs.

## The fields

| Field | Meaning | Default |
| --- | --- | --- |
| `name` | The feature's name, from 1 to 64 characters without a line break. | Required |
| `frame` | The point in the frame where the feature records, from the list below. Leave it out for a feature that publishes data and records no frame work. | None |
| `kind` | How the feature records: `'draw'`, `'compute'` or `'fullscreen'`. | Required with a frame |
| `band` | Where the feature runs against the engine's own work: `'before'`, `'normal'` or `'after'`. | `'normal'` |
| `order` | The feature's place inside its band. A lower number runs first. | The band's first place |
| `reads` | The scene resources that the feature reads. | None |
| `writes` | The scene resources that the feature writes. | None |
| `outputs` | The textures that the feature publishes to materials, effects and passes, by name, each with a neutral default. | None |
| `provides` | The lighting slots that the feature provides. One feature provides each slot. | None |
| `views` | The views that the feature records in, as its view mask. | `['main']` |
| `ready` | Called when the engine needs to know whether the feature draws. `false` means no cost at all. | Always ready |
| `settings` | The feature's own settings, by name, each with a value on every preset and the values it takes. | None |
| `budget` | The feature's time budget in each frame, on every preset. | None |
| `memory` | Returns the GPU bytes that the feature's own objects hold. | None |
| `quality` | Called with the preset, the engine's settings and the feature's own values when the engine's quality changes. | None |
| `resize` | Called with the render size in device pixels when it changes. | None |
| `reset` | Called with `'resize'`, `'camera'` or `'exposure'` when the feature must drop its history. | None |
| `destroy` | Called once when the feature is removed or the engine stops. | None |

A feature with no `frame` records no frame work. It gives no `kind`, `reads`, `writes` or `views`. It can still publish outputs, provide a lighting slot and receive the callbacks.

## Frame points

| Frame point | What runs there | Kinds |
| --- | --- | --- |
| `'shadow'` | The shadow passes, from a light's view. | `'draw'` |
| `'background'` | The background, before the opaque objects. A sky or atmosphere records here. | `'draw'`, `'compute'`, `'fullscreen'` |
| `'opaque'` | The pass that shades the opaque objects. | `'draw'`, `'compute'`, `'fullscreen'` |
| `'transparent'` | The pass that draws the blended objects. | `'draw'`, `'compute'`, `'fullscreen'` |
| `'resolve'` | The scene color as the camera's passes leave it, before the tone curve. Effects such as blur and bloom record here. | `'compute'`, `'fullscreen'` |
| `'post'` | The display image, after the tone curve. An overlay records here. | `'compute'`, `'fullscreen'` |

A `'compute'` feature publishes its results as outputs. It writes no scene resource.

## Order bands

The band places a feature against the engine's own work at its frame point. The order places it against other features in the same band.

| Band | Range of `order` | Meaning |
| --- | --- | --- |
| `'before'` | -1,048,576 to -1 | Runs before the engine's own work at the point. |
| `'normal'` | 0 to 1,048,575 | Runs with the engine's own work. |
| `'after'` | 1,048,576 to 2,097,151 | Runs after the engine's own work at the point. |

A feature without an `order` takes the first place of its band, which is 0 for `'normal'`.

## Scene resources

| Resource | Contents |
| --- | --- |
| `'sceneColor'` | The scene's color, before the tone curve. |
| `'sceneDepth'` | The scene's depth. |
| `'normals'` | The scene's surface normals. No pass makes them yet. |
| `'motionVectors'` | How far each pixel's surface moved since the last frame. |
| `'history'` | The image of an earlier frame, which a temporal effect keeps. |
| `'shadowAtlas'` | The sun's cascades and the point and spot lights' shadow tiles. |

The render graph runs a feature after the passes that write the resources that it reads. It runs the readers of the resources that the feature writes after the feature. The graph keeps its order from these declarations.

The first four are the scene inputs. A custom material declares `'sceneDepth'` in the same words: `SceneInput` is one public type, and `FeatureResource` adds `'history'` and `'shadowAtlas'` to it. No pass makes a normals target today, and the motion pass runs only while a reader wants the motion vectors.

A custom material reads the scene's depth now ([Materials](materials.md#the-scene-behind-a-surface)). The feature side binds its reads when the engine places a registered feature in the frame.

## Published outputs

An output is a texture that a feature publishes to materials, effects and passes, by name. Every output declares a neutral default:

- `'black'`: zeros in every channel.
- `'white'`: ones in every channel.
- `'transparent'`: zeros in every channel, alpha included.

A reader shows the neutral value while the feature is absent, switched off or not ready. A missing feature then breaks nothing downstream. Output names are unique across the engine's features.

## Lighting slots

A feature can provide one or more lighting slots: `'shadow'`, `'ambient'`, `'sky'`, `'ao'`, `'reflection'` or `'fog'`. One feature provides each slot. A second provider throws, because the scene would then have two answers for one kind of light.

## Views

The view mask chooses the views that the feature records in:

- `'main'`: the camera's view, which draws the canvas.
- `'scenePass'`: a scene pass's view, which draws into a texture.
- `'reflection'`: a reflection pass's view, which draws the mirrored scene.

The default is `['main']`.

## Namespaces

An add-on claims a namespace as its module loads, beside `checkAddonVersion`. The namespace gives it a name, a shader library, an error-code range and quality keys. The engine's names and the other add-ons' names stay with their owners, so two add-ons cannot give one name two meanings.

```ts
import { declareAddonNamespace } from '@null3d/engine';

export const NAMESPACE = declareAddonNamespace({
  name: 'water',                 // The add-on's name in errors.
  shaderLibrary: 'water',        // The prefix of its WGSL modules: #import water::waves. It defaults to name.
  errorCodes: [2100, 2199],      // The codes of the add-on's own errors.
  qualityKeys: [],               // Keys that it adds to the quality settings that a sketch reads.
});
```

A name takes 1 to 32 lowercase letters, digits or underscore characters, and it starts with a letter. The engine reserves `null3d` for both the name and the shader library. The engine's own error codes lie below 2000. An add-on's range therefore lies from 2000 to 9999, and two add-ons' ranges do not overlap. A quality key must not be a key of the engine's [quality table](../concepts/quality-presets.md#the-settings-of-each-preset) or another add-on's.

`FeatureHost` takes the namespace. A feature that the host registers exports its name, its outputs and its lighting slots to the whole thread. A second add-on that registers one of them is refused. The host's budgets carry the add-on's name too, so two add-ons keep their own budgets. A host refuses a namespace that the thread's registry does not hold.

Each refusal is an [E1225](../errors/E1225.md) that names both owners. A page and its sketches have one thread each, and the add-ons of one thread share one registry. A module that loads again, as a development reload does, gets the same namespace when it declares the same names.

## Preset settings and the frame-budget governor

A feature declares its own settings with a value on each preset, in the form of the engine's own [quality table](../concepts/quality-presets.md#the-settings-of-each-preset). `FeatureHost` resolves them for the preset in use. The frame-budget governor's steps reach them too.

```ts
import { defineFeature, FeatureHost } from '@null3d/engine';

const features = new FeatureHost({
  quality,                        // ctx.quality
  tier: engine.capabilities.tier, // ctx.engine.capabilities.tier
  page,                           // ctx.page, for the stats overlay
  namespace: NAMESPACE,           // the add-on's namespace, from declareAddonNamespace()
});

const splats = features.add(
  defineFeature({
    name: 'splats',
    frame: 'transparent',
    kind: 'draw',
    settings: {
      budgetSplats: {
        presets: [250_000, 500_000, 1_000_000, 2_000_000],
        values: { min: 0, max: 4_000_000, whole: true },
        governor: 'scale',
      },
    },
    budget: { presets: [2, 4, 8, 12], min: 0 },
    memory: () => 12 * 1024 * 1024,
    quality: (preset, settings, own) => {
      // own.settings.budgetSplats, own.budgetScale and own.budgetMs hold this feature's values.
    },
  }),
);
```

A setting's row holds four values, from Low to Ultra. It can also hold a `webgl2` row for the presets where WebGL2 differs. `values` says which values the row takes: `'flag'` for true or false, a list of choices, or a range `{ min, max, whole }`. The engine checks every preset value against it.

`governor` says what each of the governor's budget steps does to the setting:

| `governor` | What a step does | Use it for |
| --- | --- | --- |
| `'none'` (the default) | Nothing. The preset's value stays. | A setting that a step does not reach |
| `'scale'` | Takes the budget's share of the value, rounded where the values are whole numbers | A count that costs its number, such as a splat budget |
| `'double'` | Doubles the value for each step taken, up to the range's highest value | An interval whose work happens less often, such as a reflection cadence |

A setting with a `governor` needs the feature's `budget`. The budget's scale is what the steps move. The steps follow the sketch's other budgets: each step of the budgets' scale comes before a step of the render scale. Each step lowers the share by a quarter. `min` stops the scale above 0, so the feature always keeps its share of work.

The `quality` callback runs once when the feature is added, and again whenever the preset, the GPU path's column or the budget's share changes its values. The feature reads its values in each frame from its handle: `splats.settings.budgetSplats`, `splats.budgetScale` and `splats.budgetMs`. The handle keeps the same objects, so a value read in a frame allocates nothing.

`features.destroy()` stops the link: it removes the features' budgets and the handler that follows the quality.

## Stats

The stats overlay shows a row for each feature, under the engine's own figures. A row names the feature, its GPU time, its settings, its budget and the memory that it reports, such as `splats  gpu 0.42 ms  budgetSplats 500000  budget 3.0 of 4.0 ms  memory 12.0 MiB`.

A feature has one GPU timing scope. The engine times the feature's work in the frames that it records. Until the engine places a feature in the frame, the scope reads `gpu not measured`. The feature's memory comes from its `memory` callback, which the engine calls only when a figure changes.

`FeatureStats` holds the same figures. `FeatureHost.stats` gives them to the sketch, for tests and logs. The host sends them to the page, which the overlay reads, whenever one changes.

## Callbacks

- `ready` answers whether the feature draws now. `false` means no cost at all: no pass, no target, and none of its code or shaders downloads.
- `quality` maps the engine's preset and settings onto the feature's own settings. Its third argument holds the feature's resolved settings and its budget's share, which the host keeps current.
- `resize` gives the render size in device pixels. Make targets of the new size.
- `reset` names why the feature must drop its history. The reasons are a new render size, a camera cut to another place, and an exposure change that makes stored values stale.
- `destroy` frees the feature's own objects. The registry does not call it: stop the feature before you remove it.

## Adapters

An adapter turns a checked description into work in the frame. One adapter exists:

- **Draws:** [`scene.addFeatureDraw(description, options)`](feature-draws.md) draws the add-on's WGSL over its own vertices, with its uniforms, at the description's frame point. The band and order place a blended draw among the transparent pass's objects. The adapter places the main view alone.

The other hooks still need their own payload, and they arrive with the add-on that uses them first:

| Hook | What the description does not yet give it |
| --- | --- |
| Compute passes whose storage output other work reads in the same frame | The binding and ordering of the storage read. A feature has one kind, so the WebGL2 fragment-pass fallback needs a second description. |
| Draws whose count and instances the GPU writes | The indirect buffer and the CPU-filled fallback. The description says where the draw sorts, not how its count is made. |
| Material lobes, baked-data formats and glTF extension handlers | They are not frame features, so each needs its own hook. |
| Scene inputs, sky layers, presets and stats | Each needs its own declaration: a depth input behind a material, the background's CPU light, or a GPU timing scope. |

## Checks

`defineFeature` returns a frozen description with the defaults filled. It throws E1223 for an option that a description does not take. It also throws for a frame point or kind that does not go together. The same holds for an order outside its band, or a name that is too long. An output with no neutral default throws too. So does a resource, view or slot that does not exist. A setting whose preset value is not one of its values throws. So does a setting with a governor but no budget, and a budget whose four times are not above 0.

`FeatureRegistry.add` refuses a feature name that another feature has. It also refuses an output name that another feature publishes, and a lighting slot that another feature provides. `remove` gives those names back.

## Errors

| Code | Cause |
| --- | --- |
| E1223 | A description that `defineFeature` or `FeatureRegistry.add` cannot take: an unknown option, a bad name, a frame point or kind that does not go together, an order outside its band, an unknown resource, slot or view, an output with no neutral default, a setting value outside its own values, a governor without a budget, a budget without four times above 0, or a name that another feature has. |

## Related pages

- [The render graph](../concepts/render-graph.md): how the engine orders passes from their reads and writes.
- [Render graph API](render.md): the sketch's own scene, reflection and full-screen passes.
- [Quality API](quality.md): the preset and settings that a feature's `quality` callback receives, and the budgets' scale.
- [Debug drawing and stats](debug.md#stats-overlay-and-frame-figures): the overlay's figures, the add-on rows among them.
- [Post-processing API](post.md): the engine's effects, which run at the resolve and post points.

## API reference

[The API reference](reference/features.md) lists every export of this page with its type and description. The engine's doc comments make it.
