# api-3-readability-20

## Finding as given

- page: api/terrain
- anchor: lines 21, 78, 80, 82, 92, 102, 104
- category: long-paragraph
- severity: medium
- claim: Seven paragraphs go over the limit. Line 104 (169 words, 11 sentences) runs from the WebAssembly module to setVisible and setTint. Line 82 (the morph, 127 words) and line 86 (the skirt) are implementer detail.
- evidence: stats.json longParagraphs for api/terrain.
- proposedEdit: Line 104: move setVisible, setTint and building to a terrain object table, and put the task and block-reuse rules in <details><summary>Technical details: how blocks build on the job workers</summary>. Lines 82 and 86: keep 'Blocks morph toward their parent before they switch, so the ground does not pop. morph: false switches at once.', and put the rest in <summary>Technical details: the morph and the skirt</summary>. Line 21: split after 'the far hills stay cheap.' Lines 78, 80, 92, 102: break at the fourth sentence.
- generatedSource: (none; docs/api/terrain.md is hand-written)

Verdict: partly

## Evidence

- stats.json lists seven long paragraphs for api/terrain at body lines 14, 71, 73, 75, 85, 95, 97. The page has a 7-line front matter, so these are page lines 21, 78, 80, 82, 92, 102, 104. The finding's line numbers and counts are right.
- docs/api/terrain.md:104 does run from the WebAssembly module to setVisible and setTint. setVisible and setTint are not about speed, so they are misplaced under "## Speed". This part holds.
- docs/api/reference/terrain.md:80, 84, 86, 128, 129 already gives `building`, `setTint`, `setVisible`, `maxBlocks` and `blocksPerUpdate` in tables. A new "terrain object table" on the guide page would duplicate the reference page. A short plain paragraph is enough.
- docs/api/terrain.md:104 also holds facts a user sees and acts on: `update` only asks for the work, the ground keeps drawing its last complete selection, and `terrain.building` is true meanwhile. These must stay in the main text, so the page makes sense with the block closed. The task size, the first-selection rule, the shared arrays and the mesh reuse up to `maxBlocks` are fine in a block.
- docs/api/terrain.md:82 (morph) suits a block. Line 86 (skirt) is only 4 sentences and is not in the long list. Its last sentence ("On a very steep seam a thin sliver of skirt can still show.") is a visible artifact that users will meet, so it belongs in the main text. The proposed kept text covers only the morph and says nothing of the skirt. Line 84 (`levels: false`) sits between 82 and 86, so one block for both needs line 84 moved out of the way.
- Line 21: sentences 1-4 then 5-6 is a clean break. Holds.
- "Break at the fourth sentence" is mechanical and wrong for three of the four paragraphs:
  - Line 78 (5 sentences): a break after sentence 4 leaves "A still camera therefore costs no work at all." alone, and "therefore" points back at the sentence it lost. Break after sentence 3 ("Once a block is made, the engine reuses it.").
  - Line 80 (5 sentences): a break after sentence 4 puts `steepFaces` in its own paragraph. This is right.
  - Line 92 (7 sentences): a break after sentence 4 splits "At a boundary..., the heights push one through the other." from "Rock then shows through the grass...", which explains it. Break after sentence 3 (the `heightFrom: 'alpha'` advice).
  - Line 102 (7 sentences): a break after sentence 4 splits "That figure is for a picture 1,080 pixels tall." from "A taller picture draws more...", which follows from it. Break after sentence 2, so the block count and what changes it read as one paragraph.

## Corrected claim

Seven paragraphs go over the limit (page lines 21, 78, 80, 82, 92, 102, 104). Line 104 mixes the build schedule with setVisible and setTint, which are not about speed. Line 82 (the morph) is implementer detail that suits a block. Line 86 (the skirt) is short. Its steep-seam warning is user-facing and should stay visible.

## Corrected edit

- Line 104: keep in the main text "The selection and the block build run on the engine's job workers, so `update` only asks for the work. The ground draws its last complete selection until the new one is built, and `terrain.building` is true meanwhile." Put the rest in `<details><summary>Technical details: how blocks build on the job workers</summary>`: the WebAssembly module, `blocksPerUpdate` and its default, the first selection over a few tasks, the shared arrays, and mesh reuse up to `maxBlocks`. Move setVisible and setTint out of "## Speed" into a short plain paragraph, for example at the end of "## Placing things on the ground" or in a new "## Hiding and tinting the ground" section. Do not add a table: the API reference already has one.
- Line 82: keep "Each block morphs toward its parent block's surface before it gives way to it, so the ground does not pop. `morph: false` switches each block at once instead." Put the hand-over distance, the parent-height vertex record and the matching triangulation in `<details><summary>Technical details: the morph and the skirt</summary>`, placed after line 86, and move the skirt's mechanism (no neighbour restriction, why the morph cannot match a block two levels coarser) into it too. Keep in the main text: "A skirt hangs from the edge of each block to close the seam between blocks of different detail. On a very steep seam a thin sliver of skirt can still show." Keep line 84 (`levels: false`) as its own main-text paragraph.
- Line 21: split after "the far hills stay cheap."
- Line 78: split after "Once a block is made, the engine reuses it."
- Line 80: split after "Set `bakedNormals: false` to light from the mesh's own normals instead."
- Line 92: split after "so give their layers `heightFrom: 'alpha'`."
- Line 102: split after "the few coarse blocks cover the rest."
