# Gaussian splats for null3D

`@null3d/splats` draws Gaussian splats in a null3D sketch: clouds of soft, colored ellipsoids from
a scan or a training run. It reads SPZ files and glTF models that carry `KHR_gaussian_splatting`,
gives a large cloud detail levels and a budget that follows the quality preset and the GPU path, and
mixes the splats with the scene's meshes by depth.

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { createSplats } from '@null3d/splats';

export default defineSketch(async (ctx) => {
  const camera = ctx.scene.createPerspectiveCamera({ position: [0, 1.5, 4], target: [0, 0, 0] });
  ctx.scene.setActiveCamera(camera);
  const splats = await createSplats(ctx, { url: '/scans/garden.spz' });
  await splats.ready;
  const eye = [0, 0, 0];
  return {
    onUpdate() {
      camera.getPosition(eye);
      splats.update(eye);
    },
  };
});
```

Importing the package also registers the glTF reader, so
`assets.loadGltf('/scans/room.glb')` loads a `KHR_gaussian_splatting` model with no other call.

## Costs and limits

- One draw for the whole cloud. The engine culls the rows and sorts them back to front on its job
  workers, on WebGPU and WebGL2.
- The batch holds the budget's rows, 56 bytes each. The preset draws up to 100,000 splats on Low and
  800,000 on Ultra, half those counts on WebGL2, and the frame-budget governor lowers them again.
- The color is the first spherical-harmonic band's. Higher bands, which change a color with the
  view, are ignored, which the glTF extension allows.
- A glTF model draws its splats in the file's order inside each part; use an SPZ file for a large
  cloud, whose splats the engine sorts one by one.
- Splats cast no shadow and receive none.

## Licence

MIT OR Apache-2.0, the engine's licences. See `LICENSE-MIT` and `LICENSE-APACHE` at the repository
root.
