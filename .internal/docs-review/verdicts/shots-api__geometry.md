# Shot and demo-link verdicts: api/geometry

All four reference images exist under tests/image/references/chrome-real-gpu/webgpu/. Each is only 320 x 180 pixels, so they read small on a docs page.

## Shots

- generators: KEEP. demo-generators.png shows all nine shapes. Fix the alt text: the shapes stand in a 3 by 3 grid, not a row. Three of them have a tile texture made in code; the rest are plastic and metal.
- extra-shapes: KEEP. demo-extra-shapes.png shows the knot, the polyhedra, the lathe vase, the extruded star, the tube and a glowing flat heart, reflected in a polished floor at dusk. Add the heart to the alt text.
- mesh-arrays: KEEP, with a new source. The reference shows the smooth island with its vertex colors well. The hard-edged crystal is only about 10 pixels wide, so the reference does not show the "hard edges" point of the section. Corrected source (scripted): open the mesh-arrays demo in a development build with ?hold=1 on a 1280 x 720 canvas, so the crystal's faces can be seen. Otherwise, drop "hard-edged crystal" from the alt text.
- vertex-updates: KEEP. demo-vertex-updates.png clearly shows the rings spreading from the glowing float. The alt text is right.
- lod-levels-view: KEEP, with corrected steps. The engine's levels debug view exists, and the engine reads the ?view switch from the page address. But debug views do nothing in production builds, and the image tests add compile=wait so that the first held frame has the level pipelines. Corrected steps: open the forest demo in a development build with ?hold=2&view=levels&compile=wait (the demo's hold time is 2). The forest sets each tree's four levels by hand (setLevels, through examples/lib/trees.ts), not with the automatic planner. So put the shot under "### Levels by hand", or give it a caption that says the levels are set by hand. Another source is tests/image/references/chrome-real-gpu/webgpu/lod-levels.png: a plainer test picture of copies in their level colors, but it is not a demo.

## Demo links

- Levels of detail -> forest/: KEEP. The code "forest/" exists in examples/demos.ts. The demo shows levels picked per tree, the switch dither and the L key that turns levels off. Its levels are set by hand, so the link fits best in "### Levels by hand". Under "## Levels of detail", it must not suggest that the demo shows the automatic planner.

## Concepts said to have no demo

- integer attributes: CONFIRMED. No demo passes integer vertex arrays. The integer typed arrays in the demos are texture data or indices.
- vertex formats: CONFIRMED. No demo shows it.
- levels by hand: NOT CONFIRMED. The forest demo (forest/) calls setLevels on each tree mesh with measured errors (examples/lib/trees.ts, meshOfLevels). The impostors demo does the same for its pine (examples/impostors/pine.ts).
- destroying a mesh: CONFIRMED. Only the island showcase and add-ons destroy meshes, as cleanup. Nothing on screen shows it.
- large meshes over 65,535 vertices: CONFIRMED. No demo shows a mesh split into parts.
