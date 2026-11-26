# porting-shaders-readability-06

## Finding as given

- page: shaders/library
- anchor: File lines 404, 688, 750, 782, 890, 976, 1028, 1136, 1176, 1360, 1368 (stats lines 397, 681, 743, 775, 883, 969, 1021, 1129, 1169, 1353, 1361)
- category: long-paragraph, severity: medium
- claim: Eleven entries run over 90 words or 4 sentences. The generator joins all comment lines with a space, so a blank comment line meant as a paragraph break vanishes (the fog summary reads "encoding.  Per pixel" as one paragraph). Dense implementer facts sit in the main text, such as dfg_lut's "group 0 at binding 2" and the reflection row order per GPU path.
- evidence: fog.wgsl lines 3-10 hold a blank // line; shader-library.ts commentText uses .join(' '); library.md line 890 (fog, 117 words, 8 sentences), 688 (dfg_lut, 105), 1360 and 1368 (reflection, 101 and 99).
- proposedEdit: In commentText, turn a blank // or /// line into a paragraph break. Add a marker line, `/// Technical details:`, after which the rest of the comment renders in a technical details block. Then edit the modules: fog summary splits into what fog is plus a details block with the per-pixel cost; dfg_lut keeps its first sentence and moves the table layout and bindings into details; the reflection module and reflection_uv keep how to call them and move row order per path into details; SPECULAR_AA_VARIANCE, ambient_irradiance, the vertex and depth module summaries, distance_code and limit_hdr split at their second sentence.
- generatedSource: tools/lib/shader-library.ts and crates/null3d-shaders/wgsl/lib/*.wgsl

Verdict: partly

## Evidence

- The generator bug is real. tools/lib/shader-library.ts:56-61 `commentText` maps each line and joins with ' ', so an empty comment line becomes a double space. Two sources hold such a line: fog.wgsl line 8 (`//`) and color.wgsl line 30 (`///`, in limit_hdr). The page shows "encoding.  Per pixel" (library.md:890) and "draws black.  The NaN" (library.md:404). The authors meant two paragraphs in both places.
- The paragraph counts match stats.json. Three of the eleven are short and pass only on sentence count: SPECULAR_AA_VARIANCE (70 words), the vertex module summary (72 words) and the depth module summary (57 words). Their sentences are short. Splitting them is a matter of taste with little gain for a reader.
- dfg_lut (lighting.wgsl, library.md:688): "A shader that calls this function binds the texture of its path there too" is a requirement on the caller. It is not optional detail. The binding slots (group 0 binding 2, or binding 1 on WebGL2) are what that requirement means. If they move into a closed block, the main text tells a reader to bind a texture "there" with no place named. The table layout (16 x 16, roughness across, cosine down, four-entry filter, textureLoad with no sampler) is good block material.
- reflection_uv (reflection.wgsl:11-17, library.md:1368): "Read a reflection pass's texture with it, and no scene pass's, which would look flipped on that path" is a usage rule and must stay in the main text. The permutation sentence before it is the reason, and it can go in the block. In the module summary (reflection.wgsl:3-9), the per-path row order sentence is the block material; the first two sentences and the last one say what to call.
- Fields render as list items (shader-library.ts:236, "- `name`: doc"). A paragraph break inside a field doc would end the list item. So the new break handling must apply to module summaries and item docs only, or indent the following lines.
- The module table uses `firstSentence` (shader-library.ts:180-182) on the summary. A paragraph break after the first sentence leaves the table rows the same.
- Nothing else reads these docs: only shader-library.ts, its test and docs.ts use the reader, so the change stays on this one generated page. The shader-library test (tools/lib/shader-library.test.ts:44-61) checks single-line docs and still holds.

## Corrected claim

The generator does merge intended paragraphs: a blank comment line becomes a double space. This affects two of the eleven entries (fog summary, limit_hdr), and a blank-line fix alone splits both. Eight entries run over 90 words or carry dense detail that fits a details block: fog, limit_hdr, dfg_lut, ambient_irradiance, the fog height-share function, distance_code, and both reflection entries. The other three (SPECULAR_AA_VARIANCE, the vertex and depth module summaries) are over 4 sentences but short. Splitting them is optional polish.

## Corrected edit

1. In `commentText`, turn an empty comment line into a paragraph break ("\n\n"), for module summaries and item docs. Keep field docs on one line, or indent the lines that follow, so that the field list stays whole.
2. Add the `/// Technical details:` marker (and `// Technical details:` for module summaries). The rest of the comment renders as `<details>` with `<summary>Technical details</summary>`, blank lines around the body, no heading and no nested block.
3. fog: add the marker before the per-pixel cost paragraph. limit_hdr: add the marker before the NaN-test paragraph.
4. dfg_lut: the main text keeps what it returns and the binding requirement with its slots ("A shader that calls it binds the table at group 0, binding 2, or binding 1 on WebGL2"). The table size, axis order, filter and textureLoad note go in the block.
5. reflection module: keep what a reflection pass is and how to use `reflection_uv` and `reflection`; the row order per GPU path goes in the block. reflection_uv: keep the call form, the ripple offset and "read only a reflection pass's texture with it"; the permutation reason goes in the block.
6. ambient_irradiance, the height-share function and distance_code: keep the first one or two sentences, and move the derivation (hemisphere sum, series cutoff and exponent limit, octave and 8-bit step math) into a block.
7. Leave SPECULAR_AA_VARIANCE and the vertex and depth module summaries as they are, or split them into two paragraphs with a blank comment line. Give them no block.
