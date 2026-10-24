# Aurora

An example add-on that draws an aurora over the scene's sky. It is the first user of the sky-layer
hook (H8, D-173 ruling 2): its WGSL declares `fn skyLayer(input: SkyLayerInput) -> SkyLayer`, which
`scene.setSkyLayer` blends over the background, under every object, on WebGPU, WebGL2 and in
compatibility mode.

The aurora hangs from a height that wanders with the engine's fractal noise, so its curtains fold
and drift as the sketch time grows, and it fades out toward its crown. The core sky still draws the
sun, the moon, the stars and its flat clouds, and the sky's cloud coverage hides the aurora where it
hides the stars.

## Use

```ts
import { createAurora } from '../../addons/aurora/index';

scene.setBackground({ sky });
const aurora = createAurora(ctx, { opacity: 0.9, sun: 0.15 });
// Later, fade it in:
aurora.set({ opacity: 1 });
```

- `createAurora(ctx, options)` installs the layer and returns it. `options.opacity` and
  `options.sun` start at 1 and 0.15.
- `set({ opacity, sun })` changes the layer's values from the next frame on, without rebuilding
  anything.
- `remove()` takes the layer away and gives the core sky its full sun back.

The layer reads what the template gives it, and needs no values of its own:

| `SkyLayerInput` | What it holds |
| --- | --- |
| `direction` | The fragment's view ray in the world, from the camera |
| `clouds` | The core sky's cloud coverage, density, elevation and scale |
| `time` | The sketch time in seconds, from the frame's clock |
| `sun` | The share of the sun that the layer hides, from 0 to 1 |

A sky layer declares no uniforms, textures or bindings: the engine binds the frame and the layer's
values, and the template owns the vertex stage, the depth state and the blend. To change how the
aurora looks, change the constants in `aurora.wgsl`.

## Costs and limits

- One draw of 36 vertices over the pixels that no object covers, right after the background, so it
  costs about what the sky behind it costs. It shades no pixel that an object covers.
- The layer draws in the camera's view, in scene passes and in reflections. It draws nothing in a
  debug view, which draws no background.
- The aurora is a flat layer in the sky, not a volume: it has no parallax and no depth of its own. A
  camera that flies through it passes under it.
- The sky's environment map and its light come from the core sky alone. The aurora lights nothing,
  and a scene that the aurora should light needs a light of its own.

## Licence

MIT OR Apache-2.0, the engine's licences. See `LICENSE-MIT` and `LICENSE-APACHE` at the repository
root.
