# D-51: Morph targets

Status: decided, 2026-10-04. Task: M2-C5. Color targets added on 2026-10-05, task M2-C11.

Summary: Sparse deltas per vertex in half floats, in one RGBA16F texture, and the weights in an RGBA32F texture of their own. WebGPU morphs in the skinning pass; WebGL2 in each pass's vertex shader under the MORPH bit, keeping a preset's count of each object's largest weights (8 on Low to 64 on Ultra). Clips animate weights through joints that move no vertex. The MORPH builds load on first use, in shader files of 18.6 to 20.5 KB after Brotli, under the owner's limit of the start shader file's size. Custom materials draw morphed meshes at rest on WebGL2.

## Question

A morph target is a second shape of a mesh: a face that smiles, a door that bends. Each object of the mesh blends its targets in by weights, as three.js's `morphTargetInfluences` does. How do the targets reach the GPU, and where do vertices take them? WebGPU already skins in a compute pass ([D-20](D-20-webgpu-skinning.md)), and WebGL2 skins in each pass's vertex shader ([D-10](D-10-webgl2-skinning.md)). How do clips animate weights? And how do the extra shader builds fit the download budget ([D-14](D-14-js-budget.md))?

## Rule

- A morphed mesh draws the same on the three GPU tiers, and like three.js's `morphTargetInfluences` at the same weights.
- A page that draws no morphed mesh downloads none of the morph shader builds, and its start does not grow.
- No per-frame allocation, on either GPU path.
- WebGL2 stays within 16 texture units per shader stage, the fewest that WebGL2 allows.
- Morph targets are intent ([D-52](D-52-intent-parity.md)): they must show what the file means. So parity with three.js's morph results stays strict, by three.js's own image rule.

## Data

### Storage: sparse deltas

A target of a face moves a small part of the face. three.js's morph texture holds every vertex of every target, so a face of 52 targets stores 52 copies of its vertices. The engine stores, for each vertex, only the targets that move it. An entry is one texel of the position's delta, with the target's number in its fourth value. A texel each of the normal's, the tangent's and the color's delta follow, where the targets move them. Each vertex gets a morph attribute at location 8: its first entry's texel, and a word for its entries. The word is the count of entries times 8, plus 1 when normals follow, 2 for tangents and 4 for colors. An RGBA16F texture, 2,048 texels wide, holds every mesh's entries. A small RGBA32F texture of the same width holds each morphed object's weights, four to a texel. That width is the widest that every WebGL2 device takes.

The limits are 256 targets per mesh and 255 entries per vertex. Every mesh's deltas together take up to 4,194,304 texels, and the core's table holds 65,536 weights. The engine refuses a mesh past them with E1206, and a weight past the table with E1102.

### Half floats, and weights in a texture of their own

The deltas are half floats, as Babylon.js stores its morph textures and as three.js's glTF tools can quantize them. A delta texel then takes 8 bytes in place of 16, in the GPU's texture and in the engine's own copy. The texture of deltas holds up to 4,194,304 texels: 32 MiB in half floats, against 64 MiB in floats. RGBA16F textures that shaders read with `textureLoad` are core in WebGPU, its compatibility mode and WebGL2, so every tier takes them. The 32-bit store stays nowhere.

A half float keeps 11 bits, so a delta is off by at most 1/2048 of its size. A face's delta of 2 cm is then off by at most 10 micrometers. A target's number, up to 255, is exact. The core rounds each delta to the nearest half float, ties to even, and grows the bounds by the deltas as rounded. The parity check below measures what the rounding shows. A close-up of the sphere that blends all three targets matches three.js's 32-bit deltas within 0.069% of the pixels on every tier.

The weights stay 32-bit floats, in a texture of their own. Each frame uploads only the weights, as before: the deltas go up once. The split matters when the scene grows. With one texture, objects whose weights outgrew their rows remade the whole texture, and every mesh's deltas went up again. Now more objects remake only the texture of weights, at most 8 rows. More meshes remake only the texture of deltas. The second texture costs one more texture unit in WebGL2's vertex stage, and one more binding on each path.

### Where vertices morph

| GPU path | Where | Why |
| --- | --- | --- |
| WebGPU, both tiers | In the skinning pass, before the joints. An object that only morphs goes through the pass too | The pass already writes each skinned mesh's vertices once per frame, and every pass then draws them. Each template, custom materials' too, draws morphed meshes as they are, with no MORPH build. `?skinning=vertex` still morphs in the pass, as WebGPU has no MORPH build |
| WebGL2 | In the vertex shader of each pass that draws the mesh, under the MORPH bit, before skinning | WebGL2 has no compute pass. D-10 measured transform feedback slower than skinning in the vertex shader, and morphing reads the same kind of data |

On WebGL2 the texture of deltas takes binding 6 of the instance group, and the texture of weights binding 7. They follow the joint texture and the texture of first joints. The texture of first joints has a second half of rows: the first weight texel of each instance's object. A crowd of one morphed mesh therefore still draws in one instanced draw per part. Group 3's slots start two later (22). On WebGPU the skinning pass's group binds the two textures at bindings 4 and 5.

The largest WebGL2 program is `standard_maps` with alpha mask, shadows, SKIN and MORPH. It reads 8 textures in its vertex stage, 12 in its fragment stage and 20 in all. WebGL2 allows at least 16 per stage and 32 in all. The unit test of the slots now checks every build of every shader module, the morph modules included.

The lit, standard maps, unlit, unlit map, shadow depth and debug view templates have MORPH builds. Custom materials and sprites have none. On WebGL2 a custom material therefore draws a morphed mesh at rest, its targets left out. A custom material's vertex code may move vertices itself, and a MORPH build of every custom shader would double each one's programs.

On WebGL2 the depth prepass draws each opaque mesh with the vertex shader of its shading pipeline ([D-43](D-43-webgl2-prepass.md)). So a morphed mesh's prepass takes the MORPH build too.

### The WebGL2 cap

The vertex shader reads each entry's weight, and skips the entry's normal and tangent when the weight is 0. WebGL2 morphs in every pass that draws the mesh, the shadow cascades too. So each object keeps only a preset's count of its weights, those farthest from 0, and draws the others as 0. three.js's WebGL1 renderer kept its 8 largest influences in the same way.

| Preset | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Morph targets per object on WebGL2 | 8 | 16 | 32 | 64 |

WebGPU morphs once per frame and keeps every weight. The cap is the `morphTargets` quality setting, fixed at the start, and `createEngine`'s `morphTargets` option.

The cap finds the weights to keep with one selection over a copy of their sizes on the stack. Its cost grows with the weights, not with the weights times the cap. The first version searched for the smallest weight once for each weight that it dropped. For 256 weights and a cap of 8, that took about 63,000 steps per object per frame.

### Bounds

A morphed object's bounding sphere grows by each target's reach times the size of its weight, added up, in each frame. The reach is the longest position delta of the target. three.js grows a geometry's bounds by every target at once. The engine's spheres stay tight while weights are small, which keeps culling exact.

### Clips that animate weights

A clip animates weights through joints of the model's skeleton that move no vertex, three weights to a joint, as [D-35](D-35-gltf-animation.md#morph-targets) records. The core reads weight `k` as `t + (1 - s) * own`. Here `t` is the joint's blended translation along axis `k mod 3`, and `s` its blended scale. The own weight `own` comes from the file or `setMorphWeight`. A clip at full weight sets the weight, and a fade blends it with the object's own. The own weight holds when no clip animates it.

### Files from Blender

Blender's glTF exporter writes shape keys as sparse accessors by default. Such an accessor has no buffer view of its own. It holds a list of the vertices that the key moves, with a delta for each. The list takes the smallest unsigned index type that holds its largest vertex number. That is 8-bit up to 255, 16-bit up to 65,535, and 32-bit above. So one file can mix all three types.

The loader reads each index at its own size. The code review of 4 October 2026 (R1-01) found that it asked for the list's length squared times the index size. It refused every file whose list held two or more values, which covers most real shape keys. The unit tests now cover each index type, on positions and on a target. They also load a face with three shape keys, written as Blender writes them. The glTF page test loads the same face in a live engine.

### The shader download

The MORPH bit doubles the WebGL2 mesh builds. In each start shader file they would have taken it past the file's size. So the MORPH builds load on first use ([D-56](D-56-first-use-shader-files.md)). The MORPH builds without SKIN go into eight morph files, one for each value of the bits that a device fixes. The builds with both bits go into the skinning file of the same bits, as a build belongs to the feature of its lowest bit that a table names. A page loads the file it needs when its first pipeline with the MORPH bit asks for it. Until it arrives, that pipeline waits, as a custom material's pipeline waits for its shader. A glTF file with morph targets on meshes without skins asks for the morph file as soon as it is parsed. WebGPU has no MORPH builds, so there a morphed mesh, and `preload: ['morph']`, load the skinning file.

Sizes from `bun run build` on 4 October 2026, before the files that load on first use, after Brotli at quality 11:

| Files | Before compression | After Brotli |
| --- | --- | --- |
| The 12 start shader files | 1.7 to 3.4 MB | 23.2 to 24.4 KB |
| The 8 morph shader files | 2.8 to 3.3 MB | 18.6 to 20.5 KB |

The engine's other files that load later have a budget of 16 KB each. The morph shader files cannot fit it, as each holds every MORPH build of one device's bits. The owner decided on 4 October 2026 that shader files that load on first use have a limit of their own: 24 KB after Brotli and 1,536 KB uncompressed, as one start shader file. On 5 October 2026 the owner raised it to 32 KB after Brotli and 320 KB after gzip ([D-14](D-14-js-budget.md#first-use-shader-files)). `FIRST_USE_SHADER_BUDGET` in `tools/lib/size-report.ts` holds it, and the size check enforces it. The morph builds are the `[first_use.morph]` feature of the shader manifest.

With the builds of both bits in the skinning files, each WebGL2 skinning file held 70 builds, 34 of them with MORPH. The largest took 2,865 KB uncompressed and 428 KB after gzip, over the limits. The MORPH bit changes only the vertex shader, but each stage's text held the other stage's functions too. Each WebGL2 stage is now written from its own entry point, so the builds with and without MORPH share their fragment shaders. D-56 gives the counts and the ways weighed. Sizes after the merge of main at 62add54f, in units of 1,024 bytes:

| Files | Brotli | gzip | Uncompressed |
| --- | --- | --- | --- |
| The 8 WebGL2 skinning files, with the builds of both bits | 16.5 to 18.2 KB | 142.9 to 179.0 KB | 1,137 to 1,271 KB |
| The 8 morph files | 14.4 to 16.3 KB | 115.9 to 171.4 KB | 910 to 1,042 KB |
| The 8 WebGL2 start shader files | 17.4 to 18.1 KB | 118.7 to 160.6 KB | 902 to 1,034 KB |

Chrome on the MacBook Pro (M5 Max) parses and runs a morph shader file about as fast as a start shader file. The page imported each file seven times from memory, so no download counts. Medians, 4 October 2026:

| File | Parse and run |
| --- | --- |
| The morph file with the draw index and tone mapping bits, the largest | 9.0 ms |
| The start file with the same bits | 9.2 ms |
| The morph file with no fixed bits | 7.7 ms |

### Measurements

The image tests `morph`, `morph-shadows`, `morph-names` and `morph-closeup` draw three spheres of one mesh at their own weights, with the shadow passes and with weights set by name. Every tier draws the WebGPU image. On the Mac's GPU, WebGL2 differs in 0.128% of the pixels without the ground and 0.113% with it, all on outline edges. The test with the ground takes a tolerance of 0.2%. `morph-cap` draws the scene on WebGL2 with a cap of 2. It matches `morph-capped`, which draws the same scene with the third sphere's smallest weight set to 0.

The parity check compares each scene with three.js r186 by three.js's own image rule, under 0.1% of the pixels. Figures with the deltas in half floats:

| Scene | WebGPU | Compatibility mode | WebGL2 | three.js's two renderers |
| --- | --- | --- | --- | --- |
| The three spheres, against `morphTargetInfluences` | 0.000% | 0.102% | 0.003% | 0.062% |
| The close-up of the third sphere, which blends all three targets | 0.005% | 0.069% | 0.006% | 0.049% |
| AnimatedMorphCube, its clip at 2.4 s, against `AnimationMixer` | 0.000% | 0.000% | 0.000% | 0.001% |
| MorphStressTest, 8 targets on two primitives, its clip at 0.5 s | 0.000% | 0.037% | 0.000% | 0.027% |
| MorphPrimitivesTest, the file's default weight of 0.5 | 0.000% | 0.001% | 0.000% | 0.004% |

With 32-bit deltas the three spheres differed in 0.000%, 0.100% and 0.000%. In compatibility mode, all 234 differing pixels are on outlines, where its 8-bit path averages the edge samples after it encodes them. 53 of them are on the red sphere, whose weights are all 0, so the deltas' precision cannot move them. The wide scene takes a limit of 0.2% in `bench/lib/parity.ts` for that reason. The close-up, which shows precision best, keeps three.js's rule.

`bun run bench:allocation --morphed 64` adds 64 spheres to S1 whose three weights the sketch sets in every frame. Every place stayed within its budget on both GPU paths. On WebGL2 the sketch worker's frame code took 202 bytes per frame with the spheres and 191 without, inside its budget of 240. With half floats and the texture of weights, the sketch worker took 333 bytes per frame in all on WebGL2 and 294 on WebGPU. Every place stayed within its budget.

The Rust tests cover both frame builders. On WebGPU they check the skinning pass's morph texture and buffers, and on WebGL2 the MORPH builds of every pass and of the depth prepass. They also check custom materials at rest, bounds, the weight upload and its cap, split meshes, and frames that allocate nothing.

## Decision

- Sparse deltas in half floats in one texture, and the weights in 32-bit floats in a texture of their own, for both GPU paths.
- WebGPU morphs in the skinning pass; WebGL2 in each pass's vertex shader under the MORPH bit, with the preset's cap.
- Clips animate weights through joints that move no vertex.
- The MORPH builds load on first use: those without SKIN in the morph files, and those with SKIN in the skinning files. Each file keeps to the start shader file's limits.
- Custom materials draw morphed meshes at rest on WebGL2.
- Color targets morph vertex colors, as the next section says. Development builds note only targets of other attributes, such as texture coordinates, which three.js does not morph either.

## Color targets

Added on 5 October 2026 by M2-C11. Under D-52, glTF's meaning is strict, and glTF allows `COLOR_0` in a target. three.js morphs vertex colors through `morphAttributes.color`. Development builds had noted color targets, and the mesh drew them at rest.

- **Storage.** A color's delta is one more texel of each entry, red, green, blue and alpha in half floats, after the tangent's. It shares the texture of deltas and its cap of 4,194,304 texels, 32 MiB. A color target of three values per vertex takes an alpha delta of 0. The vertex's morph attribute counts entries times 8, so the count keeps three bits for the kinds of delta. A count of 255 entries then gives 2,047, which a 32-bit float holds exactly.
- **WebGPU.** The skinning pass adds each entry's color delta times its weight, and writes the color as four 32-bit floats. A morphed mesh's skinned vertex format therefore holds its colors as floats, whatever type the mesh holds them in. This costs 12 more bytes per skinned vertex for a mesh of 8-bit colors, only for morphed meshes with colors. The pass copied colors unchanged before. The color's code sits in the pass's VERTEX_COLOR builds, which skin only morphed formats with a color. The tangent's code sits in its VERTEX_TANGENT builds in the same way. A build without the bit holds no color code at all. Adreno 830 runs a write behind a runtime check even where the check is false ("Browser faults" in the [implementation notes](../implementation-notes.md)).
- **WebGL2.** `morph_vertex` adds the color deltas with the others, in the same loop over the vertex's entries. The lit, unlit and unlit map templates pass the vertex color in and take the morphed one out under VERTEX_COLOR. The shadow, texture coordinate and debug templates pass white and ignore the result, which the shader compiler drops.
- **Clamping.** The glTF specification says that clients should clamp `COLOR_0` to 0 to 1 after morphing. null3D does so where the vertex's entries hold colors. three.js r186 does not clamp. The two engines then differ only where the weights push a color past 0 or 1.
- **Targets that leave an attribute out.** The specification reads a left-out attribute as a delta of 0. The loader now gives every target a list for each attribute that any target moves, with zeros where a target leaves it out. Before, a later target that moved an attribute which the first target left out failed the file. three.js r186's GLTFLoader reads a left-out color or position delta as the base attribute, which `morphTargetsRelative` then adds. That is a three.js fault, and null3D follows the specification.
- **Types.** A color delta may be floats or normalized 8-bit or 16-bit integers, signed or not, with three or four values, as the specification's table allows. A target of four values on colors of three values keeps no alpha. The loader refuses integers that are not normalized. A primitive without `COLOR_0` must not have color targets; the loader notes them and leaves them out.
- **three.js's renderers.** r186's WebGPURenderer packs color targets into its morph texture. Its vertex stage adds only position and normal deltas, so it draws the colors at rest. Its WebGLRenderer fails to compile a program for color targets on colors without alpha. Its `vColor` is a `vec4`, and the morph chunk adds a `vec3` to it. The parity scene therefore uses colors with alpha, and compares every tier with WebGLRenderer.
- **The shader download.** The color work adds 0.2 to 0.4 KB after Brotli to each of the eight WebGL2 morph shader files. They take 19.9 to 21.7 KB with colors, against 19.7 to 21.4 KB on main and their limit of 24 KB. The glTF worker grows by 222 bytes after Brotli (2.2%). It reads the color targets' types, and fills the targets that leave attributes out.
- **A WebGL2 fault on the way.** WGSL's `countOneBits` becomes GLSL's `bitCount`, which GLSL ES 3.00 lacks: it came in GLSL ES 3.10. Every WebGL2 MORPH program failed to link with it. The stride of an entry adds its three bits one by one instead. [Implementation notes](../implementation-notes.md) records the fault.

### Measurements

The image test `gltf-morph-colors` loads a file that the test makes in code (`colorMorphBuilder` in `tests/pages/lib/gltf-files.ts`). It has three panels of one mesh, with two targets at weights 0.75 and 0.4. The left panel has 8-bit colors with targets of three values, one of them sparse. The middle panel blends, with float colors whose targets fade the alpha, one in normalized 16-bit integers. The right panel's 16-bit colors have no color targets, so its skinned colors on WebGPU are converted, not morphed. References exist in both sets, on all three tiers.

The parity check compares it with three.js r186's WebGLRenderer on every tier, by three.js's rule of under 0.1% of the pixels:

| GPU set | WebGPU | Compatibility mode | WebGL2 |
| --- | --- | --- | --- |
| The Mac's GPU | 0.000% | 0.000% | 0.000% |
| SwiftShader | 0.000% | 0.000% | 0.000% |

Against three.js's WebGPURenderer, which leaves the color targets out, 13.0% of the pixels differ. So the scene catches color targets that a renderer does not draw. The earlier morph scenes did not change. The 26 morph image tests pass on both sets. Their parity figures on the Mac match those of the first measurements within 0.01% of the pixels.

`bun run bench:allocation --morphed 64` now gives the 64 spheres vertex colors that their three targets change. Every place stayed within its budget on both GPU paths. The sketch worker took 328.8 bytes per frame on WebGPU and 342.5 on WebGL2, and the render worker 558.0 and 149.4.

## How three.js handles it

`BufferGeometry.morphAttributes` holds every target's full attribute arrays, and `Mesh.morphTargetInfluences` holds the weights. The `morphTargetDictionary` maps names to indices. Since r133 its WebGL renderer packs every target into a 2D array texture. Each vertex shader reads every target whose weight is not 0, with no cap. The `morphTargetsRelative` flag marks the arrays as deltas, as glTF stores them. Its `AnimationMixer` animates `morphTargetInfluences[k]` through a property track per mesh. It restores the original value when no action plays.

## Consequences

- `crates/null3d-core/src/morph.rs` holds the weight table and `posed_weight`; scene command 12 (`SET_MORPH`) links a block to an object.
- `crates/null3d-render/src/morph.rs` holds the sparse deltas, the morph texture, the cap and the bounds; both builders' skin modules bind the texture.
- `MorphTargets.colors` takes color targets in `geometry.fromArrays`, and the glTF loader reads `COLOR_0` targets into it.
- `Mesh.setMorphWeight` and `getMorphWeight`, `MeshArrays.morphTargets`, `MeshGeometry.morphTargets` and `morphTargetNames`, and the `morphTargets` quality setting are the public API.
- The record is in the table in [README.md](README.md).
