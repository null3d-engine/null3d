# Shot and demo-link verdicts: guides/assets-pipeline

Paths are relative to the generated copy of the repository.

## Shots

### boombox-optimized: keep, fix the alt text
- The reference exists: tests/image/references/chrome-real-gpu/webgpu/demo-gltf-model.png (also compat and webgl2). It shows the BoomBox on the turntable.
- The alt text is false. examples/gltf-model/sketch.ts loads the source file sources/khronos/BoomBox/glTF-Binary/BoomBox.glb, not an optimized one. The demo has no switch to load another file.
- Corrected alt: "The Khronos BoomBox from the example output, on a turntable in the glTF models demo." The caption must not say the picture shows the optimized file.
- Low value: it only shows which model the example output describes. The reference is 320 x 180, small for a docs page.

### lod-levels-view: keep, fix the steps and the caption
- The forest sketch has no view switch of its own. The levels view is an engine page switch (packages/engine/src/page/switches.ts reads ?view=; debug.ts documents 'levels'). It draws only in development builds.
- The image tests already run each demo with page switches (tests/image/manifest.ts, the DEMOS.map entry), and lod-levels uses switches ['view=levels', 'compile=wait'].
- Corrected steps: run the forest demo as its image test does (hold 2, development build) with the switches view=levels and compile=wait, and capture.
- Caveat: the forest's trees are made in code with four levels each (examples/forest/woods.ts). The `--lod` command did not make them. The caption must say the view colors each copy's level, and must not say the tool made these levels.

### roughness-bake-side-by-side: reject
- The steps cannot run. examples/gltf-model/sketch.ts loads one fixed file and has no switch for another file or for a camera pose. No test page loads an optimized BoomBox with and without the bake.
- The effect is flicker as the camera moves. A still picture cannot show flicker, and at a far pose the model covers few pixels, so the two halves would look almost the same.
- The section's diagram already explains the bake. A real picture would need a new test page.

### environment-map: keep, fix the alt text
- The reference exists: tests/image/references/chrome-real-gpu/webgpu/demo-environment.png (also compat and webgl2). The default view shows the Venice sunset, the same venice_sunset_2k.hdr that the page's command example uses.
- The demo loads the HDR file with assets.loadEnvironment, which filters it at load. The page says this gives the same map as `assets env`, so the picture is fair. The caption should not say the demo loads the command's KTX2 file.
- Corrected alt: "Plastic and metal spheres, from rough to smooth, over a polished floor, lit by the Venice sunset environment map."

## Demo links

- gltf-model/ (Optimize a model): keep, reword. The demo has no code value, so "gltf-model/" is right. It loads the source BoomBox, so it shows loading, not optimizing. Concept: "loading a model with assets.loadGltf".
- character/ (What it does to clips): keep, reword. It loads the source Knight.glb (examples/character/sketch.ts) and blends its clips. Concept: "the KayKit Knight and its clips". Do not say the clips are optimized.
- forest/ (Levels of detail): keep. It shows copies that pick their own level each frame. Its levels are made in code, not by `--lod`.
- showcase/island/ (Levels as separate downloads): keep, move it. The island's models come from `assets optimize` (tools/samples/blender/build.ts), with levels made in Blender and kept by the tool. The build does not pass `--stages`, so the island shows no staged downloads. Put the link under "Optimize a model" or "Levels of detail", where it is the only demo whose files are this command's output. showcase/creek/ is the same kind of demo.
- environment/ (Environment maps): keep. It loads the same Venice HDR file with assets.loadEnvironment.

## Concepts said to have no demo

- blockers: no demo shows them. The creek's sample models keep blockers from the optimize run (tools/samples/blender/creek.ts and creek_tripo.ts), but nothing on screen shows them.
- stored raycast trees: no demo. mesh-arrays and picking raycast, but no demo stores trees with `--bvh`.
- cluster levels: no demo uses `--clusters`.
- --stages bands: no demo uses `--stages` or maxLevels.
- assets convert: no demo. A test page (converted-models-sketch.ts) exists, but it is not a demo.
- pack-orm: no demo. Demos that use metal-rough maps make them in code.
- normal-from-bump: no demo of the command. relief/ draws a bump map with the engine, which is the input that the command replaces.
- the budget report: command output only.
- the shader list: no demo.
- ?optimized Vite import: no demo imports with ?optimized.
