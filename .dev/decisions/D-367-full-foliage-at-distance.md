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
| A fixed count of pictures on every plate | the grain inside a plate, so one picture shows eight shoots | 0 triangles at the same count | rejected: the swap rearranges the crown, which the eye reads as a few big shapes arriving |
| The first card level's pictures fitted to each clump | the grain inside a plate, so one picture is one shoot at its own scale | 47,076 card triangles on the oak; the level reads 94,681 against its 150,000 price | kept |
| The second cut over each plate, one texel up | the leaf a plate carries, not its size | one texture sample | kept and landed |
| Two plates a clump with radial normals | the projected area of every plate from every angle | 0 triangles: a rotation | withdrawn: the card material reads no vertex normal |
| Radial plate orientations, a turn a clump | what a plate shows at each angle | 0 triangles: a rotation | rejected: the mean open sky rises 2.2 points, the spread widens, and the shade tilts |

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

The switch's own step, with the pictures fitted to each clump: the oak at seed 11, variant 0, both levels forced at one
camera. At the review's from-below slot the crown above the fork reads 0.8585 covered on the leaf form. The first card
level reads 0.8945. At the inside-crown slot the two read 0.7948 and 0.8604. The largest leafy shape in the inside frame
is 47,352 pixels against the leaf form's 32,144. The separate shapes are 783 against 1,013. A fixed three-by-three count
leaves the crown at 0.9177 covered, with a largest shape of 69,852 pixels. That is the coarsened grain the rule
refuses. The runs are `switch-l0-head`, `switch-l1-tiles`, `inside-l0-head` and `inside-l1-tiles` in the oak-reset
build's `lod` folder. The fixed count's pair is `switch-l1-head` and `inside-l1-head` beside them. The two fields
differ: the parts picture's crown cover is not the frame's open sky.

The rule's own field, the frame's open sky on the matte at the from-below camera, steps from 0.0268 on the leaf form to
0.0168 on the first card level. That is one point, inside the two hundredths the rule sets. The runs are
`switch-l0-matte` and `switch-l1-matte` beside the pair.

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

4. **Radial plate orientations: rejected.** Turning each clump's plate set so its lead upright plane's own normal faces
   the clump's azimuth away from the crown's axis was built behind a record value and measured across the eight angles:
   the mean open sky rises from 0.4268 to 0.4491, the spread widens from 0.065 to 0.084, and the crown's mean lightness
   swings 4.6 levels across the angles against 3.5 today. Geometry alone cannot turn a plate without tilting its shade,
   because the baked surface normals turn with it. The parts pictures are the evidence and are why the route stops:
   runs `sw-turn3-<turn>` in the oak-reset build's `switch` folder, beside their `sw-cut1-<turn>` twins.

5. **The first card level's pictures fitted to each clump: built.** A plate grown k times its row's picture shows k
   pictures a side. One picture is then one shoot at its own scale. On the oak the counts run 2 to 10 a side, median 5.
   The level's cards cost 47,076 triangles against the fixed count's 14,418. The level reads 94,681, inside its
   150,000 price and the 155,000 class cap. The second card level keeps three a side, so the far band cannot move. Its
   card mesh keeps the bytes it had. Every species whose planned form draws clump cards takes the rule. Its first card
   level is measured again when that species' pictures are next drawn.

More cards per clump stays in reserve for a band where neither applies. The done-when is met with the pictures fitted.
The frame's open sky steps one point at the from-below camera, from 0.0268 to 0.0168, inside the two hundredths. The
crown's own area cover steps 3.6 points at that camera and 6.6 at the inside-crown camera. Under the fixed count it
steps 5.9 and 9.1. The grain matches the leaf form's separate shapes within a fifth. The cut across the eight angles
closes 1.0 point in the mean. The area cover's further closing is the card level's own fuller cover. The cover factor
below one opens it only by coarsening the leaf.

## The card's picture follows the leaf it stands for

A card's mask and its colour came from the texture manifest's leaf crop. A needle species' crop is a
picture of a needle bundle, so its cards baked the bundle's silhouette: the pine's close view showed
flat pale plates among the needles. A needle kind no longer clips its fragments to the crop's outline,
so each needle's geometry makes its own tuft. A flat blade keeps the crop's outline, which is the leaf.

The pine's close view at one camera reads as needle sprays after the change. The card atlases of the
oak, the birch and the cypress are byte-identical (`4ed6e51065f5f32a`, `8ad6727e8832a2d1`,
`b3276d7be6e8825`), while the pine's and the sequoia's move. The card's base colour divides the baked
mean out: `leaf_light` multiplies the texel by the face's scale, `reflectance / mean / (1 - share)`, so
the paleness is not the mean's brightness. A panel of one term at a time on the pine's close view reads
which term pays it.
