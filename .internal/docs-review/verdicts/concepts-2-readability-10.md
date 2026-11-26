# concepts-2-readability-10

## Finding as given

- page: concepts/static-dynamic, concepts/quality-presets, concepts/shadows
- anchor: first mention of S1, S2, S4, Skyway, Island showcase
- category: term-before-definition
- severity: medium
- claim: These pages cite benchmark and scene names as if the reader knows them. Only guides/performance.md line 82 says what S1 and S4 are. S2 and Skyway are never explained where a reader can find them from here.
- evidence: static-dynamic 74 'In the S2 benchmark'. quality-presets 63, 122 'while Skyway drew', 212 'the Island showcase', 214 'S1 benchmark with its smoke switch', 222. shadows 192, 241, 243, 245, 271, 292, 302, 304.
- proposedEdit: At the first mention on each page, add a gloss and a link: 'the S4 benchmark, a town of 5,000 still objects and 200 moving vehicles ([Performance guide](../guides/performance.md#phones-and-tablets))'. For S2: 'a scene graph of 5,096 objects, 6 levels deep'. Describe or remove 'Skyway'. Later mentions can use the short name.

Verdict: partly

## Evidence

- The core problem holds. The cited lines all use the names bare: static-dynamic.md:74 (S2), quality-presets.md:63 (S4), :122 (Skyway), :212 (Island showcase), :214 (S1, "its smoke switch"), :222 (S4), shadows.md:192, 241, 243, 245, 271, 292, 302, 304 (S4). None of the three pages links to guides/performance.md or porting/threejs-overview.md (grep for "performance" finds 0 hits on each page), so a reader has no path to a definition.
- The claim's details are wrong in two places:
  - S1 is defined at guides/performance.md:46 ("S1 has 100,000 boxes, and its onUpdate moves every box in every frame"), not only at line 82. Line 82 defines S4.
  - S2 is explained, at porting/threejs-overview.md:34 ("S2: a scene graph of 5,096 objects, 6 levels deep"). The finding's own proposed gloss is copied from there. It is not reachable from these pages, though.
- Skyway and Island are showcase demos (examples/demos.ts: name 'skyway', code 'showcase/skyway/', "A rainy megacity from a hover car"; name 'island', code 'showcase/island/', "A Mediterranean town on a hilly island in the open sea"). In docs, Skyway appears only as a table row label in guides/start-time.md and at quality-presets.md:122, and is never described. "Remove" is not needed: it can be glossed and linked by the website contract's demo-link format.
- The "smoke switch" of S1 (quality-presets.md:214) is also unexplained; the finding lists the line but its edit does not cover it.
- Severity medium fits: readers cannot tell what scene the figures describe, but the main teaching still reads.

## Corrected claim

The three pages use benchmark names (S1, S2, S4) and showcase names (Skyway, Island) with no gloss and no link. Definitions exist elsewhere: S1 at guides/performance.md:46, S4 at guides/performance.md:82, S2 only at porting/threejs-overview.md:34. Skyway and Island are showcase demos that no docs page describes. None of the three pages links to any of these.

## Corrected edit

At the first mention on each page, add a short gloss and a link; later mentions keep the short name.
- S4: "the S4 benchmark, a town of 5,000 still objects and 200 moving vehicles ([Performance guide](../guides/performance.md#phones-and-tablets))".
- S1: "the S1 benchmark, 100,000 boxes that move every frame ([Performance guide](../guides/performance.md#where-frame-time-goes))". Say in a few words what its smoke switch turns on, or drop "with its smoke switch".
- S2: "the S2 benchmark, a scene graph of 5,096 objects, 6 levels deep ([three.js comparison](../porting/threejs-overview.md))".
- Skyway: "the [Skyway showcase](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/skyway/), a rainy night city with thousands of hover cars".
- Island: "the [Island showcase](https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/), a town on a hilly island".
- Where a measurement paragraph moves into a `<details>` block (as other findings on these pages may propose), the gloss goes with the first mention, inside or outside the block, so the main text still reads with every block closed.
