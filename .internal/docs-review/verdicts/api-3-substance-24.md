# Verdict on api-3-substance-24

## The finding as given

- id: api-3-substance-24 (slice api-3, role substance)
- page: api/raycast, api/splats, api/terrain, api/water, api/wind, api/vertex-draws, api/textures, api/scene, api/tasks, api/time
- anchor: Related pages / intro of each page; wind line 326 "The forest demo, `examples/forest`"
- category: missing-content, severity: medium
- claim: These pages have a matching demo but do not link it. api/wind names examples/forest as plain text. Pages that do link demos (render, sound, sprites, ui) show the format.
- evidence: examples/demos.ts: picking (picking/), splats (no code), terrain (terrain/), water (water/), ocean (ocean/), creek (showcase/creek/), vegetation-wind, forest, rain (no code), canvas-screen, multiple-views (no code), reflection-probes, aurora (no code), light-shafts, hold-mode (no code), replay.
- proposedEdit: Add the links listed per page in shotsAndDemos, as https://github.com/null3d-engine/null3d/tree/main/examples/<code>.

Verdict: partly

## Evidence

- No GitHub demo link appears on raycast, splats, terrain, water, wind, vertex-draws, textures, tasks or time (grep for `examples/` and `github.com`; stats.json exampleLinks is empty for these pages). The finding holds for most of them.
- docs/api/wind.md:326 names "The forest demo, `examples/forest`" as plain code text, and line 328 says "as the forest demo's does". This holds.
- docs/api/scene.md is wrong in the list. It already links two demos: the atmosphere demo at line 549 and the time of day demo at line 551 (stats.json lists both links for api/scene). The gap there is narrower: the multiple views, reflection probes, aurora and light shafts demos are not linked. Line 298 names `examples/addons/aurora/` as plain text, which is the add-on folder, not the demo.
- docs/api/tasks.md has no matching demo. No demo calls `runTask` (grep over examples/ finds none). Only add-on code inside packages calls it (packages/splats/src/select.ts, packages/terrain/src/terrain-builder.ts, packages/wind/src/field.ts). A demo link on the tasks page would not show a reader how to call `runTask`, so tasks should drop out of the finding.
- Matching demos confirmed in source: picking/sketch.ts calls raycast; splats/sketch.ts calls createSplats; terrain/sketch.ts calls createTerrain; water/sketch.ts and showcase/creek/sketch.ts call createWater; ocean/ has the ocean; forest/ and vegetation-wind/ call createWind; rain/sketch.ts calls createVertexDraw; canvas-screen/ paints canvas screens through the screens add-on, which calls fromCanvas; hold-mode/sketch.ts uses onFixedUpdate (line 107), which the time page's "Fixed steps" section covers.
- The proposed edit points to a "shotsAndDemos" list that is not part of the finding. The edit must name the links itself.
- Format check: render.md:495, ui.md:129-130 and sound.md:138 use `[The <name> demo](https://github.com/null3d-engine/null3d/tree/main/examples/<code>)` with a short description. Demos with no `code` value use `<name>/` (examples/demos.ts sketchPath).

## Corrected claim

Nine pages (raycast, splats, terrain, water, wind, vertex-draws, textures, time, and scene for some of its sections) have a demo that shows their API but do not link it. api/wind names the forest demo only as plain text. api/scene already links the atmosphere and time of day demos, but not the multiple views, reflection probes, aurora or light shafts demos. api/tasks has no demo that calls its API and needs no link.

## Corrected edit

Add a demo link in the same form as render.md and ui.md, in each page's "Related pages" list or beside the matching section:

- api/raycast: [The picking demo](https://github.com/null3d-engine/null3d/tree/main/examples/picking/)
- api/splats: [The Gaussian splats demo](https://github.com/null3d-engine/null3d/tree/main/examples/splats/)
- api/terrain: [The terrain demo](https://github.com/null3d-engine/null3d/tree/main/examples/terrain/)
- api/water: the water demo (examples/water/), the ocean demo (examples/ocean/, in "The ocean" section) and the creek showcase (examples/showcase/creek/)
- api/wind: turn line 326's `examples/forest` into [the forest demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest/), and add the plants in wind demo (examples/vegetation-wind/)
- api/vertex-draws: [The rain demo](https://github.com/null3d-engine/null3d/tree/main/examples/rain/)
- api/textures: the canvas screens demo (examples/canvas-screen/) in the "Canvases" section
- api/scene: the multiple views demo (examples/multiple-views/), the reflection probes demo (examples/reflection-probes/), the aurora demo (examples/aurora/) at line 298, and the light shafts demo (examples/light-shafts/) where the page covers fog
- api/time: the repeatable frames demo (examples/hold-mode/) in "Fixed steps"
- api/tasks: no change.
