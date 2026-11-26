# Verdicts: errors/E1416 (screenshots and demo links)

Page source: generated. Edit the fix text in packages/engine/src/errors/fixes.ts (rendered by the error page code in tools/lib/docs.ts). A demo link here must go in through that source.

## Shots

None proposed. None needed: the page is about a file that fails to load, and no picture shows that.

## Demo links

- "a glTF model that loads with all its maps" -> `gltf-model/` under "## How to fix it". KEEP.
  - The demo exists in examples/demos.ts (name `gltf-model`). It has no `code` value, so `<name>/` is the right form: https://github.com/null3d-engine/null3d/tree/main/examples/gltf-model/
  - Its sketch loads a Khronos .glb with assets.loadGltf and places it with scene.instantiate. Its base color, normal, occlusion, roughness, metalness and emissive maps come from the file. That is a known-good call and a known-good file a reader can compare with theirs.
  - Fit is modest: the demo shows a load that works, not a fix for a broken file. Word the link as a working example to compare against, not as the fix.

## Concepts said to have no demo

All three confirmed. No demo in examples/demos.ts or examples/compare/comparisons.ts shows them.
- glTF decode limits: confirmed. These are failure cases; no demo shows a file that passes a limit.
- Draco and meshopt decode failures: confirmed. A search for "draco" and "meshopt" in examples/ matches only the type name MeshOptions. No demo loads Draco or meshopt data. The image test scene gltf-meshopt-khr loads meshopt data, but it is a test scene, not a demo, so it cannot be linked under the website contract.
- A skeleton over 1,024 joints: confirmed. The `character` and `look-at` demos load a skinned KayKit Knight, but its skeleton is far under the limit, so neither shows this case.
