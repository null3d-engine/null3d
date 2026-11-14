# D-332: a card's twig line reaches the foliage it carries

Status: decided and built as the optional record field `lod.cardStalkToFoliage`. The European beech
sets it. The pedunculate oak and the common ash leave it unset, so they draw as they did. Task: none.

Summary: A card's plane stands ahead of the row that draws it. The card's twig line ran only
backwards, so a card could float clear of its wood. The beech's planes stand 0.64 to 1.44 meters
ahead of their rows. Its whole views broke into 5 to 10 pieces, each 2 to 4 work pixels from the
crown. With the line to the plane's center the beech's whole views draw 2, 3 and 3 pieces. The oak's
planes stand 0.14 to 0.27 meters ahead, and its line closes its crown.

## Question

Why does the card's twig line close the oak's whole view and not the beech's? What change closes the
beech's pieces without moving the oak's or the ash's judged figures?

## Rule

- The change is an optional record field, off by default. A species that does not set it draws
  exactly as today. The oak's and the ash's figures were judged on the present behavior. A shared
  default change would put them in question for a fault neither has.
- The line replaces the present quad, so the far card level adds no triangles. That level sits at
  42,687 triangles against the owner's 43,000 cap.
- A test holds that a record without the field draws today's line, end for end.

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
pixel gap. The field this rejection names is removed since D-346's addendum on the card-level size.
Also rejected: `woodOrders` raised to draw order-2 twigs at the far level, which overruns
the 43,000 cap. Also rejected: moving the plane centers in the bake, which moves every species' cards
and every judged picture.

## Consequences

- `lod.cardStalkToFoliage` in `packages/vegetation/src/core/record.ts`, with the line in
  `packages/vegetation/src/lod/cards.ts`. The line spans the parent node's end and the plane's
  center. Absent, it spans the row and the stretch behind it, as before.
- `packages/vegetation/src/lod/cards.test.ts` holds the absent case end for end. It also holds the
  present case's reach and that both draw the same triangles.
- The beech's record sets the field beside its two-pixel width. The oak and the ash do not.
- A stated fault remains at the whole view's scale. The line joined the first wave: the beech's whole
  views fell from 8, 5 and 10 pieces to 2, 3 and 3. Edge density then took the silhouette from 9 to 7
  and the default view to 1. The rest are the card tips' own outer leaves, standing 2 to 8 pixels
  beyond the point the line reaches. That is a fault of the card level at that scale, not of the
  crown, and it is recorded beside the look-up views' limit.
