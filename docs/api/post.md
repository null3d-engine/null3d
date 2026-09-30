---
id: api/post
title: Post-processing API
status: experimental
since: "0.1"
summary: "post.set for tone mapping and exposure; the effects and post.addEffect of 0.2."
---

# Post-processing API

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. Bloom, ambient occlusion, color grading, the other `post.set` effects and `post.addEffect` come in null3D 0.2, so coding agents must not use them.

`ctx.post` holds the settings that the engine applies to the scene's color on its way to the canvas. In null3D 0.1 these are the tone mapping and the exposure. [Color management](../concepts/color-management.md) explains how they fit into the frame.

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

## Errors

| Code | Cause |
| --- | --- |
| [E1207](../errors/E1207.md) | A setting that this version does not have, a tone mapping that the engine does not know, or an exposure below 0. |
| [E1203](../errors/E1203.md) | An exposure that is not a finite number, such as NaN. |

## Related pages

- [Color management](../concepts/color-management.md): HDR color, the final pass, the 8-bit path and the background.
- [The post-processing chain](../concepts/post-processing.md): the effects of null3D 0.2.
- [three.js to null3D mapping](../porting/threejs-mapping.md): `renderer.toneMapping` and `toneMappingExposure`.

## API reference

<!-- null3d:api:start -->

### `Post`

Class `Post`.

The post-processing settings, as `ctx.post`. The engine applies them to every pixel of the scene, the background included, after lighting and before the canvas shows it.

| Member | Description |
| --- | --- |
| `set(settings: PostSettings): void` | Changes the settings that `settings` gives, from the next frame on. It allocates nothing, so a sketch can change the exposure every frame. It throws E1207 for a setting or a tone mapping it does not know, or a negative exposure, and E1203 for an exposure that is not a number. |

### `PostSettings`

Interface `PostSettings`.

Settings for `post.set`. A setting that the call leaves out keeps its value.

| Member | Description |
| --- | --- |
| `toneMapping?: ToneMapping` | How the engine maps high dynamic range color to the screen. The default is `'aces'`. three.js uses no tone mapping by default, so a port of a three.js scene without it sets `'none'`. |
| `exposure?: number` | Scales the scene's color before the tone mapping, as three.js's `toneMappingExposure` does: 2 is one stop brighter, and 0.5 one stop darker. It is 0 or more, and 1 by default. |

### `ToneMapping`

```ts
type ToneMapping = 'aces' | 'agx' | 'neutral' | 'none';
```

How the engine maps the scene's high dynamic range color to the screen, with three.js's formulas. The curves are three.js's `ACESFilmicToneMapping` (`'aces'`), `AgXToneMapping` (`'agx'`) and `NeutralToneMapping` (`'neutral'`). The value `'none'` clips the exposed color at 1, as `LinearToneMapping` does.

<!-- null3d:api:end -->
