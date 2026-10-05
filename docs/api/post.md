---
id: api/post
title: Post-processing API
status: experimental
since: "0.1"
summary: "post.set for tone mapping, exposure and a camera's EV100, bloom, ambient occlusion, outlines, color grading tables and the vignette; the other effects and post.addEffect of 0.2."
---

# Post-processing API

> Ships in null3D 0.1, with bloom, ambient occlusion, outlines, color grading and the vignette in 0.2. The API is experimental, so it can still change between versions. `post.addEffect` is not built yet, so coding agents must not use it.

`ctx.post` holds the settings that the engine applies to the scene's color on its way to the canvas. They are the tone mapping, the exposure, bloom, ambient occlusion, outlines, a color grading table and the vignette. [Color management](../concepts/color-management.md) explains how the first two fit into the frame. [The post-processing chain](../concepts/post-processing.md) explains how bloom and ambient occlusion do.

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

## Errors

| Code | Cause |
| --- | --- |
| [E1213](../errors/E1213.md) | A setting that this version does not have, such as three.js's vignette `offset` and `darkness`, a tone mapping that the engine does not know, or a bloom, ambient occlusion, outline or vignette value other than settings or `false`. Also a `lut` that is not a table from `assets.loadLut`, or a value out of its range. These are an exposure, strength, threshold, vignette intensity or size, or outline width below 0, a vignette falloff of 0 or below or a roundness above 1, a bloom radius or `lutIntensity` outside 0 to 1, an ambient occlusion value below 0 or its `distanceFalloff` or `intensity` above 1, a `distanceExponent` of 0, `samples` that are not a whole number from 1 to 64, or an `ev100` outside -20 to 30. |
| [E1203](../errors/E1203.md) | A value that is not a finite number, such as NaN. |
| [E1204](../errors/E1204.md) | An outline color that is not a hex string, a hex number or three linear components from 0 to 1. |
| [E1101](../errors/E1101.md) | A table whose `destroy()` was called. |

## Related pages

- [Color management](../concepts/color-management.md): HDR color, the final pass, the 8-bit path and the background.
- [The post-processing chain](../concepts/post-processing.md): how bloom, ambient occlusion and outlines work, what they cost, and the effects still to come.
- [three.js to null3D mapping](../porting/threejs-mapping.md): `renderer.toneMapping`, `toneMappingExposure`, `UnrealBloomPass`, `GTAOPass`, `OutlinePass`, `LUTPass` and `VignetteShader`.
- [Quality presets](../concepts/quality-presets.md): `aoScale` on each preset.
- [Objects and transforms](objects.md#mesh-calls): `setOutlined`.
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

### `BloomBlend`

```ts
type BloomBlend = 'mix' | 'add' | 'screen';
```

How bloom's glow meets the scene's color. The `'mix'` blend moves each pixel's color toward the glow by the intensity, which keeps the image's total light. The `'add'` blend adds the glow, as three.js's `UnrealBloomPass` does. The `'screen'` blend screens it, as pmndrs's `BloomEffect` does.

### `BloomSettings`

Interface `BloomSettings`.

Bloom's settings. Bloom blurs the scene's color through a chain of up to 10 levels, each half the size of the one before. It blends their sum into the image. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `intensity?: number` | How strong the glow is: 0 or more, and 0.15 by default. With the `'mix'` blend it is the glow's share of each pixel, at most 1. With `'add'` and `'screen'` it multiplies the glow. |
| `threshold?: number` | The luminance from which a pixel glows, in linear color before the exposure: 0 or more, and 0 by default, so all light glows a little. At 1, only colors brighter than white glow, such as strong emissive light. |
| `knee?: number` | The width of the threshold's soft edge, in luminance: 0 or more, and 0.1 by default. A pixel glows more as its luminance rises from the threshold to the threshold plus this width. |
| `blend?: BloomBlend` | How the glow meets the scene's color. It is `'mix'` by default. |
| `weights?: readonly number[]` | Each level's share of the glow, from the narrowest level to the widest: up to 10 numbers of 0 or more, not all 0. The engine divides them by their sum, and a missing level takes 0. Each level spreads light twice as far as the one before: the eighth over about a quarter of the canvas's shorter side, and the tenth over all of it. Levels past the last one with a weight cost nothing. The default gives 8 levels weights, most to the narrow ones, for a soft glow. |

### `OutlineSettings`

Interface `OutlineSettings`.

The outline's settings: a sharp line of one width around the objects that `setOutlined(true)` marks. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `color?: ColorInput` | The color of the line around the parts that nothing hides. The canvas shows this color exactly: the exposure and the tone mapping do not change it. It is white by default. |
| `hiddenColor?: ColorInput \| false` | The color of the line around the parts that other objects hide, or `false` for no line there. It is `false` by default. |
| `width?: number` | The line's width in CSS pixels: 0 or more, and 2 by default. Above about 4 pixels of the canvas, parts thinner than the line can leave a gap between themselves and their line. |

### `Post`

Class `Post`.

The post-processing settings, as `ctx.post`. The engine applies them to every pixel of the scene, the background included, after lighting and before the canvas shows it.

| Member | Description |
| --- | --- |
| `set(settings: PostSettings): void` | Changes the settings that `settings` gives, from the next frame on. It allocates nothing, so a sketch can change the exposure, bloom, the outline, the table's intensity or the vignette every frame. It throws E1213 for a setting or a tone mapping it does not know, or a value out of its range, E1203 for a value that is not a number, E1204 for a color it cannot read, and E1101 for a table that was destroyed. |

### `PostSettings`

Interface `PostSettings`.

Settings for `post.set`. A setting that the call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `toneMapping?: ToneMapping` | How the engine maps high dynamic range color to the screen. The default is `'aces'`. three.js uses no tone mapping by default, so a port of a three.js scene without it sets `'none'`. |
| `exposure?: number` | Scales the scene's color before the tone mapping, as three.js's `toneMappingExposure` does: 2 is one stop brighter, and 0.5 one stop darker. It is 0 or more, and 1 by default. With `ev100`, it scales the camera's exposure, as exposure compensation does. |
| `ev100?: number \| false` | The camera's exposure value at ISO 100, for lights in real units: 15 suits a sunny day lit by a sun of 100,000 lux, 12 an overcast day, and 7 a lit room. It scales the scene's color by 1 / (1.2 × 2^ev100), as Filament and Bevy do, so each step up is one stop darker. It is a number from -20 to 30, and `false`, the default, turns it off, which leaves three.js's units. |
| `bloom?: BloomSettings \| false` | Light that spreads from the bright parts of the scene through a chain of blurred levels. Settings turn bloom on, `{}` with the values it had, and `false` turns it off. It is off by default. Its glow keeps its size as a share of the canvas at any pixel ratio and render scale. |
| `ao?: AoSettings \| false` | Ambient occlusion: darkens the ambient light where nearby surfaces hide a surface from the sky, as three.js's `GTAOPass` finds it. It darkens only the light that comes from all around, where `GTAOPass` darkens the whole image. Settings turn it on, `{}` with the values it had, and `false` turns it off. It is off by default, and draws only where the quality setting `aoScale` is above 0. |
| `lut?: Lut \| false` | A color grading table from `assets.loadLut`, which maps each pixel's color after the tone mapping, as three.js's `LUTPass` does. `false` turns it off. It is off by default. |
| `lutIntensity?: number` | The share of the table's color in each pixel, from 0 for none to 1 for all of it, as `LUTPass`'s `intensity`. It is 1 by default. |
| `vignette?: VignetteSettings \| false` | Darkens the picture toward its edges. Settings turn the vignette on, `{}` with the values it had, and `false` turns it off. It is off by default. |
| `outline?: OutlineSettings \| false` | A sharp line around the objects that `setOutlined(true)` marks. Settings turn outlines on, `{}` with the values they had, and `false` turns them off. They are off by default. |

### `ToneMapping`

```ts
type ToneMapping = 'aces' | 'agx' | 'neutral' | 'none';
```

How the engine maps the scene's high dynamic range color to the screen, with three.js's formulas. The curves are three.js's `ACESFilmicToneMapping` (`'aces'`), `AgXToneMapping` (`'agx'`) and `NeutralToneMapping` (`'neutral'`). The value `'none'` clips the exposed color at 1, as `LinearToneMapping` does.

### `VignetteSettings`

Interface `VignetteSettings`.

The vignette's settings. The vignette multiplies each pixel's light by a factor that falls from 1 at the canvas's center toward its edges. It works before the tone mapping, so bright corners darken as dark ones do. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `intensity?: number` | How dark the edges turn: 0 or more, and 1 by default. At 0 nothing changes, and at 1 the edges turn black where the darkening is full. Above 1 they turn black sooner. |
| `size?: number` | How much of the picture the darkening covers: 0 or more, and 1 by default. It scales the distance from the center. From about 1.41 the corners take the full intensity, and higher values darken more of the picture. |
| `falloff?: number` | How fast the light falls from the center: the power of the falloff curve, above 0, and 2 by default. Higher values darken more of the picture, and lower values keep the darkening near the edges. |
| `roundness?: number` | The vignette's shape, from 0 to 1, and 0 by default. At 0 it follows the canvas's shape, an ellipse on a wide canvas. At 1 it is a circle. |

<!-- null3d:api:end -->
