# D-367: A crown keeps its foliage as the camera pulls back

Status: decided. The second cut is built and lands on the level branch; the radial-normal route is withdrawn. Task: none.

Summary: When a plant's drawing switches from its leaf form to leaf cards, the crown loses mass: real leaves at four to
fifteen metres, a thinned crown pulled back. The response is two mechanisms and not three. Keeping the leaf form longer
was measured and rejected; a second cut composited over every card plate was measured across the eight turn angles and
lands. Making a plate's normal radial is withdrawn, because the card material reads no vertex normal. Adding more cards
per clump stays in reserve.

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
| A second cut over each plate, one texel up | the leaf a plate carries, not its size | one texture sample | kept and landed |
| Two plates a clump with radial normals | the projected area of every plate from every angle | 0 triangles: a rotation | withdrawn: the card material reads no vertex normal |

The second cut's eight turn angles, open sky in the plant's box on the matte, unmasked against masked, one camera and
slot, the oak at seed 11, variant 0:

| Turn | Unmasked | Masked |
| --- | --- | --- |
| 0 | 0.459 | 0.449 |
| 45 | 0.429 | 0.418 |
| 90 | 0.464 | 0.452 |
| 135 | 0.422 | 0.412 |
| 180 | 0.397 | 0.387 |
| 225 | 0.446 | 0.437 |
| 270 | 0.420 | 0.409 |
| 315 | 0.459 | 0.450 |
| Mean | 0.4370 | 0.4268 |
| Spread | 0.067 | 0.065 |

The plate's grain on the parts picture, averaged over the same eight angles: the mean board grows from 215.9 to 265.4
square pixels, the board count falls from 543 to 459, and the card-coloured area grows 3.9 per cent. The painted
silhouette trims about one per cent, so the fuller read is the interior holes closing, not a larger outline. The colour
picture's local contrast rises from 13.93 to 14.52 and the share of grainy pixels from 0.791 to 0.801, so the grain
sharpens rather than softens.

How the data was produced: `bun run plants:review` runs on the oak under the shared drawing queue, one run a turn, each
state at the same camera and slot, the sky read on the matte and the boards on the parts picture. The runs are
`sw-base-<turn>` and `sw-cut1-<turn>` in the oak-reset build's `switch` folder.

The switch's own step, with the second cut landed: the oak at seed 11, variant 0, at one camera near its first card
switch with both levels forced so only the drawing swaps, the same camera and slot, the review's from-below slot with
the species framing at 4.6 metres and the record's switch pixels raised for the run. The leaf form leaves 0.219 of the
frame open and the cards 0.205, a step of 0.014 of open sky: the swap closes the crown slightly rather than opening it.
The runs are `step5-l0` and `step5-l1` in the oak-reset build's `switch` folder.

## Look

The owner's own recordings decide this row: the leaves at close range are the reference, and the pulled-back crown must
read as the same tree. The style change at the switch is the failure, not the grain alone. The clean same-commit pairs at
90, 135 and 180, read by the second reviewer at three times magnification, show the crown fuller at every one with the
grain still reading as lobed leaf clusters and internal variation, not slabs; the 45-degree pair is mixed-commit and the
0-degree angle has no unmasked twin at that commit, so neither decides. The board growth is the intended merging,
neighbouring plates joining into one board, not a side effect.

## Decision

Built: a card reads a second cut of its own picture one texel of the texture's height up, and the two cuts are combined by
their larger coverage, so the second cut can only add leaf and never remove any. The cost is one texture sample and no
triangle. Across the eight turn angles the crown's open sky closes 1.0 point in the mean and the spread across angles
barely moves, so the cut lifts every quarter evenly.

1. **Keeping the leaf form longer: measured and rejected.** The near level holds 623,220 triangles against the card
   level's 62,023, and raising the switch moves the card level nearer, not the leaf form farther. Held at one distance and
   camera, the cards cover *more* than the leaf form: open sky 0.459 against 0.565 at fifty metres, 0.476 against 0.675 at
   seventy. So the switch is not the cause of a coverage loss, and a raise opens the crown.

2. **A second cut over every plate: built and landed.** The cut rides the same texture sample's neighbour, so a species
   needs no new geometry and no new atlas. The offset ships as one texel; a species that needs another can name its own
   when the record gains the field.

3. **Radial plate normals: withdrawn.** The card material uses the plain plant shader, whose cards role takes its shading
   normal from the card's own surface map and never reads the vertex normal; the face-turning path runs only for merged
   foliage. Turning a plate's normal would therefore be inert, and the plane orientations themselves would have to change,
   which is a geometry change and not this route.

More cards per clump stays in reserve for a band where neither applies. The done-when is met with the second cut landed:
the swap itself steps 0.014 of open sky at one camera, and the cut across the eight angles closes 1.0 point in the
mean, both under the two hundredths the rule sets, and the grain does not coarsen.
