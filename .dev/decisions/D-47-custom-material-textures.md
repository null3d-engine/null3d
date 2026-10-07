# D-47: Custom material textures, uniform room and material destroy

Status: decided. Date: 2026-10-04. Task: M2-J3.

Summary: A custom material's WGSL declares `var name: texture_2d<f32>;`; the build binds it as a texture array in a map slot, declares `nameSampler`, and gives each texture function the layer, which the material's custom values hold for both stages. Up to 6 textures. The uniform room stays at 32 numbers less one per texture: the largest measured effect takes 17. `material.destroy()` draws nothing from the next frame and frees the id, and the template's pipelines, once nothing uses them.

## Question

Three questions about custom materials (`materials.shader`):

1. How does a sketch's WGSL sample textures of its own? The engine keeps every texture as a layer of a texture array, and WebGL2 has no texture views that pick one layer.
2. Is a row of 8 `vec4f` (32 numbers) of uniforms per material enough, once textures take room too?
3. What does `material.destroy()` free, and when, while objects may still name the material?

## Rule

- One way to sample, the same on WebGPU and WebGL2 and in both shader stages. It works on skinned meshes too: WebGL2 skins custom materials in their own vertex shaders, and WebGPU in the skinning pass.
- No new bind group layout, no new permutation bit and no new template: a custom material's textures reuse what the standard material's maps use.
- The textures reach the vertex stage on WebGPU, which reads no storage buffers there (the portable budget). So the texture layers cannot live in the storage buffer of material rows.
- Raise the uniform room only if an effect that a sketch or a showcase scene would draw does not fit.
- A destroyed material never shows through another material that takes its id while objects still name it.

## Data

### Uniform room

`the_row_of_custom_values_holds_the_measured_effects` in `crates/null3d-shaders/tests/material.rs` builds each effect below through the shader compiler. It counts the numbers of the row that it takes: whole `vec4f` groups for the uniforms, and one number for each texture's layer. The time and the camera come from the built-in values, so they take no room.

| Effect | Uniforms | Textures | Numbers of 32 |
| --- | --- | --- | --- |
| Clipping plane (port skill recipe) | `vec4f` | 0 | 4 |
| Matcap (port skill recipe) | none | 1 | 1 |
| Toon bands (port skill recipe) | `f32`, 2 `vec3f` | 0 | 12 |
| Dissolve with a noise texture | 3 `f32`, `vec3f` | 1 | 9 |
| Hologram | `vec3f`, 4 `f32` | 0 | 8 |
| Foliage wind with a gust texture | `vec3f`, 3 `f32` | 1 | 9 |
| Lit windows (city, S6) | `vec3f`, 3 `f32`, `vec2f` | 0 | 8 |
| Terrain splat | 2 `vec4f` | 5 | 13 |
| three.js `Sky` (Preetham) | 4 `f32`, 2 `vec3f` | 0 | 12 |
| three.js `Water`, without its mirror | 3 `f32`, 3 `vec3f` | 1 | 17 |

The largest takes 17 of the 32 numbers. The only effects found that do not fit are mirror reflections, such as three.js's `Water` with its `textureMatrix` (a `mat4`, 16 numbers, beside 17 more). They also need a pass that renders the reflection into a texture, and a `mat4` uniform type. The engine has neither for custom materials yet.

### Texture sampling

`crates/null3d-shaders/tests/material.rs` builds a material with two textures into every variant of the template. The surface function and the vertex offset both read them. The WebGL2 builds, the skinned ones included, read the height texture in the vertex stage and both textures in the fragment stage. The image tests `custom-textures` (all three tiers, every thread mode) and `skinning-custom-textures` (all three tiers, one image for all) draw them on the Mac's GPU and in SwiftShader. `crates/null3d-render/tests/custom_materials.rs` checks both frame builders. A textured custom material draws with the bind group of its map slots, and gets each texture's layer once its texels are on the GPU.

## Options

### Sampling

1. Rewrite the sketch's WGSL. The sketch declares `var name: texture_2d<f32>;`. The build replaces the declaration with a `texture_2d_array<f32>` in a map slot of the material's bind group, declares `nameSampler`, and gives each texture function call the material's layer. Chosen.
2. Bind a 2D view of the texture's layer, so the WGSL stays as written. Rejected: WebGL2 has no texture views, so a `sampler2D` cannot see one layer of a `sampler2DArray`.
3. Library functions such as `sampleTexture(slot, uv)`. Rejected: WGSL has no overloads, and a function picks a binding by a run-time slot only with a branch per slot. The sketch would also learn a second set of texture functions.
4. The sketch passes the layer itself, as `textureSample(t, s, uv, tLayer)`. Rejected: one more thing to know and get wrong, and a texture whose image has not arrived would sample another texture's layer.

The rewrite keeps every line where it was, so build errors still point at the sketch's own lines and columns. Its cost is that a texture can only go straight into a texture function. The build refuses a texture passed to a function of the sketch's own, with a message that says why. `textureSampleBaseClampToEdge` has no array form, so the build refuses it too.

The textures take the six map slots of the standard material's bind group layout, `MATERIAL_MAPS`, at group 1 on WebGPU and group 3 on WebGL2. A slot without a texture binds the white texel that standard map sets bind. Materials whose textures share arrays and samplers share bind groups, as standard materials do. The layout's stages grew from the fragment stage to both stages, so vertex offsets can read heights. Each stage now sees up to 7 sampled textures there and 10 in the fragment stage, within the 16 that WebGPU's default limits and compatibility mode allow.

### Where each layer lives

Each texture's layer is a float of the material's row of custom values, from the row's last float down. Texture 0 is at float 31, texture 1 at float 30, and so on. Both stages read that row (a data texture on WebGPU and part of the material table's data texture on WebGL2). The other choice, the map layers in the material row, is a storage buffer on WebGPU that vertex shaders cannot read. Each stage loads the layers once, into a private array, as it loads the uniforms. A layer is -1 until the texture's texels are on the GPU, and a call then gives white (`vec4f(1.0)`). A material that multiplies by its textures then draws its own values, as a standard material draws without a map that has not arrived. Picking another texture's array or a white texel per draw would need a rebuild of the draw tables each time a texture arrives.

At most 6 textures per material: the map slots. A sketch that needs more channels packs them into fewer textures.

### Uniform room

Kept at 8 `vec4f`. Every effect measured fits with room to spare, and the textures' layers take one number each. Raising the row would grow both data textures and the WebGL2 table's layout for no effect that the engine can draw today. Revisit it with a `mat4` uniform type or with reflection passes for custom materials.

### Destroy

`material.destroy()` marks the material destroyed in the core's material table. From the next frame, objects and batches that name it draw nothing, and its maps let go of their textures. Its id stays taken while any object or batch names it, so a new material cannot take it and show on those objects. A destroy is a structural change, so the next frame rebuilds the draw tables. Each rebuild marks the ids that objects and batches name, and gives back the ids of destroyed materials that none names. The next material created takes the lowest free id.

When no live material uses a custom material's template, the pipeline cache releases every pipeline of that template, and the next frame's draw list destroys them with the opcode `DESTROY_PIPELINE` (52). The WebGL2 backend deletes a program once no pipeline uses it. Released pipeline ids are never handed out again, because a capture replays a frame's list a second time: a new pipeline under an old id could then be destroyed by the replay. Backends ignore an id they do not hold for the same reason. A template that comes back, when the sketch makes a material of the same WGSL again, gets new pipeline ids. Each create and destroy cycle adds one dead key per pipeline to the cache, a few dozen bytes, which is acceptable for a call that runs outside the frame loop.

three.js's `material.dispose()` frees the GPU programs and leaves the material usable: a later draw compiles them again. null3D's `destroy` ends the material instead, and later calls throw E1101, as calls on other destroyed objects do. A sketch that wants the material again creates it again.

## Decision

Option 1 for sampling, layers in the row of custom values, the uniform room unchanged at 32 numbers less one per texture, and `destroy` with deferred release of ids and pipelines, as above.

## Consequences

- Shader compiler: `crates/null3d-shaders/src/textures.rs` reads the declarations and rewrites the WGSL. `material.rs` builds with `CUSTOM_TEXTURES`, and `uniforms.rs` leaves the texture layers' floats free. The compiled material lists `textures` with each layer's float. Full shaders take no textures.
- Template: `lit.wgsl` calls `load_custom_texture_layers` in both stages under `CUSTOM_TEXTURES`.
- Render: `CustomShading.textures`; the material table frees and reuses ids, writes each texture's layer into the custom values, and `SceneSettings::prepare_rebuild` releases unused ids and pipelines before each rebuild. Custom materials with textures bind a map set group.
- Draw list: `Op::DestroyPipeline` (52) leaves the reserved numbers. M2-J2 (hot reload) uses it for replaced shaders.
- Engine: the `textures` option, `material.destroy()`, the shading word's texture count (`SHADING_CUSTOM_TEXTURE_SHIFT`), and `WgslTextures` and `TextureValues` types read from WGSL text as D-32's uniforms are. The Vite plugin's declarations list each `.wgsl` file's textures.
- Docs: `shaders/surface-functions` (Textures), `api/materials` (Destroying a material, custom textures), `guides/custom-shaders`, E1216, and the `dispose` and `mat-shader` mapping entries. Skills: both `shaders.md`, the port skill's `materials.md` recipes, and the develop skill's quick reference.
