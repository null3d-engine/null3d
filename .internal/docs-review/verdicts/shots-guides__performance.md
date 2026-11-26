# Shots and demo links: guides/performance

## Shots

### stats-overlay: KEEP, with corrected steps
The picture helps the "Measure" section: it shows what `?stats` gives, which the text only lists. The instances demo is a good scene for it, with 100,000 columns that upload every frame.
The steps need two fixes:
- The examples page reads address switches only in a development build. A production build passes its own collapsed overlay and ignores `?stats=open`. So capture from the dev server (`bun run dev`), at `examples/index.html?demo=instances&stats=open`.
- The examples page does not expose the engine, so a script cannot wait on `engine.presetChecked`. Wait for the first frame, then about 5 s of play, so the preset check ends and the figures settle. Do not use hold mode: a held frame never shows the overlay.
Caption should say the figures are from one machine.
Corrected steps: Run the dev server. Open examples/index.html?demo=instances&stats=open in Chrome with WebGPU. Wait for the first frame plus about 5 s of play (no hold mode). Capture the canvas with the open stats card.

### overdraw-view: KEEP, but the source is "reference", not "scripted"
The image test `debug-view-overdraw` already has reference images on all three tiers. Use tests/image/references/chrome-real-gpu/webgpu/debug-view-overdraw.png. It shows the small test scene (box, sphere, torus, a see-through box, five cubes) with the overlap brighter under the see-through box. The picture is small (320 x 180) and dim, so the difference is subtle. It still matches the one sentence under "The depth prepass". Low value; keep only if the page keeps the overdraw sentence.

### devtools-threads: KEEP, conditional
Manual is the right source: it is the browser's own Performance panel. The engine names its workers `null3d-sketch`, `null3d-render` and `null3d-job-<n>`, so the tracks are readable in Chrome. But the page never tells the reader to use the Performance panel, and the Mermaid diagram already shows the same three threads. Keep only if the section gets one sentence that says to record a trace and names those tracks. Otherwise drop it. The picture also ages with each Chrome release.

### large-world-cells: REJECT
The reference file exists (webgpu/demo-large-world.png), but the picture shows a road with trees at golden hour. Nothing in it shows grid cells or culling. The "Large worlds" section is about skipping still objects of cells out of view. The demo's own subject is large-world mode, which keeps positions precise 6,378 km from the origin. That is a different feature, so the caption would mislead a reader. The road is also only 4 km long, about 4 cells. No reference image shows cells; a useful picture would need a debug drawing of cell bounds, which no demo has.

## Demo links

- instances/ (Moving objects cost uploads): KEEP. One dynamic batch of 100,000 columns whose heights change every frame, so it uploads every row each frame. The cars move in the vertex shader and upload nothing. Both sides of the section show.
- large-world/ (Large worlds): KEEP, weak. Its static instance batches spread over about 4 cells, so cell culling runs. But its summary talks about precision and large-world mode, not culling. Link text should say "static batches across several grid cells", not imply the demo is about culling cost.
- area-lights/ (Point and spot lights): KEEP. Rectangle and tube lights; the area-light paragraph sits in that section.
- compare/night-town/ (Point and spot lights): KEEP. Each block adds 12 point and spot lights, beside three.js.
- compare/battle/ (Crowds and large scenes): KEEP. Two armies of skinned soldiers and mechs, each with its own animator.
- character/ (Crowds and large scenes): REJECT. One knight in a courtyard. It shows no crowd cost, no update interval and no instanced copies. compare/battle/ covers the concept.
- compare/factory/ (Objects during play): KEEP. Strong fit. Its sketch keeps fingers and crates static, makes turning joints dynamic, and places a held crate by the wrist's world transform instead of reparenting it, because reparenting would rebuild the draw tables.
- weighted-transparency/ (See-through objects): REJECT. The demo shows weighted (order-independent) blending against sorted blending that pops. The section covers the cost of sorted blended draws, double-sided blending and forceSinglePass, and never mentions weighted blending. The link sends the reader to a technique the section does not explain. Keep it only if the section gets a sentence on weighted blending's cost.
- post-effects/ (Post effects and scene passes): KEEP. Bloom, ambient occlusion, outline and the other effects that the section prices.
- security-camera/ (Post effects and scene passes): KEEP. A scene pass draws a camera view into a texture. It sets no cadence with render.setPassEvery, so the link shows the pass, not the "draw less often" advice.

## Concepts said to have no demo

- The S1 to S6 benchmark scenes: CONFIRMED. They are benchmark scenes, not entries in examples/demos.ts or the comparisons.
- Software occlusion culling on WebGL2: CONFIRMED. No demo calls setOccluder, sets occluder or turns on softwareOcclusion.
- The memory peak: CONFIRMED. No demo reads the memory figure; only the stats overlay shows it.
- Per-frame code that allocates nothing: PARTLY WRONG. vertex-updates/ rewrites arrays it already has each frame and hands them to mesh.updateVertices, which allocates nothing. But its inner loop calls Math.hypot per vertex, which this page says is slower in hot code. Link it only after that call is replaced; until then a link would contradict the page.
- Rust tasks through runTask: CONFIRMED. No demo calls runTask.
