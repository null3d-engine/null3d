# Verdict for api-3-readability-16

## The finding as given

- page: api/wind
- anchor: lines 24, 57, 77, 81, 272, 290, 326, 328, 338, 361, 372
- category: technical-details-block
- severity: medium
- claim: The paragraph right after the first example (line 57) moves from 'Call update once in each frame' to task promises and 'a fraction that crosses one of its calls becomes an object'. A newcomer gets lost at the first step. The read() queue rules (line 77), the budget paragraph (line 361, 171 words, with an overlay line) and the last cost bullet (372) are dense implementer detail. Line 326 names examples/forest as a path, not a link.
- evidence: stats.json longParagraphs for api/wind; examples/demos.ts forest demo code is 'forest/'.
- proposedEdit: Line 57: keep three sentences, and put the rest plus line 372 in <details><summary>Technical details: what the calls allocate</summary>. Line 77: keep 'read works the air out on the job workers, up to about five thousand places a call, and the answer lands before the next frame's update.', and put the queue and drop rules in <summary>Technical details: how read queues its asks</summary>. Line 361: add a Budget row to the presets table, keep one paragraph on the governor, and put the overlay example in a details block. Line 326: link https://github.com/null3d-engine/null3d/tree/main/examples/forest/ and split after 'as the example above does.' Others: break at the fourth sentence.

Verdict: partly

## Evidence

- The page is hand-written (docs/api/wind.md; tools/lib/docs.ts:145 only lists it in PAGES), so no generated source applies.
- stats.json line numbers omit the 7 front-matter lines. Its entries 17, 50, 70, 74, 265, 283, 319, 321, 331, 354 are page lines 24, 57, 77, 81, 272, 290, 326, 328, 338, 361. The anchor list matches. Line 372 is a list item, not a stats paragraph, and the finding treats it that way.
- Line 57 says what the finding quotes: "A `read` in each frame also takes the task's promise ... a fraction that crosses one of its calls becomes an object". That is the first prose after the first example, so the newcomer claim holds.
- The claim about the code is right. packages/wind/src/field.ts:5 says a frame's ask allocates only the task's promise. packages/wind/src/wind.ts:229-233, 258-261 and 430-434 keep fractions in typed arrays so internal calls do not box them. Line 57, about a page's own arguments, and line 372, about the add-on's internal numbers, do not contradict each other.
- Line 77 holds the queue and drop rules as described (7 sentences, 128 words).
- Line 361 is 171 words. It ends with the overlay example line. The presets table (lines 350-355) has no budget row, so a Budget row fits its Low/Medium/High/Ultra/Governor columns: 0.5, 1.2, 4.9, 6.25, then `scale`, down to a quarter.
- Line 326 writes `examples/forest` as code, not a link. examples/demos.ts:952-955 gives the forest demo code 'forest/', so the link https://github.com/null3d-engine/null3d/tree/main/examples/forest/ follows the website contract.

## What does not hold in the proposed edit

1. The sentence proposed for line 77 has 26 words. The "Writing docs" rule in AGENTS.md allows at most 25.
2. Lines 57 and 372 say the same thing twice: "makes no object of its own" and "`read` ... takes the task's promise". If both go into one block after the first example, the cost facts leave "Costs and limits", where a reader looks for them, and the repeat stays. Cut the repeat instead. Keep the cost facts under Costs and limits and put the dense part in a block there.
3. The last sentence of line 57 ("A sketch that pushes in every frame keeps one two-number array for the place") is plain advice that a newcomer can act on. It should stay in the main text and not go into a block.

## Corrected edit

- Line 57: keep "Call `update` once in each frame. It places the box about the camera and sends the field's values to the GPU. The add-on's calls make no object of their own, so a sketch may make them in every frame. A sketch that pushes in every frame keeps one two-number array for the place, rather than a new one each time." Remove the two sentences about the task's promise and about fractions from this paragraph.
- Line 372: keep a short bullet: "The add-on makes no object of its own in a frame, and `read` takes only the task's promise. Run `bun run bench:allocation --wind` to see the bytes that its code allocates in a frame." Then, right after the list, add `<details><summary>Technical details: what the calls allocate</summary>` with the shared-memory and buffer path, the WebAssembly walk, the typed-array fractions, and the point (moved from line 57) that a fraction a page passes into a call can become an object before the browser optimizes the add-on's functions.
- Line 77: keep "`read` works out the air on the engine's job workers, up to about five thousand places a call. The answer gives the air at the frame's own time and lands before the next frame's update." Put the queue, replace and drop rules in `<details><summary>Technical details: how read queues its asks</summary>`, and keep in the block the fact that a dropped ask's array keeps its old numbers.
- Line 361: as proposed. Add a Budget row to the presets table, keep one short paragraph on what the governor does, and put the overlay line and its example in a details block.
- Line 326: as proposed. Link https://github.com/null3d-engine/null3d/tree/main/examples/forest/ and split after "as the example above does."
- Lines 24, 81, 272, 290, 328, 338: break at the fourth sentence, as proposed. This is low-value polish for line 81 (57 words).
