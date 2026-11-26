# Shot and demo-link verdicts: api/terrain

## Shots

### terrain-demo: keep, but recapture
- The reference file exists: tests/image/references/chrome-real-gpu/webgpu/demo-terrain.png (also compat, webgl2). It is the demo's default view.
- It is only 320 x 180 pixels. That is too small for the top picture of a docs page.
- The demo is lit at golden hour with haze. In the small picture the grass reads brown and the rock is not clear. Only the snow on the far ridge stands out. The alt text "grass, rock and snow" claims more than a reader sees.
- Corrected source (scripted): open the examples page at `?demo=terrain&still` at 1280 x 720 or larger. The page passes `still` on to the sketch, which holds the camera at one point of its circle. Wait until the ground has built its blocks (about 3 seconds, the demo's hold time), then capture.
- Corrected alt: "A hilly valley at golden hour drawn by the terrain add-on, with snow on the far ridge".

### terrain-wireframe: keep, with exact steps
- The wireframe view is real. `?view=wireframe` is an engine page switch, and the examples page passes its switches to the demo.
- The picture shows the main idea of the page: small blocks near the camera, large blocks far away. Nothing else on the page shows this.
- The given steps are vague. Corrected steps: open the examples page at `?demo=terrain&still&view=wireframe` at 1280 x 720, wait about 3 seconds, capture. Without `still` the camera moves on its circle and the blocks keep changing.
- Check the capture before you use it. The view clears to black and draws edges in each material's color. The 900 boulders also show as wireframe. Near the camera, the blocks with 1 m cells can merge into a solid fill. If this happens, use a narrower crop or a lower preset (`&preset=low`) so the block sizes stay readable.
- Better place: next to the paragraph that starts "The ground is a quadtree", the first paragraph under "How it works" that describes the blocks.

### terrain-baked-normals: drop
- The reference exists only for the baked half (tests/image/references/chrome-real-gpu/webgpu/terrain-baked-normals.png, 320 x 180). There is no reference for the mesh-normals half.
- The two halves look almost the same. The shading test (tests/image/terrain-shading.spec.ts) measures the difference: the baked normals move many pixels, but "almost none of that reaches a tenth of full scale". A side-by-side pair would show two near-identical pictures, which does not help the reader.
- The test scene is also not typical. It forces coarse blocks (`coarse=on`, an error of 120 pixels) at the Low preset so the test can see the effect.
- The steps are also wrong as written. The test switch is `normals=vertex` (with `coarse=on` and `preset=low`), not "with and without baked normals" on the image test page.
- The paragraph explains the effect clearly in words. No picture is needed.

## Demo links

### Terrain -> terrain/: keep
- The code `terrain/` exists in examples/demos.ts. The demo uses createTerrain with four layers, the default splat map from height and slope, and `terrain.update` each frame. It shows the page's main ideas.
- Note: the sketch's top comment says the boulders are placed with `terrain.heightAt`. The code places them with its own height function. So the demo does not show `heightAt`.

## Concepts said to have no demo

- steepFaces: a demo shows it. The Island showcase (`showcase/island/`, examples/showcase/island/land.ts) sets `steepFaces: true`. It is a large scene, so link it only as "used in", not as a focused example.
- a custom splat function: a demo shows it. The Island showcase passes its own `splat` function (forest floor, dry ground, rock, sand from height, slope, beach and harbour). Same link: https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/
- heightAt placement: confirmed, no demo. No demo calls the terrain's `heightAt` or `normalAt`. The terrain demo and the Island showcase read their own height functions. The terrain image test page (tests/pages/sketches/terrain-sketch.ts) does call `terrain.heightfield.heightAt`, but that is a test page, not a demo.
