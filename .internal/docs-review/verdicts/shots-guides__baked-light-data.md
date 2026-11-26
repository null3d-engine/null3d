# Shot and demo-link verdicts: guides/baked-light-data

Reference folder: tests/image/references/chrome-real-gpu/ (in the generated copy).

## Shots

### probe-grid-on-off: KEEP, with a corrected source

- The picture helps. It shows what a probe grid adds: red and green bounce light from the side walls on the floor and spheres, and darker corners. That is the light the "coefficients" paragraph under "A probe grid" talks about.
- The source is wrong. Both views already exist as reference images, so the shot is a "reference" shot, not "scripted":
  - Left (no grid): webgpu/probe-grid-off.png (the test sketch's ?off switch).
  - Right (with grid): webgpu/probe-grid.png.
  - The same pair is in the compat and webgl2 folders.
- The scripted steps would work too (the sketch has a real ?off switch), but there is no need to capture again.
- The images are only 320 x 180. Show them side by side at their own size, or capture again at a larger size through the same sketch.
- Correct the alt and caption. The left side is the room lit by the environment alone, not "diffuse light from the environment" in contrast to the grid. The grid in the picture was baked in the browser by bakeProbes, not loaded from a file. Say so in the caption: "A file from another bake tool gives the same result."
- Suggested alt: "Left: a room lit by its environment alone. Right: the same room with a probe grid; the red and green walls tint the floor and spheres, and the corners darken."
- Extra shot that is worth adding: the validity mask. webgpu/probe-grid-wall-leak.png (every probe valid: light leaks under the partition) beside webgpu/probe-grid-wall.png (mask on: dark contact shadows behind the spheres). Put it after the paragraph on validity. It shows why the optional `validity` member matters.

### directional-light-map: REJECT

- The page named (tests/pages/lightmap-cost.html) is a timing page. It switches the light map by sketch messages ('direction' and 'direction-off'), runs four timed rounds and destroys the engine. It has no query switch for lightMapDirection and saves no picture. The steps "load the page with and without lightMapDirection" cannot be taken as written.
- The scene is not "a normal-mapped wall". It is an orthographic curtain of 24 flat tiles with made-up ridges, a made-up light map of patches and a direction that turns smoothly across each tile. A reader would not see "a bake's light bringing out relief"; they would see an abstract pattern.
- The alt is wrong: the plain side is not flat. The sketch also has a weak sun and the normal map, so the ridges show on both sides.
- If a picture is still wanted, a script must drive the sketch itself: create the engine with tests/pages/sketches/lightmap-cost-sketch.ts, post 'direction-off', wait for the sketch's 'settled' message, capture a frame, then post 'direction', wait for 'settled' and capture again. That is the page's own measureDirectionShare sequence. A purpose-built scene (one brick or stone wall with a real normal map and a bake from one side) would explain the idea much better.

## Demo links

None were proposed. None should be: no demo uses any call on this page (searched examples/ for setLightProbeGrid, bakeProbes, loadLightMap, loadLightProbeGrid, lightProbeGridFile, lightMap and NEEDLE_lightmaps).

## Concepts said to have no demo

All five are confirmed: no demo or comparison shows them.

- probe grid files: confirmed. The bounce-light demo shows bounce light, but it is screen-space and live, not a baked grid. Do not link it as a demo of this page.
- light map files: confirmed.
- directional light maps: confirmed.
- Needle light maps: confirmed. A test reference exists (webgpu/needle-lightmap.png), but it is almost all black with one lit plank, so it does not help a reader.
- bakeProbes and lightProbeGridFile: confirmed. Only the probe grid test sketch calls bakeProbes; nothing calls lightProbeGridFile.
