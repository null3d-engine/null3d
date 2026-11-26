# concepts-1-readability-02

## Finding as given

- page: concepts/architecture, concepts/culling, concepts/large-worlds, concepts/lighting
- anchor: architecture '## Precision far from the origin'; culling '## Grid cells' and '## What this means for your sketch'; large-worlds '## Grid cells' and '## Limits'; lighting '## Lights far from the origin'
- category: contradiction
- severity: high
- claim: Grid cells, 64-bit camera offsets and the 512-cell limit are explained four times. The precision figures use different measures, so they seem to disagree: 8 mm at 100 km (architecture), 4 mm at 100 km and 3 cm at 1,000 km (culling), 6 cm at 1,000 km and 8 mm past 100 km (large-worlds). Lighting says the cell is 'about 1 km', the others say 1,024 m.
- evidence: architecture.md:110-112; culling.md:174-183, 212-219; large-worlds.md:22, 28-36, 74, 99, 113-117; lighting.md:166-168
- proposedEdit: Keep the full text only in large-worlds 'Grid cells' and 'Limits'. On culling, replace '## Grid cells' with two sentences and a link, and replace the precision bullets of 'What this means for your sketch' with a link to large-worlds#limits. Shorten architecture's section to two sentences and a link. Fold lighting's section into one sentence in 'Lights as objects'. Use one measure (the step size) everywhere.

Verdict: partly

## Evidence

- The repetition is real. Cell size, the root/child/row cell rule, camera-to-cell offsets in 64-bit floats and static matrices staying on the GPU appear in architecture.md (Precision far from the origin), culling.md (Grid cells), large-worlds.md (Grid cells) and, in short, lighting.md (Lights far from the origin). The 512-cell limit appears in both culling.md (What this means for your sketch) and large-worlds.md (Limits).
- The figures do not disagree. They are correct for 32-bit floats, and they use two measures. The float32 spacing is 0.98 mm at 10 km, 7.8 mm at 100 km, 6.25 cm at 1,000 km and 0.5 m at 6,378 km. Architecture and large-worlds give that step (8 mm, 6 cm, 0.5 m). Culling says "to within about 4 mm" and "3 cm", which is the largest rounding error, half a step. A reader can still think they clash, so the claim that they "seem to disagree" holds. The "contradiction" category and "high" severity overstate it. No figure is wrong, so nothing misleads a reader. Medium fits better: the repetition makes the pages harder to use.
- "About 1 km" on lighting.md is a rounding of 1,024 m. It is not a contradiction. On its own it would be low polish.
- The proposed edit loses unique content as written:
  - The culling bullet about `getWorldPosition` and `getWorldMatrix` (pass a plain array or a `Float64Array`) is not in large-worlds.md. It is in api/objects.md, but large-worlds#limits does not say it. A link to large-worlds#limits alone drops it from the concepts pages.
  - culling.md "Skipping cells out of view" depends on which cell each object takes ("A still object is a static object whose parents are all static", "One that moves into another cell rebuilds the cell order"). The culling summary must keep the rule that a root object takes the cell of its position, its children share it, and a row takes its own cell. Two sentences can hold that, but the edit must say so.
  - The culling bullet "A mesh's vertices ... stay 32-bit" is already covered by large-worlds "Floating-origin geometry", not "Limits". The link target should cover both sections.
- Architecture's section links to Culling for "the cells and their limits". After the edit it should link to large-worlds instead.
- lighting.md has a "## Lights as objects" heading (line 144), so folding the section there works. large-worlds.md:36 already says lights work from the cells.

## Corrected claim

Grid cells, camera-relative offsets and the 512-cell limit are explained on four pages. The precision figures are all correct, but two measures appear. Architecture and large-worlds give the step size (8 mm at 100 km, 6 cm at 1,000 km). Culling gives the largest error, half a step (4 mm, 3 cm). Readers can take these as a contradiction. Severity medium (repetition and mixed measures), not high.

## Corrected edit

Keep the full text in large-worlds "Grid cells", "Floating-origin geometry" and "Limits". Add to large-worlds "Limits" (or "Large-world mode") one bullet that `getWorldPosition` and `getWorldMatrix` return 64-bit positions, so pass a plain array or a `Float64Array`. On culling, cut "## Grid cells" to two or three sentences: cells are 1,024 m cubes; a root object takes the cell of its position and its children share it; a row takes its own cell. Then link to large-worlds#grid-cells. In culling "What this means for your sketch", keep the code sample. Replace the limit bullets with one sentence and links to large-worlds#floating-origin-geometry and large-worlds#limits. Shorten architecture's section to two sentences that link to large-worlds, not to culling. Fold lighting's section into one sentence in "Lights as objects" and say 1,024 m. Where a precision figure stays, give the step size.
