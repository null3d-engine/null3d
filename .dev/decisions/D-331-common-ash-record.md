# D-331: the common ash, its opposite branching and its pinned, winged keys

Status: decided and built in the ash's record, the two record fields it needed and its textures. The
review measures the species against its reference set. It stood at three of twelve rows when this
record was written. It stands at eleven at run `ash-123`: row 10's crown colour is the one open
limit. The figures and the faults that remain are under [Consequences](#consequences). Task: none.

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

### The third pass: joins, filigree and a taller dome

The review's second pass fails eight rows. Three of them share a cause, and the branch now answers all
three from the record.

- **The plant broke into pieces** (row 12: 5, 2 and 5 islands at the whole views against one each, and
  12, 12 and 6 at the cut views). The great limbs now keep `clearance` 0.3 m of air from one another
  and turn up to 30 degrees in an internode to keep it, with only wood above 0.35 of the trunk's
  girth holding the rule, so the crown's fine wood keeps its own layout. Each card draws its
  supporting twig as a line at least 1.5 pixels wide (`cardStalk`), so a card's leaves no longer read
  as a piece in air at a whole view, and the leaf's own stalk stands 2.6 millimetres across.
- **The crown read as tufts on bare axes** (row 2, and row 12's pattern). The shoots per metre rise
  from 0.8 to 2.4 along the least vigorous wood, so every limb carries leafy twigs along its run, and
  `branching` 1.15 lets more lateral buds put out a branch. The opposite arrangement was already
  there; what was missing was the wood fine enough to see it.
- **The crown was a broad dome, not a tall one** (row 1: a crown box 1.20 wide to high against the
  photograph's 0.90 at the silhouette). The leader's control rises to 0.62, so one leader carries the
  crown to its single apex.
- **The cut stem was a wire** (row 3: about 0.014 of the piece's height against the photographs'
  0.032). Its radius doubles to 11 millimetres at its foot.
- **The leaf carried eleven leaflets where its photographs show nine** (row 4). It carries nine.

The shoots that the filigree adds close the crown, so the placement dial falls from 1.5 to 1.

### The fourth pass: the rachis holds its width, and the dial's fifth

The third pass's filigree cost the cut views. The sixty most crowded leaves of the crown now break
into pieces of their own wherever the mask loses the wood, and the cut views drew 34, 36 and 19
pieces against the photograph's one each, where the second pass drew 12, 12 and 6.

- **The last leaflets hung on a thread.** A rachis thinned to 40 per cent of its base width by its
  last pair, so at the distance of a cut view the drawn tube fell under a pixel and the coverage
  mask cut each distal leaflet free. A rachis now keeps `RACHIS_TIP_SHARE`, three quarters of its
  base width, at its tip. That is a rule of the compound leaf's builder, not a figure for this
  species, and a leaf that does not compound builds no rachis at all, so its mesh is unchanged byte
  for byte. `leaf/leaf-mesh.test.ts` holds both: the tip ring measures the share of the first, and a
  simple leaf's mesh equals the blade's at every tier.
- **The shoots gather in the internode's first third.** `shoots.placement.gather` 0.33 holds each
  bud's shoots in the third of the internode nearest it, so the run between nodes stands bare. Run
  `ash-25` measured it: 01's sky gap rises from 0.201 to 0.213 against the reference's 0.261, 02
  from 0.177 to 0.192 against 0.187 and 18 from 0.203 to 0.213 against 0.215, so 02 and 18 sit on
  their photographs and 01 is 0.047 short. The whole views read 2, 2 and 2 pieces: 02 gains a bare
  twig with a small tuft standing off the crown's edge. The crown outside rises from 65 pieces to
  87 against the photograph's 3, and every cut view holds at 2, 1 and 1.
- **The placement dial stays at the curve's own count.** The review prints a sky gap as the
  reference's against the render's, so the whole views' 0.26 against 0.19 at 01 reads as the
  reference's 0.26 and the render's 0.19: the crown shows less sky than its photograph and an
  earlier report of it had the two sides reversed. The dial multiplies the shoots that the
  per-metre curve places, so raising it closes the crown further. A threefold rise moved this figure
  by 0.08, so no dial carries row 6; the crown's shape does.

### The fifth pass: the leaflets meet the rachis

The fourth pass's cut views drew 33, 36 and 16 pieces against the photograph's one each, and the
rachis rule moved them by a piece or three. The review's mattes name the cause: a single leaf draws
as two pieces from above and ten from below, and it is one mesh either way. The leaflet's own stalk
is drawn from a band of the leaf texture that carries no leaf on the underside, so that band draws
nothing and every leaflet stands clear of the rachis on that face. The photographs show sessile
leaflets, their blades meeting the rachis directly.

`CompoundLeaf.leafletStalk`, optional and 0 to 1, is the share of its drawn stalk that a leaflet
keeps. At nothing the blade begins where the leaflet meets the rachis and the stalk's geometry is
not built at all. A record that names no share keeps the whole stalk, so every other species draws
as it did.

Run `ash-24` measured it. The cut views fall from 33, 36 and 16 pieces to 2, 1 and 1, and the single
leaf from 2 and 10 to 1 and 1, with each leaflet meeting the rachis in a solid wedge in the matte.
The cluster view falls from 13 pieces to 1, the secondary branching from 28 to 1 and the fine twigs
from 5 to 1. Two views rise: the crown outside from 47 to 65, and the limb fork falls from 68 to 34.
The whole views' pieces stay at 2, 1 and 2, and their sky gap rises by 0.008 to 0.013, which puts 02
and 18 inside their bands and leaves 01 0.06 short. The kit falls to 4.91 and 9.07 MB at the high
and ultra tiers.

### The sixth pass: keys on their wings

Still 19 shows several dozen narrow keys in a bunch, each a small red-brown seed body on a
yellow-green wing, where the record drew twelve broad pale blades. The bunch now carries 28, a key
is a fifth as wide as it is long, and its body less than a fifth of that length.

A key takes its seed body in the extra's band colour, so a bunch reads as brown bodies on green
wings. The samara marks the body's rings as the band and stands the body's last ring again as the
wing's first, so the colour changes at a sharp edge; a record without a band colour draws every key
in one colour as before. Run `ash-28` measured the view's edge difference falling from 0.263 to
0.22.

The keys cost what a part costs: one key drew 80 triangles and the first variant carries about
3,300 of them, near 3 MB. A key now draws nine rings from twelve, at 56 triangles, and the largest
variant measures 5.28 MB under a cap of 5.3.

### The seventh pass: the crown's reach, in place of the internode share

The internode share (`shoots.placement.gather` 0.33) gathered each bud's shoots near the bud and
left the internodes bare. Run `ash-29` measured it against run `ash-28` with nothing else changed:
it bought 0.010 to 0.016 of sky at the whole views, and cost a piece at 02, 22 at 04, and the rim
pattern the reviewer named. With it off, 02 and 18 still sit inside their bands, and 01 stays 0.06
short either way, so the share went and the record runs its foliage along its limbs again.

The crown's reach replaces it. A shoot row stands on the wood's own surface at the buds' angle, and
a record may now add `shoots.placement.reach` in degrees, 0 to 60, held at 90 in total. The foot
stays on the wood, so a spray never stands in air, and the foliage reaches out while the run along
the twig stays open.

### The keys on their own footstalks

Still 19 shows green pedicels under separate brown bodies. The bunch's stalks and pedicels took the
seed body's band colour, so the heads ran together as one red-brown collar. The extra now names its
own `stalkColour`, the wing's green, and the bunch carries 34 keys where it carried 28, since it read
sparser than the photograph's. Run `ash-34` drew it. The largest variant rises from 5.28 to 6.11 MB.

The view's edge difference stays at 0.261, unmoved: the review frames this view inside a shaded
crown, so its tone cannot be judged there, and the picture is the measure that changed.

### The leaf's plan

Row 4's box read 0.691 and 0.690 at the leaf's views against the photographs' 0.762 to 0.917, and
the sessile join took a tenth of it. `CompoundLeaf.angle`, optional and 30 to 90 degrees, spreads
the leaflets from the builder's own 62, and the rachis sets how much of the leaf they take.

Three settings were drawn at 74 degrees:

| Rachis | Leaf's boxes, upper and underside | Cluster's sky at 11 | Row 4 |
| --- | --- | --- | --- |
| 1.68, the fitted share | 0.691, 0.690 | 0.407 against 0.392 | Outside |
| 1.55 | 0.788, 0.760 | 0.394 against 0.392 | Underside on the floor |
| 1.50, the setting kept | 0.801, 0.779 | 0.380 against 0.392 | Inside with room |
| 1.45 | 0.818, 0.789 | 0.366 against 0.392 | Inside, the cluster 0.026 under |

Run `ash-37` drew the setting kept. All four leaf views sit inside the photographs' band, the
cluster keeps its own, and the whole views gain with them: `01`'s sky rises from 0.201 to 0.208,
`02` reads 0.184 against 0.187 and `18` 0.211 against 0.215.

### Rows 8 and 10 are measures, not the plant

Still 14 shows moss over the buttresses' flanks, and the record carried a fifteenth of a square
metre at the foot. A third of a square metre over half a metre, heavier on the shaded side, takes
the base view's colour difference from 7.11 to 6.90 steps.

Neither row answers to the scene's light. The three bark stills were drawn at an even light, a sky
share of 0.85 and a daylight of 1.2, as close to the copy stand as the review's light goes: views 15
and 16 read 9.88 and 7.68 before and after, unmoved.

The reason is in the measure. The review compares the middle of the picture with the middle of the
photograph, and a bark close-up is all bark, so that patch is the bark's own colour. The patch does
not follow the light either: on 8 November the base still read 6.22 under an even light where it
read 6.38 as framed, and the mid-trunk read 5.38 to the hundredth under both a sky share of 0.85
and a bright sky share of 0.9 with a daylight of 2.2. A colour measured this way is the material's,
so the close views' daylight cannot close row 8.

View 18 is a matte. The review page draws the silhouette view as a mask, so the plant is black by
construction, #0a0a0a against the photograph's #5e5e5d, and its 25.9 steps are the mask against a
picture of a tree under an overcast sky. An overcast light on that view moved the figure by
nothing, because a matte takes no light. Views 01 and 02 read 11.78 and 11.21, which is the crown's
hue limit recorded above: the leaf's blue is nearly zero.

### The relief is the material's, and the moss is the record's

The base view showed no green film at the record's third of a square metre over half a metre, on one
side of the foot. At the full amount, a metre up and on every side, the buttress flanks and the lower
ridges carry green patches and the base view's colour difference falls from 6.90 to 5.73. The record's
amount is at its ceiling; the rest of the photograph's film would come from the material's moss rule,
which weighs a vertical face below half an upward one.

The bark's remaining gap does not answer to the record at all. The furrow's depth, the only relief
value the record holds, was drawn at 0.015, 0.03 and 0.045: views 15 and 16 read #847f7b at 9.88 and
#837e7b at 7.68 at every one of them, byte for byte the same. The gap between the flat texture's 1.91
and the bark in the view is the material's normal-map shading and its cavity term, so row 8 stands as
a limit of the material: the texture matches, the moss shows, and the relief's shading is the
material's own.

The bole's diameter rises from 0.95 to 1.10 metres, since the grown trunk read 0.037 of the tree's
height against the photographs' 0.038 to 0.051. Run `ash-46` draws the whole views' shape overlap up
from 0.474 to 0.479 at 01 and the trunk taper from 0.417 to 0.422, and takes the limb's bark view
from 0.407 to 0.356 as the camera finds a different limb. The largest variant rises to 6.13 MB.

### The cluster's third pair costs a row and does not open the turn

The reviewer named the piece itself as the lever for the cluster's turn: the reference carries six
leaves in three opposite pairs where the ash's short shoot carries four in two, so the ash's two
planes flatten more as the piece turns. The third pair was drawn on the crown's own short shoot, so
the close view and the tree stayed one plant, and run `ash-48` measured it.

It trades one axis of the turn for the other. The crown box's spread over the turn's frames, largest
less smallest over the mean, goes from 95 per cent wide and 30 tall to 58 and 63, where the reference
reads 54 and 14: the width, which was the fault, comes into line and the height doubles away from it.
The turn's mean shape overlap rises from 0.227 to 0.261. The stills go the other way: the clusters
read 0.3086 and 0.3058 against the photographs' 0.3918 and 0.3882, about 0.083 under and outside the
band on the closed side, where they passed before.

So the pair costs a passing pair of stills and brings no row, and it is back off: the short shoot
draws four leaves in two pairs again and the kit returns to 9.07 MB at the ultra tier.

### The cluster's turn is a trade the species cannot have both ways

Two changes were drawn against the cluster's turn, and neither brings its height inside the
reference's band:

| Setting | The turn's spread wide | tall | Mean shape overlap |
| --- | --- | --- | --- |
| The reference | 54 per cent | 14 per cent | none |
| As the record stands | 95 | 30 | 0.227 |
| A third leaf pair on the short shoot | 58 | 63 | 0.261 |
| The leaves laid flat at eighty degrees | 96 | 81 | 0.218 |
| A third pair on a shoot half as long again | 52 | 16 | 0.233 |
| A cutting class of its own, half as long again | 60 | 15 | 0.239 |

The last row's spread is the eight-angle measure. Run `ash-51` drew it: the turn comes inside the
band at 52 wide and 16 tall against the allowed 47 and 25, its width five points over, and the crown
closes with the same change. The crown's cost is the longer shoot's rather than the six leaves':
01's sky fell from 0.207 to 0.126 against its photograph's 0.261, 02 from 0.182 to 0.112 and 18 from
0.209 to 0.124, and the cluster stills with them to 0.353 and 0.362, because six leaves on every
short shoot is half again the crown's foliage. The third pair on the crown's own 0.18 m shoot leaves
the whole views holding, which is why the crown's cost belongs to the shoot's length and not to the
leaves' count.

The class's own leaf angle and droop, steeper and arched at fifty to thirty-eight degrees with a
droop of five, are the fourth measurement and the closest turn of all: run `ash-56` reads 56 wide and
10 tall on the eight angles against the class's 60 and 15, and 60 and 15 on every frame against 74 and
16. It buys four points of width on the eight angles and thirteen on every frame, and the turn's mean
shape overlap falls from 0.239 to 0.223. It closes the cluster stills to 0.315 and 0.322 against their
photographs' 0.392 and 0.388, about seven hundredths under and outside the band, so it costs a
passing row and comes back out.

The class's leaf spread is not the width's lever either. Narrowed from fifteen degrees either side
to five, run `ash-54` reads 65 wide and 15 tall on the eight angles against the class's 60 and 15,
and 78 and 17 on every frame against 74 and 16, so the width goes the wrong way while the overlap
rises from 0.239 to 0.247 and the stills hold at 0.371 and 0.382. The spread is back at fifteen.

Three levers have now been measured against the turn's width and none brings it down: the third
pair on the crown's own shoot, the flat angle on the crown's class, and the class's own spread. The
trade stands on the dedicated class's figures.

The last row is run `ash-53`. A class of its own costs the crown nothing: the whole views hold at
0.207, 0.181 and 0.209 and the cluster stills sit inside at 0.364 and 0.378. Its turn brings the
height inside at 15 against the allowed 25, better than the crown's longer shoot managed, and leaves
the width at 60 against the allowed 47, thirteen points over where the longer shoot read five. The
class's own leaf spread is the figure still to take, and now it can move without touching the crown.

The spread is the review's own crown-box measure over the turn's frames: the largest box less the
smallest, over the mean. The third pair brings the width into the reference's band and doubles the
height away from it; laying the leaves flat nearly triples the height and leaves the width where it
was. Both are reverted.

What the two say together is that the piece's width follows how many leaves stand in how many planes,
and its height follows something the leaf's angle does not reach. The cluster's turn therefore stands
as a trade this species cannot have both ways, and its two stills keep the figures they had.

### The envelope is not a knob

The crown's box reads 1.155, 1.089 and 1.139 wide to high at the whole views against the
photographs' 1.25, 1.23 and 0.90, so the visible next lever was the hull the grower fills. It is not
a lever that can be turned by hand.

Widening every radius of the fitted envelope and growing the first variant measures a growth that
neither follows the change smoothly nor in the direction asked:

| Radii | Crown's radius, variant 0 | 01's box | 01's sky gap |
| --- | --- | --- | --- |
| As fitted | 9.02 m | 1.155 | 0.201 |
| 2 per cent wider | 0.53 m, a stalled plant | not drawn | not drawn |
| 3 per cent wider | 10.54 m | 1.069 | 0.167 |

Run `ash-31` drew the 3 per cent hull. The crown's box falls at all three whole views, its sky gap
with it, the crown draws lopsided with a hole on one side, and the look-up view breaks from 5
pieces to 10 while the crown outside rises from 65 to 97. The 2 per cent hull stalls the first
variant outright and grows the second normally, so the stall belongs to a variant and not to the
envelope.

Two things follow. The fitted radii are not a knob, in either direction. And a fit that widens the
hull does not widen the crown: the measurement to fit against is the rendered crown box at the whole
views, not the hull's radii.

### The reference disagrees with itself about the crown's width

The fit's own report says the envelope matches the views it came from at a mean overlap of 0.689, its
worst frame at 0.570, and its last frame against its first at 0.783: the turning footage's tree
changes shape across the turn. A hull keeps only what every view allows, so it comes out narrower
than the photographs, and the stills that are overlaid to widen its broad sides reach one azimuth
each side of a row, where a view's width is a projection over many.

Widening a still across the arc it faces was measured three ways, and none can be shipped:

| Still overlay | Hull's box at 01 and 18 | at 02 | Overlap with the video's views |
| --- | --- | --- | --- |
| One azimuth each side, the shipped fit | 1.31 | 1.15 | 0.689 |
| The arc within 60 degrees | 1.59 | 1.48 | 0.506 |
| The arc within 23 degrees | 1.56 | 1.43 | 0.610 |

The photographs themselves read 1.25, 1.227 and 0.90. The stills are about a third wider than the
video's hull at every row, so a hull cannot be both: the shipped fit stands with the video and is a
sixth narrow at 02 against its photograph, and honouring the stills overshoots the photographs and
loses the video's fit. The fit stays as it is, and the disagreement is recorded here rather than
pushed into the radii.

What the growth makes of the shipped hull is the second figure: at 01 it draws a crown box 88 per
cent of the hull's 1.31, at 18 87 per cent, and at 02 95 per cent of 1.15. Row 1 passes on the
band, so the box's shortfall against its photographs is the fill's, and filling to 1.25 at 01 means
drawing about 95 per cent of that hull.

### The crown seen from under it

Stills 03 and 08 look up the bole, and there the drawn crown is far denser than its photographs: 03
shows 0.12 to 0.15 of its own box as sky against the photograph's 0.50, and 08 0.19 to 0.23 against
0.56. Three settings were tried against them, each drawn and measured:

| Setting | 03's sky gap | 08's | 01, 02, 18's | Verdict |
| --- | --- | --- | --- | --- |
| `lift` 10, `skyward` 0.5, `skyPrune` 0.15 | 0.12 | 0.19 | 0.23, 0.18, 0.24, all in band | The state the record keeps |
| `lift` 26, `skyward` 0.85 | 0.13 | 0.22 | 0.27, 0.21, 0.28 | 18 leaves its band; the look-up views barely move |
| `skyPrune` 0.45, `lift` 14, `skyward` 0.6 | 0.15 | 0.23 | 0.28, 0.22, 0.28 | 18 leaves its band; 04's colour falls to 2.5 and the cut pieces improve |
| `floor` 0.32 | 0.27 | 0.56 | the crown breaks up | The whole view's outline falls to 0.04 |

This is a limit of the plant core, not a fault of the species. A look up the bole sees the crown's
*outer* shell drawn as cards, not its interior, so an interior prune moves it a hundredth or two.
Opening it needs a crown built as two shells with air between, or a card level that thins as the eye
passes below it. Neither is a record value. Every species whose photographs look up its bole meets
the same limit. The record keeps the setting that holds every whole view inside its band.

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

At the low, medium, high and ultra tiers, the kit measures 2.60, 2.96, 4.91 and 9.07 MB with the
leaflets sessile, and the largest of seed 11's six variants 3.18, 3.25, 3.33 and 3.43 MB. The owner's caps for a tree are 2.7,
4, 7.1 and 13 MB for a kit; the low tier sits within three per cent of its cap. The first card level
of the same variants draws 24,855 to 35,382 triangles and the second 10,594 to 13,325. A variant
grows in about 290 to 300 ms with the machine in other hands.

### Row 8's bark colour takes three zones of its own

The bark's colour was read as a limit at the ninth review, at 6.38, 5.38 and 3.72 steps against a
band of 3. It is a record value after all. The three close views do not fail alike. A marker tint on
each range showed where each view draws. The base and the mid-trunk take the foot range, below about
a metre. The limb, at a radius of about a quarter of a metre, takes both the upper height range and
the thin-wood radius range.

Three zones carry the three tones. They were first measured on a diluted figure, then re-tuned once
the tool's measure was fixed. The final settings, measured at run `ash-121-retune`:

| Zone | Range | Tint | Base | Mid-trunk | Limb |
| --- | --- | --- | --- | --- | --- |
| Foot | height 0 to 1.2 m | [1.2, 1.15, 1] | 2.77 | | |
| Bole | height 1.2 to 40 m | [0.79, 0.79, 0.66] | | 1.47 | |
| Limb | radius 0 to 0.3 m | [1.38, 1.4, 1.22] | | | 2.08 |

All three stand inside the band of 3. The base slot also carries a `daylight` of 1.0, which brings
the foot's lightness onto its photograph's.

The count is twelve of twelve. The reviewer confirmed row 8 on run `ash-123` at `dbe7eebda`, 769
of 769 frames and all 32 reference files.

Row 10 passes on the owner's acceptance under D-334, not on its figure. Its only fault is the shared
review lighting: the far-crown shading under the scene's light. The owner ruled that such a row
passes, and the engine change becomes a task of its own. Its figures stay recorded beside the
acceptance, 12.9, 11.9 and 4.4 against the band of 3. Nobody then mistakes a dark crown for a fixed
one. Scored on the stated limit alone, the ash would read eleven.

Re-read on the land head at `31e48922f`, which brought the thin-wood tint, the limb stood at 1.87.
That tint is reverted at `038dac7cc`, so on the settled land tip the limb reads 2.08 again.

Re-read at `fbdcbcd83`, which merges `9da5a94d0`, the three close views read 2.77, 1.33 and 1.97,
with the mask set per picture:

| View | Masked | Unmasked | Corners of the photograph | Kept |
| --- | --- | --- | --- | --- |
| Base 14 | 2.77 | 6.93 | grey sky above, olive meadow below | masked |
| Mid-trunk 15 | 1.47 | 1.33 | four grey bark tones | unmasked |
| Limb 16 | 2.08 | 1.97 | pale grey and grey bark | unmasked |

The mask helps where the corners are the backdrop. It hurts where they are the bark itself, because
it then drops bark as backdrop. The base draws 47.7, -1.0, 7.4 against the photograph's 46.0, -1.6,
10.4. The mid-trunk draws 48.5, -0.2, 6.8 against 49.0, 0.4, 5.7, and the limb 60.5, -0.1, 5.9
against 62.8, -0.3, 5.4.

The batch re-read was drawn at `980498366`, which merges `6e44d5063`'s strands camera and the land
head. The whole views read 0.2512, 0.2244 and 0.2442, against 0.2608, 0.1869 and 0.2147.
Their crown aspects are 1.157, 1.096 and 1.157. The photographs give 1.250, 1.227 and 0.900. The
young bark reads 12.03 at the shared frame, `thin` 0.015 with a `span` of 0.1 and the mask, landed
at `b40edf899`, drawn at `b62625f07`. The ash's own entry for that picture now carries the same
pair rather than a thin alone. It read 6.68 with the narrower frame, and the rise is the frame's:
the wider span takes in the branches behind the shoot, which no mask separates from it. That is a
texture-source note, expected to stand out under the masked measure as the oak's 11.28 and the
beech's 7.33 do. The ash has no strands reference, so that view has no
picture.

The measure came first, because it was wrong. A slot's `barkMask` drops every patch pixel as close
to the picture's corners as the backdrop is. Its first version read the backdrop as one colour: the
mean of all four corners. A base view lays a stem on sky above the horizon and meadow below, so that
mean matches neither and the mask dropped nothing. Masked and unmasked both read 5.98.

The shared head now reads each corner on its own and drops a pixel that matches any of them. With
that the foot's draw stands at Lab 46.9, 0.0, 4.5 against the photograph's 46.0, -1.6, 10.4 at a
`daylight` of 1.0. The green was the meadow, and the drawn bark is neutral and six steps less yellow
than its photograph.

The tint tuning before the fix moved a diluted number. A lamp sweep on the same view read 5.35,
4.42, 4.89 and 5.05 against 6.26 for no lamp. The exposures that reached the band drew the foot pale
lavender. Those figures belong to the old measure and are kept as a record of the search.

Nothing in the shading was the cause. Moss set to zero moved the albedo draw from 5.82 to 5.41, and
young bark and lichen changed nothing. The base drawn as albedo read 5.82 against the lit 5.98, so
the light path contributes 0.16 and the moss 0.41. Neither is the yellow the old figure showed.

The reference set disagrees about the bark's colour as much as the render did. The flat texture
source, still 26, stands 5.9, 6.8 and 7.8 steps from the photographs of the base, the mid-trunk and
the limb. It stands 11.9 from the young bark. So the swatch's old figure of 1.7 measured the render
against a patch its own close views do not agree with. With the zones in place still 26 reads 6.31,
which is where the photographs themselves stand from it.

A lower young radius, 0.015 in place of 0.03, moves the limb by three hundredths. The limb draws the
mature bark either way, so that lever is not this row's.

Still 28 now frames the thin wood it is a photograph of. Its slot asks for the thinnest five per cent
of the wood rather than the view's default. The picture shows a smooth olive shoot with lenticels,
where it showed a furrowed limb. Its figure falls from 9.53 to 6.53, and that figure is
now a young bark measure. The draw stands 5.8 lighter, 2.1 greener and 3.8 yellower than the
photograph, which is the green shift the crown's own shoots asked for.

Three zones have one side effect worth naming. The silhouette view's bark measure rose from 6.50 to
6.69 steps. That measure is the bark's tone seen beside the whole plant. It belongs to row 8's bark,
not to the crown's colour. It is the bole's tone as the whole view shows it. It rose because the bole zone
darkens the trunk the whole view mostly shows. Row 8's verdict rests on the three close views,
where the same tint reads 5.98, 0.58 and 2.33. The whole view's small rise therefore changes no row.

### The row 6 band through the cards, and the young bark's tint

The crown's lower third carries less sky than view 01's photograph at every density and shape the
record offers. Two changes to the cards bring the three whole views inside their bands, measured on
8 November. The shade prune drops a shoot whose own leaves leave it under a share of the sky, at
0.45 where it stood at 0.15. At the tip it was measured on, views 01, 02 and 18 read 0.242, 0.224
and 0.240 against the photographs' 0.261, 0.187 and 0.215. The cut views hold at 0.52, 0.39 and
0.39.

The card size was then measured twice. The landing branch's card coverage fix draws each card at its
mip level's true coverage, which opens the far crown. At the fitted 1.38 the views read
0.2998, 0.2708 and 0.2887 against 0.2608, 0.1869 and 0.2147. So 02 and 18 fall outside. The cards
stand at 1.55 at that base: 01 reads 0.2509, 02 0.2225 and 18 0.2437, all inside. 1.50 leaves 02
two thousandths from its open side, and 1.60 puts 01 twenty-four thousandths under its closed one.
The helper's model of about 1.33 held for the older base, where 1.38 read 0.2458, 0.2309 and
0.2449. At that base 1.33 read 0.2401 at 02, three thousandths past its open side.

The card size has been measured a third time. The landing branch's leaf back-face change grows the
ash's crown denser: 472 limbs over 296,452 triangles, where it carried 458 over 284,391. The whole
views closed by about two hundredths. Row 6 was read again on that base. The cards stand at 1.46,
where 01 reads 0.2512, 02 0.2244 and 18 0.2442 against the photographs' 0.2608, 0.1869 and 0.2147.
1.48 leaves 01 four and a half thousandths from its closed side, and 1.50 puts it a thousandth past
it. The value belongs to this base. A shading change that alters the shoot count moves the whole
views, so the cards are read again on any base that changes the plant.

The young bark takes a colour from the texture build. The young tile is made from still 28, the
older green-grey bark of a young branch. The crown's shoots in still 10 are greener. The two
photographs' linear means differ by [1.11, 1.24, 1.01]. The young layer takes the tint
[0.99, 1.11, 0.9], which keeps its brightness. The tool's `tint` field multiplies a layer's baked
colour. It leaves the relief and the height field alone
([D-309](D-309-plant-textures-from-references.md)). The limb's bark figure moves from 3.79 to 3.72
and stays inside its band. The young bark's own still holds at 9.53 because that view draws the
mature bark. A red marker tint on the young layer left the picture's surface unchanged and reddened
only a few stalks at its edge, while the same marker reddened every stem of still 10.

## Look

From the whole view the ash reads as its photographs: a long clean bole, a crown taller than it is
broad, limbs that sweep out and climb at their ends, and buds in opposite pairs along every twig. The
leaf, its leaflets and the bark's diamond net read as the texture sources. The crown stays more open
than the photographs show, and its foliage darker, and the close views of a cut piece do not yet
stand as one piece.

## Decision

Grow the ash with the record above. Add `CompoundLeaf.leafletStep` and `ExtraShape.samara`, both
optional, so every other species grows as it did, and hold the compound leaf's rachis to
`RACHIS_TIP_SHARE` at its tip. The species does not pass its review, and the faults under
[Consequences](#consequences) stay open.

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
  `leaf/leaf-mesh.test.ts`. `leaf/compound.ts` holds the rachis rule, and
  `leaf/leaf-mesh.test.ts` measures the rachis's tip and a simple leaf's unchanged mesh.
- The review page measures a cut piece's frame in whole-leaf lengths: a compound leaf's leaf is its
  stalk, rachis and terminal leaflet, not one leaflet. Without that, every cut piece of a compound
  species was framed five times too close.
- The low tier's kit sits within three per cent of the owner's cap for a tree. A change that adds a
  prototype needs a cut elsewhere.
- Stated faults, largest first, each with its figure:
  1. The crown now shows less sky than its photographs at every whole view close to the height it
     was judged on: the render's gap is 0.19 against the reference's 0.26 at 01, 0.17 against 0.19
     at 02 and 0.20 against 0.21 at 18. Looking up the bole it is far denser still, 0.14 against
     0.50 at 03, which is the core's limit above. A threefold rise in the placement dial moved this
     figure by 0.08, so the dial alone does not carry the row either way. The crown's shape is the
     lever: the shoots gather near the axes and leave the rim between them bare.
  2. The crown is drawn three times as loose as its photograph in the wind. The top band's motion is
     0.141 against 0.041, and every band but the third moves further than its reference's.
  3. The cut pieces do not read as the photographs' pieces. Outlines are 0.06 at 21 and 22 and 0.13
     at 23, and each draws as thirty to forty separate pieces against the photograph's one. The
     class the cuttings take carries too few leaves on too long a stem, and its leaves stand apart
     from the wood in the picture.
  4. The crown's foliage stays 11.6 and 11.8 colour steps from its photographs at 01 and 02, after
     the light reaches the most it can give. The residue is hue, not brightness: the leaf's
     reflectance carries 0.014 in blue, and the photographs' crowns are nearly grey. This is a stated
     limit of the species, not a fault to repaint. A record that lifted the leaf's blue to reach a
     distant crown's colour would fight the texture that measures the leaf, and the leaf's own
     views, which stand at 2.2 and 1.5 steps, would be wrong. A future species with the same leaf
     meets the same limit, and should state it the same way.
  5. The bark's colour stands inside its band at the mid-trunk and the limb, at 0.58 and 2.33 steps.
     It stands at 6.26 at the base. The base's residue is a hue: its render reads 4.4 greener and 5.0
     yellower than its photograph. The blue factor that answers the figure draws the foot pale
     lavender. The reference set disagrees about the bark's own colour, so a swatch figure cannot
     decide the row. The flat texture source stands 5.9, 6.8 and 7.8 steps from the photographs of
     the base, the mid-trunk and the limb. It stands 11.9 from the young bark.
  6. The whole plant's outline matches its turning video at 0.507 on average. The reference's own
     hull overlaps its views by only 0.57 to 0.80, so the fitted envelope cannot be closer than the
     reference's own drift allows.
  7. The keys hang in the pictures' bunches, on a stalk several centimetres below the twig, but the
     review's fruit camera cannot reach one: it stands twelve degrees under the cluster looking up at
     its join, and a crown this dense puts a leaf at the lens. Its view reads 0.30 in edge directions
     and shows foliage. The bunch is drawn; the camera is not made for it.
  8. The wind moves the top band 0.052 where the photograph's moves 0.041, its fourth and fifth bands
     0.048 and 0.048 against 0.039 and 0.038, and its base 0.001 against 0.014: the crown's top is
     now near its photograph's, and the trunk's base still does not move at all.
  9. The bark's colour through its own close view reads 9.9 steps where the texture source measures
     1.9. Lifting the layer to meet it made the figure worse, 12.0, so the difference is the relief's
     own shading and not the record's tint.
  10. Row 11 is judged against the pedunculate oak, the catalogue's other built species. The two are
     told apart by silhouette: the ash is 0.9 of its height across with a cleaner, taller bole and
     opposite branching, where the oak is 1.53 across on a short low-forking bole. The row passes.
