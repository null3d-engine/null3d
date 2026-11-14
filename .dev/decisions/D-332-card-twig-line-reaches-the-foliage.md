# D-332: a card draws the twig it stands on

Status: decided and built as the optional record fields `lod.cardStalk` and
`lod.cardStalkToFoliage`. A card whose record asks draws its supporting twig as a line at the twig's
own width on screen, never under the wood's least drawn width. The beech, birch, alder, cypress,
holm oak and willow ask; the oak, ash, saguaro and olive do not, so their judged pictures keep no
line. Task: none.

Summary: A card's plane stands ahead of the row that draws it. The card's twig line ran only
backwards, so a card could float clear of its wood. The beech's planes stand 0.64 to 1.44 meters
ahead of their rows. Its whole views broke into 5 to 10 pieces, each 2 to 4 work pixels from the
crown. With the line to the plane's center the beech's whole views draw 2, 3 and 3 pieces. The oak's
planes stand 0.14 to 0.27 meters ahead, and its line closes its crown. The line's width was a fixed
least in pixels; it now follows the twig, so a flowering stem thinner than a texel draws at any
distance and a thick twig draws its own width. The tufts' first card level is what a width that
follows the stem answers: at picture 02 the sedge drew 11 pieces with 9 floating, the meadow grass
14 with 13, because their stems fell under the card's cut while their heads drew.

## Question

Why does the card's twig line close the oak's whole view and not the beech's? What change closes the
beech's pieces without moving the oak's or the ash's judged figures?

## Rule

- A card draws its stalk only where its record asks, with `lod.cardStalk` at 1 or more. A species
  that does not ask draws exactly as before: the oak's, the ash's, the saguaro's and the olive's
  figures were judged without a line, and a shared default would put them in question for a fault
  none has.
- The line is as wide as the twig its row grows from, which the card mesh writes in its second
  texture coordinates, and never narrower than the wood's least drawn width. The record's value asks
  for the line; it no longer sets a fixed width.
- The line ends at the stretch behind the row, or at the card plane's center where
  `lod.cardStalkToFoliage` asks. A card cut along its piece starts at the piece's base, so its line
  ends at the row.
- The line replaces the present quad, so a card that drew a stalk before adds no triangles. A record
  that newly asks adds 4 triangles a card: the sedge reads 2,482 and 1,248 triangles at its two card
  levels without one, and 4,094 and 2,056 with it, against its own 3,100 and 1,550. On the shipped
  tuft shapes, whose card levels read 1,822 and 930, the line's cost fits those caps. The tufts ask
  only where their own walk holds their caps.
- A test holds that a record that asks for no stalk draws none, and that a record that asks draws one
  quad a card at its twig's radius.

## Data

Measured at the beech's `e36065039` (run `beech-r40`, seed 11, variant 0, preset high). The oak's
columns come from `873f6f393` (run `round9`). The lines headed "with the line" come from
`4a757b4ed` (run `beech-r41`, same seed and variant, stills only). A Bun script read each kit's card
planes and placement scales.

| Measure | European beech | Pedunculate oak |
| --- | --- | --- |
| Card plane center ahead of the row, in shoot space | 0.33 to 0.74 m | 0.10 to 0.19 m |
| Placement scale | 1.95 | 1.40 |
| Card plane center ahead of the row, in the crown | 0.64 to 1.44 m | 0.14 to 0.27 m |
| Twig line's reach behind the row | the internode, about 0.1 to 0.6 m | the same |
| Whole view pieces, 01 / 02 / 18, render | 8 / 5 / 10 | 1 |
| The reference's pieces, 01 / 02 / 18 | 1 / 1 / 1 | 1 |
| Piece size in the work picture | 24 to 144 pixels (one leaf to a small card) | none |
| Nearest foliage from a piece | 2 to 4 work pixels (0.14 to 0.28 m) | none |
| Whole view pieces, 01 / 02 / 18, with the line | 2 / 3 / 3 | not measured |
| Sky gap, 01 / 02 / 18, with the line | 0.085 / 0.075 / 0.084 | not measured |
| Far card level triangles | 42,687 | 15,613 |

The sky gaps with the line stand against the reference's 0.069, 0.044 and 0.107. The line closed
each gap by 0.013 to 0.021. The gaps at 01 and 02 sit inside the row's band. The gap at 18 stands
0.023 below its reference, which is 0.003 past the 0.02 allowance on the closed side.

How the data was produced: `bun tools/plant-review.ts european-beech --views whole,silhouette`,
then `matteMask` and `components` over the run's mattes. Each piece's size and its distance to the
main mass came from them. A Bun script over `prototype.card.planes` gave the plane centers. One work
pixel spans about 7 cm at the beech's whole view. Its crown box is 476 pixels for a crown about 34 m
across.

## Look

The line under the card reads as the spray's own twig. The reference photographs show that twig
where a spray leaves a limb. Without the line, a card may float a hand's width clear of the crown.
The photograph's own crown is one piece at the same work width.

## Decision

Chosen: the optional line to the plane's center, taken by the beech. Rejected: `cardGrow` at the
oak's 1.25. The card's center stays 0.64 to 1.44 m ahead, so it closes under a pixel of a 2 to 4
pixel gap. Also rejected: `woodOrders` raised to draw order-2 twigs at the far level, which overruns
the 43,000 cap. Also rejected: moving the plane centers in the bake, which moves every species' cards
and every judged picture.

## Consequences

- `lod.cardStalk` and `lod.cardStalkToFoliage` in `packages/vegetation/src/core/record.ts`, with the
  line in `packages/vegetation/src/lod/cards.ts`. The line spans the parent node's end and the
  plane's center where the second field asks. Absent, it spans the row and the stretch behind it.
- The card mesh writes the twig's radius in the second texture coordinates, which the vertex stage
  reads to widen the line. `packages/vegetation/src/render/plant.wgsl` and its view-face copy hold
  that, and the species header's stalk-width texel is gone.
- A record that names a stalk draws one at its twigs' own widths; the beech, birch, alder, cypress,
  holm oak and willow do. The oak, ash, saguaro and olive do not.
- `packages/vegetation/src/lod/cards.test.ts` holds that a record with no stalk draws none, and that
  one that asks draws one quad a card at its twig's radius, between that radius and the thickest.
- A stated fault remains at the whole view's scale. The line joined the first wave: the beech's whole
  views fell from 8, 5 and 10 pieces to 2, 3 and 3. Edge density then took the silhouette from 9 to 7
  and the default view to 1. The rest are the card tips' own outer leaves, standing 2 to 8 pixels
  beyond the point the line reaches. That is a fault of the card level at that scale, not of the
  crown, and it is recorded beside the look-up views' limit.
