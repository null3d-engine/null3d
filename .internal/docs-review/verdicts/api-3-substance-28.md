# Verdict for api-3-substance-28

## The finding as given

- Page: api/terrain
- Anchor: lines 21, 78, 80, 82, 92, 102, 104
- Category: long-paragraph. Severity: low.
- Claim: Seven long paragraphs. Line 104 (169 words, 11 sentences) mixes the worker build, block reuse, `building`, `setVisible` and `setTint`. The last two are API calls hidden in a speed paragraph.
- Evidence: stats.json api/terrain (14, 71, 73, 75, 85, 95, 97 in its count).
- Proposed edit: Add "## The terrain object" with update, heightAt, normalAt, building, setVisible, setTint, destroy. Put the morph detail of 82 in `<details><summary>Technical details: how blocks morph</summary>`.

Verdict: partly

## Evidence

- stats.json lists seven long paragraphs for api/terrain. Its lines are counted without the 7-line front matter, so 14, 71, 73, 75, 85, 95, 97 are file lines 21, 78, 80, 82, 92, 102, 104. The count and the anchors match.
- docs/api/terrain.md:104 holds the worker build, the task limit, the `building` flag, the shared arrays, mesh reuse and `maxBlocks`. It then adds `setVisible` and `setTint`, which have nothing to do with speed. This part of the claim holds.
- docs/api/terrain.md:82: the first two sentences say what the reader sees (a block morphs toward its parent and hands over at a set distance). The sentences after them explain how (the vertices move to the parent's heights, the triangulation matches, the parent height sits in each vertex record). The last sentence names the `morph: false` option. A details block for the middle sentences is right, but the option sentence must stay in the main text.
- The proposed new section is wrong in two ways:
  1. `heightAt` and `normalAt` already have their own section, "Placing things on the ground" (docs/api/terrain.md:96-98). A second section that lists them again duplicates it.
  2. A section that lists the members of the terrain object duplicates the API reference. docs/api/reference/terrain.md:74-87 already lists every member, and the page links to it at line 118. The list in the edit is also incomplete: it leaves out `setMorph`, `drawn`, `triangles`, `size` and `heightfield` (reference lines 76-85).
- The edit fixes only two of the seven paragraphs. It proposes nothing for lines 21, 80, 92 and 102. Line 80 joins two separate options (`bakedNormals` and `steepFaces`) and has a clear break point. Line 78 (66 words, 5 sentences) is only just over the limit and can stay as it is.

## Corrected claim

The page has seven long paragraphs. Line 104 hides two calls that do not affect speed (`setVisible`, `setTint`) in the speed paragraph. Line 82 holds dense morph detail that a collapsible block can hold. A new "terrain object" section would duplicate the "Placing things on the ground" section and the API reference, so it is the wrong fix.

## Corrected edit

- Line 104: end the speed paragraph after "...only until it holds `maxBlocks` of them." Move the `setVisible` and `setTint` sentences to a short new section after "Placing things on the ground", for example "## Hiding and tinting the ground". Optionally split the speed text after "...and `terrain.building` is true meanwhile.", with the shared arrays and mesh reuse in the second paragraph.
- Line 82: keep the first two sentences and the `morph: false` sentence in the main text. Move "Over the last part of the approach ... written when the block is built or reused." into `<details><summary>Technical details: how blocks morph</summary>`.
- Line 80: start a new paragraph at "A map laid from above stretches..." (the `steepFaces` option).
- Line 92: start a new paragraph at "At a boundary between two layers...".
- Line 102: start a new paragraph at "That figure is for a picture 1,080 pixels tall."
- Line 21: start a new paragraph at "Every pixel takes its normal...".
- Line 78: leave it as it is.
