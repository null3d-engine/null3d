# D-333: the silver birch, its white peeling bole and its weeping veil

Status: decided and built in the silver birch's record, its three forms, its textures and one field
of the plant review's page query. The review measures the species against its reference set; the
figures of each round and the faults that remain are under [Consequences](#consequences). Task: none.

Summary: the silver birch (*Betula pendula*) is a slender open-grown tree on a single white bole
that peels in horizontal strips, its crown a narrow weeping flame that hangs in fine alternate
strands. Its bark carries two zones, a black fissured base under a chalky white trunk, and young
shoots take a third layer, a shiny red-brown. The crown's leaves are small, so filling it to the
reference's own openness costs about six leaves for each oak leaf of the same area; that is the
figure every budget here turns on.

## Question

What must the birch's record ask that no species asked before, and which figures does its own
reference set give? The first pass grew a bare grey skeleton: its sky gap at the whole views was
0.72 against the photographs' 0.18.

## Rule

- A species passes only when every row passes on every reference picture
  ([plant review](../plant-review.md)). Row 6 is a band in both directions.
- Every number in the record carries a comment naming the photograph it came from.
- Every budget holds at every tier, and the owner's caps for a tree are not raised for this species
  ([D-330](D-330-oak-crown-by-its-own-light.md)).
- A bark source is compared with the bark its own photograph shows, so a view that names a zone
  stands at that zone's own height.

## Data

### What the birch asks that the oak and the ash did not

| Trait | Pictures | The record's field |
| --- | --- | --- |
| Two bark zones: a black fissured base under a chalky white trunk | 14, 15, 26, 27 | `bark.zones`, with the base layer below about a metre |
| A third bark layer on thin wood: shiny red-brown | 16, 28, 32 | `bark.youngRadius`, which the birch raises above the oak's so a limb shows it |
| Strips of bark lifting and curling off the trunk | 15, 34 | `bark.peel`, which the core already offered and no record used |
| Black diamond eyes where limbs were shed | 15, 34 | `bark.scars` |
| Alternate leaves on weeping strands, each on its own long stalk | 09, 10, 19, 23 | `shoots.classes` and `foliage.leaf.petiole` |
| A crown whose lowest fringe hangs below the fork | 01, 02, 18 | `growth.tropism.gravi` below zero at the fine ends, with `growth.floor` at the fit's 0.219 |
| Other forms: young, mature and woodland | 30 to 33 | `forms` |

### The crown's mass, and why it took three rounds

The birch leaf is about five centimetres long, so one leaf covers 0.00125 m2 where the oak's
0.0072 m2 covers six times as much. A crown of the reference's openness therefore takes about six
times the leaves of a comparable oak crown, and the tree caps count the cards that stand for those
leaves.

| Round | Leaves a shoot carries | Shoots | Leaf area | Axes | Sky gap 01 against 0.177 |
| --- | --- | --- | --- | --- | --- |
| first pass | 3 to 6 | 634 | 9 m2 | 200 | 0.720 |
| second | 3 to 12 | 3,861 | 175 m2 | 530 | 0.483 |
| third | 3 to 12 | 10,198 | 464 m2 | 604 | 0.301 |

The third round's crown read as a few dense masses with sky between, because its foliage stood on
604 axes: the shoot count was large but the wood that carried it was coarse. A weaker shade shadow
inside the crown gives 1,803 axes at fewer shoots, so the foliage stands in many small sprays
instead of a few large ones, and the leaves per shoot rise while the card rows fall.

### The figures the record keeps

- `shoots.classes` carry 7, 16 and 24 nodes at 0.2, 0.4 and 0.6 m, so a leaf stands every two to two
  and a half centimetres along a strand, as stills 09, 10 and 23 show.
- `shoots.placement.perMetre` runs 4.2 to 9 shoots a metre of the finest wood, and `scale` stands at
  1.2, which draws a five centimetre leaf at six, inside the species' three to seven.
- Three `cuttingClasses` of its own, `whip`, `cut` and the crown's own classes left alone, draw the
  cut pieces with their leaves spaced, which stills 21, 22 and 23 show.
- `bark.peel` lifts strips of six centimetres at 30 a square metre, which still 34 shows close up.

### The review tool

- `barkZone` is a new page query field: a bark view stands at the height its named zone covers. Still
  27 is the base bark, and the tool had drawn it at 1.5 m, on the white trunk, and read 38.6 colour
  steps from its own source. It reads 5.96 at the zone's own height.
- `slots/silver-birch.json` frames still 20 as the whole autumn tree, which the tool's number rule
  had drawn as a limb in winter, still 35 on a catkin twig, and still 28 on wood inside the young
  bark's radius. It also carries each daylit picture's light, daylight as 1.33 times the sky's own
  strength as stills 01 and 02 measure it.

## Consequences

The species' budgets at every tier, measured on this record:

| Tier | Kit | Variant | LOD0 | LOD1 | LOD2 |
| --- | --- | --- | --- | --- | --- |
| low | 2.46 MB | 5.67 MB | 1,199,189 | 77,306 | 35,537 |
| medium | 3.81 MB | 5.76 MB | 1,223,952 | 81,428 | 36,110 |
| high | TBD | TBD | TBD | TBD | TBD |
| ultra | TBD | TBD | TBD | TBD | TBD |

Limits this record states:

- The mature crown of still 33 cannot reach that picture's sky gap of 0.057 inside the tree caps.
  The card levels draw a row for each shoot and the caps hold about eight thousand rows, so a crown
  seventeen metres across carries about a quarter of its photograph's leaf area. The alternative
  tried was long shoots on few rows, which the kit cap refuses.
- Still 20's autumn photograph lets 0.098 of its crown box show background where stills 01 and 02
  let 0.177 and 0.167 show. One grown plant cannot sit inside all three bands, and the species'
  record follows the summer whole views.
