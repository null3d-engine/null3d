# D-51: Morph targets

Status: decided, 2026-10-04. Task: M2-C5.

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

A target of a face moves a small part of the face. three.js's morph texture holds every vertex of every target, so a face of 52 targets stores 52 copies of its vertices. The engine stores, for each vertex, only the targets that move it. An entry is one texel of the position's delta, with the target's number in its fourth value. A texel of the normal's delta and one of the tangent's follow, where the targets move them. Each vertex gets a morph attribute at location 8: its first entry's texel, and its count of entries. An RGBA16F texture, 2,048 texels wide, holds every mesh's entries. A small RGBA32F texture of the same width holds each morphed object's weights, four to a texel. That width is the widest that every WebGL2 device takes.

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

### The shader download

The MORPH bit doubles the WebGL2 mesh builds. In each start shader file they would have taken it past the file's size. So the MORPH builds go into eight shader files of their own, one for each value of the bits that a device fixes. A page loads the one it needs when its first pipeline with the MORPH bit asks for it. Until it arrives, that pipeline waits, as a custom material's pipeline waits for its shader.

Sizes after Brotli at quality 11, from `bun run build` on 4 October 2026:

| Files | Before compression | After Brotli |
| --- | --- | --- |
| The 12 start shader files | 1.7 to 3.4 MB | 23.2 to 24.4 KB |
| The 8 morph shader files | 2.8 to 3.3 MB | 18.6 to 20.5 KB |

The engine's other files that load later have a budget of 16 KB each. The morph shader files cannot fit it, as each holds every MORPH build of one device's bits. The owner decided on 4 October 2026 that shader files that load on first use have a limit of their own. It is the size of the start shader file, about 24 KB after Brotli. `ON_DEMAND_SHADER_BUDGET_BYTES` in `tools/lib/size-report.ts` holds it, and the size check enforces it.

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
- The MORPH builds load on demand, in shader files whose limit is the start shader file's size.
- Custom materials draw morphed meshes at rest on WebGL2.
- Color morph targets are a gap. three.js morphs vertex colors through `morphAttributes.color`, and glTF allows `COLOR_0` in a target. The engine reads targets of positions, normals and tangents. Development builds note a file's other targets, and the mesh draws them at rest. Colors would add a texel to each entry, and a color input to each template's MORPH build. No sample model or port needs them yet.

## How three.js handles it

`BufferGeometry.morphAttributes` holds every target's full attribute arrays, and `Mesh.morphTargetInfluences` holds the weights. The `morphTargetDictionary` maps names to indices. Since r133 its WebGL renderer packs every target into a 2D array texture. Each vertex shader reads every target whose weight is not 0, with no cap. The `morphTargetsRelative` flag marks the arrays as deltas, as glTF stores them. Its `AnimationMixer` animates `morphTargetInfluences[k]` through a property track per mesh. It restores the original value when no action plays.

## Consequences

- `crates/null3d-core/src/morph.rs` holds the weight table and `posed_weight`; scene command 12 (`SET_MORPH`) links a block to an object.
- `crates/null3d-render/src/morph.rs` holds the sparse deltas, the morph texture, the cap and the bounds; both builders' skin modules bind the texture.
- `Mesh.setMorphWeight` and `getMorphWeight`, `MeshArrays.morphTargets`, `MeshGeometry.morphTargets` and `morphTargetNames`, and the `morphTargets` quality setting are the public API.
- The record is in the table in [README.md](README.md).
