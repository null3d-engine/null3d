# D-89: Texture units of the standard material on WebGL2

Status: decided. The owner confirmed the order in which a material drops maps. Built: six shared map units, one light texture and the split-sum table in the material texture, on WebGL2. Task: M2-J7.

Summary: The WebGL2 fragment stage of the standard material reads 12 of its 16 texture units, with its maps in six shared units. Past six units, a material drops its specular intensity map, then its specular color map, then its light map. WebGPU keeps one binding per map, since a switch on the map's slot slows WebGPU with MSAA on Apple GPUs many times over.

## Question

WebGL2 guarantees each shader stage only 16 texture units. With one unit per texture, the standard material's fragment stage reads all 16. Sheen, clearcoat, iridescence, transmission, probes and area lights each need more. How should the stage make room, and how much room?

## Rule

The standard material's WebGL2 fragment stage reads at most 12 textures, so 4 units stay free. Sharing changes no image test's image on any GPU path. Every map that the engine supports works on WebGL2 for every material that glTF can describe. WebGPU keeps one binding per map.

## Data

The fragment stage of the standard material's largest WebGL2 build (maps, an alpha mask, shadows):

| Texture | One unit per texture | Shared units |
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

How the data was produced: the unit test in `gpu/webgl2/programs.test.ts` prints the most textures in one GLSL stage. It prints 12 of 16 in `standard_maps.webgl2_alpha_mask_receive_shadows`, against 16 of 16 at commit 74d5f4956, which has one unit per texture. The texture store's unit test `maps_of_one_array_and_sampler_share_a_unit_and_late_maps_lose_theirs` gives the units of the first two material rows. The image tests ran for every WebGL2 test, and for the maps, glTF, KTX2, environment and light tests on WebGPU. All 262 pass on SwiftShader and on the Mac's GPU, against the references of one unit per texture.

On a cloud Galaxy S25 in Chrome 149, 18 image pages passed on all three paths (run 20261007-035252-checks). They cover the maps, glTF specular and environment tests. On the owner's iPad Pro 11 in Safari 26.6.2 they passed too (run 20261007-053931-checks).

## Decision

On WebGL2 only, the standard material frees four units in three ways.

1. The maps share six units. Each unit is a texture array with a sampler. Maps whose textures sit in the same array and sample the same way share a unit. The texture store already keeps textures of one size, format and mip count in one array. So the color maps of one size share one unit, and the data maps of one size another. The row's value for each map holds its unit times 256 plus its layer. The shader picks the unit with a switch. Slots take units in a fixed order. Past six units, the last maps draw without their texture: the specular intensity map, then the specular color map, then the light map.
2. The light grid's words and the light records share one data texture of 32-bit integers. The records fill the first 1,024 columns, four texels each. The words fill the next 1,024, four to a texel. The shader turns the records' bits into floats, which is exact.
3. three.js's split-sum table sits in the material table's texture, in the 16 columns after each material's 9 texels. The table's values stay 32-bit floats, so the lighting is the same.

Packing the maps by family alone was rejected. One binding for the color maps and one for the data maps works only when every map of a family is in one array. A compressed texture has an array of its own, so a KTX2 material would need copies or decompression. Atlases were rejected as the main method for the same reason, and because filtering and wrapping across an atlas's tiles needs padding and shader code.

### Why the shader picks a unit with a switch

GLSL ES 3.00 indexes an array of samplers only with a constant. A unit known only at run time therefore needs a branch: a switch on the unit number, with one texture read in each case. WebGPU needs no such branch, since each map has a binding of its own. The unit comes from the material's row, so the pixels of one material all take the same branch, and a GPU runs only that one. A program per arrangement of maps would need no branch. It was rejected because each arrangement would add pipelines and compiles. S4's materials and S6's city use texture maps, and the section on the WebGPU slowdown below measures the branch on WebGL2. A WebGL2 timing of S3 and S4 compared commit b4f925ce4, with one unit per texture, against commit 333513098, with shared units. Other merges sit between the two builds. It ran in Mac Chrome at a load of about 4.4, with `bun run bench:run --compare` (results in `target/bench/20261007-082644-compare`). S3's busiest thread took 0.185 ms with one unit per texture and 0.173 ms with shared units, and S4's 0.215 ms and 0.210 ms. The tool counts both as the same, within their noise. Both builds held the display's 120 Hz on every page. These are CPU times, which the comparison tool uses. The GPU times below come from the pages' GPU timer, which Chrome on the Mac offers on WebGL2 too. They show no cost of the shared light texture and the table reads on the CPU side, and no dropped frames. They do not measure the GPU's per-pixel cost of the map branch. The image runs on the iPad and the S25 check only its correctness.

### Which maps a material drops

`MapSlot::SHARING_ORDER` gives the order in which a material's maps take units. Base color comes first, then normal, metal-rough, occlusion, emissive and light. The specular color and specular intensity maps come last. The specular maps go first because they change the look least, and a light map carries a scene's baked light. A glTF file has no light maps, so a glTF material loses at most its specular intensity map. The owner confirmed this order.

## Consequences

- The library module `null3d::tables` holds the material table's binding on WebGL2 and reads the split-sum table on both paths. `null3d::lighting` imports it. A module that `null3d::lighting` imports cannot import `null3d::mesh`, which imports the tone mapping, which imports `null3d::lighting`.
- The draw list has the texture format `RGBA32_UINT`.
- The WebGL2 builder keeps room for at least 8 materials, so the material texture has the 16 rows of the split-sum table.
- The unit test of texture units fails when any GLSL stage reads more than 12 textures.
- A test in the shader crate fails when a WebGPU build of the standard material with maps holds a switch. The section below gives the reason.
- A future map slot takes a shared unit. Any other new per-pixel input takes a layer of a texture array, a part of an atlas, or a place in a shared data texture. The [technique review](../technique-review.md#webgl2-texture-units) gives the rules.
- The texture and material pages describe the six units and what a material drops past them.

## The WebGPU slowdown from a switch on the map's slot

On WebGPU each map samples its own texture directly, through a small function per map. One helper for all maps, which picks each map's texture with a switch on the map's slot, is many times slower on the GPU. The slot is a constant at each call, so the switch should fold away. In Chrome on the Mac's Apple GPU, it does not. With 4x MSAA, which the Medium preset and above use, every draw of a textured standard material slows. Without MSAA the time does not change. The cause inside Chrome's shader compilers is not known. WebGL2 keeps the switch on the shared unit, because GLSL ES 3.00 needs it. Each WebGPU map samples the same texture either way, so the images are the same.

Six builds of main ran S4 on WebGPU at Medium, 6 s each, with and without MSAA. The GPU time per frame was 1.9 ms before the switch (#389) and 62.5 ms with it. Without MSAA it was 1.8 ms in every build. The CI benchmark job does not catch such a fault. It compares CPU time (the busiest thread and the engine's own work), not GPU time. Its Mac machine has no GPU timer, and its other figures moved within their noise ([benchmarks guide](../benchmarks.md#the-benchmark-job-in-ci)).

Commit bb518e014 (#426, with S6), which has the switch, against a function per map, in Chrome 155 on the Mac (Apple M5 Max). Each figure is the median GPU time per frame of one 8 s run with the governor off, in two rounds that alternate the builds. The Mac's 1-minute load was 4.6 at the start and 7.4 at the end.

| Page | Switch, GPU ms | Switch, fps | Function per map, GPU ms | Function per map, fps |
| --- | --- | --- | --- | --- |
| S4, WebGPU, Medium | 30.8, 28.1 | 45, 48 | 1.86, 1.97 | 120, 120 |
| S4, WebGPU, High | 40.0, 22.9 | 44, 61 | 1.82, 1.96 | 120, 120 |
| S6, WebGPU, Medium | 28.4, 26.5 | 49, 51 | 3.82, 3.93 | 120, 120 |
| S6, WebGPU, High | 32.5, 32.0 | 37, 38 | 6.17, 6.75 | 120, 120 |
| S4, WebGL2, Medium | 2.95, 3.03 | 120, 120 | 3.02, 3.11 | 120, 120 |
| S6, WebGL2, Medium | 7.43, 7.77 | 115, 117 | 7.66, 8.27 | 115, 114 |

The pages hold WebGL2 at Medium, so a request for High on WebGL2 ran at Medium too. Those runs gave the same figures as the Medium rows. The WebGL2 rows differ only by noise, since WebGL2's shaders are the same in both builds.

Does the switch cost WebGL2 anything? A test build, never merged, took the switch out of WebGL2's shader. Each map read the first or second shared unit directly. That draws some maps with the wrong texture, but it costs the same texture reads. The same Mac, three rounds, Medium preset, at a load of 3.5 at the start and 20.6 at the end:

| Page | With the switch, GPU ms | Without it, GPU ms |
| --- | --- | --- |
| S4, WebGL2 | 4.08, 3.21, 5.59 | 4.24, 3.24, 5.42 |
| S6, WebGL2 | 8.01, 8.26, 8.14 | 7.87, 8.15, 7.86 |

The switch costs WebGL2 at most about 0.1 to 0.3 ms in S6, inside the spread of the runs. So WebGL2 does not show the slowdown, and it keeps the switch.

Mac WebGPU timings at the Medium preset or above from builds with the switch are not valid. This covers every scene with textured standard materials, S4 and S6 among them. No figure in these records comes from such a build. The `gpu-occlusion` page of [D-40](D-40-gpu-occlusion.md) draws no texture maps. S6's record ([D-106](D-106-s6-city.md)) gives CPU times only, and [D-103](D-103-growing-object-tables.md) times copies. S6's runs 20261008-005257-bench and 20261008-011525-bench came from such builds, so they need a new run. Phones and Safari were not checked for the slowdown.

