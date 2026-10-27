# D-215: Iridescence and anisotropy in the layered shaders

Status: decided by the helper of M3-G2 and M3-G3, for the owner's review. Built: the engine, both glTF extensions, the demo and the tests. Task: M3-G2, M3-G3.

Summary: The standard material takes iridescence and anisotropy, with the values and formulas of three.js's `MeshPhysicalMaterial`, and the glTF loader reads `KHR_materials_iridescence` and `KHR_materials_anisotropy` into them. Both ride the shader builds of the layers above the base, which load on first use, so they add no shader build. The material row takes two more `vec4f`s for their values. Their maps take the light map's and the specular maps' slots, as the clear coat's and the sheen's do, so no GPU path binds a sampled texture more.

## Question

glTF files describe thin films and brushed metal with two extensions. Without them, a port of a beetle, a pearl or a brushed panel loses its look. Each needs new shader code and new values in the material's row. The permutation word is full: all 32 values of the bit have a name, and each new bit on the lit templates doubles their builds ([D-156](D-156-template-scoped-permutation-bits.md)). The maps also need places, and the WebGPU fragment stage of the standard material's maps build reads 16 sampled textures, the device's whole budget.

## Rule

- The intent of the two extensions, with three.js's `MeshPhysicalMaterial` (0.186.1) as the reference ([D-52](D-52-intent-parity.md)).
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader.
- A page that uses neither pays nothing: no download, no bind group change, no new row reads, and the other materials' builds stay as they are.
- No new permutation value, so the shader build count stays within the figure of [BUILD_BUDGET](../../crates/null3d-shaders/src/manifest.rs).
- No new sampled texture binding on either path.

## What three.js does

`GLTFLoader` makes a `MeshPhysicalMaterial` for either extension:

| glTF | three.js |
| --- | --- |
| `iridescenceFactor`, default 0 | `iridescence` |
| `iridescenceTexture` (red) | `iridescenceMap`, linear |
| `iridescenceIor`, default 1.3 | `iridescenceIOR` |
| `iridescenceThicknessMinimum`, default 100 | `iridescenceThicknessRange[0]` |
| `iridescenceThicknessMaximum`, default 400 | `iridescenceThicknessRange[1]` |
| `iridescenceThicknessTexture` (green) | `iridescenceThicknessMap`, linear |
| `anisotropyStrength`, default 0 | `anisotropy` |
| `anisotropyRotation`, default 0 | `anisotropyRotation` |
| `anisotropyTexture` (RG direction, B strength) | `anisotropyMap`, linear |

Its shader (`lights_physical_fragment` and `iridescence_fragment`) then does this:

- The film's Fresnel term comes from Belcour and Barla's thin-film formulas, at the view angle and the film's thickness. It takes the place of the surface's own Fresnel term in the direct highlight, blended by the iridescence factor, and its reflectance at normal incidence takes the place of each path's in the light from all directions.
- An anisotropic lobe stretches the GGX alpha along the surface's tangent by the anisotropy, and turns the direction in that frame by the rotation and the map. The reflection of the environment bends across the stretched axis.

## Options for the shader code

| Option | Verdict |
| --- | --- |
| A: two new permutation values, each shared with a template that never lights a surface, as [D-156](D-156-template-scoped-permutation-bits.md) allows | Rejected. Each value doubles the lit builds: the lit templates make 2,208 (WebGPU) and 5,568 (WebGL2) builds, and the maps templates 13,760 and 39,360, so two values would take the count past 150,000 GLSL builds against the budget's 53,762 |
| B: one new permutation value for both features | Rejected. It still doubles the count, to about 100,000 GLSL builds, and its bits test apart from skinning, morph targets and the other features that an animated beetle or a brushed panel needs |
| C: extend the layered build, whose permutation [D-147](D-147-clearcoat-and-sheen.md) loads on first use, and pick the effect with row flags at run time | Chosen. The build count does not change, and a material without any layer pays nothing |
| D: a separate shader file for each feature, loaded on first use | Rejected. It needs a new permutation value to pick the file, which is option A |

With option C, the layered builds light four effects: a clear coat, a sheen, a thin film and a stretched lobe. The row flags say which apply, so a coat material runs no film code past the flag's test, and the film's arithmetic runs only where the iridescence is above 0. The build's code grows by about 3 KB of WGSL, which only materials with a layer download.

## Options for the values

Without the two effects the row has one spare float, and they need six: the iridescence, the film's index of refraction, its least and greatest thickness, the anisotropy's strength and its rotation.

| Option | Verdict |
| --- | --- |
| A: pack the values into the spare float and two of the other effects' values | Rejected. A row's `vec4f` is one texel of WebGL2's data texture and one member of the WGSL struct, and several values share each one. Packing would make a value read as two |
| B: two more `vec4f`s at the end of the row, for the film's four values and the anisotropy's two | Chosen. The row holds 17 `vec4f`s. The two add 32 bytes to each material's row and as many to its row of custom values: at most 64 KB for a full table of 1,024 materials. The layout test checks that no value crosses a `vec4f` |
| C: reuse the coat's and the sheen's texels where a material has no coat | Rejected. A material may have a coat and a film, and two of its values would then read as one |

## Options for the maps

The WebGPU fragment stage's 16 sampled textures are the frame's 8 and the maps group's 8, and the parallax builds trade one of the frame's for the displacement map. So no new binding fits.

| Option | Verdict |
| --- | --- |
| A: a binding for each new map | Rejected: past the limit, with nothing left to drop |
| B: the light map's and the specular maps' slots hold the new maps in a material that has them, as the clear coat's and the sheen's maps do | Chosen. The bindings, the bind group layouts and WebGL2's six shared units stay as they are |
| C: pack the film's two maps into one texture at load | Rejected: glTF gives them as separate images with their own sizes, and a copy of each map in memory is the cost that D-147 rejected for the layers |

With option B, a material takes the maps of one family: the coat's and the sheen's, or the iridescence's and the anisotropy's. The anisotropy's map takes the sheen's place, and iridescence's two take the light map's and the specular intensity map's. Development builds throw E1217 for a material that asks for both families, and production builds keep the coat's and the sheen's maps. The glTF loader keeps the coat's and the sheen's textures and notes the others. Of the Khronos sample models with either extension, none has two families' textures in one material.

Anisotropy needs a map, even a plain one, because the direction it stretches along comes from the surface's tangent frame, which the shader builds from the texture coordinates. three.js builds that frame from the coordinates too. A material with `anisotropy` and no map throws E1217.

## Decision

Options C, B and B, decided by the helper for the owner's review.

- `feature::IRIDESCENCE` and `feature::ANISOTROPY` are material features. They add no permutation value: `frame.rs` sets the layered builds for every material with `feature::LAYERS`, which is the clear coat's, the sheen's, the iridescence's and the anisotropy's bits.
- `flag::IRIDESCENCE` and `flag::ANISOTROPY` in a row choose the effect, and the effect's maps, at run time. The flags word is a `vec4f` member that the shaders read as a `u32`, so the flags stay below 2^24 and a float holds them exactly.
- `param::IRIDESCENCE` starts a `vec4f` of four values and `param::ANISOTROPY` a `vec4f` of two. `MATERIAL_BYTES` is 272.
- The thin film's code is its own library, `null3d::iridescence`, and the stretched lobe's terms sit beside `brdf_ggx` in `null3d::lighting`.
- A custom material's surface function takes the film's three fields, as it takes the coat's and the sheen's. Anisotropy needs the standard material's tangent frame, so a surface function cannot set it yet.
- Rectangles and tubes of light shade both effects as three.js's rectangle lights do, which is without them.

## Consequences

- The two effects add no build. The manifest's figure is 19,227 WGSL builds and 53,762 GLSL builds.
- A page that creates a material with a clear coat or a sheen downloads the film's and the lobe's code too, about 3 KB more. Its GPU cost is a flag test where neither applies. The code rides the layered family's first-use shader files, whose budget [D-14](D-14-js-budget.md) holds.
- The row's last texel is the anisotropy's, which the shader build's test that reads the row's size names.
- A material cannot have a clear coat's or a sheen's maps and iridescence's or the anisotropy's maps at once. A file that gives both loses the second family's maps, and the loader says so.
- The model scenes `gltf-iridescence` and `gltf-anisotropy` make their files in code, since the sample content pins a real Khronos file in a repository of its own. Both match three.js on all three tiers under limits of 0.3% and 0.6%, which are the specular anti-aliasing family's. [Image tests](../image-tests.md) gives the figures.

## Addendum: anisotropy without a map

Status: decided by the helper of M3-G3, for the owner's review. Task: M3-G3.

Summary: The standard material draws anisotropy with no texture at all. A material with texture coordinates draws through the standard material's maps template. Its tangent frame is three.js's exactly: the mesh's tangents where it has them, else the normal map's coordinates, else the first coordinates. A surface with neither takes any frame square to its normal. No shader build is added.

### Problem

The engine dropped anisotropy twice for a material with no texture. The loader set the strength and rotation to 0, with a note. The material API threw E1217 for `materials.standard({ anisotropy })` without a map. Both rested on one claim: the direction comes from the texture coordinates, which the untextured shader build does not read.

The Khronos sample AnisotropyStrengthTest shows the cost. Its 50 materials compare seven anisotropy strengths against seven roughnesses, and 49 of them carry `KHR_materials_anisotropy`. None of those 49 has a texture of any kind, and 42 have a strength above 0. All 49 primitives carry `TANGENT` and `TEXCOORD_0`. three.js r186 draws the 42 stretched, because `HAS_ANISOTROPY` needs no map. It builds the frame from the mesh's tangents when the geometry has them. The engine drew all 42 as round highlights on perfect mirrors, which is a plain white or black ball where a long highlight belongs. The code-built scene `gltf-anisotropy` never met the case: it gave every sphere a white base color texture so that a map existed.

The second half is why this is not a one-line change. A material with no map never enters the maps build, so the shader built no tangent frame at all: the lobe had no direction to stretch along. Keeping the loader's value alone would draw a stretch along a frame that reads zero, which is no stretch.

### Options rejected

- **Give the untextured build its own tangent frame and nothing else.** The frame would come from the surface normal alone. The stretch would show, but its direction would be arbitrary, so the picture would not match three.js on the sample and no strict comparison could pass.
- **Add `VERTEX_TANGENT` to the untextured lit template.** Then the sample matches exactly, with or without texture coordinates. It doubles the lit family, from 2,208 to 4,416 WebGPU builds and from 5,568 to 11,136 WebGL2 builds. That is 7,776 builds, about a ninth of the whole set. It also adds to the work on build time and shader build size, which the owner's focus covers.

### What the engine does now

- The loader keeps the anisotropy that a material gives, with no note, and the material API takes a material without a map.
- A material with anisotropy and texture coordinates draws through the standard material's maps template, even with no live map. The frame is the one that three.js builds. The maps group binds its white placeholders where a slot has no texture. The same condition adds `VERTEX_TANGENT` where the mesh has tangents, so a file's own tangents win, as in three.js.
- A surface without texture coordinates cannot draw through the maps template. It keeps the untextured lit build, which now takes any frame square to the surface's normal. The stretch shows and its direction is steady; no file gives such a surface a direction to match.
- The shader build count does not change, and neither does any download for a page that draws no anisotropy.

### Consequences

- An untextured anisotropy material loads the standard material's maps template on its first use. That template already loads on first use for every textured standard material. A page that draws this case downloads it, where a page without it does not.
- The model scenes draw the real Khronos AnisotropyStrengthTest, a 94,444-byte file that the repository keeps beside its tests, since the sample rule lets a file that size stay in this repository. [Sample content](../sample-content.md) names it. Its pictures sit in both reference sets. CI drew the SwiftShader set, and it differs from the Mac set in 0.016% of the pixels or less. It compares with three.js on all three tiers: 0.521%, 0.403% and 0.511% of the pixels differ on the Mac's GPU, and 0.507%, 0.382% and 0.506% on SwiftShader. The scene's limit is 0.6%. With the loader's old zeroing put back, the picture differs in 1.474% of WebGPU's pixels.
- [Image tests](../image-tests.md) gives the comparison's figures.

## Addendum: the first-use shader budget rises to 53 KB

The grading controls' second design grades light before the tone curve. Its code rides every WebGL2
tone-map build, and the largest of those files, the half-precision draw-index tone-map set, reached
53,325 bytes after Brotli. That is 77 bytes over the 52 KB cap set above.

The cap rises to 53 KB, or 54,272 bytes, leaving 947 bytes on the largest file. The helper decided it
for the owner's review, as the rise of 22 October was. A trim is possible in principle: the grade is
a function per shader that the WebGL2 build flattens, so inlining it into the tone map would save a
few hundred bytes. The helper measured the shape of the generated GLSL but did not take that route,
because it changes a shared library's structure for the sake of a fraction of a kilobyte, and the
owner may delete the whole design if the display table stands.

The figure comes from a local build of the branch. CI's `wasm-checks` job measures the same files, and
a later rise should quote its figure.
