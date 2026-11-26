# concepts-1-readability-24

## Finding as given

- page: concepts/assets
- anchor: "## Models and prefabs", line 43
- category: wall-of-text
- severity: medium
- claim: The supported glTF extensions are 32 names in one comma list inside a sentence. Geometry, textures, materials, lights, animation and the engine's own extensions are mixed together.
- evidence: assets.md:43
- proposedEdit: Main text: 'The loader reads .glb and .gltf files and most Khronos extensions. A file that requires an extension it does not read fails with E1417; an extension that a file only uses is left out.' Then a grouped table inside a block 'Technical details: the glTF extensions the loader reads': Geometry (quantization, meshopt both names, Draco, GPU instancing, MSFT_lod), Textures (basisu, webp, avif, transform), Materials (unlit to anisotropy), Scene (lights_punctual, animation_pointer, node_visibility, NEEDLE_*), null3D's own (NULL3D_mesh_bvh, NULL3D_occluder, NULL3D_clusters, NULL3D_pieces).

Verdict: partly

## Evidence

- docs/concepts/assets.md:43 is one paragraph with a 28-name inline list in one sentence, mixed across compression, textures, materials, lights, animation, instancing, levels of detail and Needle files. The engine's 4 own extensions are in a separate, second sentence, not in the same list. So the total is 32, but "32 names in one comma list" and "the engine's own are mixed in" are not exact.
- The list on the page matches the loader's list of read extensions exactly (packages/engine/src/scene/gltf-parse.ts:47-82, 32 entries). So the detail is correct and worth keeping, which fits a collapsible block.
- The readability problem is real: a reader cannot scan 28 inline code names to find "does it read Draco / clearcoat / lights?".
- docs/api/assets.md:84-101 already has a table that says what most of these extensions become, but it leaves out MSFT_lod, most KHR_materials_* names (folded into one row) and the NULL3D_* names. So the concept page is the only full list; a block, not a cut, is right.

## Problems with the proposed edit

- "most Khronos extensions" is a new, vague claim. It is not in the source, it is hard to check, and MSFT_lod, NEEDLE_* and NULL3D_* are not Khronos extensions. It can mislead a reader who needs, for example, KHR_materials_variants (the example the E1417 message itself uses, packages/engine/src/errors/codes.ts:438).
- It drops two useful facts: that a .gltf file loads with the files it names, and that a model draws without the extensions a file only uses.
- NEEDLE_lightmaps and NEEDLE_components carry light maps for materials (docs/api/assets.md:95); "Scene" is a weak home for them. "Lights and light maps" fits better.

## Corrected claim

The page puts 28 extension names in one inline sentence, mixed across geometry, textures, materials, lights, animation and Needle files, then 4 engine extensions in a second sentence. The 32 names are correct but hard to scan.

## Corrected edit

Main text:

"The loader reads `.glb` files, and `.gltf` files with the files they name. It reads the common extensions for compressed meshes and textures, physically based materials, lights, animation, instancing and levels of detail, and the asset tool's own extensions. A file that requires an extension the loader does not read fails with [E1417](../errors/E1417.md). The loader leaves out other extensions that a file only uses, and the model draws without them. [Assets](../api/assets.md#gltf-models) says what each extension becomes."

Then:

<details>
<summary>Technical details: the glTF extensions the loader reads</summary>

| Group | Extensions |
| --- | --- |
| Meshes | `KHR_mesh_quantization`, `KHR_meshopt_compression`, `EXT_meshopt_compression`, `KHR_draco_mesh_compression`, `EXT_mesh_gpu_instancing`, `MSFT_lod` |
| Textures | `KHR_texture_basisu`, `EXT_texture_webp`, `EXT_texture_avif`, `KHR_texture_transform` |
| Materials | `KHR_materials_unlit`, `KHR_materials_emissive_strength`, `KHR_materials_specular`, `KHR_materials_ior`, `KHR_materials_transmission`, `KHR_materials_volume`, `KHR_materials_dispersion`, `KHR_materials_diffuse_transmission`, `KHR_materials_volume_scatter`, `KHR_materials_clearcoat`, `KHR_materials_sheen`, `KHR_materials_iridescence`, `KHR_materials_anisotropy` |
| Lights and light maps | `KHR_lights_punctual`, `NEEDLE_lightmaps`, `NEEDLE_components` |
| Animation and visibility | `KHR_animation_pointer`, `KHR_node_visibility` |
| The asset tool's own | `NULL3D_mesh_bvh`, `NULL3D_occluder`, `NULL3D_clusters`, `NULL3D_pieces` |

</details>

The main text makes sense with the block closed, and the block has no heading and no nested block.
