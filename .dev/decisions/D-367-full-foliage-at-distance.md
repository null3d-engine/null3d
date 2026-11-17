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

1. **Keeping the leaf form longer — measured and rejected.** The near level holds 623,220 triangles against the card
   level's 62,023, and raising the switch moves the card level nearer, not the leaf form farther. Held at one distance and
   camera, the cards cover *more* than the leaf form: open sky 0.459 against 0.565 at fifty metres, 0.476 against 0.675 at
   seventy. So the switch is not the cause of a coverage loss, and a raise opens the crown. What a viewer sees at the pull
   back is the card's own style — a flat plate whose cut trims it — which is what the second cut answers.

2. **Make a far plate cover from every angle.** Its normal points outward from its clump's centre, so a camera from any
   direction sees the near-side plates close to face-on; and a second cut of the same picture is composited over it, so a
   plate carries more leaf than one cut allows. The rotation costs no triangle and the second cut one texture sample,
   which is why this route serves both the far band and a capped tree's leaf side.

More cards per clump stays in reserve for a band where neither applies. The done-when is the sky's step across the switch
at two hundredths or less and no visible style change at the pull back.
