# Verdict: api-2-readability-28

## The finding as given

- page: api/lines
- anchor: long paragraphs at lines 23, 106, 117, 123, 153; error list at line 104
- category: long-paragraph
- severity: low
- claim: Line 106 mixes material.set, browser boxing and setWidth. Line 104 gives five error cases in one paragraph.
- evidence: stats.json api/lines longParagraphs (stats lines 16, 99, 110, 116, 146); line 104 'throw [E1206] ... throws [E1217] ... throws [E1108] ... throws [E1203]'.
- proposedEdit: 104: a table of input and error. 106: three short sentences (what material.set changes, setWidth, other options are fixed), with the boxing note in a details block. Split 117 into how colors are stored and how to make a line glow.
- generatedSource: (none; docs/api/lines.md is hand-written)

Verdict: partly

## Evidence

- The stats lines are 7 lower than the page lines, because of the front matter. Stats 16, 99, 110, 116 and 146 are page lines 23, 106, 117, 123 and 153. The anchor is right.
- Page line 106 (111 words, 9 sentences) holds three topics: what `material.set` changes, the cost of boxed numbers in the browser, and `setWidth` with the fixed options. The split and a details block for the boxing note are right. The boxing note is a correct, dense detail for implementers, so a block fits the user request better than a cut. `setWidth` exists (packages/engine/src/scene/lines.ts:366).
- Page line 117 (107 words, 7 sentences) holds two topics: how colors are stored (8 bits per channel, sRGB) and how to make a line glow for bloom. The proposed split is right.
- The finding names lines 23, 123 and 153 in the anchor but proposes no edit for them. The rule says one finding lists all long paragraphs of a page, so the edit is incomplete. Line 153 (96 words, 7 sentences) mixes the hit test, the event API and the `lineThreshold` option. Line 123 (57 words, 6 sentences) lists four calls. Line 23 (83 words, 5 sentences) is just over the limit.
- Page line 104 is not in the stats list of long paragraphs (64 words, 4 sentences). It is not a long paragraph. A table is still a good change, because it lists cases that a reader scans. The finding counts four error codes; the paragraph gives six cases, and two of them (too few points, an odd count for `segments`) have no code on the page.
- The code shows that the paragraph is incomplete and partly wrong. A table must not copy its errors (packages/engine/src/scene/scene.ts:3245-3308, 3323-3339):
  - Too few points, or an odd number of points for `segments`, throws E1206. The page gives no code for these.
  - A number in `positions` or `colors` that is not finite throws E1206, not E1203.
  - A width or dash value that is not finite throws E1203.
  - A negative `dashScale` throws E1108 too, not only a negative dash or gap.
  - The finite and range checks run in development builds only. The mode and point-count checks always run.

## Corrected claim

Page line 106 mixes `material.set`, the boxing cost and `setWidth`. Page line 117 mixes color storage and glow. Lines 23, 123 and 153 are also over the limit and need an edit. Line 104 is not long, but its error cases read better as a table, and the table must fix its error codes.

## Corrected edit

- 104: a table with the columns "Input" and "Error". Rows: positions not a multiple of 3, fewer than 2 points, an odd count for `segments`, or `colors` of another length: E1206. A number in `positions` or `colors` that is not finite: E1206 (development builds). An unknown mode: E1217. A width not above 0, or a negative dash size, gap size or dash scale: E1108 (development builds). A width or dash value that is not finite: E1203 (development builds). Keep one sentence before the table on what a strip, a loop and `segments` need.
- 106: three short sentences in the main text: what `material.set` changes; `setWidth(width)` changes the width and updates every segment once; the other options are fixed at creation. Move the boxing cost into a block:

  <details>
  <summary>Technical details: the cost of a change in every frame</summary>

  A change of the dashes alone converts nothing, and the line keeps them in the engine's own memory. The call reads the options object that you pass. Where the same call has seen objects of a few shapes, the browser boxes each number, so a change in every frame costs a few bytes a frame.

  </details>

- 117: two paragraphs. First, how a segment blends colors and how the engine stores them (8 bits per channel, sRGB; values 0 to 1; `color.fromHex`). Second, how to make a line glow for bloom (a lit line, black `color`, `emissive` with `emissiveIntensity` above 1).
- 153: two paragraphs. First, the hit test (half the width, in pixels or world units; `lineThreshold`; dashed gaps also hit). Second, the hit result and the events (`object`, `instance`, `lines.on('click', ...)`), with the link to Raycasting.
- 123: a short list of the three calls (`setActiveCount`, `setLayers`, `destroy`), one line each.
- 23: optional. Move the demo sentence into its own paragraph.
