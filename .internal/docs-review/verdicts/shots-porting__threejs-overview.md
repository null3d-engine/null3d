# Verdicts: porting/threejs-overview (slice porting-shaders)

## Shots

### night-town-two-engines: keep, with changes

- Source is right. Both reference files exist for the webgpu and webgl2 tiers (not compat):
  tests/image/references/chrome-real-gpu/webgpu/compare-night-town-null3d.png and compare-night-town-threejs.png.
  The image manifest makes them from tests/pages/compare.html with the switches compare=night-town and engine=null3d or engine=threejs, at 640x360.
- The two files are separate pictures. The website takes one image per link, so the shot must join them side by side into one file, docs/images/porting/threejs-overview/night-town-two-engines.webp. Or it must be two images.
- Alt text is wrong. The pictures show a whole town block seen from above, not a street. Proposed alt: "The same rainy night town, seen from above, drawn by three.js on the left and by null3D on the right."
- Placement is wrong. "What gets faster" is about CPU time per frame. A still picture shows no speed, and the table there comes from the benchmark scenes, not from this comparison. Put the picture after the first paragraph, which says that a good port looks like the original. The caption must say that each half was written for its own engine, so it is not a line-by-line port.

## Demo links

- compare/battle/ (same scene in both engines, speed gap): keep. The code is in comparisons.ts. The comparison page shows frames per second and CPU time per frame for both engines while the count of soldiers and mechs rises. It is the nearest match to the table's row of 500 animated characters. The link text must not say that the table's numbers come from it.
- compare/factory/ (scene graph trees in both engines): keep. The code is in comparisons.ts. Each robot arm is a tree of seven parts, and the comparison times both engines while the count of moving parts rises. It matches the table's scene graph row.
- compare/night-town/ (many lights in both engines): keep, with changes. The code is in comparisons.ts (listed as "Night effects"), and it times both engines while each block adds 12 lights. But this page says nothing about lights. Link it as a town scene timed in both engines, or say in one clause that it counts lights. It is also the scene of the shot, so a link in the shot's caption can do the job.
- hold-mode/ (frames that repeat for a baseline): drop here. The code exists, and the demo shows the engine's held frames, which are the same on every run. But step 2 of the workflow captures the three.js app, and the engine's hold switch does nothing there. This page never names held frames. The link belongs on porting/verification, which explains hold.

## Concepts said to have no demo

- Two-step port with sketchThread 'main': confirmed. No demo or test page sets that option.
- The porting scanner's inventory: confirmed. It is a script in the agent skill, and no demo runs it.
- Model conversion with the command line tool: confirmed for demos. The image test converted-models (tests/pages/sketches/converted-models-sketch.ts) draws the converter's FBX, OBJ, STL and PLY output, but it is a test page, not a demo, so no demo link can point to it.
