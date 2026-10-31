---
id: api/feature-effects
title: Add-on feature effects
status: experimental
since: "0.3"
summary: "post.addFeatureEffect turns a full-screen feature description into a pass of your WGSL over the scene's color, at the resolve point, on both GPU paths and in every thread mode, and draws it only while the feature is ready."
---

# Add-on feature effects

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions. A full-screen effect records at the resolve point, in the main view alone.

```mermaid
flowchart LR
    description["defineFeature<br/>frame 'resolve', kind 'fullscreen'"] --> call["post.addFeatureEffect"]
    shader["Your WGSL"] --> call
    uniforms["Your uniforms"] --> call
    call --> chain["The chain of custom effects<br/>HDR color, before bloom"]
    chain --> gpu["WebGPU or WebGL2"]
```

`post.addFeatureEffect` runs an add-on's pass over the whole image. The add-on gives the WGSL, its uniforms and its textures, as it would to [`post.addEffect`](post.md). The description says where the pass records. It says what the pass reads and writes, and whether it draws at all. The engine places it in the chain of custom effects. That chain runs on the scene's high dynamic range color, after the exposure and before bloom and the tone curve. The pass therefore reaches WebGPU and WebGL2, in every thread mode, with the same picture.

This is the adapter for a [feature description](features.md) with `kind: 'fullscreen'`. The description carries the place, the resources and the readiness; the shader and its values are the pass's own declaration, which this call takes.

## A depth of field

```ts
import { declareAddonNamespace, defineFeature, defineSketch, FeatureHost } from '@null3d/engine';

const NAMESPACE = declareAddonNamespace({ name: 'dof', package: '@acme/dof' });

const dof = /* wgsl */ `
struct Uniforms {
  focus: f32,
  strength: f32,
}

fn effect(input: EffectInput) -> vec4f {
  const distance = effectDistance(input.uv);
  const away = abs(distance - uniforms.focus) / max(distance, 0.001);
  const radius = away * uniforms.strength;
  if (radius < 0.35) return input.color;
  const step = radius / input.size.y;
  var color = input.color.rgb;
  for (var i = 1u; i < 16u; i = i + 1u) {
    const angle = f32(i) * 2.39996323;
    const uv = input.uv + vec2f(cos(angle), sin(angle)) * step;
    color += effectColor(uv).rgb;
  }
  return vec4f(color / 16.0, input.color.a);
}
`;

export default defineSketch(async ({ post, quality, engine, page }) => {
  let samples = 0;
  const description = defineFeature({
    name: 'depth-of-field',
    frame: 'resolve',
    kind: 'fullscreen',
    reads: ['sceneColor', 'sceneDepth'],
    writes: ['sceneColor'],
    ready: () => samples > 0,
    quality: (_preset, settings) => {
      samples = settings.dofSamples;
    },
  });
  const features = new FeatureHost({ quality, tier: engine.capabilities.tier, page, namespace: NAMESPACE });
  features.add(description);
  const effect = await post.addFeatureEffect(description, {
    wgsl: dof,
    uniforms: { focus: 8, strength: 9 },
  });
  // Later, from any frame: change a value of the pass.
  effect.setUniform('focus', 12);
});
```

## The description

`addFeatureEffect` reads these fields of the description. The [feature description page](features.md) gives the others: `name`, `outputs`, `provides` and the callbacks.

| Field | What a full-screen effect takes |
| --- | --- |
| `kind` | `'fullscreen'`. Any other kind throws E1223. |
| `frame` | `'resolve'`. No public pass draws an add-on's effect after the tone curve yet, so another frame point throws E1223. |
| `band` | `'before'`, `'normal'` or `'after'`. It places the pass among the sketch's other effects, whose orders the band's ranges keep in that order. |
| `order` | The place inside the band. A lower number runs first. |
| `reads` | `'sceneColor'`, and `'sceneDepth'` when the WGSL reads the depth. Another resource throws E1223. |
| `writes` | `['sceneColor']` alone. The pass returns the scene's new color. |
| `views` | `['main']`. The adapter refuses another view rather than drawing in the wrong one. |
| `ready` | Whether the pass runs now. `false` keeps the effect out of the chain, so it costs no pass, no target and no shader download. |

The description and the WGSL must agree about the depth. A pass that declares `'sceneDepth'` reads it with `effectDepth(uv)`, `effectViewPosition(uv)` or `effectDistance(uv)`; a pass that declares no depth reads none of them. A mismatch at either side throws E1223.

## The shader

The WGSL declares `fn effect(input: EffectInput) -> vec4f`, as a custom effect's does. [Custom effects](post.md#custom-effects) describes the input, the helpers and the texture declarations that the plugin compiles into the engine's effect template.

- `input.uv`, `input.pixel` and `input.size` place the pixel.
- `input.color`, `effectColor(uv)` and `effectPixel(pixel)` read the scene's color, before the tone curve.
- `effectDepth(uv)`, `effectViewPosition(uv)` and `effectDistance(uv)` read the scene's depth. They read it at the pixel, or at any other pixel of the image. `effectDistance` gives the distance from the camera, in world units. A blur by distance uses it.

## Readiness and values

The adapter asks `ready` when the feature is added, and again whenever the engine's quality changes. A `false` answer removes the effect from the chain. A later `true` answer adds it again, with its last values.

`effect.refresh()` asks again after a change of the sketch's own state. `effect.setUniform(name, value)` changes a live pass without allocating. A not-ready feature keeps the value until it draws.

Add the feature to its `FeatureHost` before you place it. The host's quality callback and the adapter's `ready` check both run on the same quality change, in the order that they were registered. A `ready` that reads the feature's own settings therefore needs the host's values first.

## Limits

- The pass records at the resolve point and in the main view alone. An add-on's effect after the tone curve, or in a scene or reflection pass, needs a hook that the engine does not have yet.
- The pass reads the scene's color and depth alone. Normals, motion vectors, history and the shadow atlas need a binding that the effect chain does not add yet.
- The pass publishes no texture and provides no lighting slot. A feature that publishes an output is a compute pass, and a lighting slot belongs to the pass that shades the surfaces.
- The chain runs in one place in the frame, so the band orders the pass among the sketch's other effects. The engine's own bloom and depth of field keep their own places around it.

## Errors

| Code | Cause |
| --- | --- |
| E1223 | A description that the effect adapter cannot place: another kind or frame point, another view, another write, a resource that the chain does not bind, an output, a lighting slot, or a depth read that the description and the WGSL do not agree on. |
| E1215, E1216 | WGSL that the plugin did not compile as an effect, or a uniform or a texture that the WGSL does not declare. |
| E1213 | The most effects already run, or a bloom level that the WGSL does not read. |
| E1406 | The effect adapter did not download. |

## Related pages

- [Add-on feature descriptions](features.md): the one description shape, its fields and its registry.
- [Post-processing API](post.md): the engine's effects, exposure, bloom and tone mapping.
- [Custom effects](post.md#custom-effects): the `fn effect` template and its helpers.
- [Add-on feature draws](feature-draws.md): the adapter for a draw, in the scene's own passes.

## API reference

[The API reference](reference/feature-effects.md) lists every export of this page with its type and description. The engine's doc comments make it.
