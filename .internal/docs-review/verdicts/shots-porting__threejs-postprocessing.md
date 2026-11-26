# Shots and demo links: porting/threejs-postprocessing

## Shots

### tone-curves: KEEP, with a corrected source
- The picture helps. It shows why a port of a scene without tone mapping must set `toneMapping: 'none'`: the default `agx-punchy` tiles look darker and more saturated than `none`.
- All seven files exist under `tests/image/references/chrome-real-gpu/webgpu/`: tone-none, tone-aces, tone-agx, tone-agx-punchy, tone-neutral, tone-reinhard, tone-cineon (.png). The test page sets reinhard and cineon from `@null3d/three-compat`, as the page says.
- Source correction: this is a strip of existing reference images, not a scripted capture. Source = reference, the seven paths above, tiled with captions. Nothing has to run.
- Placement: put it in "Delete the composer", beside the paragraph about the default tone curve. The point it proves is made there.

### post-effects: KEEP
- `tests/image/references/chrome-real-gpu/webgpu/demo-post-effects.png` exists and shows the neon alley: crates, an outlined crate, reflections in the wet floor, bloom.
- The sketch sets bloom, ao, outline, dof and ssr through `post.set`, which are the rows of the table. The picture shows what the built-in chain draws with no composer.
- Nit: it fits better at the top of "Passes that become settings" than under "Delete the composer". The demo also runs the lens kit (fringes, streak, grain), so the alt text should not claim the picture shows only built-in settings.

### rgb-shift: REJECT, replace
- The steps cannot run. The post-effects demo has no switch that adds an effect. "Add the page's rgbShift effect" means editing the demo's code.
- The demo already splits red from blue toward the edges (lens kit `aberration: 2`). An added shift would not show as a new thing.
- The amount 0.004 is not the page's 0.0015.
- Replacement: a before/after pair of existing references from the custom-effects test page (`tests/pages/sketches/effects-sketch.ts`):
  `tests/image/references/chrome-real-gpu/webgpu/effects-off.png` and `.../webgpu/effects.png`.
  With `?effects` the page adds a red/blue split that reads the pixels beside each pixel (3 px, the same shape as the RGBShiftShader port) and the page's exact depth fog (`#b0c4d8`, density 0.04). Caption both effects. The fog changes the image the most, so the pair fits best under "Example: fog from the depth", or under "Port a ShaderPass to a custom effect" with a caption that names both effects.

## Demo links

- post-effects/ (Passes that become settings): KEEP. Code exists. The sketch sets bloom, ao, outline, dof and ssr.
- auto-exposure/ (AdaptiveToneMappingPass): KEEP. Code exists. The sketch sets `autoExposure` with `speedUp` and `speedDown`, and E turns adaptation on and off. It does not use `metering: 'mean'` or `compensation`.
- light-shafts/ (GodRaysEffect as lit fog): KEEP. Code exists. The sketch calls `scene.setFog` with `volumetric: { intensity, anisotropy }`, as the row says.
- wet-street/ (SSRPass): KEEP. Code exists. The sketch sets `ssr: { maxDistance, thickness }` and turns on `ssrScale`.
- camera-lens/ (BokehPass): KEEP. The demo has no code value, so `camera-lens/` (name/) is the right form, and the folder exists. The sketch sets `dof` with `aperture` and `maxBlur`, racks `focusPoint` and calls `camera.setFocalLength`: the two things the BokehPass row names.
- compare/battle/ (a custom effect in both engines): KEEP, with a note. The code exists in comparisons.ts. null3D adds the lens grade with `post.addEffect`, and three.js runs the same grade as a `ShaderPass` before `UnrealBloomPass` (WebGL) or a TSL node (WebGPU). But the effect's code lives in `examples/lib/lens.ts` and `examples/lib/lens-three.ts`, which the battle sketches import. The link text should say the battle comparison imports its lens effect from the shared lens module, so a reader can find it.

## Concepts said to have no demo

- Fog from the depth effect: CONFIRMED. No demo calls `effectDistance` or `effectDepth`. Only the test page `tests/pages/sketches/effects-sketch.ts` runs this exact effect (reference effects.png).
- Chain of full-screen passes with their own targets: CONFIRMED. No demo calls `render.addPass` with `kind: 'fullscreen'`; the demos use only scene and reflection passes.
- Custom tone curve in WGSL: NOT CONFIRMED. The creek showcase (`showcase/creek/`) sets `post.set({ toneMapping: TONE_CURVE })` in `look.ts`, with a WGSL `fn toneCurve`. Link https://github.com/null3d-engine/null3d/tree/main/examples/showcase/creek/ under "Port a tone mapping". The code is a large showcase, so say the curve is in its look module.
- reinhard and cineon from @null3d/three-compat: CONFIRMED. No demo imports `@null3d/three-compat`; only the tone mapping test page does.
