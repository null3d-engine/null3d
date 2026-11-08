# D-336: the small-leaved lime, its two-ranked shoots and its tall egg dome

Status: decided and built in the lime's record, its textures and its review slot file. The review
measures the species against its reference set; the figures and the faults that remain are under
[Consequences](#consequences). Task: none.

Summary: the plant core grows the small-leaved lime, a tall egg-shaped dome, taller than wide, on one
straight central stem. Slender branches leave the stem all the way up, and every twig carries one
heart-shaped leaf at each node, alternate in two ranks. The fit measures a crown base at 0.156 of the
height, an aspect of 0.74 and an envelope overlap of 0.79 to 0.93.

## Question

The catalogue's next built species is the small-leaved lime (*Tilia cordata*). Its record must pass
the twelve rows of the [plant review](../plant-review.md) against its own reference set. Which
figures does the lime's record set, and which parts of the plant core does it use?

## Rule

- A species passes only when every row passes on every reference picture
  ([plant review](../plant-review.md)). Row 6 is a band in both directions: a crown denser than its
  reference fails as surely as a thinner one.
- Every number in the record carries a comment naming the photograph it came from.
- Every budget holds at every tier, and the owner's caps for a tree are not raised for this species
  ([D-330](D-330-oak-crown-by-its-own-light.md)).
- A field that no other species needs must be optional, so every other species grows as it did.

## Data

### What the lime does that the oak and the ash do not

The reference set holds twenty-seven stills and five videos. These traits have a record field of
their own:

| Trait | Pictures | The record's field |
| --- | --- | --- |
| Alternate leaves in two ranks | 09, 10, 11, 22 | `growth.buds.arrangement` and `shoots.phyllotaxis`, both `distichous` with `flatten` 0.7 |
| A heart-shaped blade on a long stalk | 11, 12, 13, 24, 25 | `foliage.leaf`, the texture contour and a 2.8 cm petiole |
| One lopsided red bud at each node | 10, 22 | `shoots.bud`, 9 mm by 5.5 mm |
| Shallow, long, irregular vertical fissures | 15, 16, 26 | the bark texture, from slot 26 at a 0.5 m tile |
| Smooth green and red-brown young bark | 28 | the young texture, from slot 28 below a 3 cm radius |
| Cream flowers at the shoot tips | 19 | `extras`, a five-petal cup in blossom |
| A skirt of sprouts at the foot | 14, 20 | no field: the record cannot draw basal sprouts |

The plant core needed no new field. It already grew a distichous phyllotaxis, and the blade, the bud
and the bark zones carry the rest.

### The choices

Every figure below comes from the lime's own reference set. The photographs are named by their number
in that folder.

| Choice | Field and the lime's value | Pictures | Presses on |
| --- | --- | --- | --- |
| A tall tree | `size.height` 22 m ± 2 | 01, 02, 18: a mature open-grown lime | The leaf's share of the view |
| The photographs' girth | `size.dbh` 0.72 m | 01, 02, 18: the trunk stands 0.030 to 0.034 of the height across at breast height | The sharp-bend test |
| An egg-shaped dome, taller than wide | `size.aspect` 0.74, from the fitted hull | 01, 02, 18: the widest foliage is 0.70 to 0.80 of the height across | The all-round band |
| A crown base a sixth up | `growth.floor` 0.156 | 01, 02, 18 and the fitted hull's base | Variant bytes |
| One straight central stem | no `growth.divide` | 17: the bole runs on as one stem and branches leave it all the way up | The crown's shape |
| A leader that outgrows the limbs | `growth.apical.control` 0.64 to 0.67 | 01, 02, 18: one leader carries the crown to its single apex | The crown's width |
| Wide, arching branches that droop | `growth.buds.angle` 52 to 62, `growth.tropism.gravi` below zero at the finest order | 02, 07, 09: branches leave at wide angles and their ends hang | Nothing measured |
| Alternate leaves in two ranks | `growth.buds.arrangement` and `shoots.phyllotaxis`, `distichous` | 09, 10, 11, 22 | Shoot mesh |
| A dense crown of fine twigs | `shoots.placement.perMetre` 4.2 to 12 and `density` 1.38 | 01, 02, 18: the crown's box shows about a twentieth of sky | Variant bytes and the card level |
| Heart-shaped blades on long stalks | `foliage.leaf.length` 8 cm, `petiole.length` 2.8 cm | 12, 13, 24: a 3 to 9 cm blade on a stalk about two fifths of it | Kit bytes |
| Leaf colour | `foliage.leaf.optics`, sampled in linear light | 24, 25: the upper face 0.039, 0.093, 0.011 and the lower 0.267, 0.323, 0.201 | The leaf colour figures |
| A lopsided red bud at each node | `shoots.bud` 9 mm by 5.5 mm, a single terminal bud | 10, 22 | Kit bytes |
| Shallow fissures in grey bark | `bark`, the texture from slot 26 at a 0.5 m tile, slot 28 for young wood | 14, 15, 16, 26, 28 | The bark figures |
| Cream flowers at the shoot tips | `extras` `flower`, a five-petal cup 3 mm across, in blossom | 19: cream flowers in clusters at the year's shoot ends | Variant bytes |
| A cut piece of its own | `shoots.cuttingClasses`, `cut` and `spur` | 21, 22, 23: one slender shoot with a few alternate leaves | Kit bytes |

### The fitted figures

The fitting tool measured the lime's turning video. The hull of 35 views overlaps its own views by
0.787 to 0.934, mean 0.872. The crown's box at the rubric's eight angles spreads 0.317 wide and 0.143
tall, so the all-round band is 0.32. The leaf contour matches the slot 24 picture with an overlap of
0.9825. The fit reports no problem with the reference.

### The seed salt

The record's seed salt was chosen by a fill sweep. Twelve salts were grown as variant 0 and measured
against the fitted envelope with the grower's own silhouette, as the growth test measures the oak.
Salt 11 draws one piece at every angle, the highest overlap and a crown base at 0.188 of the height.
One salt drew a detached clump above the crown, so a salt is never chosen by its bounding box alone.

### The near foliage

The near foliage switch stands at 160 pixels, where the oak and the ash keep 240. A shoot at that
screen size draws as real leaves rather than as a card, so the close crown view keeps the leaf
shapes. The near band's triangles stay under the owner's cap at every tier.

## Look

From the whole view the lime reads as its photographs: a tall egg-shaped dome, clearly taller than
wide, on one straight central stem. The bole shows bare below a crown base about a sixth up. The
branches leave the stem at wide angles and droop at their ends. The leaves stand in two ranks along
zigzag red-brown twigs. The leaf texture carries the heart shape, the toothed margin and the
rust-orange hair tufts on the lower face. The crown stays more open than the photographs at the
profile view, and its cards read coarse at the close crown view.

## Decision

Grow the lime with the record above. Add no field to the plant core, because the distichous
phyllotaxis, the blade, the bud and the bark zones already carry what the species needs.

Rejected:

- **A fork low on the bole.** A `divide` at 0.10 or 0.14 stalls the plant or draws a low, broad crown.
  The photographs show one central stem carried to the crown's top.
- **A crown at the oak's density.** The lime's photographs show a denser crown, and its leaves are far
  smaller, so the shoots stand at more per metre.
- **A third cutting class.** A class of its own for the sub-branch takes the medium kit past the
  owner's 4 MB cap. The cut class draws both pieces instead.
- **A card larger than half again.** A larger card closes the sky gap, and 1.7 read as a coarse leaf
  at the close crown view.

## Consequences

- `packages/vegetation/src/species/small-leaved-lime/` holds the record, the entry and the fitted
  figures. The textures package holds the leaf, bark and young-bark files, 795 KB for the full set and
  237 KB for the half set. The review slot file holds each picture's light.
- The kit measures 2.47, 3.73, 5.95 and 10.17 MB at the low, medium, high and ultra tiers. The first
  variant measures 4.88 to 5.15 MB. Every figure sits under the owner's cap for a tree.
- The review draws every still and compares it. The figures for the whole views and the faults that
  remain are listed with the run. The species review is the acceptance test, and its figures are the
  evidence.
- The basal sprouts of stills 14 and 20 are not drawn. The record has no field for a sprout at the
  foot, and the species does not claim one.
