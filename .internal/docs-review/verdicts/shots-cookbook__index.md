# Shot and demo-link verdicts: cookbook/index

All reference images named below exist under tests/image/references/chrome-real-gpu/webgpu/. They are 320x180 pictures.

## Shots

- picking: KEEP. The file exists and shows the plinth with the red cube outlined. The pointer glow does not show in a held frame, and the HTML labels are not in the canvas capture. Fix the alt: "Six pieces on a plinth in a dark gallery, with the red cube outlined after a click."
- walk-to-click: KEEP, with a corrected source. The image test page takes no timed script, so the skill-sketch page cannot draw it. The CLI shot command can: put the recipe in a project's sketch.ts and run `bunx @null3d/cli shot --gpu webgpu --script walk.txt` at the default 1280x720 size. Script lines: `0.5 pointer down 900 500`, `0.6 pointer up`, `1.1 shot walking`. The click lands near (3.9, 0, 2.8), about 4.8 m away, so the capsule arrives at about 1.7 s. At 2 s the capsule stands on the marker, which has the same radius, and hides most of it. A mid-walk shot shows the capsule, the marker and the gap between them. Fix the alt: "A yellow capsule that walks toward a white marker on a flat ground."
- character: KEEP. The file exists and shows the Knight in the cobbled courtyard. The demo's camera orbits; it does not follow. So say the picture is the demo, not the recipe.
- crowd: KEEP, with exact steps. The cookbook test writes the recipe to tests/test-results/skill-sketches/hold/docs-cookbook-index-a-crowd-of-animated-characters.ts and holds it at 1 s on a 320x180 canvas. For the shot, open `/tests/pages/image.html?gpu=webgpu&hold=2&size=1280x720&sketch=/tests/test-results/skill-sketches/hold/docs-cookbook-index-a-crowd-of-animated-characters.ts` after a test run has written the file. The start times and speeds are random, so each run differs a little.
- morph-flowers: KEEP. The file exists and shows the tulip bed. The tulips' morph targets are made in code, not loaded from a file. The caption must not say "from a model". The only reference of the recipe's own model (gltf-morph-cube.png) is a plain grey wedge, which helps less.
- time-of-day: KEEP. The file shows the lighthouse island at sunset, with the sun on the horizon.
- post-effects: KEEP. The file shows the neon alley with bloom and an outlined crate. The demo also adds a custom effect through the lens kit add-on (post.addEffect), which matches the section.
- security-camera: KEEP. The file shows a monitor with a second camera's grainy view of a yard at night.
- canvas-screen: KEEP. The file is a close view of three glowing readings and a wave line. No console panel is clear at this size. Fix the alt: "In-world screens with three readings and a wave line, painted on a canvas."
- sprites-lines: DROP. The section is a trail that updates every frame. The demo's lines are a static helix and a dash ring, and the picture shows a spark fountain. It would make a reader expect a trail that the picture does not show. The demo link stays.
- galaxy: KEEP. The file shows the spiral galaxy of soft points.
- occlusion-stats: DROP. The `?stats` overlay shows CPU time per thread. It does not count hidden objects; `engine.measure()` reports that as occludedEntries (docs/concepts/culling.md says so). The overlay is HTML, so a held canvas frame does not include it. The two frames are the same picture by design: the crates are behind the wall with culling on or off, and the occlusion tests check that on and off match the same references. The image test page also passes no occlusion or preset option to createEngine. A side-by-side would show two identical walls.

## Demo links

- picking/ (pointer events and outlines): KEEP. The code is in demos.ts. The sketch lights the piece under the pointer and outlines it on a click.
- character/ (1D blend and follow camera): KEEP. The demo blends idle, walk and run by speed (setBlend). Its camera is an orbit camera, not a third-person follow. Label the link for the blend only.
- compare/battle/ (crowd): KEEP. The code is in comparisons.ts. Each soldier is its own copy with its own animator, with clips played at their own times on the job workers. look-at/ (seven Knights, each on its own idle clip) is a smaller example of the same idea.
- gltf-model/ (loading a glTF model): KEEP, and relabel it as a loading-screen example. Its sketch calls reportLoading (examples/lib/progress.ts), which posts 'loading' messages from assets.onProgress, as the recipe does.
- morph-flowers/ (morph weights): KEEP. It calls setMorphWeight on each tulip. Say that its targets are made in code.
- time-of-day/ (sky, sun and fog): KEEP. The name has no code value, so the "<name>/" form is right.
- post-effects/ (bloom and effects): KEEP. It sets bloom and adds a WGSL effect through the lens kit.
- security-camera/ (scene pass to a texture): KEEP.
- canvas-screen/ (OffscreenCanvas textures): KEEP.
- sprites-lines/ (line batches): KEEP as "wide lines and dashes". Do not label it a trail: its lines do not change each frame.
- galaxy/ (point batches): KEEP.

## Concepts said to have no demo

- Walking to a clicked point with layered raycasts: CONFIRMED. No demo calls scene.raycast with a layer mask, or moves to a clicked point. The shared orbit helper (examples/lib/interact.ts) casts rays only to drag the camera.
- Loading screen progress messages: WRONG. gltf-model/ posts download progress through reportLoading. character/, look-at/, environment/ and compare/battle/ use the same helper. splats/ posts chunk counts with a value.
- Occlusion culling with marked occluders: CONFIRMED. No sketch under examples/ uses `occluder`. Only the occlusion test city (tests/pages/sketches/occlusion-sketch.ts) has it, and that is not a demo.
