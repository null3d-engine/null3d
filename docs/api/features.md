---
id: api/features
title: Add-on feature descriptions
status: experimental
since: "0.3"
summary: "One description for an add-on's render work: the frame point, the reads and writes, the callbacks, the outputs with neutral defaults, the lighting slots, the order band and the view mask."
---

# Add-on feature descriptions

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions. Not built yet: the engine does not place a registered feature in the frame. Each hook that does this arrives with the add-on that first uses it. Until then, a registration checks the shape and changes nothing that draws.

```mermaid
flowchart LR
    description["defineFeature<br/>frame point, reads, writes"] --> registry["FeatureRegistry<br/>one owner for each name"]
    registry --> outputs[("published outputs<br/>a neutral value for readers")]
    registry --> slots["lighting slots<br/>one provider each"]
    registry -.-> graph["The render graph<br/>its hook is not built yet"]
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
| `quality` | Called with the preset and the settings when the engine's quality changes. | None |
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

## Callbacks

- `ready` answers whether the feature draws now. `false` means no cost at all: no pass, no target, and none of its code or shaders downloads.
- `quality` maps the engine's preset and settings onto the feature's own settings.
- `resize` gives the render size in device pixels. Make targets of the new size.
- `reset` names why the feature must drop its history. The reasons are a new render size, a camera cut to another place, and an exposure change that makes stored values stale.
- `destroy` frees the feature's own objects. The registry does not call it: stop the feature before you remove it.

## Checks

`defineFeature` returns a frozen description with the defaults filled. It throws E1223 for an option that a description does not take. It also throws for a frame point or kind that does not go together. The same holds for an order outside its band, or a name that is too long. An output with no neutral default throws too. So does a resource, view or slot that does not exist.

`FeatureRegistry.add` refuses a feature name that another feature has. It also refuses an output name that another feature publishes, and a lighting slot that another feature provides. `remove` gives those names back.

## Errors

| Code | Cause |
| --- | --- |
| E1223 | A description that `defineFeature` or `FeatureRegistry.add` cannot take: an unknown option, a bad name, a frame point or kind that does not go together, an order outside its band, an unknown resource, slot or view, an output with no neutral default, or a name that another feature has. |

## Related pages

- [The render graph](../concepts/render-graph.md): how the engine orders passes from their reads and writes.
- [Render graph API](render.md): the sketch's own scene, reflection and full-screen passes.
- [Quality API](quality.md): the preset and settings that a feature's `quality` callback receives.
- [Post-processing API](post.md): the engine's effects, which run at the resolve and post points.

## API reference

[The API reference](reference/features.md) lists every export of this page with its type and description. The engine's doc comments make it.
