# Shot and demo-link verdicts: shaders/surface-functions

## Shots

### custom-surface: keep, with the source and alt text fixed
- The source type is wrong. The steps say "reuse the test reference", so this is a reference shot. Use `tests/image/references/chrome-real-gpu/webgpu/custom-surface.png` (it exists; compat and webgl2 copies exist too).
- The alt text is wrong. The picture holds twelve objects in two rows, not one sphere. Top row: three standard materials, each beside a surface function that keeps its look (the pairs match). Bottom row: a sphere with glowing stripes (the opening example's WGSL), red and blue spheres that share one ring function, a flat-shaded green one, and two planes colored by the face they show.
- Proposed alt: "Two rows of spheres and planes. The top row pairs three standard materials with surface functions that keep their look. The bottom row shows surface functions that change it: glowing stripes, colored rings and a plane colored by its face."
- Proposed caption: "Top row: each pair must match. Bottom row: surface functions that change the look."

### vertex-offset: keep, with the source and alt text fixed
- The source type is wrong. Use the reference `tests/image/references/chrome-real-gpu/webgpu/custom-vertex-offset.png` (it exists in all three tiers).
- The test sketch uses the exact wave WGSL from the page's "Vertex offsets" section, so the picture matches the text well.
- Proposed alt: "Two planes bent into waves, a sphere swollen in bands, and a twisted torus beside a plain one, all moved by vertex offsets."

### translucency: drop on this page
- The reference file exists and shows leaves and petals lit from behind.
- But the translucency demo makes every leaf, petal and the lantern with `materials.standard` and its diffuse transmission options. It has no surface function. On a page about setting `s.diffuseTransmission` in WGSL, the picture suggests a WGSL example that the demo does not have.
- The section already sends readers to the Materials page for the concept. The picture belongs there.

### coat: keep, with the alt text fixed
- The reference `tests/image/references/chrome-real-gpu/webgpu/demo-coat-and-sheen.png` exists and is the demo's default view.
- `examples/coat-and-sheen/surfaces.ts` has a surface function that sets `s.clearcoat`, `s.clearcoatRoughness` and `s.clearcoatNormal` on the wet cobbles, which is the section's own case.
- The alt text leaves out what fills the picture: a red car on a plinth under rain, before a red curtain.
- Proposed alt: "A red car on a plinth in the rain, over wet cobbles whose puddles shine with a clear coat, beside a velvet cushion with a sheen."

## Demo links

| Concept | Code | Verdict | Why |
| --- | --- | --- | --- |
| Surface input and reflections | `shader-inputs/` | Keep | `examples/shader-inputs/pool.ts` is a slate floor whose surface function reads a reflection pass with `reflection_uv`, as the section shows. The demo's own summary does not name the reflection, so the link text should say "the slate floor in pool.ts". |
| A material's own lobe | `showroom/` | Keep | The showroom car uses the car-paint add-on (`createCarPaint`), whose `examples/addons/car-paint/paint.wgsl` declares `fn lobe` for the metal flakes. Say that the lobe is in the car-paint add-on, or the reader will not find it. `coat-and-sheen/` uses the same paint and its summary names the flakes, so it is an equal choice. |
| Light through thin surfaces | `translucency/` | Drop here | The demo uses standard materials with diffuse transmission options, not a surface function. Link it from the Materials page instead. |
| Clear coat and sheen | `coat-and-sheen/` | Keep | `surfaces.ts` sets the coat per point in WGSL on the wet cobbles, with ripples through `clearcoatNormal`. |
| Wind vertex offsets | `vegetation-wind/` | Keep | The grove's materials come from `examples/lib/sway.ts`, which declares `fn vertexOffset` and fades it by `swayDistance`. |
| swayDistance and castsStill | `forest/` | Keep for swayDistance only | The forest uses the same sway materials, which declare `swayDistance`. No example sets `castsStill`. The impostors add-on sets it on its cards by default (`packages/impostors/src/batch.ts`), so name `impostors/` for `castsStill`. |
| Cards that cast a crown's shape | `impostors/` | Keep | The impostors add-on's `cards.wgsl` declares `fn coverage` and sets `s.shadowOffset`, which is the section's case. The WGSL is in the package, not the example folder. |

## Concepts said to have no demo

| Concept | Has a demo? | Demo |
| --- | --- | --- |
| Unlit surfaces | Yes | `showcase/creek/`: `clouds.ts` declares `fn unlit` for the sea of cloud. `splats/` (no code value) also draws every splat through the splats add-on's `fn unlit`. |
| Occlusion counted once | No (confirmed) | No example or add-on sets `occlusionByMinimum`. |
| The scene's depth | Yes | `showcase/creek/`: `clouds.ts` declares `sceneInputs: ['sceneDepth']`. `water/` also reads it through the water add-on for its soft shores. |
| Water seen from below | Yes | `water/`: the camera dives under the lake, and the water add-on's `water.wgsl` branches on `input.frontFacing`, turns the normal round, clears `s.reflection` and thins `s.thickness`, as the section says. |
| Cut-out shapes | Yes | `vegetation-wind/`: its leaf cards take the sway material's cut-out setting, which sets `s.alpha` from the leaf texture with `alphaMode: 'mask'` and a cutoff. |
