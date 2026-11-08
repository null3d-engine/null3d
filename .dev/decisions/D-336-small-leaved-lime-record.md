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
| A tall tree | `size.height` 20.9 m ± 2 | 01, 02, 18: a mature open-grown lime | The leaf's share of the view |
| The photographs' girth | `size.dbh` 0.72 m | 01, 02, 18: the trunk stands 0.030 to 0.034 of the height across at breast height | The sharp-bend test |
| An egg-shaped dome, taller than wide | `size.aspect` 0.74, and the hull's radii taken at 0.80 of the fit | 01, 02, 18: the widest foliage is 0.70 to 0.80 of the height across | The all-round band, rows 1 and 9 |
| A crown base a sixth up | `growth.floor` 0.156 | 01, 02, 18 and the fitted hull's base | Variant bytes |
| One straight central stem | no `growth.divide` | 17: the bole runs on as one stem and branches leave it all the way up | The crown's shape |
| A leader that outgrows the limbs | `growth.apical.control` 0.68 to 0.70 | 01, 02, 18: one leader carries the crown to its single apex | The crown's width |
| Wide, arching branches that droop | `growth.buds.angle` 52 to 62, `growth.tropism.gravi` below zero at the finest order | 02, 07, 09: branches leave at wide angles and their ends hang | Nothing measured |
| Alternate leaves in two ranks | `growth.buds.arrangement` and `shoots.phyllotaxis`, `distichous` | 09, 10, 11, 22 | Shoot mesh |
| A dense crown of fine twigs | `growth.branching` 1.4, `shoots.placement.perMetre` 4.2 to 12, `density` 2.1, `skyPrune` 0 and `cardGrow` 1.87 | 01, 02, 18: the crown's box shows about a twentieth of sky | Variant bytes and the card level |
| Heart-shaped blades on long stalks | `foliage.leaf.length` 7 cm, `petiole.length` 2.8 cm | 12, 13, 24: a 3 to 9 cm blade on a stalk about two fifths of it | Kit bytes |
| Leaf colour | `foliage.leaf.optics`, sampled in linear light | 24, 25: the upper face 0.039, 0.093, 0.011 and the lower 0.267, 0.323, 0.201 | The leaf colour figures |
| A lopsided red bud at each node | `shoots.bud` 9 mm by 5.5 mm, a single terminal bud | 10, 22 | Kit bytes |
| Shallow fissures in grey bark | `bark`, the texture from slot 26 at a 0.5 m tile, slot 28 for young wood | 14, 15, 16, 26, 28 | The bark figures |
| Cream flowers at the shoot tips | `extras` `flower`, a five-petal cup 3 mm across, in blossom | 19: cream flowers in clusters at the year's shoot ends | Variant bytes |
| A cut piece of its own | `shoots.cuttingClasses`: `cut` over three years with two side twigs at 85 degrees, and `spur` | 21, 22, 23: a limb that forks and runs out as wide as it is tall, and one leaf cluster | Kit bytes |

### The fitted figures

The fitting tool measured the lime's turning video. The hull of 35 views overlaps its own views by
0.787 to 0.934, mean 0.872. The crown's box at the rubric's eight angles spreads 0.317 wide and 0.143
tall, so the all-round band is 0.32. The leaf contour matches the slot 24 picture with an overlap of
0.9825. The fit reports no problem with the reference.

### The seed salt

The record's seed salt was chosen by a fill sweep. Twelve salts were grown as variant 0 and measured
against the fitted envelope with the grower's own silhouette, as the growth test measures the oak.
Salt 18 draws one piece at every angle, a crown base at 0.178 of the height and the sky its
photographs show through the crown. Salt 11 fills fuller but closes the silhouette's sky. One salt
drew a detached clump above the crown, so a salt is never chosen by its bounding box alone.

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
- The fitted hull's radii are used at 0.80 of their measured value. The hull is the foliage the
  photographs show, and the grower adds each shoot's own reach past the bud it sits on, so a plant
  grown to the bare hull draws about a quarter wider than its photographs: the crown measured 1.05
  as wide as its own height where the photographs read 0.73 to 0.80. The factor is written in
  `fit.ts`, and a re-run of the fitting tool writes the raw hull again and must have it applied.
- The kit measures 2.48, 3.85, 6.26 and 10.82 MB at the low, medium, high and ultra tiers. The first
  variant measures 3.21 to 3.47 MB, and the two card levels draw 62,500 and 28,300 triangles. Every
  figure sits under the owner's cap for a tree.
- The grown plant stands 23.74 m tall and 17.85 m across, so it is 0.752 as wide as tall. Its crown
  base is 3.91 m up, a sixth of the height. The record's mean height is 20.9 m with a spread of 2,
  and the drawn plant stands above that band: a narrower hull lifts the growth, which is the cost of
  bringing the width inside the photographs' 0.70 to 0.80.
- The review draws every one of the 32 reference files. The whole views, the render against its
  reference: still 01 has a sky gap of 0.095 against 0.049, a leaf colour of 3.6 and one piece. Still
  02 has 0.085 against 0.062, a colour of 3.5 and four pieces. Still 18 has 0.090 against 0.107 and
  two pieces. So the three sky gaps sit inside their two-sided band, at margins of 0.004, 0.027 and
  0.003. The window is narrow because the reference set disagrees with itself: the silhouette's own
  0.107 sky sets a floor of 0.0866 while the distant view's 0.049 sets a ceiling of 0.099.
- The leaf close-ups match with an overlap of 0.78 and 0.64 and a colour of 3.0 and 2.0. The bark
  texture matches at 6.3 steps.
- The whole-plant turn matches its video with a mean shape overlap of 0.701. Its crown box spreads 23
  per cent wide and 17 per cent tall over the eight angles against the reference's 62 and 15, so
  both sit inside the all-round band.
- The branch turn spreads 61 per cent wide and 25 per cent tall against 107 and 17, so both sit
  inside. The sub-branch spreads 68 per cent wide against 119, inside, but 29 per cent tall against
  6, outside. The leaf-cluster turn spreads 137 per cent wide and 75 per cent tall against 102 and
  13, so both sit outside; a 35-degree leaf spread over the flat shoot made this worse, 142 and 83,
  and was reverted.
- The wind moves its bands 0.001, 0.021, 0.022, 0.025, 0.024 and 0.048 against the clip's 0.045,
  0.064, 0.020, 0.024, 0.029 and 0.047. The four middle and top bands sit inside or at their
  photograph's figure. The foot's band does not move: a sway record bends the crown where a real
  tree moves at its foot, the model-shape limit the maple and the ash state in the same words.
- The cut pieces draw their proportions: the branch at 0.91 as wide as it is tall against 1.05, the
  sub-branch at 0.60 against 0.59, and the leaf cluster at 0.71 against 0.50 and 0.68 against 0.70.
  A leaf stalk twice as thick and nearly straight brings the piece counts down from 18 and 17 to 15
  and 10 against one each.
- The basal sprouts of stills 14 and 20 are not drawn. The record has no field for a sprout at the
  foot. A stool of three stems was grown as a test: it draws a 5 cm plant with three limbs and no
  crown, so the stool does not give the sprouts either. The still is of a coppiced stool, not of the
  single-stemmed tree the whole views show.

