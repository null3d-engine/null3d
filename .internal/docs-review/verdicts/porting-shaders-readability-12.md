# porting-shaders-readability-12

## Finding as given

- Page: shaders/surface-functions
- Anchor: File lines 13, 38, 100, 150, 168, 590 (stats lines 6, 31, 93, 143, 161, 583)
- Category: long-paragraph. Severity: medium.
- Claim: Six paragraphs run over the limit: the opening (85 words, 5 sentences), Make a custom material (49 words, 5 sentences), defaultSurface (95 words, 7 sentences), the sky's normal (95 words, 6), occlusion (97 words, 5) and built-in values (91 words, 6).
- Proposed edit: Line 13: split after "it returns a `Surface`". Line 38: make the options a list (wgsl, uniforms, textures, standard options). Line 100: turn the starting values of defaultSurface into a two-column table (field, starting value) under one lead sentence. Line 150: keep two sentences and put the crown example under the code. Line 168: split at "That suits an occlusion map". Line 590: keep the first sentence and the link, and make the rest a three-item list (frame.time, object.position, object.values).

Verdict: partly

## Evidence

- The counts match stats.json (shaders/surface-functions, longParagraphs). The file line is the stats line plus 7, because of the front matter. Five of the six paragraphs read as dense and benefit from a break.
- Line 38 (49 words, 5 sentences) does not need a change for length. Its sentences are about 10 words each, and a bullet list follows it at once (lines 40 to 44). A second list in front of that list adds structure with no gain. Its real problem is one unclear word: "Its other options are those of `materials.standard`, but the texture maps" uses "but" to mean "except". Fix that word, not the shape.
- Line 13: "split after `it returns a Surface`" cuts a sentence before its colon list ("...returns a `Surface`: the base color, roughness, ..."). The clean break is before "The engine then lights the surface".
- Line 100: the full `Surface` field table sits right above this paragraph (lines 68 to 98), and some of its rows already say "It starts as the input's normal". A second table with the same 25 field names repeats that table. Better: put the starting values in a short grouped list (from the material's options; the input's normal; fixed values such as occlusion 1 and zero irradiance and reflection), or add a "Starts as" column to the existing table.
- Line 150: the proposal holds. The code uses `leafNormal` and `openSkyNormal`, so the crown sentences explain the code and read well as a paragraph under it.
- Line 168: the proposal holds. The break at "That suits an occlusion map" leaves "what occlusion darkens and how it joins screen-space occlusion" in one paragraph, and "when the product fits, when it counts twice, and the fix" in the next, which leads into the code.
- Line 590: the proposal holds in part. The paragraph also has a sentence on the camera's `view`, `projection`, `near`, `far` and the object's `worldMatrix`, `normalMatrix` and `id`. The edit must keep that sentence after the list, with the link to Built-in shader inputs.
- The 90-word / 4-sentence threshold is the review's measure. AGENTS.md "Writing docs" sets 25 words per sentence, and no paragraph limit. So the cost here is readability, not a rule break.

## Corrected claim

Five paragraphs (file lines 13, 100, 150, 168, 590) are dense enough to break. Line 38 is short (49 words, short sentences). It needs only a clearer word for "except", not a new shape.

## Corrected edit

- Line 13: break into two paragraphs before "The engine then lights the surface".
- Line 38: keep it as prose. Change "but the texture maps, which a custom material samples as textures of its own" to "except the texture maps. A custom material samples its own textures in their place."
- Line 100: keep one lead sentence ("`defaultSurface(input)` returns the surface that the material's own options make."). Then give a short list grouped by source: values from the options (base color as `color` times vertex color, metalness, roughness, emissive, transmission, thickness, diffuse transmission and its color, layer values); values from the input's normal (normal, diffuse normal, sky's normal, coat normal); fixed values (occlusion 1, multiplied by screen-space occlusion; irradiance and reflection zero). Or add a "Starts as" column to the Surface table above. End with "Start from it, and change only the fields that your look needs:".
- Line 150: keep the first two sentences, plus the sentence on probes, above the code. Move the crown sentences to a paragraph under the code.
- Line 168: break before "That suits an occlusion map".
- Line 590: keep the first sentence. Give a three-item list (`frame.time`, `object.position`, `object.values`). Keep the camera and object fields sentence and the link after the list.
