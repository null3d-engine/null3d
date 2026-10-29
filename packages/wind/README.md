# Wind for null3D

`@null3d/wind` makes the air in a null3D scene. One field moves every plant, flag and smoke card
that reads it. A gust that crosses a field therefore reaches all of them together. The air is a
rule of place and time. A steady wind slows near the ground. A gust travels through it. Swirls turn
without piling up.

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { createWind } from '@null3d/wind';

export default defineSketch((ctx) => {
  const { scene } = ctx;
  const camera = scene.createPerspectiveCamera({ position: [0, 6, 18], target: [0, 1, 0] });
  scene.setActiveCamera(camera);

  const wind = createWind(ctx, { camera, box: 128, grid: 64 });
  wind.setBase(4, 0.4);

  const leaf = ctx.materials.shader({
    wgsl: leafShader,
    textures: { wind: wind.field.texture },
    uniforms: {
      origin: wind.field.origin,
      size: wind.field.size,
      base: wind.field.air.base,
      gust: wind.field.air.gust,
      swirl: wind.field.air.swirl,
    },
  });

  let nextGust = 0;
  return {
    onUpdate() {
      // A gust every four seconds, sent where the air enters the scene.
      if (ctx.time.now > nextGust) {
        wind.gust([-40, 6], 6);
        nextGust = ctx.time.now + 4;
      }
      wind.update();
    },
  };
});
```

Call `update` once in each frame. The add-on's calls allocate nothing; a sketch that pushes every frame keeps one two-number array for the place.

## The field

The field is one `rgba16float` texture over a box of ground that follows the camera. Its red and
blue channels hold the wind across the ground. Its green channel holds the wind's rise, which is
zero while the field is flat. Its alpha holds how fast the air moves there.

A reader samples it with one texture read at each vertex. The shader build resolves only the
engine's library, so a reader's WGSL holds copies of two blocks: the steady field and the sampling
function. They are in `shaders/field.wgsl` and on the `api/wind` docs page. A test keeps those two
copies equal to the page's own copy.

`sample(x, y, z, out)` gives the same air on the CPU, from the same rule, for a page's own motion.

## Costs and limits

- The pass fills one texture of `grid` by `grid` texels in each frame, and a reader spends one
  texture slot on it.
- The field carries no state between frames. A gust therefore does not spread by itself, and a
  wake lasts only as long as the pushes that made it.
- A device without float render targets keeps no grid. There `field.size` is zero, so a reader
  works the air out from the steady field and a plant still moves.
- A place outside the box reads the steady field at its own place, at the height that the texture
  holds. So the air carries on past the box, instead of holding the box's edge.

`@null3d/wind` owns the wind. A scene makes its air with it, not with a hand-written field of its
own, so there is one wind for every reader.
