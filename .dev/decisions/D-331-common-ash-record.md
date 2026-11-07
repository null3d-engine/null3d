# D-331: the common ash, its opposite branching and its pinned, winged keys

Status: decided and built in the ash's record, the two record fields it needed and its textures. The
review measures the species against its reference set and fails it; the figures and the faults that
remain are under [Consequences](#consequences). Task: none.

Summary: the plant core grows the common ash, a tall open dome on a long clean bole, with every axis
carrying opposite decussate pairs of shoots, a pinnate leaf of eleven leaflets, and bunches of
one-winged keys. Two optional record fields carry what no species needed before: the tier a
compound leaf's leaflets mesh at, and a key's one-winged shape. The review fails the species: nine of
its twelve rows fail on at least one picture, the crown's sky gap worst.

## Question

The catalogue's second built species is the common ash (*Fraxinus excelsior*). Its record must pass
the twelve rows of the [plant review](../plant-review.md) against its own reference set. What must
the plant core grow that the pedunculate oak's record could not ask for, and which figures does the
ash's own record set?

## Rule

- A species passes only when every row passes on every reference picture
  ([plant review](../plant-review.md)). Row 6 is a band in both directions: a crown denser than its
  reference fails as surely as a thinner one.
- Each new behavior sits behind an optional record field with a doc comment, a unit, a range check
  and a test. With the field absent, a plant grows as it did, so no other species changes.
- Every number in the record carries a comment naming the photograph it came from.
- Every budget holds at every tier, and the owner's caps for a tree are not raised for this species
  ([D-330](D-330-oak-crown-by-its-own-light.md)).

## Data

### What the ash does that the oak does not

The reference set holds twenty-seven stills and five videos. These traits have no record field of
their own:

| Trait | Pictures | The record's field |
| --- | --- | --- |
| Opposite, decussate branching | 09, 10, 20, 22 | `growth.buds.arrangement` and `shoots.phyllotaxis`, both `opposite` with `decussate` |
| A pinnate leaf of eleven leaflets | 12, 13, 21, 22, 24, 25 | `foliage.compound`, `pinnate` |
| A single stout black bud at each twig's end | 10, 20, 22 | `shoots.bud`, with a tight cluster of three |
| One-winged keys in hanging bunches | 19 | `extras`, a `samara` shape |
| A diamond net of bark ridges | 14, 15, 16, 26 | the bark texture, from slots 26 and 28 |
| Limbs that sweep out and turn up at their ends | 04, 05, 06 | `growth.tropism.gravi` and `growth.bending.upturn` |

The plant core grew an opposite phyllotaxis already (`Phyllotaxis` names it, and the grower's
`arrangementOf` reads it), and a compound leaf already. Two gaps remained:

- **A compound leaf paid a whole leaf's cut for every leaflet.** Eleven leaflets at the finest tier
  came to 65,535 vertices in one shoot prototype, the most a prototype may hold, and a plant could
  not grow. `CompoundLeaf.leafletStep` now cuts a leaflet that many tiers below its leaf's own, one
  by default, which is what a leaflet's size asks for.
- **An extra was a surface of revolution, a petal cup, a spine fan or a catkin.** A key is a flat
  winged seed, and no lathe draws one. `ExtraShape` now names a `samara`: a seed body and a wing
  running from it, closed as a lens of four faces so it reads from both sides.

### The choices

Every figure below comes from the ash's own reference set. The photographs are named by their
number in that folder.

| Choice | Field and the ash's value | Pictures | Presses on |
| --- | --- | --- | --- |
| A tall tree | `size.height` 22 m ± 2 | 01, 02, 18: the bole stands 0.038 to 0.051 of the height across at breast height, so a 22 m tree's bole is about a metre thick | The leaf's share of the view |
| The photographs' girth | `size.dbh` 0.95 m | 01, 02, 18: the trunk's width at breast height, measured on the mask | The sharp-bend test |
| A crown narrower than tall | `size.aspect` 0.9, from the fitted figure | 01, 02, 18: the widest run of foliage is 0.72 to 0.98 of the height across | The all-round band |
| A clean bole to the crown's base | `growth.floor` 0.25 | 01, 02, 18: the foliage's lowest run stands at a quarter of the height | Variant bytes |
| Opposite pairs | `growth.buds.arrangement` and `shoots.phyllotaxis`, `opposite` decussate | 09, 10, 20, 22 | Shoot mesh |
| Steep limbs, a narrow fork | `growth.buds.angle` 48 to 55 degrees, `growth.divide` at 0.3 with four limbs at 55 degrees | 07, 08, 18: the great limbs leave the bole at about 40 to 50 degrees, and a fork closes in a narrow V | The bole-and-crown test |
| A leader that outgrows the limbs | `growth.apical.control` 0.58 to 0.62 | 01, 02, 18: one leader carries the crown to its top | The crown's width |
| Limbs that turn up at their ends | `growth.tropism.gravi` 0.24 at the finest order, `growth.bending.upturn` 0.4 | 04, 05, 06: a limb's end climbs against gravity | Nothing measured |
| An open crown | `shoots.placement.skyPrune` 0.5, `density` 0.6 | 01, 03 and 05: sky through the crown's middle and under it | Variant bytes |
| Eleven leaflets on a rachis | `foliage.compound` `pinnate`, 11 leaflets, rachis 4.2 leaflet lengths | 12, 13, 24: five opposite pairs and one terminal leaflet; the whole leaf about five times a leaflet | Kit bytes |
| A leaflet of its own | `foliage.leaf.length` 0.055 m, `outline` from the texture | 12, 24: one leaflet is 3 to 4 cm long on the photographs' leaf, and the record's leaflet is five and a half centimetres at the near view's scale | Kit bytes |
| Leaflet colour | `foliage.leaf.optics`, sampled in linear light | 24, 25: the upper face 0.065, 0.130, 0.014 and the lower 0.169, 0.248, 0.062 | The leaf colour figures |
| A black bud at every twig's end | `shoots.bud` 12 mm by 7 mm, colour 0.009 linear, a cluster of three | 10, 20: the buds are jet black, about a centimetre, one terminal and a pair below | Kit bytes |
| The diamond net | `bark`, the texture from slot 26 at a 0.5 m tile, and slot 28 for young wood below 3 cm radius | 14, 15, 16, 26, 28 | The bark figures |
| Keys in bunches | `extras` `fruit`, a `samara` 32 mm by 10 mm, twelve at a shoot tip from a 2 cm stalk | 19: keys hang in dense bunches from the last joint of the shoot | Variant bytes |
| A cut piece of its own | `shoots.cuttingClasses`, the ash's `cut` | 20, 21, 22: a cut twig forks once into two leafy shoots, far sparser than the crown's own twigs | Kit bytes |

### The reference files

The review draws every still beside its photograph with the same slot file, in the photograph's own
light and framing. The figures are those of run `ash-final` at `988f4676`, seed 11, variant 0,
preset high, drawn headless in Chrome on the Mac's GPU. The outline figure compares the two outlines
scaled to the same height, with a guide of 0.75. The sky gap is the share of the crown's own box that
shows background, and the band is five hundredths above the reference's and two below it. The colour
figure is CIEDE2000, where about 2 is one visible step.

The species fails its review. Nine of its twelve rows fail on at least one picture.

| Reference | Judged | Deciding figures |
| --- | --- | --- |
| `01-whole-distant.png` | Fail | The render's sky gap 0.37 against the reference's 0.26, 0.11 above the band; outline 0.45; leaf colour 16.4 |
| `02-whole-profile.png` | Fail | The render's sky gap 0.31 against the reference's 0.19, 0.12 above the band; outline 0.48; leaf colour 17.0 |
| `03-whole-from-below.png` | Fail | The render's sky gap 0.35 against the reference's 0.50, 0.15 below the band: the crown is denser than the photograph's |
| `04-crown-outside.png` | Fail | Outline 0.18; sky gap 0.59 against 0.43 |
| `05-crown-underside.png` | Unjudged | No plain outline; edge directions 0.035 |
| `06-inside-crown.png` | Unjudged | No plain outline; edge directions 0.097 |
| `07-limb-leaving-trunk.png` | Unjudged | No plain outline; edge directions 0.194 |
| `08-limb-fork.png` | Fail | Outline 0.30; sky gap 0.24 against 0.56 |
| `09-secondary-branching.png` | Fail | Outline 0.06; sky gap 0.83 against 0.57 |
| `10-fine-twigs.png` | Fail | Outline 0.03; sky gap 0.00 against 0.24 |
| `11-leaf-cluster.png` | Fail | Outline 0.16; sky gap 0.74 against 0.39 |
| `12-single-leaf-upper.png` | Fail | Outline 0.31; leaf colour 5.5 |
| `13-single-leaf-underside.png` | Fail | Outline 0.24; leaf colour 3.3 |
| `14-bark-base.png` | Fail | Outline 0.47 |
| `15-bark-mid-trunk.png` | Partial | Shape 0.62; the trunk's surface colour on the render against the photograph 9.9 |
| `16-bark-on-limb.png` | Fail | Outline 0.36 |
| `17-trunk-taper.png` | Partial | Outline 0.39; sky gap 0.04 against 0.29 |
| `18-silhouette.png` | Fail | Outline 0.47; the render's sky gap 0.37 against the reference's 0.21; leaf colour 23.3 |
| `19-keys.png` | Fail | Edge directions 0.298; the render's bunch is 6 separate pieces |
| `20-winter-black-buds.png` | Fail | Outline 0.15; colour 11.1 |
| `21-branch-studio.png` | Fail | Outline 0.06; 35 pieces in the render against 1 |
| `22-subbranch-studio.png` | Fail | Outline 0.06; 43 pieces in the render against 1 |
| `23-leaf-cluster-studio.png` | Fail | Outline 0.13; 44 pieces in the render against 1 |
| `24-leaf-texture-upper.png` | Partial | Outline 0.18; leaf colour 1.7 |
| `25-leaf-texture-underside.png` | Partial | Outline 0.11; leaf colour 1.0 |
| `26-bark-texture.png` | Pass | Surface colour 1.9 |
| `28-young-bark.png` | Fail | Surface colour 8.3; edge directions 0.201 |
| `branch-turntable.mp4` | Fail | Mean outline 0.065, lowest 0.032 |
| `common-ash-turntable.mp4` | Partial | Mean outline 0.507, lowest 0.456; the crown box's spread inside both bands at the eight angles; leaf colour 13.8 |
| `leaf-cluster-turntable.mp4` | Fail | Mean outline 0.093; the crown box's width spread 85 per cent against the reference's 47 |
| `subbranch-turntable-halfturn.mp4` | Fail | Mean outline 0.063 |
| `common-ash-wind-motion.mp4` | Fail | Top band motion 0.141 against the reference's 0.041: the drawn crown moves three times as far |

Every one of the 32 reference files in use was drawn and compared, so coverage passes.

### The second pass

Run `ash-8` at the branch's next head draws the same stills after the leaf, the crown and the cut
class changed to the photographs' own proportions. These are the figures that moved:

| Reference | Before | After |
| --- | --- | --- |
| 01 whole distant: sky gap, render against reference | 0.37 against 0.26 | 0.23 against 0.26, inside the band |
| 02 whole profile: sky gap | 0.31 against 0.19 | 0.18 against 0.19, inside the band |
| 18 silhouette: sky gap | 0.37 against 0.21 | 0.24 against 0.21, inside the band |
| 01, 02, 18 outline | 0.45, 0.48, 0.47 | 0.54, 0.56, 0.51 |
| 12, 13 single leaf outline | 0.31, 0.24 | 0.44, 0.58 |
| 21, 22, 23 cut piece outline | 0.06, 0.06, 0.13 | 0.18, 0.17, 0.27 |
| 11 leaf cluster outline | 0.16 | 0.31 |
| 09, 10 cut piece outline | 0.06, 0.03 | 0.16, 0.15 |

The leaf moved because a leaflet runs 0.37 of its leaf and the rachis 0.63, so the record's
five-and-a-half centimetre leaflets on a rachis four times their length drew a leaf under half as
wide as its photograph's. The crown moved because five great limbs at 62 degrees reach its rim where
four at 55 left it bare. The cut pieces moved because the class's twig is the photographs' 42 cm of
two nodes rather than a metre of wire.

### The crown's colour is the light's, and its blue is the leaf's

The crown's foliage read #4b6131 at 01 where its photograph reads #798b74. A first reading of two
runs said the light did not move it, and that was wrong: between those runs the sky's share rose
from 0.24 to 0.62 while the daylight fell from 2.8 to 2.2, and more skylight with less sun came out
even. A single test settles it. At eight times daylight the same view's crown reads #87ab58, where
2.2 reads #4b6131 and 02, left at 2.2 in the same run, stays #4d6133. So the far cards take the
scene's light as the near leaves do, and no builder or material change is needed.

The light's own share of the fix is large. Raising the whole views to 5.5 and 5.2 of daylight at a
sky share of 0.5 takes the colour difference from 20.1 and 20.6 steps to 11.8 and 11.6, and 03's
from 7.1 to 1.5, with every sky gap still inside its band.

What the light cannot do is the blue. The leaf's reflectance is 0.065, 0.130, 0.014: almost none in
blue. At eight times daylight the crown reaches #87ab58 against the photograph's #798b74, which is
nearly grey, and the extra light overshoots red and green long before the blue arrives. The crown's
remaining 11.6 to 11.8 steps are that hue, and they move only with the leaf's blue in its texture or
with a sky that carries more of the pictures' light.

### Budgets and grow time

At the low, medium, high and ultra tiers, the kit measures 2.63, 3.03, 5.64 and 11.21 MB, and the
largest of seed 11's six variants 2.24, 2.31, 2.39 and 2.50 MB. The owner's caps for a tree are 2.7,
4, 7.1 and 13 MB for a kit; the low tier sits within three per cent of its cap. A variant grows in
270 to 331 ms.

## Look

From the whole view the ash reads as its photographs: a long clean bole, a crown taller than it is
broad, limbs that sweep out and climb at their ends, and buds in opposite pairs along every twig. The
leaf, its leaflets and the bark's diamond net read as the texture sources. The crown stays more open
than the photographs show, and its foliage darker, and the close views of a cut piece do not yet
stand as one piece.

## Decision

Grow the ash with the record above. Add `CompoundLeaf.leafletStep` and `ExtraShape.samara`, both
optional, so every other species grows as it did. The species does not pass its review, and the
faults under [Consequences](#consequences) stay open.

Rejected:

- **Eleven leaflets with no coarser cut.** A shoot prototype passed 65,535 vertices at the finest
  tier, and the plant could not grow at all. Cutting the leaflets as finely as the leaf triples the
  kit's cost and buys nothing a leaflet's size can show.
- **An eleven-leaflet leaf from a parametric outline.** The texture carries the serrations, veins and
  both faces; a parametric blade would draw a smooth green sliver.
- **A lathe for the keys.** A key is a flat wing, and a surface of revolution draws a spindle,
  whatever profile it is given.
- **The crown's density at the oak's 1.25.** The ash's photographs show a far more open crown, and
  row 6 fails a crown that is denser than its reference as surely as one that is thinner.

## Consequences

- `core/record.ts` gains the two optional fields, `core/check.ts` checks them, and
  `leaf/extras.ts` and `leaf/leaf-mesh.ts` read them. Their tests are in `leaf/extras.test.ts` and
  `leaf/leaf-mesh.test.ts`.
- The review page measures a cut piece's frame in whole-leaf lengths: a compound leaf's leaf is its
  stalk, rachis and terminal leaflet, not one leaflet. Without that, every cut piece of a compound
  species was framed five times too close.
- The low tier's kit sits within three per cent of the owner's cap for a tree. A change that adds a
  prototype needs a cut elsewhere.
- Stated faults, largest first, each with its figure:
  1. The crown's density is wrong in both directions. It shows more sky than its photographs at 01,
     where the render's gap is 0.37 against the reference's 0.26, at 02 at 0.31 against 0.19 and at
     18 at 0.37 against 0.21. It shows less looking up the bole from the foot, where 03 stands at
     0.35 against 0.50. The shoots sit in tufts near the axes, leaving the rim between the tufts
     bare and the middle over the trunk full. The dial moved this figure by 0.08 over a threefold
     rise, so a change of density alone will not close it.
  2. The crown is drawn three times as loose as its photograph in the wind. The top band's motion is
     0.141 against 0.041, and every band but the third moves further than its reference's.
  3. The cut pieces do not read as the photographs' pieces. Outlines are 0.06 at 21 and 22 and 0.13
     at 23, and each draws as thirty to forty separate pieces against the photograph's one. The
     class the cuttings take carries too few leaves on too long a stem, and its leaves stand apart
     from the wood in the picture.
  4. The crown's foliage is too dark at the whole views: leaf colour difference 16.4, 17.0 and 23.3
     at 01, 02 and 18, against 1.0 to 1.7 on the leaf textures themselves. The record's own leaf
     colour is right; the crown's cards and their light are not.
  5. The bark's colour at mid-trunk reads 9.9 through the bark-mid view where the texture itself
     measures 1.9, and the young bark reads 8.3. The view's light stands at the copy stand's angle
     and the bark's figure moves with it.
  6. The whole plant's outline matches its turning video at 0.507 on average. The reference's own
     hull overlaps its views by only 0.57 to 0.80, so the fitted envelope cannot be closer than the
     reference's own drift allows.
  7. Row 11 is judged against the pedunculate oak, the catalogue's other built species. The two are
     told apart by silhouette: the ash is 0.9 of its height across with a cleaner, taller bole and
     opposite branching, where the oak is 1.53 across on a short low-forking bole. The row passes.
