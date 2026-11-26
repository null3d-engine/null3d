# porting-shaders-readability-17

## Finding as given

- page: porting/threejs-postprocessing
- anchor: Line 125 "Uniforms are `f32`..." (stats 118); line 210 "For any other curve, `post.set` takes the WGSL..." (stats 203)
- category: long-paragraph
- severity: medium
- claim: Line 125 packs types, a size limit, packing, color strings and errors into 70 words and 5 sentences. Line 210 packs the function shape, when it runs, what follows, the vignette and the uniform rule into 70 words and 6 sentences.
- evidence: stats.json porting/threejs-postprocessing longParagraphs.
- proposedEdit: Line 125: a list of allowed types; up to 32 floats, each vec3f and vec4f starting a group of four; a vec3f takes a color string; a wrong name fails the type check and throws E1216. Line 210: keep the function signature and "A tone curve takes no uniforms" in the text, and move the order of steps (after bloom, clamp, sRGB, grading, dithering, vignette first) into a short list or a technical details block.

Verdict: partly

## Evidence

- stats.json lists both paragraphs: line 118, 70 words, 5 sentences; line 203, 70 words, 6 sentences. The page has 7 lines of front matter, so these are page lines 125 and 210. The counts hold.
- Page line 125 says what the finding says. E1216 is the right code: its cause in packages/engine/src/errors/codes.ts:184-190 covers "a custom material's or effect's uniforms". So the proposed list keeps true facts.
- Page line 210 says what the finding says. It also mentions the vignette out of order: it lists clamp, sRGB, grading and dithering, then says the vignette "has darkened the color already". That reversal is a real cost to a reader, so a break here is worth it.
- AGENTS.md "Writing docs" has no paragraph length rule, only a 25-word sentence limit. Both paragraphs keep every sentence short (about 12 to 14 words). At 70 words, neither is a wall of text. The cost to a reader is small, so medium overstates it.
- The next paragraph (page line 212) builds on "the exposed linear color": "null3D's color arrives exposed, so leave that step out and copy the exposure." The fact that the color arrives exposed and linear is what a porter needs, so it must stay in the main text, not only inside a closed block.

## Corrected claim

Both paragraphs pack several facts into short sentences. Line 210 also puts the vignette step after the steps that follow it, which is confusing. Line 125 reads as a list of rules written as prose. The cost is polish, not a real barrier: severity low.

## Corrected edit

- Line 125: make it a short bullet list (allowed types; a limit of 32 floats in all; a vec3f takes a color string, converted from sRGB to linear; a name that the WGSL does not declare fails the TypeScript check and throws E1216 at run time). Keep the link to Porting shaders as its own sentence after the list. Put the rule that each vec3f and vec4f starts a new group of four floats in a "Technical details: how uniforms are packed" block, because it matters only to someone who counts against the 32-float limit.
- Line 210: keep in the text the WGSL signature, "The engine calls it with the exposed linear color of each pixel" and "A tone curve takes no uniforms". Move the step order into a "Technical details: where the tone curve runs" block, in pipeline order: the curve runs after bloom and the vignette, then the engine clamps to 0 to 1, encodes sRGB, grades and dithers. The source (packages/engine/src/scene/post.ts:2-8) confirms the vignette runs before the tone mapping and grading after it; keep the page's wording for bloom.
