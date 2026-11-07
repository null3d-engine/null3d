# D-331: the common ash, its opposite branching and its pinned, winged keys

Status: decided and built in the ash's record, the two record fields it needed and its textures. The
review measures the species against its reference set; the figures and the faults that remain are
under [Consequences](#consequences). Task: none.

Summary: the plant core grows the common ash, a tall open dome on a long clean bole, with every axis
carrying opposite decussate pairs of shoots, a pinnate leaf of eleven leaflets, and bunches of
one-winged keys. Two optional record fields carry what no species needed before: the tier a
compound leaf's leaflets mesh at, and a key's one-winged shape.

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
light and framing. The figures are those of run `ash-4`. The outline figure compares the two
outlines scaled to the same height, with a guide of 0.75. The colour figure is CIEDE2000, where about
2 is one visible step.

<!-- The table is filled from the final run. -->

### Budgets and grow time

At the low, medium, high and ultra tiers, the kit measures 2.63, 3.03, 5.64 and 11.21 MB, and the
largest of seed 11's six variants 2.24, 2.31, 2.39 and 2.50 MB. The owner's caps for a tree are 2.7,
4, 7.1 and 13 MB for a kit; the low tier sits within three per cent of its cap. A variant grows in
270 to 331 ms.

## Look

The ash reads as its photographs from the whole view: a long clean bole, a crown taller than it is
broad, limbs that sweep out and climb at their ends, and buds in opposite pairs along every twig. The
keys hang in bunches of flat wings rather than as beads, which no lathe would draw.

## Decision

Grow the ash with the record above. Add `CompoundLeaf.leafletStep` and `ExtraShape.samara`, both
optional, so every other species grows as it did.

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
- Stated faults: <!-- the final run's faults. -->
