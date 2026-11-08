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
- The whole views were re-read after the land branch's leaves-and-limbs split and its stool rule
  (`b277994b6`) merged: the plant stands 23.74 m by 17.85 m with 487 limbs and the gaps are 0.0949,
  0.0853 and 0.0898, unchanged to the figure, so neither change reaches a full-size single-stemmed
  plant.
- The review draws every one of the 32 reference files. The whole views, the render against its
  reference: still 01 has a sky gap of 0.095 against 0.049, a leaf colour of 3.6 and one piece. Still
  02 has 0.085 against 0.062, a colour of 3.5 and one piece. Still 18 has 0.090 against 0.107 and one
  piece. So the three sky gaps sit inside their two-sided band, at margins of 0.004, 0.027 and 0.003,
  and the whole views draw one piece each. The window is narrow because the reference set disagrees
  with itself: the silhouette's own 0.107 sky sets a floor of 0.0866 while the distant view's 0.049
  sets a ceiling of 0.099.
- The whole views' leaf colour reads 4.7, 5.05 and 6.3 under the crown shading term landed at
  `90247be6d`, which cuts a far crown's shade from a half to three tenths. The figures taken before
  that term were 3.6 and 3.5, so the term lifted this species' whole-view colour by about a step
  while the leaf's own albedo, measured on the pressed leaves, still reads 3.0 and 2.0. Lowering the
  albedo a twentieth moved the whole views a tenth of a step and worsened the pressed leaf, so the
  albedo stays as the photographs measure it.
- The material's own blue was tried as the cure for the violet case and rejected. Raising the leaf
  front and back faces' blue, 0.011 to 0.018 and 0.2011 to 0.26, improved the two branch studio
  stills from 5.35 to 4.76 and 3.7 to 3.29 and the leaf-cluster studio from 2.9 to 2.74, but took
  the two whole views out of their band, 2.31 to 3.64 and 1.81 to 3.64, and worsened the close
  cluster from 0.76 to 1.65. The reason is that `lamp` is a copy-stand control and never reaches an
  outdoor whole view: those have only `daylight`, so the material's blue is the one lever that moves
  them, and it moves them the wrong way. The optics stay as the photographs measure them. A per
  picture sun colour for outdoor views would be the lever, and `dbc427d9f` then landed exactly that:
  an outdoor view's sun takes the slot's lamp. With the light tinted rather than the material, the
  branch studio falls to 2.85 and the sub-branch studio to 2.37, both inside the mark, and the
  branch turn from 7.28 to 6.98, the leaf cluster's from 6.96 to 6.82 and the whole plant's from
  4.73 to 4.22. The turns converge in steps because their colour is a mean over 121 frames, so the
  branch needed 16.26, then 8.49, then 6.98; row 10 stays a stated limit on the turns, with the
  light tuned as far as the page allows.
- The bark close views are read masked, which drops every patch pixel close to the picture's own
  background before the nine-patch mean. The base keeps its sign: our bark 2.2 dark, 3.6 short of
  green and 6.1 short of yellow against its photograph. The mid-trunk fills its frame and is the
  control, matching its photograph at 48.7 light either way. The limb's sign flips: unmasked it read
  lighter than its photograph, masked it reads 8.8 dark, so the trimmed backdrop was carrying that
  figure. The young bark stays 9.8.
- The clean run `lime-full-11` at `70181eaba` has every still inside the three-step colour mark:
  distant 1.8, profile 1.6, leaf cluster 0.2, flower spray 0.5, branch studio 2.9, sub-branch studio
  2.4 and leaf-cluster studio 1.6, with the turns at 4.22, 6.82, 6.98 and 7.46.
- Row 10's colour is now lit per picture. Each still's slot takes a daylight scaled and a lamp set
  from its photograph's mean foliage colour against the render's in linear light. The distant view
  falls from 4.88 to 2.4 steps, the profile from 5.07 to 2.0, the close cluster from 5.67 to 0.8, the
  flower spray from 5.75 to 0.6 and the leaf-cluster studio from 9.8 to 2.9. The whole-plant turn
  falls from 8.84 to 4.73 and the leaf cluster's from 8.73 to 6.96. The views that want a strong
  violet lamp, the branch turn and the two branch studio stills, overshoot at the full ratio and at
  half of it, so they keep no lamp: 7.28 to 18.91 and 15.10, 5.3 to 8.9, 3.7 to 4.8. The sky gaps do
  not move under the light (0.0949, 0.0853, 0.0898 before and after), which shows the light moves
  colour and not geometry.
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

The crown's shape was attacked with six levers, and none wins the row without losing another. Steeper branches, 42 to 52 degrees, bring the boxes to 0.85, 0.88 and 0.88 but open the distant view's sky to 0.097 and the profile's to 0.115, past the profile's 0.112 ceiling, while the silhouette's floor of 0.0866 needs the crown denser than the profile's ceiling allows. Tapering the hull's top rows widens the plant to 0.974 of its height and fails all three gaps. A lower crown floor changes nothing, because the fitted envelope's own base is the floor. A firmer leader, dominance 0.85 and 0.75 with a wander of 4 degrees, is the closest: the boxes fall
to **0.78, 0.82 and 0.81** against the photographs' 0.80, 0.755 and 0.734, and the plant to 0.793 of
its height. But that crown's distant view shows 0.107 of sky against a ceiling of 0.099 while its
silhouette shows 0.084 against a floor of 0.0866: the distant photograph needs a crown denser than
the rising tree while the silhouette's needs one more open, by twenty-three thousandths in the wrong
direction, which no single crown can be. A middle leader, dominance 0.80 and 0.68 with a wander of
6, gives boxes of 0.78, 0.92 and 0.85 and fails two gaps by more. So the record keeps the crown whose
three gaps are inside and states the box fault: the crown's roundness sweeps the boxes' spread to
0.93, 1.08 and 0.97.
| The close cluster carries too few leaves | 5 | eight leaves; stills 0.368 against 0.379 and 0.357 against 0.354; its turn 138.5 wide and 38.2 tall against 101.9 and 13.4 | The count and the gaps are met. The turn is **structural**. The stills were held fixed while the turn was measured against them, as the lead directed, and the turn's own frames name the cause. Read frame by frame, our piece's crown box runs 247 to 321 pixels tall, and it bottoms at the two angles where the piece is edge on, near 95 and 262 degrees, which are the same angles where its width bottoms. The video's piece stays 276 to 300 tall at every angle. So the frame follows the foliage's planar extent, not the piece's arc: when the blades turn edge on they leave almost nothing at the piece's extremes, and the box closes to the stem.

Three levers were measured against that. A blade facing of the class's own (blades in the shoot's plane rather than half turned to the sky) takes the width from 138.5 to 125.5 and the height from 38.2 to 54.9, trading one for the other. A longer shoot, 0.45 m against 0.30, takes the height to 35.4 and the stills' overlaps down to 0.19 and 0.21. More blade depth, curl 10 to 16 and twist 6 to 22, takes the height to 35.8, the width to 135.5 and the sub-branch turn's height from 28.1 to 45.3, and costs about one per cent of kit bytes, 10.82 to 10.97 MB. None of the three lands both bands, so the turn stays a stated limit with the frames' figures and the run folders' sheets beside it: `lime-turn-01` for the render against `leaf-cluster-turntable.mp4`, whose piece holds its height at every angle where ours does not.  |
| The young bark's colour | 8 | 9.8, from 15.95 at the verdict | The young layer **is** drawn on this species, unlike the olive's: the tint reaches it, green 12.9, browner 11.3, red-brown 1.22 by 0.94 by 0.84 giving 10.8. The eye reads the drawn bark as grey against the photograph's red-brown, so the direction came from the eye because this view prints no colour triple. The young bark's reach was the larger lever: it covered wood thinner than six centimetres across and now covers the young wood the close view reads, about ten. That and the tint took the figure from 15.95 to 9.8. The alder's method of taking half the measured per-channel ratio cannot be applied here, because this view prints no colour pair for the lime: its figure comes from the nine-patch mean alone, where the alder's view prints its photograph's and its render's triples. The rest is a nine-patch mean over a frame carrying the bark swatch and the plant, so part of it is the view's own composition. The bark texture's surface is 1.9 and passes |
| The flower and sprout views frame the wrong subject | 12 | 19 draws one open flower and its buds where the photograph shows three sprays; its gap is 0.031 against 0.227 | The flowers are drawn and framed; the gap stays closed because the view's frame is set by the extras around the chosen cluster, with leaves between them, and a flower carries no stalk of its own to stand clear. The view was also tried as a cut piece, the slot asking for the cluster cutting the way the elm's fan and the alder's second shoot are reached: the cluster cutting draws the spur, which carries leaves and no flowers, so its overlap reads 0.03 and its colour 23.7, and the view stays the twigs view. The Norway maple then tested the same route for its blossom and reached the same answer from the other side: **a cut piece is built from the shoot prototypes alone and carries no extras**, so a flowering piece returns as a bare twig. Two species, tested in opposite directions, make this a limit of the cutting path rather than of either record, and it would need an engine change to lift.

That was half wrong, and the Norway maple found the other half: a piece **cut from the grown plant** carries the flowers its own shoot rows place, and only a piece cut from the kit carries none. So the lime tried the plant-cut route too: the branch hint at order 1 with a metre of wood, then the sub-branch at order 2 with 0.4 m and order 3 with 0.3 m, the flower still's slot naming each view at leaf scales from 1.5 to 8. Every piece came back as macro-axis bark, a young red-brown branch and leaves, with no flowers. The lime's inflorescences stand at the tips of the shoot rows, and the plant cut's macro axes do not carry those tips to the frame. So the plant-cut route is real for a species whose flowers the piece reaches, and this species' sprays are not reached by it; the flower view stays the twigs view. The crown box the figure rested on was **640 by 1 pixels**, one row tall, so that reading was void. The shared branch's box-slice rule (`75653ba69`) gives the view a sound 640 by 640 box, and under it the gap is 0.031 against the photograph's 0.227: the figure is quotable again and fails, because the frame fills with leaves. View 20 frames a branch because the record cannot draw a stool's sprouts |
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

