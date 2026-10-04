---
id: api/post
title: Post-processing API
status: experimental
since: "0.1"
summary: "post.set for tone mapping, exposure and a camera's EV100, bloom, ambient occlusion, color grading tables and the vignette; the other effects and post.addEffect of 0.2."
---

# Post-processing API

> Ships in null3D 0.1, with bloom, ambient occlusion, color grading and the vignette in 0.2. The API is experimental, so it can still change between versions. Outlines and `post.addEffect` are not built yet, so coding agents must not use them.

`ctx.post` holds the settings that the engine applies to the scene's color on its way to the canvas. They are the tone mapping, the exposure, bloom, ambient occlusion, a color grading table and the vignette. [Color management](../concepts/color-management.md) explains how the first two fit into the frame. [The post-processing chain](../concepts/post-processing.md) explains how bloom and ambient occlusion do.

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
| `toneMapping` | `'aces'`, `'agx'`, `'neutral'` or `'none'` | `'aces'` |
| `exposure` | A number from 0 up. 2 is one stop brighter, and 0.5 one stop darker. | 1 |
| `ev100` | The camera's exposure value at ISO 100, for lights in real units: a number from -20 to 30, or `false` for none | `false` |

- The curves use three.js's formulas: `'aces'` for `ACESFilmicToneMapping`, `'agx'` for `AgXToneMapping` and `'neutral'` for `NeutralToneMapping`.
- `'none'` scales the color by the exposure and clips it at white, as three.js's `LinearToneMapping` does.
- three.js uses no tone mapping by default. A port of a three.js scene without tone mapping sets `toneMapping: 'none'`.
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

The engine multiplies the exposure into each light, the background color and the fog color. The shaders multiply it into emissive light and unlit colors. The tone mapping then works on values near 1, even with a sun of 100,000 lux. Otherwise its highlights would pass the largest value of the 16-bit float scene color. The picture is the one that an exposure at the end gives. Background and unlit colors take the exposure too. At EV100 15 they draw black unless their own values are in real units, as in three.js at the same exposure.

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

Bloom spreads light from the brightest parts of the scene, with the meanings of three.js's `UnrealBloomPass`. It is off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ post }) => {
  post.set({ bloom: { strength: 0.8, radius: 0.4, threshold: 1 } });
  return {};
});
```

| Setting | Values | Default |
| --- | --- | --- |
| `bloom` | Bloom's settings to turn it on, or `false` to turn it off. | Off |
| `bloom.strength` | How bright the glow is: a number from 0 up. | 1 |
| `bloom.radius` | How far the glow spreads: a number from 0 to 1. | 0.5 |
| `bloom.threshold` | The luminance from which a pixel glows, in linear color before the exposure: a number from 0 up. | 1 |

- A setting that a call leaves out keeps its value, also while bloom is off. `post.set({ bloom: {} })` turns bloom on with the values it had.
- At a threshold of 1, only light brighter than white glows, such as an emissive material with an `emissiveIntensity` above 1.
- The threshold keeps its meaning at any exposure: the engine scales it with the exposure, as it scales the scene's light. In a scene in real units, give it in the scene's units, such as 40,000 for about white at EV100 15.
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

The vignette darkens the picture toward its edges, with the meanings of three.js's `VignetteShader`:

```ts
post.set({ vignette: { offset: 1, darkness: 1.2 } });
```

| Setting | Values | Default |
| --- | --- | --- |
| `vignette` | Its settings to turn it on, or `false` to turn it off. | Off |
| `vignette.offset` | How far toward the center the darkening reaches: a number from 0 up. At 1, the corners blend halfway toward the gray of `1 - darkness`. | 1 |
| `vignette.darkness` | How dark the edges turn: a number from 0 up. At 1 they blend toward black. | 1 |

- Each pixel blends toward the gray of `1 - darkness` by its squared distance from the canvas's center, scaled by `offset`. The vignette applies after the color grading table.
- A setting that a call leaves out keeps its value, also while the vignette is off. `post.set({ vignette: {} })` turns it on with the values it had.

Grading and the vignette work on display color, so they draw on every GPU path, with HDR color or without it. They cost the final pass a few operations per pixel, and the table one texture read. On a device that resolves its multisampled picture straight into the canvas, they make the final pass run, which reads the picture once more.

## Errors

| Code | Cause |
| --- | --- |
| [E1213](../errors/E1213.md) | A setting that this version does not have, a tone mapping that the engine does not know, or a bloom, ambient occlusion or vignette value other than settings or `false`. Also a `lut` that is not a table from `assets.loadLut`, or a value out of its range. These are an exposure, strength, threshold, offset or darkness below 0, a bloom radius or `lutIntensity` outside 0 to 1, an ambient occlusion value below 0 or its `distanceFalloff` or `intensity` above 1, a `distanceExponent` of 0, `samples` that are not a whole number from 1 to 64, or an `ev100` outside -20 to 30. |
| [E1203](../errors/E1203.md) | A value that is not a finite number, such as NaN. |
| [E1101](../errors/E1101.md) | A table whose `destroy()` was called. |

## Related pages

- [Color management](../concepts/color-management.md): HDR color, the final pass, the 8-bit path and the background.
- [The post-processing chain](../concepts/post-processing.md): how bloom and ambient occlusion work, what they cost, and the effects still to come.
- [three.js to null3D mapping](../porting/threejs-mapping.md): `renderer.toneMapping`, `toneMappingExposure`, `UnrealBloomPass`, `GTAOPass`, `LUTPass` and `VignetteShader`.
- [Quality presets](../concepts/quality-presets.md): `aoScale` on each preset.
- [Assets](assets.md): `assets.loadLut`, which loads color grading tables.

## API reference

<!-- null3d:api:start -->

### `AoSettings`

Interface `AoSettings`.

Ambient occlusion's settings, with the meanings of three.js's `GTAOPass`. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `radius?: number` | How far from a surface the search for what hides it reaches, in world units: 0 or more, and 0.25 by default, as `GTAOPass`'s `radius`. |
| `thickness?: number` | How far in front of a surface, along the view, an object still hides it, in world units: 0 or more, and 1 by default. Objects farther in front cast no occlusion, so a thin pole does not darken the wall far behind it. |
| `distanceExponent?: number` | How the search's steps spread over the radius: 1 spreads them evenly, the default, and higher values gather them near the surface. It is above 0. |
| `distanceFalloff?: number` | From 0 to 1: how much less the farther steps of the search count. It is 1 by default, as `GTAOPass`'s `distanceFallOff`. |
| `scale?: number` | The power that the occlusion is raised to: 0 or more, and 1 by default. Above 1 it darkens. |
| `samples?: number` | The depth samples that each pixel's search reads: a whole number from 1 to 64, and 16 by default. Below 30 they spread over 3 directions, and from 30 over 5. |
| `intensity?: number` | From 0 to 1: how much of the occlusion reaches the ambient light. It is 1 by default, as `GTAOPass`'s `blendIntensity`. |

### `BloomSettings`

Interface `BloomSettings`.

Bloom's settings, with the meanings of three.js's `UnrealBloomPass`. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `strength?: number` | How bright the glow is: 0 or more, and 1 by default. |
| `radius?: number` | How far the glow spreads, from 0 to 1: higher values move its light from the narrow levels of its blur to the wide ones. It is 0.5 by default. |
| `threshold?: number` | The luminance from which a pixel glows, in linear color before the exposure: 0 or more, and 1 by default. At 1, only colors brighter than white glow, such as strong emissive light. |

### `Post`

Class `Post`.

The post-processing settings, as `ctx.post`. The engine applies them to every pixel of the scene, the background included, after lighting and before the canvas shows it.

| Member | Description |
| --- | --- |
| `set(settings: PostSettings): void` | Changes the settings that `settings` gives, from the next frame on. It allocates nothing, so a sketch can change the exposure, bloom, the table's intensity or the vignette every frame. It throws E1213 for a setting or a tone mapping it does not know, or a value out of its range, E1203 for a value that is not a number, and E1101 for a table that was destroyed. |

### `PostSettings`

Interface `PostSettings`.

Settings for `post.set`. A setting that the call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `toneMapping?: ToneMapping` | How the engine maps high dynamic range color to the screen. The default is `'aces'`. three.js uses no tone mapping by default, so a port of a three.js scene without it sets `'none'`. |
| `exposure?: number` | Scales the scene's color before the tone mapping, as three.js's `toneMappingExposure` does: 2 is one stop brighter, and 0.5 one stop darker. It is 0 or more, and 1 by default. With `ev100`, it scales the camera's exposure, as exposure compensation does. |
| `ev100?: number \| false` | The camera's exposure value at ISO 100, for lights in real units: 15 suits a sunny day lit by a sun of 100,000 lux, 12 an overcast day, and 7 a lit room. It scales the scene's color by 1 / (1.2 × 2^ev100), as Filament and Bevy do, so each step up is one stop darker. It is a number from -20 to 30, and `false`, the default, turns it off, which leaves three.js's units. |
| `bloom?: BloomSettings \| false` | Light that spreads from the brightest parts of the scene, as three.js's `UnrealBloomPass` spreads it. Settings turn bloom on, `{}` with the values it had, and `false` turns it off. It is off by default. |
| `ao?: AoSettings \| false` | Ambient occlusion: darkens the ambient light where nearby surfaces hide a surface from the sky, as three.js's `GTAOPass` finds it. It darkens only the light that comes from all around, where `GTAOPass` darkens the whole image. Settings turn it on, `{}` with the values it had, and `false` turns it off. It is off by default, and draws only where the quality setting `aoScale` is above 0. |
| `lut?: Lut \| false` | A color grading table from `assets.loadLut`, which maps each pixel's color after the tone mapping, as three.js's `LUTPass` does. `false` turns it off. It is off by default. |
| `lutIntensity?: number` | The share of the table's color in each pixel, from 0 for none to 1 for all of it, as `LUTPass`'s `intensity`. It is 1 by default. |
| `vignette?: VignetteSettings \| false` | Darkens the picture toward its edges, as three.js's `VignetteShader` does. Settings turn the vignette on, `{}` with the values it had, and `false` turns it off. It is off by default. |

### `ToneMapping`

```ts
type ToneMapping = 'aces' | 'agx' | 'neutral' | 'none';
```

How the engine maps the scene's high dynamic range color to the screen, with three.js's formulas. The curves are three.js's `ACESFilmicToneMapping` (`'aces'`), `AgXToneMapping` (`'agx'`) and `NeutralToneMapping` (`'neutral'`). The value `'none'` clips the exposed color at 1, as `LinearToneMapping` does.

### `VignetteSettings`

Interface `VignetteSettings`.

The vignette's settings, with the meanings of three.js's `VignetteShader`: each pixel blends toward the gray of `1 - darkness` by its squared distance from the canvas's center, scaled by `offset`. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `offset?: number` | How far toward the center the darkening reaches: 0 or more, and 1 by default. At 1, the corners blend halfway toward the gray, and higher values darken more of the picture. |
| `darkness?: number` | How dark the edges turn: 0 or more, and 1 by default, which blends them toward black. Above 1 the blend goes past black, so the edges darken faster. |

<!-- null3d:api:end -->
