---
id: api/post
title: Post-processing API
status: experimental
since: "0.1"
summary: "post.set for tone mapping, exposure, bloom, outlines, color grading tables and the vignette; the other effects and post.addEffect of 0.2."
---

# Post-processing API

> Ships in null3D 0.1, with bloom, outlines, color grading and the vignette in 0.2. The API is experimental, so it can still change between versions. Ambient occlusion and `post.addEffect` are not built yet, so coding agents must not use them.

`ctx.post` holds the settings that the engine applies to the scene's color on its way to the canvas. They are the tone mapping, the exposure, bloom, outlines, a color grading table and the vignette. [Color management](../concepts/color-management.md) explains how the first two fit into the frame, and [the post-processing chain](../concepts/post-processing.md) how bloom does.

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

- The curves use three.js's formulas: `'aces'` for `ACESFilmicToneMapping`, `'agx'` for `AgXToneMapping` and `'neutral'` for `NeutralToneMapping`.
- `'none'` scales the color by the exposure and clips it at white, as three.js's `LinearToneMapping` does.
- three.js uses no tone mapping by default. A port of a three.js scene without tone mapping sets `toneMapping: 'none'`.
- The settings apply to the whole scene, the background included, from the next frame on. A setting that a call leaves out keeps its value.

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
- In WebGPU's compatibility mode with MSAA, turning bloom on moves the engine to HDR color with FXAA. On a WebGL2 device with no float target, bloom stays off. [The post-processing chain](../concepts/post-processing.md#effects-on-devices-without-hdr-color) explains both.
- `post.set` allocates nothing, so a sketch can change bloom's settings every frame.

## Outlines

Outlines draw edges around the meshes that `setOutlined(true)` marks, with the meanings of three.js's `OutlinePass`. They are off by default.

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, post }) => {
  post.set({ outline: { color: '#ffcc00', thickness: 2 } });
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
| `outline.color` | The color of the edges around the parts that nothing hides, as `visibleEdgeColor`. | White |
| `outline.hiddenColor` | The color of the edges around the parts that other objects hide, as `hiddenEdgeColor`, or `false` for no edges there. | Dark brown, `[0.1, 0.04, 0.02]` |
| `outline.strength` | How bright the edges are, as `edgeStrength`: a number from 0 up. | 3 |
| `outline.thickness` | How far the edges spread, as `edgeThickness`: the radius of their blur in pixels at half the render size, from 0 up. | 1 |
| `outline.glow` | How much of a wide, soft glow joins the edges, as `edgeGlow`: a number from 0 up. | 0 |

- `mesh.setOutlined(true)` marks a mesh, and `setOutlined(false)` clears it. A model's copy from `scene.instantiate` has `setOutlined` too, which marks each of its meshes. Instance batches take no outline.
- One outline style covers every outlined mesh. three.js needs one `OutlinePass` for each style, and null3D draws one.
- The edges add light before the tone mapping, as three.js's overlay adds it before its `OutputPass`. Bright edges on a bright scene can reach white.
- The outline covers the mesh's whole shape. It ignores the holes that an alpha cutoff cuts, and the vertices that a custom material moves.
- A setting that a call leaves out keeps its value, also while outlines are off. `post.set` allocates nothing, so a sketch can change `glow` every frame. That gives a pulse, as three.js's `pulsePeriod` does.
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
| [E1213](../errors/E1213.md) | A setting that this version does not have, a tone mapping that the engine does not know, a bloom, outline or vignette value other than settings or `false`, a `lut` that is not a table from `assets.loadLut`, or a value out of its range: an exposure, strength, threshold, thickness, glow, offset or darkness below 0, or a radius or `lutIntensity` outside 0 to 1. |
| [E1203](../errors/E1203.md) | A value that is not a finite number, such as NaN. |
| [E1204](../errors/E1204.md) | An outline color that is not a hex string, a hex number or three linear components from 0 to 1. |
| [E1101](../errors/E1101.md) | A table whose `destroy()` was called. |

## Related pages

- [Color management](../concepts/color-management.md): HDR color, the final pass, the 8-bit path and the background.
- [The post-processing chain](../concepts/post-processing.md): how bloom and outlines work, what they cost, and the effects still to come.
- [three.js to null3D mapping](../porting/threejs-mapping.md): `renderer.toneMapping`, `toneMappingExposure`, `UnrealBloomPass`, `OutlinePass`, `LUTPass` and `VignetteShader`.
- [Objects and transforms](objects.md#mesh-calls): `setOutlined`.
- [Assets](assets.md): `assets.loadLut`, which loads color grading tables.

## API reference

<!-- null3d:api:start -->

### `BloomSettings`

Interface `BloomSettings`.

Bloom's settings, with the meanings of three.js's `UnrealBloomPass`. A setting that a call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `strength?: number` | How bright the glow is: 0 or more, and 1 by default. |
| `radius?: number` | How far the glow spreads, from 0 to 1: higher values move its light from the narrow levels of its blur to the wide ones. It is 0.5 by default. |
| `threshold?: number` | The luminance from which a pixel glows, in linear color before the exposure: 0 or more, and 1 by default. At 1, only colors brighter than white glow, such as strong emissive light. |

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
| `exposure?: number` | Scales the scene's color before the tone mapping, as three.js's `toneMappingExposure` does: 2 is one stop brighter, and 0.5 one stop darker. It is 0 or more, and 1 by default. |
| `bloom?: BloomSettings \| false` | Light that spreads from the brightest parts of the scene, as three.js's `UnrealBloomPass` spreads it. Settings turn bloom on, `{}` with the values it had, and `false` turns it off. It is off by default. |
| `lut?: Lut \| false` | A color grading table from `assets.loadLut`, which maps each pixel's color after the tone mapping, as three.js's `LUTPass` does. `false` turns it off. It is off by default. |
| `lutIntensity?: number` | The share of the table's color in each pixel, from 0 for none to 1 for all of it, as `LUTPass`'s `intensity`. It is 1 by default. |
| `vignette?: VignetteSettings \| false` | Darkens the picture toward its edges, as three.js's `VignetteShader` does. Settings turn the vignette on, `{}` with the values it had, and `false` turns it off. It is off by default. |
| `outline?: OutlineSettings \| false` | A sharp line around the objects that `setOutlined(true)` marks. Settings turn outlines on, `{}` with the values they had, and `false` turns them off. They are off by default. |

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
