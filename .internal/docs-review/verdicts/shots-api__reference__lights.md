# Shot and demo-link verdicts: api/reference/lights

## Shot `light-kinds`: keep, with a corrected source

- The four pictures exist in all three tiers (webgpu, compat, webgl2): `lights-rect.png`, `lights-tube.png`, `lights-spot.png` and `lights-hemisphere.png` under `tests/image/references/chrome-real-gpu/<tier>/`. All four come from one test sketch (`tests/pages/sketches/lights-sketch.ts`, `?scene=rect|tube|spot|hemisphere`) with the same floor, shapes and camera, so a row of four compares like with like.
- The source type is wrong. Nothing needs to be scripted: the step only joins four existing reference files. It is a "reference" shot made from four files.
- The named source file `packages/engine/src/scene/lights.ts` does not exist. The light classes' doc comments live in `packages/engine/src/scene/scene.ts` (18 exports tagged `@category api/lights`) and `packages/engine/src/scene/light-images.ts` (`LightImagePixels`).
- The hemisphere picture has a column of solid black shapes on the right. They are fully metal (the fifth column of the bench scene in `bench/scenes/lights.ts`) and have nothing to reflect under a hemisphere light alone. A reader will take them for a bug. Crop that column out of all four panels, or say so in the caption.
- The pictures are small (480 x 270) and dark. Rectangle and tube lights do not show their own shape in the picture; only the light pools show. The labels must name the light kind.
- Placement: this page is generated from doc comments by `tools/gen-docs.ts` and `tools/lib/docs.ts`, and no reference page carries a picture today. The hand-written page `docs/api/lights.md` ("Kinds of light" section) is the better home. Put it on this page only if the generator gains a way to emit it.

## Demo links

- `area-lights/` at `RectAreaLight`: keep. The code exists in `examples/demos.ts`. The sketch makes three window rectangle lights with pictures, a strip rectangle light, a sign rectangle light with a picture, and a tube light (`examples/area-lights/sketch.ts`). It shows both `RectAreaLight` and `TubeLight`; a second link under `TubeLight` would also be fair.
- `spot-cookies/` at `SpotLight`: keep. The code exists. The sketch gives two spot lights a picture through the `map` option: one as pixels (a 512 rose window) and one as an engine texture. It never calls `setMap`, so the concept is "spot light maps" (the `map` option and `setMap`), not the method alone.
- `hero-shadow/` at `DirectionalShadowOptions`: keep. The code exists. The sketch sets `cascades`, the `hero` option through `setShadow`, and `heroTileSize` through `?heroTile=`, and turns the hero tile off and on every few seconds. It shows the `hero` and `heroTileSize` members best; "DirectionalLight shadows" is broader than what it shows.
- Each link on this generated page must come from the doc comments in `packages/engine/src/scene/scene.ts`, not a hand edit of the page.

## Concepts said to have no demo

- "AmbientLight alone": confirmed. Many demos create an ambient light as a faint fill (for example `spot-cookies/`), but none lights a scene with it alone. No demo is needed: such a scene is flat by design.
- "LightImagePixels": disproved. `area-lights/` passes `{ width, height, data }` pixel pictures to rectangle lights through `image`, and `spot-cookies/` passes a 512-pixel rose window to a spot light through `map`. Link `area-lights/` under `LightImagePixels`.
