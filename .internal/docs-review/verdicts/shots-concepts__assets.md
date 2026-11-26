# Shot and demo-link verdicts: concepts/assets

## Shots

### gltf-model: keep
- The reference file exists: tests/image/references/chrome-real-gpu/webgpu/demo-gltf-model.png (also under compat and webgl2). It is the demo's default view in the image manifest.
- It shows the BoomBox on the polished turntable, loaded with assets.loadGltf and scene.instantiate, so it fits under "Models and prefabs".
- Caveat: the reference is only 320 x 180. The website copy will be small; the alt text claims maps the small picture cannot show one by one. Fine as alt text, since the demo really uses every map from the file.

### devtools-decoder-download: drop
- "manual" is the right kind for a picture of the browser's Network panel.
- The source is wrong. The glTF model demo loads the Khronos BoomBox.glb as published, which has no meshopt data. The engine downloads the meshopt decoder only for a file that needs it, so this page would show no decoder download.
- A page that does load meshopt files: the Island showcase (showcase/island/), whose models come from the asset tool (quantized, meshopt-compressed meshes and KTX2 textures). Its network list is busy, though, and the WebAssembly filter shows the engine core and the KTX2 transcoder beside the decoder.
- Low value for a concepts page: one row in a dev-tools panel says no more than the sentence "about 4 KB after Brotli, downloaded with the first meshopt file". Drop it.

## Demo links

### gltf-model/ (glTF models load into prefabs): keep
- The demo has no code field, so "gltf-model/" is the right path.
- Its sketch loads a glTF file into a prefab with assets.loadGltf, reads the prefab's bounds and places it with scene.instantiate. That is the section's subject.

### mesh-arrays/ (Meshes from vertex arrays): keep, with care in the link text
- The demo exists and builds both meshes with geometry.fromArrays.
- Its arrays are floats (positions and colors) with 16-bit indices and computed normals. It does not show integer vertex attributes, which is the main point of "Meshes and vertex data". The link text must say "meshes from arrays", not "integer attributes".

## Concepts said to have no demo

- Draco compression: confirmed. No demo loads a Draco file.
- KTX2 textures and UASTC HDR: partly wrong. The Island showcase (showcase/island/) loads models whose textures are KTX2 through the asset tool. No demo calls loadTexture on a KTX2 file, and none uses UASTC HDR data.
- Integer vertex attributes: partly wrong. The Island showcase's models carry quantized (integer) meshes from the asset tool. No demo builds integer arrays with geometry.fromArrays, as the page's example does.
- Limits on each file: confirmed. No demo shows them.
- The texture upload budget: confirmed. No demo sets or shows it (only the texture-budget test page does, which is not a demo).
- prefab.destroy: confirmed. No demo frees a prefab; demos destroy objects, meshes and batches only.
