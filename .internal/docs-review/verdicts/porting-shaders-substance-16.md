# porting-shaders-substance-16

## The finding as given

- page: porting/threejs-shaders, porting/threejs-postprocessing
- anchor: shaders line 121 'up to 32 numbers in all'; postprocessing line 125 'up to 32 floats in all'
- category: wrong-claim
- severity: medium
- claim: For a custom material each texture takes one of the 32 numbers, and vec2f/vec3f/vec4f align. 'Pass a matrix as vec4f rows' costs 16 numbers, unstated. A ShaderMaterial port with a mat4 and textures hits the build limit with no warning from this page.
- evidence: docs/shaders/surface-functions.md:245,283; packages/engine/src/generated/core.ts:351 (EFFECT_FLOATS = 32)
- proposedEdit: Shaders page: 'The uniforms fit in 32 numbers, less one for each texture. Each vec3f and vec4f starts a group of four, and a mat4x4f passed as four vec4f rows takes 16 ([Uniforms](../shaders/surface-functions.md#uniforms)).'

Verdict: partly

## Evidence

- docs/porting/threejs-shaders.md:121 says "up to 32 numbers in all" and says nothing about textures or alignment. Line 115 says a material takes up to 6 textures, but not that each one costs a number.
- docs/porting/threejs-postprocessing.md:125 already says "Each vec3f and vec4f starts a new group of four floats". It does not say that each texture costs a number, and it does not mention the even start of a vec2f.
- The code backs the finding. crates/null3d-shaders/src/uniforms.rs:4 and :18: a material's row holds 32 floats, and the layers of its textures take the last floats, one each. uniforms.rs:172-178: a vec3f or vec4f starts at a multiple of 4, and a vec2f at an even float. crates/null3d-shaders/src/textures.rs:29-30: the same holds for a custom effect ("a custom material or effect ... their layers take the last floats of its values"). docs/guides/custom-passes.md:114 says this for effects.
- docs/shaders/surface-functions.md:245 and :283 state the texture cost and alignment for materials. The porting page links that page at line 26 and line 303, but not from the uniforms sentence.

## What does not hold

- "With no warning" is overstated. When the uniforms do not fit, the build stops with a clear message: "the uniforms of a custom material hold 32 numbers at most, less one for each of the N textures, with each vec3f and vec4f starting a group of four" (uniforms.rs:186-190). The reader finds out at build time, with the cause named.
- "A mat4 and textures hits the build limit" is not true in general. A mat4 as four vec4f takes 16, and 6 textures take 6, so 10 numbers stay free. Only a port with a mat4, many textures and several more uniforms runs out.
- "Costs 16 numbers, unstated" is weak: four vec4f is plainly 16. The real gap is the texture cost and the alignment, which a porter cannot guess.
- The finding names both pages but its edit fixes only the shaders page. The postprocessing page has the same gap for textures, since effects reserve one float per texture too.
- Severity fits low-to-medium, not a misleading claim: the page undercounts, and the build explains the limit.

## Corrected claim

Both porting pages give a budget of 32 numbers without saying that each texture takes one of them (true for materials and effects alike). The shaders page also leaves out that a vec3f or vec4f starts a group of four and a vec2f starts at an even place. A port can then run out of room sooner than the page suggests. The build error names the cause, so the reader is not left without a clue.

## Corrected edit

Shaders page, line 121:
"Uniforms take `f32`, `i32`, `u32`, `vec2f`, `vec3f` and `vec4f`, in 32 numbers less one for each texture. Each `vec3f` and `vec4f` starts a group of four, so a matrix passed as four `vec4f` takes 16 ([Uniforms](../shaders/surface-functions.md#uniforms)). Rename a uniform called `color`, `roughness` or another standard value, because those names belong to the material."

Postprocessing page, line 125: change "up to 32 floats in all" to "in 32 floats, less one for each texture in the `textures` option".

Side note, outside this finding: line 121 says "Pass a matrix as `vec4f` rows". WGSL's `mat4x4f(a, b, c, d)` takes columns, and line 108 says both engines store matrices by column. A porter who passes three.js's `elements` in order gets columns, not rows. The edit above avoids the word "rows"; another finding may want to check it.
