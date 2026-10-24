# three.js looks for null3D

`@null3d/three-compat` gives null3D the looks that a port of a three.js scene asks for. The engine
keeps them out of its core. They are Reinhard's and Cineon's tone curves, and the soft outline of
three.js's `OutlinePass`, with its glow, its pulse and its blurred edge.

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { cineon, createOutlinePass } from '@null3d/three-compat';

export default defineSketch((ctx) => {
  ctx.post.set({ toneMapping: cineon });
  const outline = createOutlinePass(ctx, { color: '#ffd060', glow: 1, pulsePeriod: 1.5 });
  const hero = ctx.scene.createMesh({
    mesh: ctx.geometry.box(),
    material: ctx.materials.standard({ color: '#808080' }),
  });
  hero.setOutlined(true);
  outline.set({ strength: 5 }); // From the next frame on.
  return {};
});
```

A tone curve goes to `post.set({ toneMapping })` where the three.js scene sets
`renderer.toneMapping`. The curves take the exposed color, as the engine's own curves do, so leave
out the exposure that three.js multiplies in.

The outline draws around the meshes that `setOutlined(true)` marks, and the core draws the mask that
it reads. The add-on turns the mask's edge into three.js's soft edge, with the `OutlinePass` settings
`color`, `hiddenColor`, `strength`, `thickness`, `glow` and `pulsePeriod`. The core's crisp line is
off; a scene that also wants it sets `post.set({ outline: { width } })` after the call.

## Costs and limits

- The outline costs five full-screen passes. The edge draws at half the render size, two blurs
  soften it at the same size, and two wider blurs at a quarter of the size make the glow. Together
  they shade about 0.88 of the canvas's pixels and read about nine texels for each screen pixel.
  The effect that adds them reads two more. The core also draws the outlined meshes twice more,
  into the mask.
- `thickness` widens the blur, not the number of reads, because the kernel keeps four taps each way.
- `pulsePeriod` costs nothing beyond a cosine in the effect. The edge fades to a quarter of its
  strength and back over the period.
- The edges join the scene's color before bloom and the tone curve, as three.js's `OutlinePass` adds
  them before its output pass. A bright edge can bloom.
- The edge color is one color for every outlined mesh, as three.js's `OutlinePass` has one style for
  its selected objects. The `patternTexture` option of three.js's pass has no setting.
- The add-on draws the outline's mask at half the render size, where three.js reads the full-size
  mask in its overlay. A pixel at a soft edge can therefore differ by up to one texel.
- The add-on works on WebGPU and WebGL2, in every thread mode.

## Licence

MIT OR Apache-2.0, the engine's licences. See `LICENSE-MIT` and `LICENSE-APACHE` at the repository
root. The ported three.js code and its notice are in `THIRD-PARTY-NOTICES.txt`.
