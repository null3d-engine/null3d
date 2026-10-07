# D-89: Texture units of the standard material on WebGL2

Status: decided; the order in which maps are dropped confirmed by the owner, 7 October 2026. Date: 2026-10-07. Task: M2-J7.

Summary: The WebGL2 fragment stage of the standard material reads 12 of its 16 texture units, down from 16. Maps that share an array and a sampler share one of six units. The light grid and light records share one data texture, and the split-sum table sits in the material table's texture. Past six units, a material drops its specular intensity map, then its specular color map, then its light map. WebGPU keeps one binding per map.

## Question

WebGL2 guarantees each shader stage only 16 texture units. After M2-E2 and M2-J5 the standard material's fragment stage read all 16. Sheen, clearcoat, iridescence, transmission, probes and area lights each need more. How should the stage make room, and how much room?

## Rule

The standard material's WebGL2 fragment stage reads at most 12 textures, so 4 units stay free. Every image test draws as before on every GPU path, with no reference changed. Maps that the engine supports today keep working on WebGL2 for every material that glTF can describe. WebGPU keeps one binding per map.

## Data

The fragment stage of the standard material's largest WebGL2 build (maps, an alpha mask, shadows):

| Texture | Before | After |
| --- | --- | --- |
| Material table | 1 | 1, which also holds the split-sum table |
| Split-sum table | 1 | 0 |
| Sun's shadow map, shadow atlas | 2 | 2 |
| Light grid, light records | 2 | 1 |
| Ambient occlusion | 1 | 1 |
| Environment map | 1 | 1 |
| Maps | 8, one per slot | 6 shared units |
| All | 16 | 12 |

How many units a material's maps take with shared units:

| Material | Units |
| --- | --- |
| PNG or JPEG maps of one size: color maps in sRGB, data maps in linear color | 2 |
| The same, with an occlusion map of another size | 3 |
| KTX2 maps: base color, packed occlusion-roughness-metalness, normal, emissive | 4 |
| glTF's seven maps, each in a different array or with a different sampler | 7: the specular intensity map is dropped |

How the data was produced, 7 October 2026: the unit test in `gpu/webgl2/programs.test.ts` prints the most textures in one GLSL stage. On main (74d5f4956) it printed 16 of 16, and on this change 12 of 16, in `standard_maps.webgl2_alpha_mask_receive_shadows`. The texture store's unit test `maps_of_one_array_and_sampler_share_a_unit_and_late_maps_lose_theirs` gives the units of the first two material rows. The image tests ran for every WebGL2 test, and for the maps, glTF, KTX2, environment and light tests on WebGPU. All 262 passed on SwiftShader and on the Mac's GPU, with no reference changed.

On a cloud Galaxy S25 in Chrome 149, 18 image pages passed on all three paths (run 20261007-035252-checks). They cover the maps, glTF specular and environment tests. On the owner's iPad Pro 11 in Safari 26.6.2 they passed too (run 20261007-053931-checks).

## Decision

On WebGL2 only, the standard material frees four units in three ways.

1. The maps share six units. Each unit is a texture array with a sampler. Maps whose textures sit in the same array and sample the same way share a unit. The texture store already keeps textures of one size, format and mip count in one array. So the color maps of one size share one unit, and the data maps of one size another. The row's value for each map holds its unit times 256 plus its layer. The shader picks the unit with a switch. Slots take units in a fixed order. Past six units, the last maps draw without their texture: the specular intensity map, then the specular color map, then the light map.
2. The light grid's words and the light records share one data texture of 32-bit integers. The records fill the first 1,024 columns, four texels each. The words fill the next 1,024, four to a texel. The shader turns the records' bits into floats, which is exact.
3. three.js's split-sum table sits in the material table's texture, in the 16 columns after each material's 9 texels. The table's values become 32-bit floats, as before, so the lighting is the same.

Packing the maps by family alone was rejected. One binding for the color maps and one for the data maps works only when every map of a family is in one array. A compressed texture has an array of its own, so a KTX2 material would need copies or decompression. Atlases were rejected as the main method for the same reason, and because filtering and wrapping across an atlas's tiles needs padding and shader code.

### Why the shader picks a unit with a switch

GLSL ES 3.00 indexes an array of samplers only with a constant. A unit known only at run time therefore needs a branch: a switch on the unit number, with one texture read in each case. On WebGPU the same helper switches on the slot, a constant at each call, which the GPU compilers fold away. The unit comes from the material's row, so the pixels of one material all take the same branch, and a GPU runs only that one. A program per arrangement of maps would need no branch. It was rejected because each arrangement would add pipelines and compiles. No benchmark scene uses texture maps, so the branch's cost is not measured yet. A WebGL2 timing of S3 and S4 in a quiet window compares main with this change. It measures the shared light texture and the table reads.

### Which maps a material drops

`MapSlot::SHARING_ORDER` gives the order in which a material's maps take units. Base color comes first, then normal, metal-rough, occlusion, emissive and light. The specular color and specular intensity maps come last. The specular maps go first because they change the look least, and a light map carries a scene's baked light. A glTF file has no light maps, so a glTF material loses at most its specular intensity map. The owner confirmed this order on 7 October 2026.

## Consequences

- `null3d::tables` is a new library module. It holds the material table's binding on WebGL2 and reads the split-sum table on both paths. `null3d::lighting` imports it. A module that `null3d::lighting` imports cannot import `null3d::mesh`, which imports the tone mapping, which imports `null3d::lighting`.
- `RGBA32_UINT` is a new texture format of the draw list.
- The WebGL2 builder keeps room for at least 8 materials, so the material texture has the 16 rows of the split-sum table.
- The unit test of texture units fails when any GLSL stage reads more than 12 textures.
- A future map slot takes a shared unit. Any other new per-pixel input takes a layer of a texture array, a part of an atlas, or a place in a shared data texture. The [technique review](../technique-review-2026-10.md#webgl2-texture-units) gives the rules.
- The texture and material pages describe the six units and what a material drops past them.
