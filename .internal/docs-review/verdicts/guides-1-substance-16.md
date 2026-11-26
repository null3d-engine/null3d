# guides-1-substance-16

## Finding as given

- page: guides/add-ons, concepts/lod
- anchor: ## Give every mesh levels of detail (lines 51-73)
- category: duplication, severity: medium
- claim: The section repeats the concept page's thresholds, planner, fades, refusals and pieces rules; the two copies already differ (the add-on page leaves out the 1,024 to 32,767 range for facing pieces). An add-on author needs only the rule and the opt-out table.
- evidence: docs/guides/add-ons.md:55, 59, 71, 73; docs/concepts/lod.md:29, 127, 129; packages/engine/src/scene/resources.ts:306-315.
- proposedEdit: Keep line 57, the opt-out table and one sentence each for levels: { cards: true } and levels: 'pieces'. Replace lines 55, 59 (after two sentences), 71 and 73 with a link to concepts/lod.md#levels-of-meshes-made-in-code, or a 'Technical details: when the engine plans or drops levels' block.

Verdict: partly

## Evidence

- The duplication is real, and wider than the finding says. The same rules appear on three pages, not two:
  - Thresholds and planner: add-ons.md:55, lod.md:29, api/geometry.md:228 and the table row at 246. All give 4,096 / 256 / 65,536, which match resources.ts (AUTOMATIC_LEVEL_TRIANGLES 4096, AUTOMATIC_COPY_TRIANGLES 256, AUTOMATIC_DRAWN_TRIANGLES 65_536).
  - Fade past about one and a half pixels: add-ons.md:55, lod.md:37 and 166, 178, api/geometry.md:238 and 277.
  - Refusals (joints, morph targets, targets, flat meshes, displacement or vertexOffset, updateVertices, setLevels): add-ons.md:71 and api/geometry.md:254-260. lod.md does NOT list them; lod.md:37 sends the reader to the geometry page for them.
  - Pieces: add-ons.md:73, lod.md:123-129, api/geometry.md:240.
- "The two copies already differ" is weak as stated. Leaving out the 1,024 to 32,767 range is a simplification, not a conflict: add-ons.md:73 says "a smaller mesh that many copies draw", which is true. A better sign of drift: add-ons.md:71 leaves out the refusal for meshes that only blended or light-through materials draw (api/geometry.md:258). The page says "in a few cases", so it does not claim to be complete, but the copies have already started to drift apart.
- Problems with the proposed edit:
  1. Wrong link target for the refusals. concepts/lod.md#levels-of-meshes-made-in-code does not hold the refusal list. The full list is at api/geometry.md#levels-of-detail (lines 242-261), together with the `levels` option table.
  2. Line 71 ends with a rule only for add-on authors: "Still pass `levels: false` for a mesh of the table, so the code states the decision where the mesh is made." It must stay in the main text. A link cannot replace it.
  3. Line 73 holds two more rules for add-on authors that must stay: "an add-on that takes the default gets [pieces] with no change" and "A mesh with `levels: false` gets none". The proposal keeps only the `'pieces'` sentence.
  4. Line 55's last sentence (the mesh keeps its vertex and triangle order, which raycasts and `updateVertices` read) tells an add-on author that the levels are safe to plan. It is short and worth keeping.
- Link or block: for duplicated detail, a link is better. Putting the copy in a collapsible block keeps three copies that can drift apart. Use the block only for detail that no other page holds.

## Corrected claim

The levels section of guides/add-ons repeats rules that concepts/lod.md and api/geometry.md#levels-of-detail already give: thresholds, the planner, fading, refusals and pieces. The refusals come from the geometry page, not the concept page. The copies have started to drift: the add-on page leaves out the refusal for meshes that only blended or light-through materials draw. Leaving out the 1,024 to 32,767 range is only a simplification. The add-on page should keep the rules that are only for add-on authors, and link to the other pages for the rest.

## Corrected edit

- Line 53: keep it.
- Line 55: keep "A mesh from `geometry.fromArrays` or a generator plans its levels at its first draw, on the job workers, when it is large or many copies draw it." and the sentence about vertex and triangle order. Replace the thresholds and fade detail with links: "[Levels of meshes made in code](../concepts/lod.md#levels-of-meshes-made-in-code) gives the sizes and how the levels switch."
- Line 57: keep it.
- Line 59: keep the first two sentences, the `buildLevels()` after `updateVertices` advice and the `levels: { cards: true }` sentence. Drop "A small mesh drawn a few times gains little, and each level adds draw work" and the `levels: true` detail. The geometry page's option table covers them.
- Line 61 and the table: keep them.
- Line 71: replace it with "The engine also refuses planned levels by itself for some meshes; [the geometry page](../api/geometry.md#levels-of-detail) lists them. Still pass `levels: false` for a mesh of the table, so the code states the decision where the mesh is made."
- Line 73: shorten it to "A mesh made in code gets [pieces](../concepts/lod.md#pieces-of-a-large-level) with its planned levels, so an add-on that takes the default gets them with no change. A mesh with `levels: false` gets none. A large mesh that takes no levels but spans the view, such as a merged far cell, asks for `levels: 'pieces'`, which sorts it into pieces by space alone."
- Do not use a collapsible block for this section. All the cut detail already lives on the linked pages.
