# api-3-readability-28

## Finding as given

- Page: api/raycast
- Anchor: "## How queries find objects", lines 252-265
- Category: technical-details-block. Severity: low.
- Claim: The section explains tree levels, rebuild rules, four-child nodes and SIMD, pixel-sized rows and 64-bit cell frames. The two facts a user needs (the first query on a large mesh can be slow; a large dynamic batch adds cost to each frame that queries) are buried in it.
- Evidence: line 256 "A large mesh can make that first query slow."; line 257 "So a large dynamic batch of particles adds to each frame that runs a query."
- Proposed edit: Lead with a short "What this means for your scene" list: the first query per mesh builds its tree; dynamic objects rebuild in each frame that queries; cost does not grow with scene size; far objects keep precision. Put lines 257-265 in `<details><summary>Technical details: the query trees</summary>`.

Verdict: partly

## Evidence

- docs/api/raycast.md:252-265 hold the section as the finding describes. The section is the last one before the API reference link (line 267), so it is already an end-of-page deep dive.
- "Buried" is half right. The slow-first-query fact (line 256) is in the first bullet of the section, third sentence. A reader sees it at once. The dynamic-batch fact is the sixth sentence of a 7-sentence bullet (line 257), so that one is buried.
- The proposed summary list leaves out user-facing facts that the block would then hide:
  - line 257: moving a static object is cheap (the engine adjusts boxes), but creating or destroying objects rebuilds the static tree; a frame with no queries builds nothing. These facts help a user choose `dynamic: true` or not.
  - line 263: when the query's layers hold pixel-sized sprites, points or lines, the raycast does more work; a raycast on layers without them costs no more. This is a performance fact with a clear user action (keep such rows on their own layer).
- The "cost does not grow with scene size" fact is also stated in the page intro (line 14, "So a query tests only the few triangles near it"). Repeating it in the summary is fine but not new.
- Moving the four-child/SIMD detail (line 259), the three.js comparison reasoning (line 261), the box-growth mechanism (line 263) and the cell-frame mechanism (line 265) into one block is a sound use of the block. The block has no headings and no nested blocks, so it meets the contract.

## Corrected claim

The dynamic-batch cost (line 257) is buried; the slow-first-query fact (line 256) is not, as it opens the section. A short lead list plus a details block is a good fit, but the list must keep every user-facing cost fact the block hides.

## Corrected edit

Under "## How queries find objects", lead with this list, then put the mechanism text in one block:

- The first query after a mesh is created builds that mesh's tree. A large mesh can make that first query slow.
- Static objects are cheap to move. Creating or destroying objects rebuilds the static tree at the next query.
- Dynamic objects, dynamic batches, sprites, points and lines are rebuilt in each frame that runs a query. A large dynamic batch of particles adds to each such frame. A frame without queries builds nothing.
- A raycast on layers that hold pixel-sized sprites, points or lines costs more. Keep them on their own layers to keep other raycasts fast.
- A ray costs about the same in a large scene as in a small one.
- Objects thousands of kilometers from the origin get the same precision as objects near it.

<details>
<summary>Technical details: the query trees</summary>

(the two-level tree description from lines 254-257, the four-child/SIMD paragraph at 259, the three.js comparison at 261, the box-growth reasoning at 263 and the cell-frame reasoning at 265)

</details>
