# D-367: A crown keeps its foliage as the camera pulls back

Status: decided as a plan; the first measurement is running and nothing is built. Task: none.

Summary: When a plant's drawing switches from its leaf form to leaf cards, the crown loses mass: real leaves at four to
fifteen metres, a thinned crown pulled back. The response is two mechanisms and not three — keep the leaf form longer for
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
| Keeping the leaf form longer | the near band's switch | the near form's triangles, to be measured | to be measured |
| A second cut over each plate | the leaf a plate carries, not its size | one texture sample | to be built |
| Two plates a clump with radial normals | the projected area of every plate from every angle | 0 triangles: a rotation | to be measured across the eight turn angles |

How the data was produced: `bun run plants:review` runs on the oak, the birch, the beech and the willow with each
setting drawn at one camera, and the shaded plates measured on the parts picture.

## Look

The owner's own recordings decide this row: the leaves at close range are the reference, and the pulled-back crown must
read as the same tree. The style change at the switch is the failure, not the grain alone.

## Decision

Two mechanisms, in the order they are measured.

1. **Keep the leaf form longer.** The switch is in pixels of the plant's height on screen, so it is a record number.
   Measure, do not assume: at least two raises, reading the plant's triangles, the sky and the level drawn on both sides.
2. **Make a far plate cover from every angle.** Its normal points outward from its clump's centre, so a camera from any
   direction sees the near-side plates close to face-on; and a second cut of the same picture is composited over it, so a
   plate carries more leaf than one cut allows. The rotation costs no triangle and the second cut one texture sample,
   which is why this route serves both the far band and a capped tree's leaf side.

More cards per clump stays in reserve for a band where neither applies. The done-when is the sky's step across the switch
at two hundredths or less and no visible style change at the pull back.
