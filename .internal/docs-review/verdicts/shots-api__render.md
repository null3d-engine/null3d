# Shot and demo-link verdicts: api/render (slice api-3)

Reference paths below are relative to the repository root. Every reference image named here exists in the webgpu tier, and is 320 by 180 pixels. That is small for a docs page, so the website may want to scale it with care or capture it again at a larger size.

## Shots

### security-camera: keep
- Source is right: `tests/image/references/chrome-real-gpu/webgpu/demo-security-camera.png` exists (also in compat and webgl2).
- The picture shows the monitor on the wall with the camera's black-and-white view of the yard, and the camera on its pole above. It shows a scene pass's texture on a material, which is what "Scene passes" explains.

### reflection-mirror: keep, with a corrected source and alt text
- The proposal says "scripted", but a reference already exists: `tests/image/references/chrome-real-gpu/webgpu/reflection-mirror.png` (also in compat and webgl2). It is the default view of the reflection test sketch, with no query.
- The alt text is wrong. The floor is not dark: it mirrors a bright sky. The picture shows a red box, a green box, a blue ball and a yellow post, each mirrored upside down in the floor.
- Corrected alt: "A red box, a green box, a blue ball and a yellow post mirrored in a polished floor under a blue sky".
- It matches the page's own mirror-floor example well (a red box on a mirror floor under the sky).

### fullscreen-glow: keep, with a corrected source
- The source is wrong. The default full-screen test view ("fullscreen-passes") shows a posterized scene-pass texture and a painted texture, not a glow. The glow is the separate "fullscreen-glow" test (the same sketch with `?glow`).
- A reference exists: `tests/image/references/chrome-real-gpu/webgpu/fullscreen-glow.png` (also in compat and webgl2). It shows a white ball with a warm glow and four colored boxes on a grey floor.
- Corrected alt: "A white ball with a warm orange glow around it, among colored boxes on a grey floor".
- It matches the page's glow example exactly: the outline mask blurred at half size and added by an effect.

### compute-waves: drop
- The source and alt text are both wrong. The compute-pass test does not draw a red wave pattern. Its reference, `tests/image/references/chrome-real-gpu/webgpu/compute-pass.png` (webgpu and webgl2 only), shows four flat colored quadrants.
- Four flat quadrants teach a reader nothing about compute passes, so the picture does not help. The ocean shot covers this section better.

### ocean-compute: keep, with a corrected alt text and a caption
- Source is right: `tests/image/references/chrome-real-gpu/webgpu/demo-ocean.png` exists in all three tiers.
- At this size no foam shows on the crests. Corrected alt: "An open sea with long swells under a cloudy evening sky".
- The picture alone cannot show that compute passes made the waves. Give it a caption that says so: the water add-on fills the sea's heights with compute passes every frame.

### dump-graph: drop
- "Manual" is only for the browser's own developer tools. A Graphviz viewer is not one.
- No demo calls `render.dumpGraph()`, so nobody can make the picture again without changing the security camera demo's code.
- The graph covers all of the engine's passes as well as the sketch's own. At docs width it would be a dense, hard-to-read picture.

## Demo links

### Scene passes -> security-camera/: drop (already there)
- The code exists in examples/demos.ts, and the sketch calls `render.addPass({ kind: 'scene', ... })` directly.
- But "Related pages" already links this demo. The proposal adds nothing. If the link should move, put it under "Scene passes" and remove the one in "Related pages".

### Compute passes -> ocean/: keep, with a note
- The code exists, and the demo's compute passes are real. But the sketch does not call `render.addPass` itself. The water add-on (packages/water/src/ocean.ts) adds the compute passes.
- No demo's sketch adds a compute pass directly, so ocean is the best choice. The link text should say that the water add-on adds the passes.

### Reflection passes -> water/: drop, replace with mesh-arrays/
- The code exists, and the water demo does use a reflection pass. But the add-on adds it (packages/water/src/water.ts), so the demo's sketch has no `render.addPass({ kind: 'reflection' })` and no `reflection_uv`.
- Better link: `mesh-arrays/`. Its sketch adds the reflection pass itself and reads it with `reflection_uv`, with an offset from small waves. That is the "offset that bends the reflection" which the section explains. Another good choice is `environment/`: a polished floor, close to the page's own example.

## Concepts said to have no demo

- Passes with history: wrong, a demo shows it. In `vegetation-wind/`, the wind add-on adds a compute pass with `history: true` that steps the air field (packages/wind/src/wind.ts). It runs on WebGPU, and on WebGL2 devices with float targets.
- render.readPass: right. No demo or add-on calls it.
- A pass that fills instance buffers: wrong, a demo shows it. In `vegetation-wind/`, the grass add-on gives a compute pass `buffers: [draw.counts, draw.instances]` for each blade shape, on WebGPU (packages/grass/src/grass.ts).
