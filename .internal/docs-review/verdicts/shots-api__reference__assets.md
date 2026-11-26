# Shot and demo-link verdicts: api/reference/assets

Page is generated. Its text comes from TSDoc on the Assets exports in packages/engine/src/scene/assets.ts (tag @category api/assets), rendered by tools/gen-docs.ts and tools/lib/docs.ts. No reference page has demo links today, and the generator has no field for them. A link must go into the TSDoc text or the generator must gain a "demo" field.

## Shots

None proposed. Nothing to check.

## Demo links

| Concept | Code | Keep | Reason |
| --- | --- | --- | --- |
| loadGltf | gltf-model/ | yes | Demo "gltf-model" has no code field, so "<name>/" applies. Its sketch calls assets.loadGltf on the BoomBox .glb and places it with scene.instantiate. It also calls assets.builtinEnvironment('room'). Reference image exists: tests/image/references/chrome-real-gpu/<tier>/demo-gltf-model.png. |
| loadEnvironment | environment/ | yes | Demo "environment" has no code field. Its sketch calls assets.loadEnvironment on an HDR file and an EXR file, and assets.skyEnvironment. It shows loadEnvironment and skyEnvironment together. demo-environment.png exists. |
| animated glTF | character/ | yes | Demo "character" has no code field. Its sketch loads the KayKit Knight with assets.loadGltf and plays blended clips through the animator. Fits best beside the Prefab section, since clips come from the prefab, but under Assets is acceptable. demo-character.png exists. |

## Concepts said to have no demo

- glTF extension handlers: confirmed. No demo calls registerGltfExtension. The splats add-on has a handler (packages/splats/src/gltf.ts), but the "splats" demo streams chunk files and does not load a glTF file with it.
- download progress handlers: not confirmed. gltf-model, environment and character (and look-at, showcase/creek) call reportLoading from examples/lib/progress.ts, which calls ctx.assets.onProgress to feed the loading bar. The call sits in the shared helper, outside the demo folder, so a link to gltf-model/ shows it only one step away. showcase/island also uses assets.preload.
