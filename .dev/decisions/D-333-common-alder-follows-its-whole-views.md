# D-333: the common alder follows its three whole views, not its widest one, and its cut pieces are proportions

Status: decided and built in the species record. Task: none.

Summary: The alder's reference set disagrees with itself. Still `01` draws a tree 1.23 times its
height wide, still `02` 0.59, still `18` 0.63 and the turning video's hull 1.015, so the record
follows the three that agree and states the outlier. Its cut pieces are fixed by their proportions,
not their leaves: width over length 0.49 and 0.45 against the photographs' 0.79 and 0.80 for the two
stem pieces, and 0.91 against 0.57 for the cluster.

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

The whole views' crown boxes, as shares of each plant's own height, read by the review tool's mask:

| Picture | Width | Height |
| --- | --- | --- |
| `01-whole-distant.png` | 1.227 | 1.000 |
| `02-whole-profile.png` | 0.590 | 0.898 |
| `18-silhouette.png` | 0.626 | 0.834 |
| `30-whole-with-landmark.png` | 0.920 | 0.772 |
| the turning video's hull | 1.015 at its widest | - |

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

Set `01` beside `18`: one is a broad tree whose lowest limbs reach past the width of its crown, the
other a cone half as wide with the trunk running through it. `02` and `30` stand with `18`. A viewer
who knows the species would take `18`, `02` and `30` for one tree and `01` for another.

## Decision

- The record follows `02`, `18` and `30`. Its envelope is the visual hull of stills `18` and `02`,
  which stand square to one another, so each gives the reach along one horizontal axis at every
  height. `fit.ts` keeps the fitting tool's own hull beside it, and the record says why it is not
  used. Rejected: growing to the tool's hull, which draws a crown 1.015 of the height wide where
  three of the four whole views stand near 0.6.
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
