# D-367: A crown keeps its foliage as the camera pulls back

Status: decided as a plan; the first measurement is running and nothing is built. Task: none.

Summary: When a plant's drawing switches from its leaf form to leaf cards, the crown loses mass: real leaves at four to
fifteen metres, a thinned crown pulled back. The response is two mechanisms and not three: keep the leaf form longer for
the near band, and make each far plate cover from every direction with its normal pointing outward from its clump and a
second cut composited over it. Adding more cards per clump stays in reserve.

## Question

A viewer pulling away from a tree sees its foliage thin at the moment the drawing swaps real leaves for flat leaf-group
pictures. The style change is visible at the switch and the crown reads sparse from then on. What fixes it without
coarsening the leaf the way the cover factor does?

## Rule

The sky across the switch must step by no more than two hundredths, the change must not coarsen the leaf's grain to the
eye, and the cost must be stated in triangles or samples. A route that buys cover by enlarging the cut is rejected: the
cover factor proved that opening a crown that way coarsens its leaf. A route is judged at the camera the owner filmed and
across the eight turn angles the review already uses.

## Data

| Route | What it moves | Cost | Verdict |
| --- | --- | --- | --- |
| The first card level's cover factor below one | the cut, hence the crown's sky 0.142 to 0.204 on the birch | 0 triangles; leaf delta-E 10.63 to 14.39 | rejected: coarsens the leaf |
| A crossed plane a card | 0.2 of a point of sky on the willow | 11,492 triangles at the first card level | rejected: inert for cover |
| Four pictures a side instead of three | finer plates, no more mass | 11,214 card triangles on the oak | rejected: scatters the crown into speckle |
| Keeping the leaf form longer | the near band's switch | the near level holds 623,220 triangles against the card level's 62,023, so a raise costs about ten times the triangles for every metre | rejected: and at one distance the leaf form reads more open than the cards |
| A second cut over each plate | the leaf a plate carries, not its size | one texture sample | to be built |
| Two plates a clump with radial normals | the projected area of every plate from every angle | 0 triangles: a rotation | to be measured across the eight turn angles |

How the data was produced: `bun run plants:review` runs on the oak, the birch, the beech and the willow with each
setting drawn at one camera, and the shaded plates measured on the parts picture.

## Look

The owner's own recordings decide this row: the leaves at close range are the reference, and the pulled-back crown must
read as the same tree. The style change at the switch is the failure, not the grain alone.

## Decision

The plan, with its first mechanism measured and rejected.

1. **Keeping the leaf form longer: measured and rejected.** The near level holds 623,220 triangles against the card
   level's 62,023, and raising the switch moves the card level nearer, not the leaf form farther. Held at one distance and
   camera, the cards cover *more* than the leaf form: open sky 0.459 against 0.565 at fifty metres, 0.476 against 0.675 at
   seventy. So the switch is not the cause of a coverage loss, and a raise opens the crown. What a viewer sees at the pull
   back is the card's own style, a flat plate whose cut trims it, which is what the second cut answers.

2. **Make a far plate cover from every angle.** Its normal points outward from its clump's centre, so a camera from any
   direction sees the near-side plates close to face-on; and a second cut of the same picture is composited over it, so a
   plate carries more leaf than one cut allows. The rotation costs no triangle and the second cut one texture sample,
   which is why this route serves both the far band and a capped tree's leaf side.

More cards per clump stays in reserve for a band where neither applies. The done-when is the sky's step across the switch
at two hundredths or less and no visible style change at the pull back.

## What the second cut does

Landed as `db04b90b9` on the level branch. A card's coverage takes the larger of two cuts of the same picture, the second read
one texel up it, so the cut can only add leaf.

| Turn | One cut | Two cuts |
| --- | --- | --- |
| 0 degrees | 0.459 | 0.449 |
| 45 | 0.429 | 0.418 |
| 90 | 0.464 | 0.452 |
| 135 | 0.422 | 0.412 |
| 180 | 0.397 | 0.387 |
| 225 | 0.446 | 0.437 |
| 270 | 0.420 | 0.409 |
| 315 | 0.459 | 0.450 |

The figures are open sky in the plant's box, at one camera and one slot. The mean closes 1.0 point, from 0.4370 to 0.4268. The
spread across the eight turns moves only 0.067 to 0.065, so every quarter gains alike. The merged leaf boards on the parts
picture grow 215.9 to 265.4 square pixels, 23 per cent, while their count falls 543 to 459 and the card-coloured area rises
3.9 per cent. Neighbouring plates merge, and each plate does not inflate. Local contrast rises 13.93 to 14.52, and the grainy
share 0.791 to 0.801.

The merging is the intended mechanism, not a side effect. Oak-A read the grain as lobed leaf clusters with internal variation
at three times magnification, and found the crown fuller at every clean pair: 90, 135 and 180 degrees. The 45 degree pair is
mixed-commit and the 0 degree turn has no base, so neither decides. The silhouette trims about a per cent while the interior
holes close, so the fuller read comes from the holes.

The done-when holds: the mean sky step is under two hundredths, and the style change at the pull back is the holes closing
rather than the plates softening.
