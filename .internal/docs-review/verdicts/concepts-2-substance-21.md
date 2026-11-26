# concepts-2-substance-21

## Finding as given

- page: concepts/shadows
- anchor: 30 long paragraphs: lines 27, 29, 76, 115, 117, 133, 155, 157, 161, 208, 224, 243, 271, 275, 277, 286, 292, 300, 304, 308, 310, 318, 343, 347, 403, 427, 429, 433, 435, 439
- category: long-paragraph
- severity: medium
- claim: The page has 7,488 words. Whole sections are implementer detail that the main text does not need: depth steps and the bias floor (292), the face move and its measured figures (300-304), the plane test of flat casters (310), the formats on each GPU path (439).
- evidence: stats.json concepts/shadows longParagraphs.
- proposedEdit: Move these into details blocks: "Technical details: the depth precision of the shadow map" (292), "Technical details: how the engine moves casters' faces" (300-304), "Technical details: the plane test of flat casters" (310), "Technical details: formats and reads on each GPU path" (439). Keep one plain sentence of each in the main text.

Verdict: partly

## Evidence

- The word count (7,488) and the 30 long paragraphs match stats.json. The finding's line numbers are file lines. The stats lines are 7 lower, because stats skip the 7-line front matter. Both point to the same paragraphs.
- The four chosen paragraphs are dense implementer detail, and the blocks are a good fit:
  - Line 292: 16-bit depth steps, about 14 mm in S4's last cascade, and the floor of one and a half steps. Only the floor changes what a reader sees.
  - Lines 300-302: how faces that point away from the light move (one texel, at most 5 cm), plus the contact-check figures (0.16 to 0.02 pixels and more). Naming S4 is allowed, because AGENTS.md says to name the benchmark when you cite a figure.
  - Line 310: the plane test of the directional filter (1 cm or one and a half steps, four texels per read).
  - Line 439: depth16unorm and DEPTH_COMPONENT16, 32-bit atlas, sampler2DArrayShadow, gather reads. This one paragraph is the whole "On each GPU path" section.
  None of the blocks would need a heading or a nested block. The headings "Bias", "Where shadows meet their casters" and "Flat casters" stay outside the blocks, so the "#flat-casters" link on line 292 still resolves.
- Three parts of the finding do not hold:
  1. "Whole sections" is overstated. Only line 439 is a whole section. Lines 292, 300-304 and 310 are paragraphs inside sections whose other paragraphs give reader-facing facts (lines 288, 294, 298, 308, 312).
  2. Line 304 is not only implementer detail. It ends with the one action the reader can take: "Give a ground that needs to cast no shadows `receiveShadows` alone". Line 300 also holds a fact that ties back to the acne advice on line 286: a double-sided material's faces stay in place. "Keep one plain sentence" of lines 300-304 would drop one of these two facts. Both must stay in the main text.
  3. The anchor lists 30 long paragraphs, but the edit covers only 6 of them (292, 300, 302, 304, 310, 439). It gives no fix for the other 24. Many of them are user guidance that must stay in the main text and be split, not hidden. Examples: line 155 (setting `distance`), line 161 (a zooming orbit camera), lines 427-435 (what shadows cost and how to make them cheaper), line 347 (grass turns dark).
- With line 439 in a block, the "On each GPU path" section keeps only its first sentence. The link "Depth on each tier" (backends.md) should stay in the main text.

## Corrected claim

The page has 7,488 words and 30 long paragraphs. Four places hold dense implementer detail that fits collapsible blocks: the depth steps and bias floor (292), the face move and its measured figures (300-302), the plane test of flat casters (310), and the formats and reads on each GPU path (439). Line 304's advice to give a ground `receiveShadows` alone is reader guidance, and it must stay in the main text. The other long paragraphs need splits, not blocks.

## Corrected edit

1. Line 292: keep "In each cascade, the engine raises `bias` to at least one and a half steps of the map's stored depth, which matters only in far cascades." Move the rest into "Technical details: the depth precision of the shadow map".
2. Lines 300-304: keep a short paragraph in the main text: "So the engine moves each caster's faces that point away from the light a little toward the light before it draws them. A double-sided material's faces stay in place. Give a ground that needs to cast no shadows `receiveShadows` alone, as S4's streets have." Move the size of the move (one texel, the 5 cm cap and why it protects floors) and the measured contact figures (line 302) into "Technical details: how the engine moves casters' faces".
3. Line 310: keep "So the directional light's filter compares each texel with the surface's own plane, just below it. The slab's bottom then leaves its top lit, and a box that stands on the slab still shadows it." Move the plane's source, the margin and the four-texel reads into "Technical details: the plane test of flat casters".
4. Line 439: keep "WebGPU and WebGL2 draw the same shadows. [Depth on each tier](backends.md#depth-on-each-tier) explains how WebGL2 keeps WebGPU's depth values." Move the formats, sampler and read counts into "Technical details: formats and reads on each GPU path".
5. Split the other long paragraphs at their topic turns, and do not hide them. They include lines 29, 76, 115, 117, 133, 155, 157, 161, 208, 224, 243, 271, 275, 277, 286, 308, 318, 343, 347, 403, 427, 429, 433 and 435. Two further blocks are fair: the half-size ray and denoise steps (343), and the byte and read figures in the cost section (427, 429). The advice in 435 stays in the main text.
