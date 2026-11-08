# D-334: the common alder follows its three whole views, not its widest one, and its cut pieces are proportions

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

The stem pieces as the class change moved them, drawn on the record before it was committed, so
these steer the design and are not evidence:

| Run | Still | Groups render / photograph | Gap render / photograph | Outline IoU |
| --- | --- | --- | --- | --- |
| branch on the crown's spray | `21` | 1 / 1 | 0.277 / 0.412 | 0.235 |
| branch class at 1 m | `21` | 12 / 1 | 0.650 / 0.412 | 0.154 |
| branch class at 0.78 m | `21` | 7 / 1 | 0.446 / 0.412 | 0.164 |
| sub-branch two years | `22` | 2 / 1 | 0.484 / 0.428 | 0.153 |
| sub-branch three years, 0.55 m | `22` | 1 / 1 | 0.479 / 0.428 | 0.252 |

Covered area moves with the square of a piece's length, so the branch's 0.65 at a metre becomes
0.45 at 0.78 m. Its width does not follow: the piece draws one prototype, so which way its side
shoots point is the seed's choice, and only their number answers it from the record.

The committed record draws `21` at seven groups and 0.446 background against 0.412, and `22` at one
group and 0.479 against 0.428; its outline overlap against the two photographs is 0.164 and 0.252.
The sub-branch's half turn rises from 0.180 to 0.270 in outline overlap, and its background share
from 0.468 to 0.394 against the photograph's 0.425.

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
  than any whole view.
- The piece count at a whole view is two to three against the photograph's one, at `lod.cardGrow`
  1.7. Neither a wider card stalk nor a denser crown moved them; the card's size did, halving them
  from five, four, three and three to two, three, three and two. The record does not claim one.
- Row 6 cannot pass on every whole view, and the record states why: still `02` needs a gap of 0.141
  or less and still `18` needs 0.16 or more, an empty band. The crown sits where three of the four
  views pass and `02` misses by 0.02.
- The cut pieces are fixed by their proportions. The stem pieces splay side shoots at 70 degrees
  from the stem (`lateral`), and the cluster's leaves stand along a stem with its internodes
  showing rather than crowded at one point. Rejected: thinning leaves, which a studio still scales
  back up, and a real branch cut from the grown plant, which draws one bare pole with a tuft.
- The branch piece draws a cutting class of its own rather than the crown's spray. Three years put
  a side shoot at two joints, and the one at the lower joint reaches two units, so the piece
  branches where its photograph does. A class of its own is the fix because the crown's spray is
  two years long: stretched to the length the photograph's branch has, its leaves read a third
  small, and shortened back, the piece has no side shoot to reach out with.
- The new class stands last among the cutting classes. Each class's shoot is seeded by its
  prototype index, so a class inserted before another redraws that one. Standing first, the branch
  class moved the cluster piece's turn gap from 0.116 to 0.062 against a photograph's 0.146, with
  no field of the cluster class touched.
- The rim's pieces are stated limits. Under the corrected piece count, which closes a one-pixel
  hairline, the four whole views stand at two, one, two and two against the photographs' one, and
  the trunk view at four against two. Seven record levers were measured one at a time and none moved
  the trunk view: the first level switch, the leaf stalk's radius, the shoots' scale, the card's
  size, the side shoots' count, the card stalk's width and the crown's density. A matte cutoff would
  join them and was refused, because it fills the crown's fine gaps on the same mask and would take
  the oak's two passing whole views into failure. What remains is an engine fault, not a species
  one.
- The leaf cluster carries eight leaves, not six, each a seventh smaller. Six large blades covered
  what eight should, which put still `11`'s background share 0.012 below its floor. With eight, its
  share rises to 0.161 against a photograph's 0.166 and its outline overlap from 0.336 to 0.415;
  still `23` reads 0.165 against 0.152, with overlap 0.312 to 0.373. The cluster's turning video
  moves with them: background 0.116 to 0.162 against its reference's 0.146, and overlap 0.266 to
  0.307.
- **The winter keys are a budget limit.** Still `19` draws one catkin where its photograph shows six
  cones and three catkin strings on one twig end, and the keys are not missing: the winter plant
  holds the same 438,057 extras vertices as summer and autumn. A cone stands on 16 per cent of shoot
  tips and a catkin on 18, drawn independently, so one tip carries both about three times in a
  hundred. The lever is the share, and the densest variant measures 19.58 MB against the record's
  19.70 and the owner's 20.30; a share of 0.3 put the same variant at 28.2 MB, so the 0.6 MB left
  buys about one hundredth of a share.
- **The base bark view is a limit of what its figure measures, not of the foot's colour.** The base
  view's colour is the mean of nine patches of a fifth of the frame each. Counted on the drawing,
  **half of those patch pixels are sky and ground**, against 39 per cent of the photograph's,
  because the base camera's stand-off grows with the trunk's radius and this bole is thick. Two
  zones over the one trunk layer, with the foot tinted 0.78, 0.78 and 0.88, moved the figure's
  red-green by 3.2 steps while moving its light by 0.6 — the signature of a measure that is mostly
  not the material. On the patches' darkest pixels, which are the bark, the foot reads 18.2, 3.0 and
  4.0 against a photograph's 18.2, 2.6 and 6.8: the bark agrees in light and red-green and stands
  2.8 too blue. A tint that corrects that blue moves the figure the wrong way, so the record keeps
  one zone and states both sets of figures. The darkest reading is an argument and not a proposal:
  used as the measure it over-corrects, because a picture's darkest pixels are its deep shade, and
  on this species' mid-trunk it would move a correct 1.8 to about 8. The fix belongs where a close
  bark view is framed or masked, so its measure reads bark alone.
- **A limit of how a shoot's leaf stalk draws, not of this species.** At the photograph's own
  density the branch piece reads seven groups against one. Labelled by connected area, each small
  group is one leaf at a shoot's tip, and its nearest plant pixel stands **3 to 8.5 pixels** away.
  The stalk is not drawn: a stalk a little over three millimetres across falls to about one pixel at
  a cut piece's scale, and the leaf's alpha cutoff drops it whole rather than keeping part of it.
  The colour render at its own width is one plant; the matte is what splits. A card's stalk
  avoids this because the shader widens it to the record's least screen width; nothing gives a
  shoot's leaf stalk the same treatment. The counter-example is in the record: a two-and-a-half
  millimetre stalk joins two of the seven and is not this species' own size, so the thin stalk
  stays. The sub-branch draws one group because its leaves sit close enough to overlap. Any species
  whose cut piece is drawn at photograph scale meets the same limit.

## Consequences

- `packages/vegetation/src/species/common-alder/record.ts` holds the envelope, the shoot classes and
  the budget, each figure beside the still it comes from.
- `tools/lib/plant-review/slots/common-alder.json` holds each photograph's own light and framing.
- The species' densest variant measures 18.5, 18.6, 18.7 and 18.8 MB from the low tier up, under the
owner's twenty; its kit 3.35, 4.71, 7.17 and 12.16 MB under the owner's 3.5, 6.3, 11.8 and 22.6. The
third cutting class carries most of that rise: a kit costs by the shoots it holds, and a class is
two prototypes at every tier.
- The young bark's tiling spans six centimetres round the stem against twelve, which takes its
  edge-direction mix from 0.401 to 0.309 and its surface colour difference from 3.08 to 3.40, both
  over the three-step mark. The grain's own elongation is a texture-build fault, with the two ratios
  recorded in [D-309](D-309-plant-textures-from-references.md).
