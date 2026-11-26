# concepts-2-substance-18

## The finding as given

```json
{
 "page": "concepts/post-processing",
 "anchor": "Long paragraphs at lines 37 (226 words), 39, 101, 155, 263, 299, 305, 307, 358, 392",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Line 37 holds the whole chain in one paragraph. Implementer detail sits in the main text: GSR 1's taps (63), bloom's kernel and Karis average (78-79), the meter's bins (172-175, 187-188), RCAS (376), the grading table (369).",
 "evidence": "stats.json concepts/post-processing longParagraphs (stats lines 30, 32, 94, 148, 256, 292, 298, 300, 351, 385).",
 "proposedEdit": "Split line 37 into three paragraphs: before the scene, the HDR effects, the final pass. Move the dense parts into details blocks, for example <details><summary>Technical details: how GSR 1 scales the image</summary> (line 63 from \"The pass blends the four nearest texels\"), and the same for bloom's kernel, the meter, RCAS and the grading table. Split lines 305-307 into what the effect adds and what it cost in the benchmark.",
 "generatedSource": "",
 "id": "concepts-2-substance-18",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- Line mapping holds. stats.json counts body lines after the 7-line front matter, so stats lines 30, 32, 94, 148, 256, 292, 298, 300, 351, 385 are page lines 37, 39, 101, 155, 263, 299, 305, 307, 358, 392.
- Line 37 (226 words, 12 sentences) holds. It walks the whole chain: prepass effects, HDR scene color, the effects in order, then every step of the final pass. Most of it repeats the Mermaid diagram at lines 13-35. The final-pass order also comes back in the "Below the whole canvas's render scale" section (lines 60-72) and in each effect's own section.
- The implementer detail the finding names is on the page where it says:
  - line 63: GSR 1's bilinear blend, green-channel vote and twelve-texel correction;
  - line 79: the 13-texel kernel with Call of Duty: Advanced Warfare weights and the Karis average;
  - lines 172-175: the meter's log2 luminance, 128 quarter-stop bins, percentile mean and adaptation;
  - lines 187-188: how each meter works, in a table;
  - line 376: how RCAS works;
  - line 369: the grading table's 32-texel size, square-root lookup, worker bake and 256 KB upload.

## What does not hold

1. "Split lines 305-307 into what the effect adds and what it cost in the benchmark." They are already split that way. Line 305 lists the passes the reflections add, and line 307 gives the benchmark. Only line 305 (94 words) runs long. Its last sentence ("While the reflections are off ... turns them on") could become its own sentence or a bullet. That is the only split needed here.
2. The anchor lists lines 39, 101, 155, 263, 299 and 358, but the edit proposes nothing for them. Each is 63-83 words, and stats.json flags them only for having 5 sentences. Each makes one point (the cost of full-screen passes, bloomSize, DoF cost, AO cost, ssrScale, outline cost). They read well and need no change. Only lines 37, 305 and 392 (104 words) go past 90 words. Line 392 is a clear sequence: blend, rest, wake. It could split after "smoother than any one frame's.", but that is polish.
3. Some of the proposed blocks would hide facts that users need:
   - Meter, lines 172-175. Steps 3 and 4 explain what the user settings `metering: 'percentile'`, `minEv`/`maxEv` and `speedUp`/`speedDown` do. Only steps 1-2 (log luminance, 128 bins) are implementer detail. The meter table at lines 185-188 also has a "Where" column, which tells users which backend and preset gets which meter. Move only the "How it meters" detail, or leave the table as it is. A details block cannot sit inside a GFM table cell.
   - GSR 1, line 63. "The work runs only where a pixel reads a smaller corner ... pays nothing for it" is a cost fact for users. It must stay in the main text. Only the two sentences from "The pass blends the four nearest texels" to "keeps the blend alone" belong in the block.
   - Bloom, line 78. Step 1's threshold and NaN behavior is user-facing. Only step 2 (line 79) is implementer detail.
4. Placement. The detail at lines 63, 79, 174-175, 369 and 376 sits inside numbered or bulleted lists. A details block dropped in place would break the list numbering, and the website's collapse may not apply inside list items. Each block must go after its list, with the list item cut down to a short main-text statement.

## Corrected claim

Line 37 (226 words) restates the Mermaid diagram and the later sections in one paragraph, and should be cut down and split. Line 305 (94 words) and line 392 (104 words) are the only other paragraphs over 90 words, and both need only a small split. Lines 39, 101, 155, 263, 299 and 358 are fine. Some implementer detail can move into collapsible blocks: GSR 1's edge test, bloom's 13-texel kernel and Karis average, the meter's binning, how RCAS works, and how the grading table is built. User-facing setting semantics and cost facts must stay in the main text.

## Corrected edit

- Line 37: shorten it to three short paragraphs and let the diagram carry the order.
  - (a) Ambient occlusion and reflections run before the opaque pass and read the prepass depth.
  - (b) The scene draws exposed linear HDR color into a float target. Fog, custom effects, depth of field and bloom read it in that order. Keep the link to lighting.md#volumetric-fog.
  - (c) The final pass does the rest per pixel: FXAA, the effects' results, vignette, tone curve (AgX punchy by default; link color-management.md#exposure-and-tone-mapping), sRGB, outline, grading table, dither. Keep the link to the render-scale section.
- Line 63: keep the first two sentences and the "runs only where ... pays nothing" sentence, plus the rest of the step. After the numbered list, add `<details><summary>Technical details: how GSR 1 finds edges</summary>` holding the two sentences from "The pass blends the four nearest texels" to "keeps the blend alone".
- Bloom: change step 2 (line 79) to "Each step down blurs while it halves the size, and the first step keeps a small bright point from flickering." After the list, add `<details><summary>Technical details: bloom's downsample filter</summary>` with the 13-texel Call of Duty weights and the Karis average.
- Meter: keep steps 3-4 in the main text. Move steps 1-2 (log2 luminance over middle gray, center weight, 128 quarter-stop bins from -16 to +16) into `<details><summary>Technical details: how the meter bins the image</summary>` after the list. Keep the table, or shorten its "How it meters" cells and put the full text in the same block.
- Line 369: change the bullet to "A job worker computes the grading controls' table, so changing a value stalls no frame." Move the 32-texel size, the square-root lookup, the 256 KB upload and the past-white range into `<details><summary>Technical details: the grading controls' table</summary>` after the list.
- Line 376: keep "Flat areas and grain stay as they are, and no channel clips or rings." Move the RCAS mechanism into `<details><summary>Technical details: how RCAS sharpens</summary>` after the list.
- Line 305: move its last sentence into a bullet under the Cost list, or into its own short paragraph. Leave line 307 as it is.
- Line 392: optionally split after "smoother than any one frame's."
- Leave lines 39, 101, 155, 263, 299 and 358 as they are.
