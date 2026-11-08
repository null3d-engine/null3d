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

### The figures the record keeps

- `shoots.classes` carry 7, 16 and 24 nodes at 0.2, 0.4 and 0.6 meters. A leaf stands every two to
  two and a half centimeters along a strand, as stills 09, 10 and 23 show.
- `shoots.placement.perMetre` runs 4.2 to 9 shoots a meter of the finest wood. `scale` stands at
  1.2. A five centimeter leaf then draws at six, inside the species' three to seven.
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

## Consequences

The species' budgets, measured across the species and its three forms:

| Tier | Kit | Variant | LOD0 | LOD1 | LOD2 |
| --- | --- | --- | --- | --- | --- |
| low | 2.47 MB | 6.94 MB | 1,648,898 | 120,650 | 41,076 |
| medium | 3.79 MB | 7.00 MB | | | |
| high | 6.05 MB | 7.05 MB | 1,726,976 | 125,117 | 42,241 |
| ultra | 10.33 MB | 7.10 MB | | | |

The record's budget stands above each figure and inside the tree caps: 150,000 card triangles and
43,000 at the second card level. The woodland form sets the card levels and the variant bytes. The
mature form sets the nearest level's triangles.

The species registers a `plant-silver-birch` picture test, which the image manifest builds from the
registry with no line of its own. That test's six references, three tiers on the Mac and three on
SwiftShader, are not drawn yet, so `bun run limits` reports the picture references past their limit.
They must be drawn and accepted once the record is final, since a reference holds only for the tree
that drew it.

Limits this record states:

- The mature crown of still 33 cannot reach that picture's sky gap of 0.057 inside the tree caps. The
  card levels draw a row for each shoot, and the caps hold about eight thousand rows. A crown
  seventeen meters across then carries about a quarter of its photograph's leaf area.
- Still 20's autumn photograph lets 0.098 of its crown box show background. Stills 01 and 02 let
  0.177 and 0.167 show. One grown plant cannot sit inside all three bands, so the record follows the
  summer whole views.
- The crown's color still reads 8 to 15 steps from the photographs where the working band is 3. Its
  leaves are small, so a whole view's crown is mostly leaf edges and shade. The light that each
  photograph's own sky gives does not close the gap. The leaf's optics carry little blue, which the
  crown's mix of shades then reads as a saturated green.
- Still 34's lifting strips stand on the bole, but the camera looks straight at them. They read
  almost flat, where the photograph shows them curling away from the wood.
