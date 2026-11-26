# Verdict for api-1-readability-29

## The finding as given

- page: api/grass
- anchor: long paragraphs at lines 25, 69, 75, 92, 94, 100
- category: long-paragraph
- severity: low
- claim: Six paragraphs are too long. Line 69 is fixed by the options table. Lines 92 and 94 explain per-view culling and the CPU path in detail. Line 100 ends with an unrelated tip about ground color.
- evidence: stats.json lines 18, 62, 68, 85, 87, 93. grass.md:100 ends 'The ground's own color and the blades' root colors should meet at the hill's foot.'
- proposedEdit: Line 25: split after '...wind add-on's field.' Line 75: split after '...light apart.' Lines 92-94: keep the camera sentence and the 'compute: false' sentence, and put the rest in <details><summary>Technical details: how each path culls and thins</summary>. Line 100: split into sway distance and matching plants, and move the ground-color tip beside 'color' in 'The blade shape'.
- generatedSource: (none; docs/api/grass.md is hand-written)

Verdict: partly

## Evidence

- The six long paragraphs are facts from stats.json. Its line numbers count from the end of the front matter, so its lines 18, 62, 68, 85, 87 and 93 are page lines 25, 69, 75, 92, 94 and 100. The mapping in the finding is right.
- Line 100 (grass.md:100): the last sentence is about ground and blade color. The rest of the section is about shadows and sway distance, so the sentence is out of place there. The TSDoc on the `color` option (packages/grass/src/grass.ts:86) says "The blades' color, which meets the ground's own at their roots." That supports moving the tip next to the `color` sentence at grass.md:75.
- Line 25 and line 75: the split points are at sentence ends and make two clear parts each: what the package does versus how it draws, and the blade shape versus the plant tip. These splits hold.
- Line 69: the finding says the paragraph "is fixed by the options table", but this page has no options table, and the proposed edit gives no fix for line 69. That part of the claim is not true as written. The paragraph has 10 sentences that cover placement (height, maxSlope, mask, where), hashes and tint, and preset counts and fitting. It needs its own split.
- Lines 92-94: the proposed block hides too much. If only the camera sentence and the `compute: false` sentence stay in the main text, then:
  - the section "The two GPU paths" no longer names its second path, because the sentence "WebGL2 fills one instance batch for each tuft shape on the CPU" goes into the block;
  - "keeps the instance batch on both paths" then points at a batch that the main text never brings in. With the block closed, the text does not make sense, which breaks the block rule.
  - The `compute: false` behaviour is real (grass.ts:125 and grass.ts:403), so that sentence should stay in the main text.

## Corrected claim

Six paragraphs are too long (page lines 25, 69, 75, 92, 94, 100). The page has no options table, so line 69 also needs a split. The splits for lines 25, 75 and 100 are right, and so is moving the ground-color tip beside `color`. For lines 92-94, the main text must keep the WebGL2 path's first sentence and the "both paths draw the same hill" point, or the main text stops making sense with the block closed.

## Corrected edit

- Line 25: split after "...the wind add-on's field."
- Line 69: split into three paragraphs. (1) Where tufts grow: `height`, `maxSlope`, `mask`, `where`. (2) Hashes: turn, size and tint. (3) Presets: "`count` is the tufts at the High preset..." up to the end, with the await sentence.
- Line 75: split after "...so its two halves light apart." Move the ground-color sentence from line 100 into the second part, next to the `color` sentence.
- Lines 92-94: keep in the main text: "Give the pass the drawing `camera`, and it culls the tiles outside the view and thins the far tufts." Then "WebGL2 fills one instance batch for each tuft shape on the CPU, and it applies the same share and cull, so both paths draw the same hill." Then the `compute: false` sentence. Put the rest in one block, `<details><summary>Technical details: how each path culls and thins</summary>`. The rest is the hash share and blade widening, the per-view boxes and cascades, and the Ultra-sized rows and memory.
- Line 100: split into (1) the shadow and `swayDistance` sentences, including the cached far cascade, and (2) `setSwayDistance`, `swayDistanceFor` and matching plant materials. The ground-color sentence moves to "The blade shape".
