# concepts-1-substance-22

## Finding as given

- page: concepts/assets
- anchor: ## Models and prefabs, line 43 (stats line 36) "It reads these extensions: `KHR_mesh_quantization`, ..."
- category: wall-of-text
- severity: medium
- claim: 32 extension names run inside one paragraph. A developer who asks 'does it read KHR_materials_sheen?' must scan them all. The useful rule (a required unknown extension fails with E1417; a used one is skipped) comes last.
- evidence: stats.json concepts/assets, line 36.
- proposedEdit: Keep: 'The loader reads .glb files, and .gltf files with the files they name. A file that requires an extension the loader does not read fails with E1417. A file that only uses one draws without it.' Put the list in <details><summary>Technical details: the glTF extensions that the loader reads</summary>, grouped by compression, textures, materials and scene.

Verdict: survives

## Evidence

- docs/concepts/assets.md:43 holds one paragraph with 28 named extensions plus 4 of the asset tool's own: 32 names. The rule about E1417 and skipped extensions is in the last two sentences. stats.json lists it as a long paragraph (84 words, 5 sentences).
- The list is correct. It matches the loader's list of read extensions in packages/engine/src/scene/gltf-parse.ts:47-82, and the required-extension check at gltf-parse.ts:1131-1143 throws E1417 for any other required name. So the proposed main-text sentences are true.
- No other page holds the full list. docs/api/assets.md:84-100 has a table of what some extensions become, but not every name (for example sheen, iridescence, MSFT_lod and the asset tool's own extensions are not rows there). So the list must stay on this page, and a collapsible block keeps it without cutting it.
- With the block closed, the main text still makes sense: it states what files load and what happens to an unknown extension. The next paragraph (line 45, add-on handlers) reads on cleanly.
- The block follows the contract: a summary that starts "Technical details:", no heading inside, no nesting.

## Refinement to the edit

The proposed groups leave out a home for the four extensions that the asset tool writes. Use five groups inside the block, as short bullet lines:

- Compression: KHR_mesh_quantization, KHR_meshopt_compression, EXT_meshopt_compression, KHR_draco_mesh_compression.
- Textures: KHR_texture_basisu, EXT_texture_webp, EXT_texture_avif, KHR_texture_transform.
- Materials: KHR_materials_unlit, _emissive_strength, _specular, _ior, _transmission, _volume, _dispersion, _diffuse_transmission, _volume_scatter, _clearcoat, _sheen, _iridescence, _anisotropy (write each name in full).
- Scene and animation: KHR_lights_punctual, KHR_animation_pointer, KHR_node_visibility, EXT_mesh_gpu_instancing, MSFT_lod, NEEDLE_lightmaps, NEEDLE_components.
- The asset tool's own: NULL3D_mesh_bvh, NULL3D_occluder, NULL3D_clusters, NULL3D_pieces.
