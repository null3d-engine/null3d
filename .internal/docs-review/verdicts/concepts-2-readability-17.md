# Verdict: concepts-2-readability-17

## Finding as given

- page: concepts/shadows
- anchor: long paragraphs at lines 27, 29, 76, 115, 117, 133, 155, 157, 161, 208, 224, 243, 271, 275, 277, 286, 292, 300, 304, 308, 310, 318, 343, 347, 403, 427, 429, 433, 435, 439
- category: long-paragraph
- severity: medium
- claim: 30 paragraphs pass the limit. The worst are 439 (196 words), 310 (161), 208 (139, three methods in one), 292 (133) and 427 (121). Line 243 mixes the rule with S4 and three.js comparisons.
- evidence: stats.json longParagraphs for concepts/shadows, 30 entries.
- proposedEdit: 208: keep 'Shadow edges stay still while the camera moves and turns' and the debug tip, and put the three methods in `<details><summary>Technical details: how cascades stay stable</summary>`. 155 and 157: make two lists, 'How auto picks the distance' and 'When auto picks too far'. 243: rule first, then the town example. 427-433: a cost table, Part | Passes | Memory | Reads per receiving pixel (cascade, tile, hero, contact). 435: a bulleted checklist.

Verdict: partly

## Evidence

- stats.json lists 30 long paragraphs for concepts/shadows. Its line numbers count from after the front matter (7 lines), so stats line 432 is page line 439, 303 is 310, 201 is 208, 285 is 292 and 420 is 427. The finding's lines and word counts match (196, 161, 139, 133, 121). The page has 7,488 words. The claim holds.
- 208 (docs/concepts/shadows.md:208) does hold three methods: the bounding sphere, texel-grid snapping, and snapping along the light to 16-bit depth steps. The `<details>` proposal for 208 is right.
- 243 (docs/concepts/shadows.md:243): the rule is already in sentence 2 ("So on every preset, a far cascade draws in every frame while a moving caster touches its box"). Sentence 1 gives the reason. "Rule first" changes little. The real problem is the end of the paragraph: S4, the three.js comparison and the character example are a second topic. The fix is a split, not a reorder.
- 427-433 (docs/concepts/shadows.md:427-433): a table fits, with two errors in the proposed columns. Contact shadows read `contactShadowSteps` per half-size texel, not per receiving pixel (line 433). The hero's memory is not in 431; it is in the rules list at line 395 (4, 16 or 64 MiB). Some text does not fit a cell and must stay as text: the phone bandwidth reason (427), the WebGL2 per-texel reads (427), the culling paths (429) and the shared AO copy (433).
- 435 (docs/concepts/shadows.md:435) is a list of tips in one paragraph. A bulleted checklist is right.
- 155 and 157: the split is right. The 1.25 ladder and the hold-one-step rule in 155 are implementer detail, and they suit a `<details>` block better than a list.
- The proposed edit leaves out three of the five paragraphs that the claim calls worst:
  - 439 (196 words, 12 sentences) is the densest paragraph on the page. It names `depth16unorm`, `DEPTH_COMPONENT16`, `sampler2DArrayShadow`, the 32-bit atlas, the 1.5% step at a tile's far end and Apple GPU read levels. Only its first sentence ("WebGPU and WebGL2 draw the same shadows.") and its link are main-text material. It is the clearest case on the page for a `<details>` block.
  - 310 (161 words, 10 sentences) explains the plane test. Its outcome (a slab's own bottom leaves its top lit, and a box on the slab still shadows it) is main text. The plane offset (1 cm or 1.5 depth steps), the normal-map note and the four-texel read are detail.
  - 292 (133 words, 9 sentences) holds the depth-step math (65,535 steps, 14 mm in S4's last cascade). The main text needs only the result: the engine floors `bias` at one and a half depth steps per cascade.
  - 343 (110 words), the half-size upsample and per-texel jitter of contact shadows, is also pure implementer detail and gets no proposal.
- Several entries pass the limit on sentence count alone, with short sentences: 27 (73 words), 133 (80), 286 (75), 304 (65), 318 (77). They follow the 25-word sentence rule and read well. They need no change, and the finding should say so, so that no one breaks them up for no gain.

## Corrected claim

30 paragraphs pass the limit; the five largest are 439 (196 words), 310 (161), 208 (139), 292 (133) and 427 (121). Most of the weight is implementer detail that belongs in collapsible blocks: 439, 310, 292, 208 and 343. Line 243 holds the rule in its second sentence, then moves to a second topic (S4, three.js, a character). Paragraphs at 27, 133, 286, 304 and 318 pass only on sentence count and need no change.

## Corrected edit

- 439: keep "WebGPU and WebGL2 draw the same shadows." and the link to [Depth on each tier](backends.md#depth-on-each-tier). Move the rest into `<details><summary>Technical details: depth formats and reads on each GPU path</summary>`.
- 310: keep two sentences in the main text: the filter compares each texel with the surface's own plane, so a slab's bottom leaves its top lit, and a box on the slab still shadows it. Move the plane offset, the normal-map note and the four-texel read into `<details><summary>Technical details: the plane test</summary>`.
- 292: keep "The shadow map stores 16-bit depth, so the engine uses at least one and a half depth steps for `bias` in each cascade. This changes nothing in the near cascades." Move the step math and the S4 figure into `<details><summary>Technical details: depth steps per cascade</summary>`.
- 208: as proposed. Keep the first sentence and the debug tip; move the sphere, texel snapping and depth snapping into `<details><summary>Technical details: how cascades stay stable</summary>`.
- 155 and 157: keep "a shorter distance gives sharper shadows; `'auto'` follows the farthest receiver" in 155, and keep 157 as the "when auto picks too far" advice, with its two fixes as a list. Move the 1.25 ladder and the hold rule into `<details><summary>Technical details: how auto rounds the distance</summary>`.
- 343: keep "The rays run at half the render size, in the same step as ambient occlusion." Move the upsample, the masked-surface note and the jitter into a `<details>` block.
- 76: keep the tile layout (a spot light takes one tile, a point light six). Move the 85-degree limit and the 3-texel edge inset into a `<details>` block.
- 243: split it into two paragraphs. The first holds sentences 1 to 5 (the reason and the rule). The second holds the S4 town, the three.js comparison and the character near the camera.
- 427-433: a table with Part | Render passes | Memory | Reads. Rows: cascade (one pass per cascade that draws; 2 bytes per texel, 8 MiB at 2,048; 4 or 9 per pixel, 16 or 36 on WebGL2, twice in a blend band), tile (a pass only when it draws, up to 12 per frame; 4 bytes per texel, 4 MiB at 1,024; 4 or 9 per pixel for each shadowed light), hero (one tile pass when the hero or a caster in its box moves; 4, 16 or 64 MiB; 4 or 9 per pixel inside the box), contact (the depth prepass, a second vertex pass on WebGPU; a half-size depth copy; `contactShadowSteps` reads per half-size texel). Keep the phone bandwidth reason, the culling paths and the shared AO copy as short sentences under the table.
- 435: as proposed, a bulleted checklist.
- 27, 133, 286, 304, 318: no change.
