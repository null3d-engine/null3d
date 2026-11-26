# Verdict: concepts-2-readability-25

## Finding as given

- page: concepts/shadows
- anchor: "## On each GPU path", line 439
- category: technical-details-block
- severity: medium
- claim: One paragraph of 196 words and 12 sentences covers depth formats, the 32-bit atlas, perspective precision, comparison samplers, gather against single reads, and Apple sampling speed. A user needs one fact.
- evidence: stats.json concepts/shadows line 432: 196 words, 12 sentences.
- proposedEdit: Main text: 'WebGPU and WebGL2 draw the same shadows. WebGL2 reads each shadow map texel on its own, so it takes four times as many reads per pixel.' Move the rest into <details><summary>Technical details: shadow formats and reads on each path</summary>.

Verdict: survives

## Evidence

- stats.json lists the paragraph at line 432 (196 words, 12 sentences). In the generated copy it is line 439 of docs/concepts/shadows.md, the only paragraph of the "On each GPU path" section. It is the longest paragraph on the page.
- The content is implementer detail: texture formats (`depth16unorm`, `DEPTH_COMPONENT16`), a 32-bit float atlas, the 16-bit precision sum at a tile's far end, `sampler2DArrayShadow`, gather against single reads, and Apple GPU sampling speed. This is the kind of correct, dense detail that the user asked to move into a collapsible block.
- The proposed main text is correct against the code. In crates/null3d-shaders/wgsl/lib/shadows.wgsl, `sun_texels` (about lines 209-229) uses one `textureGather` for four texels on WebGPU. Under `#ifdef WEBGL2` it uses four `textureSampleCompareLevel` reads at texel centres instead. The atlas reads (lines 468 and 498) use `textureSampleCompareLevel` on both paths. So "four times as many reads" holds for the directional light's shadow map only, and the page uses "shadow map" for that map and "atlas" for the tiles.
- crates/null3d-shaders/src/glsl.rs rewrites zero-gradient `textureGrad` to plain `texture` on WebGL2, which matches the "reads the map at its own level" sentence. The detail is correct, so it should be moved, not cut.
- The main text still makes sense with the block closed. The cost of the extra reads is already given in "What shadows cost" (line 427: "16 or 36 reads").

## Small fix to the proposed edit

The proposed main text leaves out the last sentence's link to [Depth on each tier](backends.md#depth-on-each-tier). Keep that link in the main text, where a reader can see it with the block closed. Also name the directional light, because spot and point light tiles read the same way on both paths.

Suggested main text:

> WebGPU and WebGL2 draw the same shadows. On WebGL2, the directional light's filter reads each shadow map texel on its own, so it takes four times as many reads per pixel. [Depth on each tier](backends.md#depth-on-each-tier) explains how WebGL2 keeps WebGPU's depth values.
>
> <details>
> <summary>Technical details: shadow formats and reads on each path</summary>
>
> (sentences 2 to 11 of the current paragraph, split into two short paragraphs: formats and precision first, then sampling)
>
> </details>
