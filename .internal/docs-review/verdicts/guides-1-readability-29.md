# guides-1-readability-29

## Finding as given

- Page: guides/custom-shaders
- Anchor: ## Full shaders, rules at lines 89-96
- Category: wall-of-text, severity low
- Claim: Eight bullets; lines 90, 94 and 96 are 4-6 sentences. The attribute locations in line 90 are a lookup table written as prose.
- Evidence: line 90 "The position is at 0, the normal at 1, the first texture coordinates at 2 and the second at 3. The tangent is at 4, and the color at 5. The joints are at 6..."
- Proposed edit: Put locations in a table (location, attribute, type). Split line 94 into finish and finish_exposed bullets. Split line 96 into options that apply and options that do not reach a full shader.
- Generated source: none (hand-written page)

## Verdict: survives

## Evidence

- docs/guides/custom-shaders.md:89-96 holds eight bullets under the full-shader rules. Line 90 has 5 sentences and lists eight attribute locations in prose. Line 94 has 5 sentences (finish, exposure, the lights, finish_exposed). Line 96 has 5 sentences (options that apply, values that do not reach, vertexColors and mask, the shader's own work, the texture stop).
- stats.json does not list these lines as long paragraphs, since each is under 90 words. So this is a density issue, not a word-count issue. Low severity fits.
- The locations on the page match the code. crates/null3d-shaders/wgsl/pick.wgsl:70-81 declares position at 0 (vec3f), uv0 at 2 (vec2f), uv1 at 3 (vec2f), vertex_color at 5 (vec4f), joints at 6 (vec4u) and weights at 7 (vec4f).
- The finish split is accurate. crates/null3d-shaders/wgsl/lib/mesh.wgsl:856-870: finish applies the exposure and then calls finish_exposed; finish_exposed takes color that is already exposed, such as light from the frame's lights.
- A table is a real gain for implementers. Today only the joints have a WGSL type on the page, and a full-shader author must match each type. The page has no other place that lists the locations.
- No writing rule bars a table. The locations are needed to write any full shader, so they belong in the main text, not in a collapsible block.

## Refined edit

- Do not put the table inside the bullet list. A GFM table nested in a list item renders badly on many renderers. Shorten the bullet to "The vertex entry point reads the mesh at the engine's locations, in the table below. A mesh draws only when it has every attribute that the shader reads." Put the table (location, attribute, WGSL type) straight after the list.
- Take the types from the engine's shaders (pick.wgsl gives 0 vec3f, 2 and 3 vec2f, 5 vec4f, 6 vec4u, 7 vec4f). Check the normal (1) and tangent (4) types in the engine's mesh shaders before you publish them.
- Line 94: one bullet for finish (writes linear color, multiplies by the exposure as for an unlit color). One bullet for finish_exposed (for color that is already exposed, such as the sum of the frame's lights).
- Line 96: one bullet for the options that apply (doubleSided, depthBias). One bullet for what does not reach a full shader (standard values, uniforms and textures; vertexColors and the mask alpha mode do nothing, so the shader reads colors and discards pixels itself; the build stops at a texture that a full shader declares).
