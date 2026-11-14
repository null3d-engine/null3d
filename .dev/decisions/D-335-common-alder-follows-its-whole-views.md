# D-335: the common alder follows its three whole views, not its widest one, and its cut pieces are proportions

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

The whole views' sky gaps, which row 6 reads, by the photograph's color rule: `02` 0.101 and `30`
0.138. Still `01` is void, because the far river bank behind the tree joins its outline. Still `18`
is another tree, a recorded reference conflict, so it counts neither way; both levels read 0.175 on
it by the half-dark rule.

The record's card level, the level a whole view draws, reads 0.108 at `02` and 0.133 at `30`, 0.007
open and 0.005 closed, both inside the band. The leaf form reads 0.075 at `02`, 0.026 closed and
0.006 past the closed side.

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
- Row 6 is read on two whole views, `02` and `30`. Still `01` is void, because the far river bank
  joins its outline, and still `18` is another tree, so neither counts. At the card level the two
  readable views stand inside the band, 0.007 open at `02` and 0.005 closed at `30`. The leaf form
  is 0.006 past the closed side at `02`, which is the species' residual.
- The cut pieces are fixed by their proportions. The stem pieces splay side shoots at 70 degrees
  from the stem (`lateral`), and the cluster's leaves stand along a stem with its internodes
  showing rather than crowded at one point. Rejected: thinning leaves, which a studio still scales
  back up, and a real branch cut from the grown plant, which draws one bare pole with a tuft.
- **The branch turn's height spread is a pressed specimen against a fan.** At the eight angles the
  review measures, the render's crown-box heights run 251, 326, 304, 299, 304, 310, 325 and 301
  pixels, a spread of about a quarter; its photograph's run 277, 279, 280, 279, 276, 274, 260 and
  277, a spread of about a fourteenth. A flat piece keeps its height as it turns; a shoot whose side
  shoots fan in azimuth does not. The record has no field for planarity: `lateral` sets the angle from
  the stem's line, and the azimuth step between one side shoot and the next is the engine's. So
  this row's turn is the same structural gap as its narrower still, stated rather than bent.
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
- The leaf's light through and its underside carry more red and much more blue than the texture's
  means gave. All three whole views drew their foliage too green and too yellow by the same amounts,
  so the fault was the material rather than any photograph's light, and the front face was already
  right: the single-leaf stills measure it at 3.1 and 3.0 and did not move.

  The method, so another species can repeat it. Read each whole view's foliage colour beside the
  render's, convert both to linear light, and take the ratio of the photograph to the render per
  channel. Here the three views gave 1.130/1.000/1.720, 1.199/1.000/1.720 and 1.147/1.063/1.413,
  whose mean is **1.158, 1.021, 1.618**. Multiply `transmittance` and `reflectanceBack` by it and
  leave `reflectance` alone, because a copy-stand view shows the front face and a crown shows a
  mixture of the three.

  **Then draw the close undersides in the same run**, because they measure the back face alone and
  they disagree with the crown. A full step took the whole views to 2.01, 1.93 and 2.08 and the
  texture underside from 1.20 to 8.06. Four settings were measured; the balance is a back face
  raised by a little under half the step, which puts stills 01, 02, 30 and 25 all inside the
  three-step mark:

  | Back face raised by | 01 | 02 | 30 | 25 underside | 13 underside |
  | --- | --- | --- | --- | --- | --- |
  | none | 3.18 | 3.45 | 1.46 | 1.20 | 6.80 |
  | three tenths | 3.0 | 3.2 | 1.6 | 2.2 | 6.2 |
  | **a little under half** | **2.8** | **3.0** | **1.7** | **2.8** | 6.0 |
  | all | 2.01 | 1.93 | 2.08 | 8.06 | 6.33 |

  Values went from `[0.065, 0.14, 0.016]` and `[0.1818, 0.2535, 0.0781]` to
  `[0.0895, 0.1401, 0.0343]` and `[0.194, 0.2558, 0.0965]`.
  **How narrow the window is:** still `02` sits exactly on the mark at 3.0 and still `25` at 2.8, so
  the two cross within two tenths of a step. Either side of it fails one of them.
- Still `13` is the picture row 10 keeps. Its photograph is 145, 155, 105 and still `25`'s is
  118, 138, 79, some twelve steps apart, and still `13` reads between 6.0 and 6.8 at every
  setting of the back face. One leaf cannot be two undersides as long as the stand's light is fixed.
- **A studio picture now carries its own light.** `9a1ff7585` gives every light path the slot's
  `daylight` for exposure and `lamp` for white balance, and a studio background stands between its
  own walls rather than under the sky's blue. Before it, the copy stand read no query at all, so
  still `13` was a fixed exposure and the two underside photographs looked like a wall. They are not:
  the record sets `daylight` 1.09 and a warm lamp on still `13`, and twice the default exposure on
  the winter keys, with still `25` left with no slot entry as the control that proves the field is
  per picture.
- **The young bark is this batch's control for young-colour changes.** Its tint lives in the texture
  set, where a shader or frame change cannot reach it, so a change to the shader's young-wood zone
  tint or to the picture's frame must leave it byte-identical. It does: still `28` read 2.3 after
  the zone tint was reverted and 2.3 again after the picture was asked for young wood. A species
  that moves under the same change has moved because its own colour path differs, not because the
  engine shifted under everything. The control's own line is `thin` 0.015, `span` 0.1 and
  `barkMask` true, with the texture tint at 0.92, 0.78 and 0.81: framing first, material second.
- **A studio view's light is the slot's, and that includes the copy stand.** A slot's `daylight`
  scales a view's light and its `lamp` colours it, on the field views and the copy stand alike. Still
  `13` took 4.53 to 2.45 with `daylight` 1.27 and a lamp, while still `25`, which carries no slot
  entry, held at 2.80 across three settings, the control that shows the light is per picture.
- **Row 8 rests on the three close views**, not the young bark, which is a supplementary note about
  the material and cannot set a count. Read at run `alder-bark-tint-clean-1`, commit `9a57b04a0`,
  dirty false:

  | View | Photograph | Render | Plain | Masked | What the view says |
  | --- | --- | --- | --- | --- | --- |
  | `14` base | 41.0, 2.2, 8.6 | 44.9, −2.2, 11.8 | 7.28 | 8.64 | a limit of the measure |
  | `15` mid-trunk | 25.8, 1.0, 3.6 | 25.8, 2.3, 3.3 | **1.88** | 3.91 | inside |
  | `16` limb | 57.9, 2.1, 5.6 | 54.4, 3.6, 6.1 | 3.78 | 33.89 | void both ways |

- **The mid-trunk's gap was red-green, and one tint closes it.** Its photograph is 25.8, 1.0, 3.6
  against a render of 26.2, 3.7, 3.5, so lightness agreed within 0.4 and the red-green axis stood
  2.7 high. A lightness ratio would have left 3.65, so the lever is the axis. The trunk zone takes
  the ratio the pair itself gives in linear light, 0.89 on red and 0.97 on blue. The plain pair
  falls from 3.66 to **1.88** and lightness moves 0.1. The texture set still carries the tone; the
  zone only pulls it.
- **`14`'s 7.28 is a whole-frame mean that cannot judge bark**, because half of its nine patch
  pixels are sky and ground on a bole this thick. Its honest reading is the patch-based one, where
  the bark stands within half a step in light and red-green and 2.8 too blue. That is a limit of
  the measure and is recorded as such, not counted as a pass.
- **The bark mask is a per-picture decision.** The mask drops each patch pixel within a small color
  distance of a corner. It helps only where the corners are backdrop. Both forms were read on the
  same frame files of the same round:

  | View | Photograph's four corners | Patch pixels dropped, photograph and render | Plain | Masked |
  | --- | --- | --- | --- | --- |
  | `14` base | sky 77.7, sky 86.8, sky 78.2, soil 38.5 | 25.9 and 53.8 per cent | 7.28 | 8.64 |
  | `15` mid-trunk | bark 63.0, 68.1, 60.8 and 64.3 | 4.2 and 86.0 per cent | **1.88** | 3.91 |
  | `16` limb | limb 35.3, sky 71.7, sky 70.2, bark 46.5 | 77.6 and 73.6 per cent | **3.78** | 33.89 |

  `15` is judged plain. All four of its photograph's corners are bark. The mask calls 86 per cent
  of the render's patch pixels backdrop, because the render's bark sits within one step of its own
  backdrop's tone. `16` is void both ways. Its photograph has a limb at one corner, so the mask
  keeps the shaded limb and drops the lit one, and the render does the opposite; the mask reads
  33.89, which is not a bark figure. `14`'s corners are backdrop, which should suit the mask, but it
  drops twice as many of the render's patch pixels as of the photograph's. The kept sets are
  different populations, so the figure stays a limit. Masked, its bark is 10.4 darker than the
  photograph's rather than 4.0 lighter, so its direction flips with the form.
- **A height split cannot separate `14` from `15`.** The mid-trunk frames 1.28 to 1.73 m, at a
  camera stand-off of a quarter of a meter either side of 1.5 m. The base camera orbits a point at
  0.9 m from 2.76 m away, and at the review's 75-degree lens its frame runs well past both edges of
  that band. The two views hold the same wood, so a zone boundary would cut bark both of them see.
  One trunk zone serves the row, and the base follows the mid-trunk.
- The two cluster photographs draw different shoots of the one class. The slot file names the second
  prototype for the studio still, which costs no kit byte: `23` reads 0.150 background against its
  photograph's 0.152 with outline overlap 0.421, and `11` keeps the first at 0.166 against 0.173 and
  0.415. A second cutting class would have given the same choice for two more prototypes at every
  tier.
- **The cluster's count and its silhouette pull opposite.** The studio photograph carries six leaves
  and the field photograph seven; the class drew eight for both. Six was drawn. It matches the count
  and loses the shape: with the leaves grown to hold the density, backgrounds stay inside their
  bands (still `11` at 0.17 against a photograph's 0.18, still `23` at 0.15 against 0.16) while
  outline overlap falls from 0.415 to 0.31 and from 0.421 to 0.23. Eight smaller blades covered what
  the photograph covers and matched its outline; six larger ones cover the same and do not.
  The class now carries **seven** at a middle size, which suits the field still exactly, because its
  photograph carries seven, and leaves the studio one leaf over rather than two.
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
  red-green by 3.2 steps while moving its light by 0.6, the signature of a measure that is mostly
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
