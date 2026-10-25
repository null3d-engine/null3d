# D-215: Iridescence and anisotropy in the layered shaders

Status: decided by the helper of M3-G2 and M3-G3 on 22 October 2026, for the owner's review. Built: the engine, both glTF extensions, the demo and the tests, not yet on main. The owner's review is pending. Date: 2026-10-22. Task: M3-G2, M3-G3.

Summary: The standard material takes iridescence and anisotropy, with the values and formulas of three.js's `MeshPhysicalMaterial`, and the glTF loader reads `KHR_materials_iridescence` and `KHR_materials_anisotropy` into them. Both ride the shader builds of the layers above the base, which already load on first use, so the shader build count does not grow. The material row takes two more `vec4f`s for their values. Their maps take the light map's and the specular maps' slots, as the clear coat's and the sheen's do, so no GPU path binds a sampled texture more.

## Question

glTF files describe thin films and brushed metal with two extensions that the engine ignores today, so a port of a beetle, a pearl or a brushed panel loses its look. Each needs new shader code and new values in the material's row. The permutation word is full: all 32 values of the bit have a name, and each new bit on the lit templates doubles their builds ([D-156](D-156-template-scoped-permutation-bits.md)). The maps also need places, and the WebGPU fragment stage of the standard material's maps build reads 16 sampled textures already, the device's whole budget.

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
| C: extend the layered build, whose permutation [D-147](D-147-clearcoat-and-sheen.md) already loads on first use, and pick the effect with row flags at run time | Chosen. The build count does not change, and a material without any layer pays nothing |
| D: a separate shader file for each feature, loaded on first use | Rejected. It needs a new permutation value to pick the file, which is option A |

With option C, the layered builds light four effects: a clear coat, a sheen, a thin film and a stretched lobe. The row flags say which apply, so a coat material runs no film code past the flag's test, and the film's arithmetic runs only where the iridescence is above 0. The build's code grows by about 3 KB of WGSL, which only materials with a layer download.

## Options for the values

The row had one spare float, and the two effects need six: the iridescence, the film's index of refraction, its least and greatest thickness, the anisotropy's strength and its rotation.

| Option | Verdict |
| --- | --- |
| A: pack the values into the spare float and two of the other effects' values | Rejected. A row's `vec4f` is one texel of WebGL2's data texture and one member of the WGSL struct, and several values share each one. Packing would make a value read as two |
| B: two more `vec4f`s at the end of the row, for the film's four values and the anisotropy's two | Chosen. The row grows from 15 to 17 `vec4f`s, which is 32 bytes for each material's row and as many for its row of custom values: at most 64 KB for a full table of 1,024 materials. The layout test checks that no value crosses a `vec4f` |
| C: reuse the coat's and the sheen's texels where a material has no coat | Rejected. A material may have a coat and a film, and two of its values would then read as one |

## Options for the maps

The WebGPU fragment stage's 16 sampled textures are the frame's 8 and the maps group's 8, and the parallax builds already trade one of the frame's for the displacement map. So no new binding fits.

| Option | Verdict |
| --- | --- |
| A: a binding for each new map | Rejected: past the limit, with nothing left to drop |
| B: the light map's and the specular maps' slots hold the new maps in a material that has them, as the clear coat's and the sheen's maps do | Chosen. The bindings, the bind group layouts and WebGL2's six shared units stay as they are |
| C: pack the film's two maps into one texture at load | Rejected: glTF gives them as separate images with their own sizes, and a copy of each map in memory is the cost that D-147 rejected for the layers |

With option B, a material takes the maps of one family: the coat's and the sheen's, or the iridescence's and the anisotropy's. The anisotropy's map takes the sheen's place, and iridescence's two take the light map's and the specular intensity map's. Development builds throw E1217 for a material that asks for both families, and production builds keep the coat's and the sheen's maps. The glTF loader keeps the coat's and the sheen's textures and notes the others. Of the Khronos sample models with either extension, none has two families' textures in one material.

Anisotropy needs a map, even a plain one, because the direction it stretches along comes from the surface's tangent frame, which the shader builds from the texture coordinates. three.js builds that frame from the coordinates too. A material with `anisotropy` and no map throws E1217.

## Decision

Options C, B and B. The helper decided on 22 October 2026; the owner's review is pending.

- `feature::IRIDESCENCE` and `feature::ANISOTROPY` are material features. They add no permutation value: `frame.rs` sets the layered builds for every material with `feature::LAYERS`, which is the clear coat's, the sheen's, the iridescence's and the anisotropy's bits.
- `flag::IRIDESCENCE` and `flag::ANISOTROPY` in a row choose the effect, and the effect's maps, at run time. The flags word is a `vec4f` member that the shaders read as a `u32`, so the flags stay below 2^24 and a float holds them exactly.
- `param::IRIDESCENCE` starts a `vec4f` of four values and `param::ANISOTROPY` a `vec4f` of two. `MATERIAL_BYTES` grows from 240 to 272.
- The thin film's code is its own library, `null3d::iridescence`, and the stretched lobe's terms sit beside `brdf_ggx` in `null3d::lighting`.
- A custom material's surface function takes the film's three fields, as it takes the coat's and the sheen's. Anisotropy needs the standard material's tangent frame, so a surface function cannot set it yet.
- Rectangles and tubes of light shade both effects as three.js's rectangle lights do, which is without them.

## Consequences

- The build count does not change. The manifest's figure stays at 19,227 WGSL builds and 53,762 GLSL builds.
- A page that creates a material with a clear coat or a sheen downloads the film's and the lobe's code too, about 3 KB more. Its GPU cost is a flag test where neither applies.
- The row's last texel is the anisotropy's, which the shader build's test that reads the row's size now names.
- A material cannot have a clear coat's or a sheen's maps and iridescence's or the anisotropy's maps at once. A file that gives both loses the second family's maps, and the loader says so.
- The model scenes `gltf-iridescence` and `gltf-anisotropy` make their files in code, since the sample content pins a real Khronos file in a repository of its own. Both match three.js on all three tiers under limits of 0.3% and 0.6%, which are the specular anti-aliasing family's. [Image tests](../image-tests.md) gives the figures.

## Addendum, 25 October 2026: the first-use shader budget rises to 53 KB

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
