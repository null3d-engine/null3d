# Verdict: api-2-readability-22

## Finding as given

- page: api/lights
- anchor: long paragraphs at lines 50, 98, 121, 138, 168, 196, 224, 252
- category: long-paragraph
- severity: low
- claim: Eight paragraphs are just over the limit. Lines 50 and 252 hold separate rules that read better as a table or a list.
- evidence: stats.json api/lights longParagraphs (stats lines 43-245).
- proposedEdit: 50: a table of light, the axis its light runs along, and how to aim it. 252: a list (must cast shadows; where the tile comes from; tile sizes). 138: move the method credit to a details block. Split 98, 168, 196 and 224 after the second sentence.
- generatedSource: "" (docs/api/lights.md is hand-written, so none is needed)

Verdict: partly

## Evidence

- The eight long paragraphs are real. stats.json gives them at lines 43, 91, 114, 131, 161, 189, 217 and 245. Those numbers are 7 lower than the lines in the file. The opening words match the file at lines 50, 98, 121, 138, 168, 196, 224 and 252, so the finding's line numbers are the right ones.
- Line 50 (82 words, 7 sentences) and line 252 (73 words, 7 sentences) are the worst. The others have 54 to 87 words and 5 sentences each.
- Line 50, the table: the "Kinds of light" table (docs/api/lights.md:36-44) already says which lights take `direction` and `target`. The ways to aim (the `direction` option, `setDirection`, `lookAt`) are the same for every light that points. Only `target` differs, and only at creation. In a table of light, axis and how to aim, the aim column would repeat the same text in four rows and copy the table above. One axis rule plus a short list of the ways to aim is clearer.
- Line 252, the list: correct. The paragraph holds separate rules: the object must cast shadows, where the tile comes from, which surfaces read the tile, the sizes, and how to choose the size and its default.
- Line 138, the details block: correct and in line with the user's request. The last sentence credits the shading method (linearly transformed cosines, and the authors who made it). This helps implementers but is not needed to use the light. Moving it out leaves 4 sentences, which is under the limit.
- The proposal does not cover line 121, but the anchor lists it. That paragraph has 87 words and 5 sentences. It joins two topics: the range and fade of point and spot lights, and the cone of a spot light.
- Splitting after the second sentence works for line 98 (the units come first, then the worked example of an intensity of pi) and line 168. It is wrong for line 196. Its third sentence starts "`assets.skyEnvironment()` makes one", and "one" points back to "an environment" in the second sentence, so a break there cuts the link. For line 224 the third sentence ("A small scene then gets sharper shadows") is the result of the second, so the natural break comes before "Pass a number to fix it".

## Corrected claim

There are eight long paragraphs at lines 50, 98, 121, 138, 168, 196, 224 and 252 (stats.json lists them 7 lines lower). Line 252 reads better as a list. Line 50 reads better as one axis rule plus a short list of the ways to aim, not as a table that copies the "Kinds of light" table. Line 121 also needs a split.

## Corrected edit

- 50: keep the first two sentences (the light runs along the -Z axis; a tube runs along it). Follow them with a list: the `direction` option and `setDirection` (relative to the parent); `lookAt` (toward a point); `target` (spot, rectangle and tube lights, at creation); the default, straight down (0, -1, 0); parents turn the light with them. Do not add a table.
- 252: make a list: the object must cast shadows; surfaces within its box along the light read the tile, and the cascades shadow the rest; the tile is 1,024, 2,048 or 4,096 texels on each side, set with `setHeroShadow(car, 4096)` or `heroTileSize`, with the quality preset's `heroTileSize` as the default. Put "its tile comes from the spot and point lights' shadow atlas and takes its last layer" in a "Technical details" block after the list, or keep it as a list item.
- 138: move the last sentence (the shading method and its authors) into a `<details><summary>Technical details: how area lights are shaded</summary>` block after the paragraph.
- 121: split after the third sentence, so the range and decay come first and the spot light's `angle` and `penumbra` come second.
- 98 and 168: split after the second sentence.
- 196: split after the third sentence, before the `timeOfDay` sentence.
- 224: split after the third sentence, before "Pass a number to fix it".
