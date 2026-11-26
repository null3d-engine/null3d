# guides-1-substance-25

## Finding as given

- page: guides/custom-shaders
- anchor: long paragraphs at lines 43, 175, 187
- category: long-paragraph
- severity: medium
- claim: Line 43 lists uniforms, textures, vertex offsets and lobes in one paragraph. Line 175 gives the battle comparison's build sizes in the main text. Line 187 (arrays in WGSL) sits under 'Where a custom effect's and a tone curve's builds go', where it does not belong.
- evidence: .internal/docs-review/stats.json guides/custom-shaders (statistics 36, 168, 180); docs/guides/custom-shaders.md:177-187.
- proposedEdit: Line 43: a short list. Line 175: one sentence ('A device downloads one small file, about 20 KB after Brotli') and a 'Technical details: measured build sizes' block linking compare/battle/. Line 187: move to 'What the plugin compiles' or the WGSL rules page.

## Verdict: survives

## Evidence

- stats.json lines 36, 168, 180 map to page lines 43, 175, 187 (the front matter is 7 lines). Counts: 100 words / 6 sentences, 87 / 5, 85 / 5.
- docs/guides/custom-shaders.md:43 lists four separate hooks (uniforms, textures and texture arrays, vertexOffset, lobe), each with its own syntax, then two links. A list of four items plus one link sentence reads better. The detail is already on docs/shaders/surface-functions.md (line 41, section "A material's own lobe" at 183), so a list loses nothing.
- docs/guides/custom-shaders.md:175 is a run of measured numbers (5 KB, 1,504 KB, 41 KB, 235-346 KB, 18-21 KB, 3-4 MB, 7 MB, 27 MB). The main point (the module stays small, a device downloads one small file) needs one sentence. The rest is good implementer detail for a collapsible block. The comparison exists: examples/compare/comparisons.ts:99 gives code 'compare/battle/'.
- docs/guides/custom-shaders.md:187 is about the WebGL2 build rewriting array returns and array constructors. It has nothing to do with where effect and tone-curve builds go (lines 177-185). It fits beside the WebGL2 build text at lines 154-164, or in docs/shaders/wgsl-rules.md, which already describes WebGL2 rewrites for phone GPUs (line 55, struct splitting) and array rules (line 53). I could not refute any part.

## Refined edit

- Line 175: keep both halves of the point in the main text, not only the download size. Suggested: "For example, the battle comparison's sketch has 5 custom materials, and its module takes 5 KB. A device downloads one file of about 20 KB after Brotli compression, and one more for its skinned meshes." Put the rest (module size with every build, raw file sizes, shader text kept in memory, totals per GPU path) in a block with summary "Technical details: measured build sizes". Link the code with the website contract form: https://github.com/null3d-engine/null3d/tree/main/examples/compare/battle/
- Line 187: prefer docs/shaders/wgsl-rules.md, next to the struct-splitting paragraph (line 55), because both describe WebGL2 rewrites for phone GPUs. Leave one sentence plus a link at custom-shaders.md lines 154-164 if the guide must mention it.
