# Shot and demo-link verdicts: api/assets

## Shots

### gltf-boombox: keep
The reference file exists: tests/image/references/chrome-real-gpu/webgpu/demo-gltf-model.png. It shows the Khronos BoomBox on the polished turntable in the dark studio, which is the demo's default view (hold 2 s). The sketch lights it with the built-in room, as the "shows" text says. Caveat: every demo reference is 320 x 180 pixels, which is small on a docs page. A larger scripted capture of the same view (examples page, `?demo=gltf-model&hold=2`, development build) would look better.

### environment-spheres: drop (duplicate)
The reference file exists and shows the spheres under the Venice sunset (demo-environment.png, hold 1 s). But the side-by-side shot below starts with this same frame, so the page would show the sunset twice under one heading. Keep this one only if the side-by-side shot is not made.

### environments-side-by-side: keep, with exact steps
The steps work. The demo changes environment every 4 s (sunset, studio, sky), so 1 s, 5 s and 9 s land on each of the three. The examples page reads the engine's `?hold=` switch in a development build. A held frame makes the sky's whole map at once, so the 9 s frame shows the final sky light. This shot shows the section's main point: one call takes an HDR file, an EXR file or the generated sky. Exact steps: in a development build of the examples page, capture `?demo=environment&hold=1`, `?demo=environment&hold=5` and `?demo=environment&hold=9`, and place the three frames in a row, labelled "Radiance .hdr", "OpenEXR .exr" and "Generated sky".

### devtools-network-stages: reject as given; corrected source
The island showcase does not load staged models. Its plant, town, house and prop models are optimized and packed into one file each (tools/samples/blender/build.ts and island.ts pass no `--stages`), and the sample manifest names no stage files. The network panel would show trees.glb and shrubs.glb as single downloads, which contradicts the paragraph. The repository has a page that does this: tests/pages/staged-levels.html with tests/pages/sketches/staged-levels-sketch.ts, which loads assets/models/staged-terrain.glb, written with `--lod --stages`. `?near` starts with the camera far, so only the coarse file loads, then moves close, and the stage files (names end in `.m<N>.lod<N>.bin`) arrive. Corrected steps: open tests/pages/staged-levels.html?near on the development server, open the browser's Network panel first, filter on "staged-terrain", and capture the list after the camera moves close.

## Demo links

### Environments from HDR and EXR files -> environment: keep, fix the code
The demo exists and loads a Radiance .hdr and an OpenEXR .exr with loadEnvironment, plus skyEnvironment. The demo has no `code` field, so the link code must be `environment/` (the contract's "<name>/" form), not `environment`.

### Models with levels and far cards -> showcase/island/: keep, place with care
The code exists. The island loads trees.glb and shrubs.glb with loadGltf, with levels of detail from the asset tool, and far cards from the impostors add-on. It does not use `--stages`, so put the link at the levels-of-detail sentence, not at the `--stages` paragraph. For the basic "load a model" point, gltf-model/ is a smaller and clearer demo; consider linking it too under "## glTF models".

### Extensions that add-ons read -> splats: reject
The splats demo does not read a glTF extension. It calls createSplats from @null3d/splats with a chunk index file (sources/splats/bolton-priory-stream/index.json). No demo calls registerGltfExtension or loads a file with KHR_gaussian_splatting. Only the image test page tests/pages/sketches/splats-gltf-sketch.ts does that, and it is not a demo.

## Concepts said to have no demo

- Color grading tables (loadLut, lutFromData): partly wrong. The comparisons compare/night-town/, compare/battle/ and compare/factory/ build their grade with assets.lutFromData, and the grade is on by default. No demo loads a .cube or .3dl file with loadLut. compare/night-town/ is the best link, for lutFromData only.
- Cube maps: confirmed. No demo calls loadCubemap.
- Baked light files: confirmed. No demo calls loadLightProbeGrid, loadLightMap or lightProbeGridFile. The bounce-light demo is screen-space bounce light, not a baked file.
- The cache of derived data: confirmed. No demo calls assets.cache.
- rewriteUrl for uploaded models: confirmed. No demo uses it.
- onProgress loading bars: wrong. gltf-model/ and environment/ (and character, look-at, creek) call reportLoading in examples/lib/progress.ts, which uses assets.onProgress to drive the page's loading bar with bytes loaded against bytes announced. gltf-model/ is the clearest link.
