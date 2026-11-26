# porting-shaders-substance-23

## Finding as given

- Page: porting/threejs-postprocessing
- Anchor: stats lines 118 and 203 (uniform rules; custom tone curve)
- Category: long-paragraph. Severity: low.
- Claim: The uniform layout rules and the tone curve's call order are reference detail in running text.
- Evidence: stats.json longParagraphs for porting/threejs-postprocessing
- Proposed edit: Keep 'Uniforms are numbers and vectors, up to 32 floats in all' and 'The WGSL declares fn toneCurve(color: vec3f) -> vec3f, and takes no uniforms.' Move alignment, colour strings, E1216, and the clamp/grade/dither order into <details><summary>Technical details: ...</summary> blocks.

Verdict: partly

## Evidence

- stats.json lists two paragraphs: line 118 (70 words, 5 sentences) and line 203 (70 words, 6 sentences). Both are under the 90-word limit. They are flagged only for sentence count, and their sentences are short, as the writing rules ask. In the generated page they sit at lines 125 and 210.
- Uniform paragraph (page line 125):
  - The colour-string sentence must stay in the main text. The fog example on the same page (line 183) passes `color: '#b0c4d8'` to a `vec3f` uniform. With the block closed, the example would depend on hidden text.
  - The alignment sentence must stay next to the 32-float limit. Without it, "up to 32 floats" misleads: each `vec3f` uses four floats, not three. A reader who counts three per `vec3f` goes past the limit.
  - The E1216 sentence is one short sentence about an error a porter will hit. Keeping it costs little. guides/custom-passes.md:90-92 repeats the same rules, so the page could link there. Hiding them in a block adds nothing.
  - A rewrite to "numbers and vectors" also drops the exact type list (`f32`, `i32`, `u32`, `vec2f`, `vec3f`, `vec4f`). A porter needs that list to write `struct Uniforms`.
- Tone curve paragraph (page line 210):
  - "The engine calls it with the exposed linear color of each pixel, after bloom" must stay. The next paragraph (line 212) depends on it: "null3D's color arrives exposed, so leave that step out".
  - The order after the curve (clamp, sRGB, grade, dither) and the vignette sentence are reference detail. The Mermaid diagram at the top of the page shows that order already (final pass: vignette, tone curve, FXAA, sRGB, outlines, grading, sharpening, dithering). These two sentences can go into a block. That part of the finding holds.

## Corrected claim

Only the tone curve paragraph holds reference detail that can be folded: the order after the curve (clamp, sRGB encode, grade, dither) and the note that the vignette comes first. The uniform paragraph is short, and the example and the float budget depend on it. It should stay as it is.

## Corrected edit

Leave the uniform paragraph (line 125) as it is. In the tone curve paragraph (line 210), keep in the main text: "For any other curve, `post.set` takes the WGSL of a custom tone curve in place of a curve's name. The WGSL declares `fn toneCurve(color: vec3f) -> vec3f`. The engine calls it with the exposed linear color of each pixel, after bloom. A tone curve takes no uniforms." Move the last two pipeline sentences into a block:

<details>
<summary>Technical details: what runs after the tone curve</summary>

The engine clamps the curve's result to 0 to 1, then encodes sRGB, grades and dithers as usual. The vignette has darkened the color already.

</details>
