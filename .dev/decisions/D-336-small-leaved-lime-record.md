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
  variant measures 3.21 to 3.47 MB, and its blossom season, which carries the flowers, 4.16 to 4.41,
  so the cap follows the heavier season. The two card levels draw 62,500 and 28,300 triangles.
- The grown plant stands 23.74 m tall and 17.85 m across, so it is 0.752 as wide as tall, against
  the photographs' 0.70 to 0.80. Its crown base is 3.91 m up, a sixth of the height. The record's
  mean height is 20.9 m with a spread of 2, so the drawn plant stands eight tenths above that band:
  a narrower hull lifts the growth, which is the cost of the width. Pulling the mean down to 20.1 m
  drew a 20.04 m plant at 0.922 as wide as tall, and a spread of 2.7 drew 24.43 m at 0.807 with the
  silhouette's sky below its floor, so the height does not move with the mean in steps a record can
  aim with. The width was kept because it gates rows 1, 6 and 9 together.
- The review draws every one of the 32 reference files. The whole views, the render against its
  reference: still 01 has a sky gap of 0.095 against 0.049, a leaf colour of 3.6 and one piece. Still
  02 has 0.085 against 0.062, a colour of 3.5 and one piece. Still 18 has 0.090 against 0.107 and one
  piece. So the three sky gaps sit inside their two-sided band, at margins of 0.004, 0.027 and 0.003,
  and the whole views draw one piece each. The window is narrow because the reference set disagrees
  with itself: the silhouette's own 0.107 sky sets a floor of 0.0866 while the distant view's 0.049
  sets a ceiling of 0.099.
- The leaf close-ups match with an overlap of 0.78 and 0.64 and a colour of 3.0 and 2.0. The bark
  texture's surface matches at 1.38 steps, while the young bark's colour reads 15.95 against its
  photograph. The base and mid close views are not paired in this run. A per-zone linear tint in the
  texture source moves the young layer's colour without touching the relief.
- The whole-plant turn matches its video with a mean shape overlap of 0.701. Its crown box spreads 23
  per cent wide and 17 per cent tall over the eight angles against the reference's 58 and 15, so
  both sit inside the all-round band.
- The branch turn spreads 61 per cent wide and 25 per cent tall against 107 and 17, so both sit
  inside. The sub-branch spreads 68 per cent wide and 28 per cent tall against 119 and 6, inside both.
  The leaf-cluster turn spreads 142 per cent wide and 66 per cent tall against 85 and 6, so both sit
  outside. A 35-degree leaf spread over the flat shoot made it worse, 129 and 41 to 142 and 83, and
  was reverted.
- The cut pieces draw their proportions: the branch at 0.91 as wide as it is tall against 1.05, the
  sub-branch at 0.60 against 0.59, and the leaf cluster at 0.71 against 0.50 and 0.68 against 0.70.
  The branch's still draws ten separate leaf groups and the sub-branch's ten, against fifteen and ten
  in the round before the shared branch merged. The lime's record is unchanged between those runs, so
  the fall is the shared tool's one-pixel join, not the leaf stalks: the doubled stalk is a second,
  separate lever that took the counts to fifteen and ten from eighteen and seventeen.
- The elm's cure for a collapsing flat shoot, a 35-degree leaf spread with a small droop, made this
  species worse: a lime leaf already hangs from a 2.8 cm stalk, so the spread turns the blades edge
  on as the piece comes round.

### The verdict's named faults

The third verdict passed rows 3, 4, 6, 7 and 11. It named the faults below, corrected against the
run's own figures, in the order of value the lead set.

| Fault | Row | Figure | What it is |
| --- | --- | --- | --- |
| The upper crown is short of its photograph | 1 | crown boxes 240, 306 and 343 pixels tall against 295, 387 and 391 | The largest fault left: the crown's box is a fifth to a quarter short in height at every whole view, and its width is 0.93, 1.08 and 0.97 against 0.80, 0.755 and 0.734 |

The crown's shape was attacked with four levers, and none wins the row without losing another. Steeper branches, 42 to 52 degrees, bring the boxes to 0.85, 0.88 and 0.88 but open the distant view's sky to 0.097 and the profile's to 0.115, past the profile's 0.112 ceiling, while the silhouette's floor of 0.0866 needs the crown denser than the profile's ceiling allows. Tapering the hull's top rows widens the plant to 0.974 of its height and fails all three gaps. A lower crown floor changes nothing, because the fitted envelope's own base is the floor. The crown's roundness sweeps the boxes' spread to 0.93, 1.08 and 0.97, so the row is left to the reviewer with these figures rather than a fourth guess.
| The close cluster carries too few leaves | 5 | five leaves against the reference's eight | A leaf count, not a shape: a blob count of the reference cluster gives eight, so the deficit is three. Its turn is 142 wide against 85 |
| The young bark's colour | 8 | 15.95 | A colour fault on the young layer, which a per-zone linear tint in the texture source can move without touching the relief. The bark texture's surface is 1.38 and passes |
| The flower and sprout views frame the wrong subject | 12 | 19 and 20 frame a twig and a branch | Framing, not growth: their slots aim at wood where the photographs show a flower cluster and a stool's sprouts |
| No skeleton view was drawn | 2 | none in the reference set | The cheapest row on the board: the tool draws a wood-only view, so the record needs a slot entry for it rather than a photograph |

The piece counts are not a fault: the whole views draw one piece each, which the shared branch's
crown-foot rule gave back, so the matte's earlier groups are withdrawn as a measure limit.

Two more are recorded as agreed limits with the lead: the drawn height at 0.84 m above the record's
band, which is row 9's limit, and the basal sprouts, which the record cannot draw.

- The basal sprouts of stills 14 and 20 are not drawn, and the reference set holds no skeleton view
  for row 2: both stay as stated limits. The record has no field for a sprout at the foot. A stool of
  three stems was grown as a test: it draws a 5 cm plant with three limbs and no crown, so the stool
  does not give the sprouts either. The still is of a coppiced stool, not of the single-stemmed tree
  the whole views show.

