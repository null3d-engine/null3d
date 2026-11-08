# D-333: the common alder follows its three whole views, not its widest one, and its cut pieces are proportions

Status: decided and built in the species record. Task: none.

Summary: The alder's reference set disagrees with itself: stills `01` and `30` draw a crown box
1.227 and 1.192 as wide as it is tall, stills `02` and `18` 0.658 and 0.750. The record follows the
narrow pair, which its outline fits better, and states the disagreement rather than averaging it.
Its cut pieces are fixed by their proportions, not their leaves: width over length 0.49 and 0.45
against the photographs' 0.79 and 0.80 for the two stem pieces, and 0.91 against 0.57 for the
cluster.

## Question

Which of the alder's reference pictures sets its crown's width, and what fixes a cut piece that reads
as a bare stem where its photograph shows a leafy branch?

## Rule

- A species passes only when every row passes on every reference picture
  ([plant review](../plant-review.md)). Where the pictures disagree, the record states the
  disagreement and its figures rather than averaging it.
- Row 6 is a band in both directions: a render's sky gap may stand at most 0.05 above its
  photograph's and at most 0.02 below it.
- Every budget holds at every tier, under the owner's caps for a tree: kit 3.4, 4, 7.1 and 13 MB,
  variants 20, 20.1, 20.3 and 20.7 MB, first card level 150,000 triangles.

## Data

The whole views' crown boxes, as the review tool measures them, in work pixels and as their width
over their own height:

| Picture | Box, width by height | Width over height |
| --- | --- | --- |
| `01-whole-distant.png` | 373 by 304 | 1.227 |
| `02-whole-profile.png` | 242 by 368 | 0.658 |
| `18-silhouette.png` | 249 by 332 | 0.750 |
| `30-whole-with-landmark.png` | 323 by 271 | 1.192 |
| the turning video's eight angles | 234 by 347 to 324 by 272 | 0.674 to 1.191 |

The turning video does not settle it: its own crown boxes run from 0.67 to 1.19 over its eight
angles, because the generated tree drifts between frames. The envelope the fitting tool measures is
1.015 of the plant's height wide at its widest, which is a third measure again and the widest of
any of them.

The same views' sky gaps, which row 6 reads: `01` 0.140, `02` 0.091, `18` 0.180, `30` 0.138.

The cut pieces, width over length, photograph against the run before the fix:

| Still | Photograph | Render |
| --- | --- | --- |
| `21-branch-studio.png` | 0.79 | 0.49 |
| `22-subbranch-studio.png` | 0.80 | 0.45 |
| `23-leaf-cluster-studio.png` | 0.57 | 0.91 |
| `11-leaf-cluster.png` | 0.66 | 0.96 |

How the data was produced: `bun run plants:review common-alder --slot-query
tools/lib/plant-review/slots/common-alder.json --out /tmp/alder-renders --run alder-r12`, and the
same command's later runs; the crown boxes and gaps come from `metrics.json`, and the cut pieces'
boxes from each run's matte and each photograph's mask.

## Look

Set `01` beside `18`: one is a broad tree, its crown box wider than it is tall, the other a cone
whose box is three quarters as wide as it is tall. `30` stands with `01` and `02` with `18`, so the
pictures split two and two. The eyes do not settle it, so the figures do: the narrow crown the
record grows outlines 0.67 against `02`, 0.60 against `18`, 0.62 against `30` and 0.42 against
`01`, so it fits the narrow pair better.

## Decision

- The record follows `02` and `18`. Its envelope is the visual hull of those two stills, which
  stand square to one another, so each gives the reach along one horizontal axis at every height.
  `fit.ts` keeps the fitting tool's own hull beside it, and the record says why it is not used.
  Rejected: growing to the tool's hull, which draws a crown 1.015 of the plant's height wide, wider
  than any whole view.")
- The piece count at a whole view is two to three against the photograph's one, at `lod.cardGrow`
  1.7. Neither a wider card stalk nor a denser crown moved them; the card's size did, halving them
  from five, four, three and three to two, three, three and two. The record does not claim one.
- Row 6 cannot pass on every whole view, and the record states why: still `02` needs a gap of 0.141
  or less and still `18` needs 0.16 or more, an empty band. The crown sits where three of the four
  views pass and `02` misses by 0.02.
- The cut pieces are fixed by their proportions. The stem pieces splay side shoots at 70 degrees
  from the stem (`lateral`), and the cluster's six leaves stand along a stem with its internodes
  showing rather than crowded at one point. Rejected: thinning leaves, which a studio still scales
  back up, and a real branch cut from the grown plant, which draws one bare pole with a tuft.
- The rim's pieces fell from 5, 3, 1 and 3 at the four whole views to one at each, from the engine's
  card-coverage fix and `lod.cardStalk` at 2.5 pixels. No extra shoots were spent on them.

## Consequences

- `packages/vegetation/src/species/common-alder/record.ts` holds the envelope, the shoot classes and
  the budget, each figure beside the still it comes from.
- `tools/lib/plant-review/slots/common-alder.json` holds each photograph's own light and framing.
- The species' densest variant measures 18.5, 18.6, 18.7 and 18.8 MB from the low tier up, under the
owner's twenty; its kit 2.44, 3.11, 4.33 and 6.80 MB under 3.4, 5, 7.1 and 13.
- The young bark's tiling spans six centimetres round the stem against twelve, which takes its
  edge-direction mix from 0.401 to 0.309 and its surface colour difference from 3.08 to 3.40, both
  over the three-step mark. The grain's own elongation is a texture-build fault, with the two ratios
  recorded in [D-309](D-309-plant-textures-from-references.md).
