---
id: api/post
title: Post-processing API
status: experimental
since: "0.1"
summary: "post.set for tone mapping, exposure and a camera's EV100, bloom, ambient occlusion, outlines, color grading tables and the vignette; custom effects with post.addEffect, and custom tone curves."
---

# Post-processing API

> Ships in null3D 0.1, with bloom, ambient occlusion, outlines, color grading, the vignette, custom effects and custom tone curves in 0.2. The API is experimental, so it can still change between versions.

`ctx.post` holds the settings that the engine applies to the scene's color on its way to the canvas. They are the tone mapping, the exposure, bloom, ambient occlusion, outlines, a color grading table, the vignette and the sketch's own effects. [Color management](../concepts/color-management.md) explains how the first two fit into the frame. [The post-processing chain](../concepts/post-processing.md) explains how bloom and ambient occlusion do.

## Tone mapping and exposure

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ post }) => {
  post.set({ toneMapping: 'neutral', exposure: 1.2 });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `toneMapping` | `'agx-punchy'`, `'agx'`, `'neutral'`, `'aces'`, `'none'`, or a custom tone curve's WGSL | `'agx-punchy'` |
| `exposure` | A number from 0 up. 2 is one stop brighter, and 0.5 one stop darker. | 1 |
| `ev100` | The camera's exposure value at ISO 100, for lights in real units: a number from -20 to 30, or `false` for none | `false` |

- The curves use three.js's formulas: `'agx'` for `AgXToneMapping`, `'neutral'` for `NeutralToneMapping` and `'aces'` for `ACESFilmicToneMapping`. `'agx-punchy'` is AgX with Filament's punchy look, which adds contrast and color. three.js has no such curve.
- `'aces'` serves ports of three.js scenes that set `ACESFilmicToneMapping`. It shifts the hues of bright colors, so new scenes use AgX.
- `'none'` scales the color by the exposure and clips it at white, as three.js's `LinearToneMapping` does.
- three.js uses no tone mapping by default. A port of a three.js scene without tone mapping sets `toneMapping: 'none'`.
- A custom tone curve is WGSL that declares `fn toneCurve(color: vec3f) -> vec3f`, compiled by the null3D Vite plugin. [Custom effects](#custom-effects) shows one.
- The settings apply to the whole scene, the background included, from the next frame on. A setting that a call leaves out keeps its value.

## Lights in real units

Most scenes and ports keep three.js's units, which need no camera setting. Lights in real units, such as a sun of 100,000 lux, need `ev100`: the exposure value of a camera at ISO 100. The units are on the [Lights](lights.md#color-intensity-and-units) page. Typical values are 15 for a sunny day, 12 for an overcast day and 7 for a lit room. Each step up is one stop darker. The engine scales the scene by 1 / (1.2 × 2^ev100), the formula of Filament, Bevy and Unity's HDRP. The `exposure` setting then scales that, as exposure compensation does. Setting `ev100: false` turns the camera off again.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, post }) => {
  // A sunny day, half a stop brighter than the camera's own exposure.
  post.set({ ev100: 15, exposure: 1.41 });
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 100_000, intensityUnit: 'lux' });
  return {};
});
```

The engine multiplies the exposure into each light, the environment's light, the background color and the fog color. The shaders multiply it into emissive light and unlit colors. The tone mapping then works on values near 1, even with a sun of 100,000 lux. Otherwise its highlights would pass the largest value of the 16-bit float scene color. The picture is the one that an exposure at the end gives. Background and unlit colors take the exposure too. At EV100 15 they draw black unless their own values are in real units, as in three.js at the same exposure.

## Changing the exposure during play

`post.set` allocates nothing, so a sketch can change the exposure every frame. Keep one settings object and change its field, so your own code allocates nothing either:

```ts
export default defineSketch(({ post, time }) => {
  const settings = { exposure: 1 };
  return {
    onUpdate() {
      settings.exposure = 1 + 0.5 * Math.sin(time.now);
      post.set(settings);
    },
  };
});
```

## Bloom

Bloom spreads light from the bright parts of the scene through a chain of blurred levels. It is off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ post }) => {
  post.set({ bloom: { intensity: 0.2, threshold: 1 } });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `bloom` | Bloom's settings to turn it on, or `false` to turn it off. | Off |
| `bloom.intensity` | How strong the glow is: a number from 0 up. With the `'mix'` blend it is the glow's share of each pixel, at most 1. | 0.15 |
| `bloom.threshold` | The luminance from which a pixel glows, in linear color before the exposure: a number from 0 up. | 0 |
| `bloom.knee` | The width of the threshold's soft edge, in luminance: a number from 0 up. | 0.1 |
| `bloom.blend` | How the glow meets the scene's color: `'mix'`, `'add'` or `'screen'`. | `'mix'` |
| `bloom.weights` | Each level's share of the glow, from the narrowest to the widest: up to 10 numbers from 0 up, not all 0. | Shares for 8 levels |

- `'mix'` moves each pixel's color toward the glow, so the image keeps its total light. `'add'` adds the glow, as three.js's `UnrealBloomPass` does. `'screen'` screens it, as pmndrs's `BloomEffect` does.
- At a threshold of 0, all light glows a little. At 1, only light brighter than white glows, such as an emissive material with an `emissiveIntensity` above 1.
- Each level spreads light twice as far as the one before. The eighth spreads it over about a quarter of the canvas's shorter side, and the tenth over all of it. The engine divides the weights by their sum. Levels past the last one with a weight cost nothing.
- The glow keeps its size as a share of the screen at any pixel ratio, render scale and orientation. The quality setting `bloomSize` sets how many texels the chain's largest level has, which trades the glow's detail for cost.
- A setting that a call leaves out keeps its value, also while bloom is off. `post.set({ bloom: {} })` turns bloom on with the values it had.
- The threshold and its soft edge keep their meaning at any exposure: the engine scales them with the exposure, as it scales the scene's light. In a scene in real units, give them in the scene's units, such as 40,000 for about white at EV100 15.
- In WebGPU's compatibility mode with MSAA, turning bloom on moves the engine to HDR color with FXAA. On a WebGL2 device with no float target, bloom stays off. [The post-processing chain](../concepts/post-processing.md#effects-on-devices-without-hdr-color) explains both.
- `post.set` allocates nothing, so a sketch can change bloom's settings every frame.

## Ambient occlusion

Ambient occlusion darkens the ambient light in corners, in creases and under objects, with the meanings of three.js's `GTAOPass`. It is off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ post, quality }) => {
  quality.set({ aoScale: 0.5 });
  post.set({ ao: { radius: 0.5 } });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `ao` | Its settings to turn it on, or `false` to turn it off. | Off |
| `ao.radius` | How far from a surface the search reaches, in world units: a number from 0 up. | 0.25 |
| `ao.thickness` | How far in front of a surface, along the view, an object still hides it: a number from 0 up. | 1 |
| `ao.distanceExponent` | How the search's steps spread over the radius: a number above 0. Higher values gather them near the surface. | 1 |
| `ao.distanceFalloff` | How much less the farther steps count: a number from 0 to 1. | 1 |
| `ao.scale` | The power that the occlusion is raised to: a number from 0 up. Above 1 darkens it. | 1 |
| `ao.samples` | The depth samples of each pixel's search: a whole number from 1 to 64. | 16 |
| `ao.intensity` | How much of the occlusion reaches the ambient light: a number from 0 to 1. | 1 |

- It darkens only the ambient light and the light that light maps add. `GTAOPass` darkens the whole image, direct light included.
- It draws where the quality setting `aoScale` is above 0: on the High and Ultra presets, or after `quality.set({ aoScale })`. On Low and Medium, the presets of phones and tablets, the scale is 0.
- It turns the depth prepass on while it draws. On a WebGL2 device without float render targets it stays off.
- A setting that a call leaves out keeps its value, also while it is off. `post.set({ ao: {} })` turns it on with the values it had.
- `post.set` allocates nothing, so a sketch can change its settings every frame. Turning it on or off adds or removes passes, which takes a few frames.

## Outlines

Outlines draw a crisp line around the meshes that `setOutlined(true)` marks, as three.js's `OutlinePass` draws edges around its selected objects. They are off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, post }) => {
  post.set({ outline: { color: '#ffcc00', width: 3 } });
  const camera = scene.createPerspectiveCamera({ position: [0, 2, 6], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1] });
  const crate = scene.createMesh({
    mesh: geometry.box(),
    material: materials.standard({ color: '#8a6a4a' }),
  });
  crate.setOutlined(true);
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `outline` | The outline's settings to turn it on, or `false` to turn it off. | Off |
| `outline.color` | The color of the line around the parts that nothing hides. | White |
| `outline.hiddenColor` | The color of the line around the parts that other objects hide, or `false` for no line there. | `false` |
| `outline.width` | The line's width in CSS pixels, from 0 up. | 2 |

- `mesh.setOutlined(true)` marks a mesh, and `setOutlined(false)` clears it. A model's copy from `scene.instantiate` has `setOutlined` too, which marks each of its meshes. Instance batches take no outline.
- One outline style covers every outlined mesh. three.js needs one `OutlinePass` for each style, and null3D draws one.
- The exposure, the tone mapping and the vignette do not change the line's colors. The color grading table still applies, and the dither moves them by up to one 8-bit step.
- The line is as wide as `width` says on every screen and at every render scale. The engine multiplies it by the device's pixel ratio.
- Above about 4 pixels of the canvas, a part of a mesh thinner than the line can leave a gap between itself and its line.
- The outline covers the mesh's whole shape. It ignores the holes that an alpha cutoff cuts, and the vertices that a custom material moves.
- A setting that a call leaves out keeps its value, also while outlines are off. `post.set` allocates nothing. So a sketch can change the outline's color or width every frame.
- Turning outlines on or off, and `setOutlined`, rebuild the engine's draw tables, as a new material does. Do it in response to a click, not in every frame.

[The post-processing chain](../concepts/post-processing.md#outlines) explains how outlines draw and what they cost.

## Color grading

A color grading table maps each color of the picture to a graded color, as three.js's `LUTPass` does. Load one from a `.cube` or a `.3dl` file with [`assets.loadLut`](assets.md), then give it to `post.set`:

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ assets, post }) => {
  const lut = await assets.loadLut('/grades/warm.cube');
  post.set({ lut, lutIntensity: 0.8 });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `lut` | A table from `assets.loadLut`, or `false` to turn grading off. | Off |
| `lutIntensity` | The share of the table's color in each pixel, from 0 to 1, as `LUTPass`'s `intensity`. | 1 |

- The table grades each pixel after the tone mapping and the sRGB encoding, as `LUTPass` does after three.js's `OutputPass`. Tables made for sRGB display color, as most are, look as their authors made them.
- The final pass reads the table with a linear filter between its texel centers, as `LUTPass` does. It maps the colors of a `.cube` file's domain onto the table, which `LUTPass` leaves out.
- The table grades the picture from the first frame after its texels reach the GPU, usually the next one.
- `lutIntensity` keeps its value while the table is off, and `post.set` allocates nothing, so a sketch can fade a grade in every frame.

## Vignette

The vignette darkens the picture toward its edges:

```ts
post.set({ vignette: { intensity: 0.8, size: 1.2 } });
```

| Setting | Values | Default |
| --- | --- | --- |
| `vignette` | Its settings to turn it on, or `false` to turn it off. | Off |
| `vignette.intensity` | How dark the edges turn, from 0 up. At 1 the edges turn black where the darkening is full, and above 1 they turn black sooner. | 1 |
| `vignette.size` | How much of the picture the darkening covers, from 0 up. It scales the distance from the center. From about 1.41 the corners take the full intensity. | 1 |
| `vignette.falloff` | How fast the light falls from the center: the power of the falloff curve, above 0. Higher values darken more of the picture. | 2 |
| `vignette.roundness` | The shape, from 0 to 1: 0 follows the canvas's shape, an ellipse on a wide canvas, and 1 is a circle. | 0 |

- The vignette multiplies each pixel's light before the tone mapping, as Filament, Unity's URP, Bevy and Babylon.js do. Bright corners darken as dark corners do.
- At a distance `d` from the center, in canvas widths and heights times `size`, the light is multiplied by `1 - intensity × (1 - (1 - d²)^falloff)`, and never by less than 0.
- three.js's `VignetteShader` blends display color toward a gray instead. A port sets `size` to its `offset` and `intensity` to its `darkness`, and the default falloff gives a close match. With a `darkness` below 1, three.js also lifts dark corners toward the gray, and null3D does not.
- A setting that a call leaves out keeps its value, also while the vignette is off. `post.set({ vignette: {} })` turns it on with the values it had.

Grading and the vignette draw on every GPU path, with HDR color or without it. Without HDR color, the vignette multiplies the linear value of each pixel's display color. They cost the final pass a few operations per pixel, and the table one texture read. On a device that resolves its multisampled picture straight into the canvas, they make the final pass run, which reads the picture once more.

The final pass dithers last, after the table and the vignette. It adds noise of up to one step of the 8-bit canvas, so smooth gradients show no bands. The noise is the same in every frame.

## Custom effects

`post.addEffect` adds a full-screen effect of the sketch's own WGSL. It returns the effect, which the other two calls take:

```ts
const grade = /* wgsl */ `
struct Uniforms { warmth: f32 }

fn effect(input: EffectInput) -> vec4f {
    let warm = input.color.rgb * vec3f(1.0 + uniforms.warmth, 1.0, 1.0 - uniforms.warmth);
    return vec4f(warm, input.color.a);
}
`;

const effect = post.addEffect({ wgsl: grade, uniforms: { warmth: 0.1 } });
post.setEffectUniform(effect, 'warmth', 0.2);
post.removeEffect(effect);
```

| Option | Values | Default |
| --- | --- | --- |
| `wgsl` | WGSL that the null3D Vite plugin compiled, which declares `fn effect(input: EffectInput) -> vec4f` | Required |
| `uniforms` | The first value of each field of the WGSL's `struct Uniforms`, by name | 0 for each field |
| `order` | A number. Effects run from the lowest order to the highest. | 0 |

A custom tone curve takes the place of the built-in curves:

```ts
const reinhard = /* wgsl */ `
fn toneCurve(color: vec3f) -> vec3f {
    return color / (vec3f(1.0) + color);
}
`;

post.set({ toneMapping: reinhard });
```

- Effects run on linear HDR color, after the exposure and before bloom and the tone curve. At most 8 run at once. The engine joins effects that read only their own pixel into fewer passes ([Custom passes](../guides/custom-passes.md#cost)).
- `setEffectUniform` allocates nothing, so a sketch can call it every frame. Keep a vector's values in one array that the sketch changes in place.
- Effects and custom curves need HDR color. On a device without it they stay off, and development builds warn once.
- [Custom passes](../guides/custom-passes.md) lists what an effect reads, and what effects cost.

## Errors

| Code | Cause |
| --- | --- |
| [E1213](../errors/E1213.md) | A ninth effect. A setting that this version does not have, such as three.js's vignette `offset` and `darkness`, a tone mapping that the engine does not know, or a bloom, ambient occlusion, outline or vignette value other than settings or `false`. Also a `lut` that is not a table from `assets.loadLut`, or a value out of its range. These are an exposure, bloom intensity, threshold or knee, vignette intensity or size, or outline width below 0, a vignette falloff of 0 or below or a roundness above 1, a bloom blend other than `'mix'`, `'add'` or `'screen'`, bloom weights that are not 1 to 10 numbers of 0 or more, or that are all 0, a `lutIntensity` outside 0 to 1, an ambient occlusion value below 0 or its `distanceFalloff` or `intensity` above 1, a `distanceExponent` of 0, `samples` that are not a whole number from 1 to 64, or an `ev100` outside -20 to 30. |
| [E1203](../errors/E1203.md) | A value that is not a finite number, such as NaN, or an effect's `order` that is not one. |
| [E1204](../errors/E1204.md) | An outline color that is not a hex string, a hex number or three linear components from 0 to 1. |
| [E1215](../errors/E1215.md) | An effect or a tone curve as WGSL that the null3D Vite plugin did not compile, or compiled WGSL of another kind. |
| [E1216](../errors/E1216.md) | An effect's uniform that its WGSL does not declare, or a value of the wrong kind. |
| [E1101](../errors/E1101.md) | A table whose `destroy()` was called, or an effect that `removeEffect` removed. |

## Related pages

- [Color management](../concepts/color-management.md): HDR color, the final pass, the 8-bit path and the background.
- [The post-processing chain](../concepts/post-processing.md): how bloom, ambient occlusion, outlines and custom effects work, and what they cost.
- [Custom passes](../guides/custom-passes.md): how to write custom effects and tone curves.
- [three.js to null3D mapping](../porting/threejs-mapping.md): `renderer.toneMapping`, `toneMappingExposure`, `UnrealBloomPass`, `GTAOPass`, `OutlinePass`, `LUTPass`, `VignetteShader` and `ShaderPass`.
- [Quality presets](../concepts/quality-presets.md): `aoScale` on each preset.
- [Objects and transforms](objects.md#mesh-calls): `setOutlined`.
- [Assets](assets.md): `assets.loadLut`, which loads color grading tables.
- [The post effects demo](https://github.com/null3d-engine/null3d/tree/main/examples/post-effects): bloom, ambient occlusion, an outline, a vignette and color grading tables in one scene.

## API reference

[The API reference](reference/post.md) lists every export of this page with its type and description. The engine's doc comments make it.
