# D-333: the silver birch, its white peeling bole and its weeping veil

Status: decided and built in the silver birch's record, its three forms, its textures and one field
of the plant review's page query. The review measures the species against its reference set. The
figures of each round and the faults that remain are under [Consequences](#consequences). Task: none.

Summary: the silver birch (*Betula pendula*) is a slender open-grown tree on a single white bole.
Its bark peels in horizontal strips, and its crown is a narrow weeping flame of fine alternate
strands. The bark carries two zones, a black fissured base under a chalky white trunk. Young shoots
take a third layer, a shiny red-brown. The crown's leaves are small. Filling it to the reference's
own openness therefore costs about six leaves for each oak leaf of the same area.

## Question

What must the birch's record ask that no species asked before, and which figures does its own
reference set give? The first pass drew a bare gray skeleton. Its sky gap at the whole views was
0.72 against the photographs' 0.18.

## Rule

- A species passes only when every row passes on every reference picture
  ([plant review](../plant-review.md)). Row 6 is a band in both directions.
- Every number in the record carries a comment that names the photograph it came from.
- Every budget holds at every tier, and the owner's caps for a tree are not raised for this species
  ([D-330](D-330-oak-crown-by-its-own-light.md)).
- A bark source is compared with the bark its own photograph shows. A view that names a zone stands
  at that zone's own height.

## Data

### What the birch asks that the oak and the ash did not

| Trait | Pictures | The record's field |
| --- | --- | --- |
| Two bark zones: a black fissured base under a chalky white trunk | 14, 15, 26, 27 | `bark.zones`, the base layer below about a meter |
| A third bark layer on thin wood: shiny red-brown | 16, 28, 32 | `bark.youngRadius`, raised above the oak's so a limb shows it |
| Strips of bark lifting and curling off the trunk | 15, 34 | `bark.peel`, which the core offered and no record used |
| Black diamond eyes where limbs were shed | 15, 34 | `bark.scars` |
| Alternate leaves on weeping strands, each on a long stalk | 09, 10, 19, 23 | `shoots.classes` and `foliage.leaf.petiole` |
| A crown whose lowest fringe hangs below the fork | 01, 02, 18 | `growth.tropism.gravi` below zero at the fine ends |
| Other forms: young, mature and woodland | 30 to 33 | `forms` |

### The crown's mass, and why it took three rounds

The birch leaf is about five centimeters long. One leaf therefore covers 0.00125 square meters,
where the oak's 0.0072 covers six times as much. A crown of the reference's openness takes about six
times the leaves of a comparable oak crown. The tree caps count the cards that stand for those
leaves, so the two pull against each other.

| Round | Leaves a shoot carries | Shoots | Leaf area | Axes | Sky gap at 01, against 0.177 |
| --- | --- | --- | --- | --- | --- |
| first pass | 3 to 6 | 634 | 9 square meters | 200 | 0.720 |
| second | 3 to 12 | 3,861 | 175 square meters | 530 | 0.483 |
| third | 3 to 12 | 10,198 | 464 square meters | 604 | 0.301 |

The third round's crown read as a few dense masses with sky between. Its foliage stood on 604 axes,
so the shoot count was large but the wood that carried it was coarse. A weaker shade shadow inside
the crown gives 1,803 axes at fewer shoots. The foliage then stands in many small sprays rather than
a few large ones, and the leaves per shoot rise while the card rows fall.

### A crown round in plan

The fitting tool measures the crown's radius at 16 azimuths. The hull it writes is 9.6 m across one
way and 7.0 the other. Its own consistency runs 0.668 to 0.872, because the turntable's tree drifts
during its turn. A crown drawn on that hull reads denser from its broad side than from its narrow
one. No shoot count puts both whole views inside row 6 at once. One such crown read 0.237 of sky at
still 01 and 0.165 at still 02, against photographs that give 0.177 and 0.167.

The species' fact sheet says the crown is near round from above. The record therefore averages the
same measurement to one radius at each height, 15 numbers. `RadialEnvelope` allows a species to
state that round form. The three whole views then read 0.225, 0.196 and 0.203
against 0.177, 0.167 and 0.199, all inside the band.

### What moves a crown's figures, and what does not

A crown picks the shoot prototype each bud draws by the prototype's index in the kit. An edit that
moves an index therefore moves the whole crown. The cutting classes are safe, because
`shootPrototypes` plans them after the crown's prototypes and marks them, and `prototypesFor` skips
a marked one. On this species, variant 0 grew the same rows with no cutting classes, with two and
with three. Every one gave 6,189 shoots, 1,387.2 square meters of leaf and one first point. The test
`leaves the crown as it was when a cutting class joins the kit` holds that.

A class's `share` is not safe. `classOf` gives each prototype index a class by the shares, so editing
them re-plans which class every crown prototype serves. The same measurement moved the long shoot's
and the spray's shares from 0.35 and 0.35 to 0.40 and 0.30. That moved the first crown shoot and took
the leaf area to 1,328 square meters. Raising `shoots.prototypes` moves it a little too.

### The figures the record keeps

- `shoots.classes` carry 7, 20 and 29 nodes at 0.2, 0.4 and 0.6 meters, so a leaf stands every two
  to three centimeters along a strand. Stills 09, 10 and 23 show it.
- `shoots.placement.perMetre` runs 4.2 to 9 shoots a meter of the finest wood. `density` stands at
  3. `scale` is 1.3, so a five centimeter leaf draws at six and a half, inside the species' three to
  seven.
- Three `cuttingClasses` of its own, `whip` and `cut`, draw the cut pieces with their leaves spaced,
  as stills 21, 22 and 23 show.
- `bark.peel` lifts strips of nine centimeters at 220 a square meter on the lower trunk, which still
  34 shows close up.

### The review tool

- `barkZone` is a new page query field. A bark view stands at the height its named zone covers.
  Still 27 is the base bark, and the tool had drawn it at 1.5 meters on the white trunk. It read
  38.6 color steps from its own source there, and reads 5.96 at the zone's own height.
- `slots/silver-birch.json` frames still 20 as the whole autumn tree. The tool's number rule had
  drawn it as a limb in winter. The file also frames still 35 on a catkin twig and still 28 on wood
  inside the young bark's radius. It carries each daylit picture's light too.
- The fork view frames a fork over both arms and the twigs they carry, and never out into the crown
  above them. A slot's `span` asks for a frame height in metres, as it does for the limb view. Still
  08's sky gap moves from 0.137 to 0.145 against its photograph's 0.720, and its shape match from
  0.138 to 0.148. That gap is the view's subject limit, not a fault of the frame. The photograph is
  a cut limb on a plain studio ground. The view draws a fork inside a leafy crown, so no camera gives
  the two the same background share.
- The oak is the guard a shared view's change is measured against, and here it cannot give a figure.
  Its own fork photograph yields no outline in the tool, before the change or after. The picture is
  the guard: it shows both arms inside the frame where the old frame cut them off.

### A shoot class's own leaf arrangement and facing

The three studio cuttings show leaves two-ranked along the twig and held face on to the camera. The
crown's shoots spiral and turn their faces to the sky, and both settings belong to the species. A
class may now name its own `phyllotaxis` and `skyward`, each defaulting to the species' value, so a
class that names neither draws byte for byte as it did.

Measured on the birch's cutting classes, with the whole views drawn beside them at every value:

| still | species' own | two-ranked, faces level | box, photograph |
| --- | --- | --- | --- |
| 21 branch | 0.629 open, 26 pieces, box 156x243 | 0.657 open, 6 pieces, box 172x189 | 246x317 |
| 22 sub-branch | 0.337 open, box 137x311 | 0.483 open, box 143x315 | 207x283 |
| 23 leaf cluster | 0.379 open, box 163x304 | 0.278 open, box 139x283 | 164x283 |

Stills 01, 02 and 18 read 0.199, 0.168 and 0.188 at both settings, since no crown class names
either field. The record sets the fields on the branch's class and on a class of its own for still
22, which is where they gain. The leaf cluster keeps a class without them and holds 163 by 304
pixels against its photograph's 164 by 283, with a shape match of 0.237, where the two ranks take
its box to 139 by 283 and its shape match to 0.156.

The slot file stands still 22 on the side its photograph took. Two ranks of leaves lie in one plane,
so a frame that looks across that plane sees them face on and one that looks along it sees them
edge on. At a turn of 45 degrees the view reads 0.534 open against its photograph's 0.614, up from
0.483; its box grows from 143 to 171 pixels across against the photograph's 207, and its shape match
rises from 0.093 to 0.101.

## Consequences

The species' budgets, measured across the species and its three forms:

| Tier | Kit | Variant | LOD0 | LOD1 | LOD2 |
| --- | --- | --- | --- | --- | --- |
| low | 2.49 MB | 5.72 MB | 1,651,374 | 98,741 | 31,891 |
| medium | 4.37 MB | 5.76 MB | 1,671,693 | 100,122 | 32,180 |
| high | 7.60 MB | 5.81 MB | 1,725,532 | 102,316 | 32,596 |
| ultra | 13.74 MB | 5.89 MB | 1,849,438 | 108,818 | 33,567 |

The record's budget stands above each figure and inside the tree caps: 150,000 card triangles and
43,000 at the second card level. The kit's ultra figure sits inside the tree cap's 14.5 MB, since the
kit holds the long leafy shoots that the fine leaf needs.

The species registers a `plant-silver-birch` picture test, which the image manifest builds from the
registry with no line of its own. That test's six references, three tiers on the Mac and three on
SwiftShader, are not drawn yet, so `bun run limits` reports the picture references past their limit.
They must be drawn and accepted once the record is final, since a reference holds only for the tree
that drew it.

Limits this record states:

- The mature crown of still 33 cannot reach that picture's sky gap of 0.057 inside the tree caps. The
  card levels draw a row for each shoot, and the caps hold about eight thousand rows. A crown
  seventeen meters across then carries about a quarter of its photograph's leaf area.
- The woodland crown's figure comes from its volume, not its foliage. A crown a third of the height
  across spreads its shoots thin and read 0.258 open against its photograph's 0.139. A narrower
  crown of the same foliage fills the same box and reads 0.148. Adding foliage instead passes the
  second card level's cap at a density of 6, reaching 46,371 triangles against the cap's 43,000.
- Still 20's autumn photograph lets 0.098 of its crown box show background. Stills 01 and 02 let
  0.177 and 0.167 show. One grown plant cannot sit inside all three bands, so the record follows the
  summer whole views.
- Still 03's from-below view lets 0.343 of its frame show background where the record draws 0.190.
  The sky it shows lies between limbs that leave the bole and hang. The record's crown carries its
  foliage lower and deeper on the same limbs. Opening it needs a sky prune strong enough to take
  still 01 past its own band's ceiling, so the record keeps the summer side views and states this
  one.
- The crown's color still reads 11 to 15 steps from the photographs where the working band is 3. Its
  leaves are small, so a whole view's crown is mostly leaf edges and shade. The light that each
  photograph's own sky gives does not close the gap. The leaf's optics carry little blue, which the
  crown's mix of shades then reads as a saturated green. Blue in the transmitted light alone gains
  the crown 1.6 steps and moves neither leaf swatch, so the blue sits there. Blue in the reflected
  light gains a little more at the crown. It also costs the upper swatch 3.8 steps, so that lever is
  a trade and not a fix. The remaining gap belongs to the leaf's size and the crown's mixture of
  shades rather than to one color value.
- The lifting strips do not read as ribbons. `bark.peel` draws them as broad flat sheets that carry
  the bark's texture stretched across them, so they read as square patches pasted on the trunk rather
  than as narrow strips curling away from the wood. At the record's curl they stay flat against the
  bark, and the review counts one piece where the photograph's strips separate seventy-five. Raising
  the curl to 8 degrees turns them into wide translucent sheets that smear the texture and show black
  from behind. The record keeps the setting the engine draws least wrongly until the feature is
  settled.
- At a whole view each leaf of the crown reads as its own piece. The twigs and the leaf stalks fall
  under a pixel wide at that range. The review counts 37 pieces in the young form against its
  photograph's 9, and four in still 01 against 1. A thicker stalk and a thicker twig tip move neither
  count, and the render's own matte is one piece, so the plant is joined and the measure reads the
  leaves apart. At close range the same split appears. Still 21's matte holds its stem with the side
  shoot and thirty-eight leaf-sized groups beside it, where the leaves touch the stem in the render,
  since the review works at 480 pixels across and the stalk is two pixels at the render's own size.
