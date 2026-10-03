---
id: api/post
title: Post-processing API
status: experimental
since: "0.1"
summary: "post.set for tone mapping, exposure and bloom; the other effects and post.addEffect of 0.2."
---

# Post-processing API

> Ships in null3D 0.1, with bloom in 0.2. The API is experimental, so it can still change between versions. Ambient occlusion, color grading, the vignette, outlines and `post.addEffect` are not built yet, so coding agents must not use them.

`ctx.post` holds the settings that the engine applies to the scene's color on its way to the canvas: the tone mapping, the exposure and bloom. [Color management](../concepts/color-management.md) explains how the first two fit into the frame, and [the post-processing chain](../concepts/post-processing.md) how bloom does.

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

## Errors

| Code | Cause |
| --- | --- |
| [E1213](../errors/E1213.md) | A setting that this version does not have, a tone mapping that the engine does not know, a bloom value other than settings or `false`, or a value out of its range: an exposure, strength or threshold below 0, or a radius outside 0 to 1. |
| [E1203](../errors/E1203.md) | A value that is not a finite number, such as NaN. |

## Related pages

- [Color management](../concepts/color-management.md): HDR color, the final pass, the 8-bit path and the background.
- [The post-processing chain](../concepts/post-processing.md): how bloom works, what it costs, and the effects still to come.
- [three.js to null3D mapping](../porting/threejs-mapping.md): `renderer.toneMapping`, `toneMappingExposure` and `UnrealBloomPass`.

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

### `Post`

Class `Post`.

The post-processing settings, as `ctx.post`. The engine applies them to every pixel of the scene, the background included, after lighting and before the canvas shows it.

| Member | Description |
| --- | --- |
| `set(settings: PostSettings): void` | Changes the settings that `settings` gives, from the next frame on. It allocates nothing, so a sketch can change the exposure or bloom every frame. It throws E1213 for a setting or a tone mapping it does not know, or a value out of its range, and E1203 for a value that is not a number. |

### `PostSettings`

Interface `PostSettings`.

Settings for `post.set`. A setting that the call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `toneMapping?: ToneMapping` | How the engine maps high dynamic range color to the screen. The default is `'aces'`. three.js uses no tone mapping by default, so a port of a three.js scene without it sets `'none'`. |
| `exposure?: number` | Scales the scene's color before the tone mapping, as three.js's `toneMappingExposure` does: 2 is one stop brighter, and 0.5 one stop darker. It is 0 or more, and 1 by default. |
| `bloom?: BloomSettings \| false` | Light that spreads from the brightest parts of the scene, as three.js's `UnrealBloomPass` spreads it. Settings turn bloom on, `{}` with the values it had, and `false` turns it off. It is off by default. |

### `ToneMapping`

```ts
type ToneMapping = 'aces' | 'agx' | 'neutral' | 'none';
```

How the engine maps the scene's high dynamic range color to the screen, with three.js's formulas. The curves are three.js's `ACESFilmicToneMapping` (`'aces'`), `AgXToneMapping` (`'agx'`) and `NeutralToneMapping` (`'neutral'`). The value `'none'` clips the exposed color at 1, as `LinearToneMapping` does.

<!-- null3d:api:end -->
