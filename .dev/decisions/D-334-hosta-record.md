# D-334: the hosta, a ribbed herbaceous rosette, and what a herb asked of the plant core

Status: decided and built: the hosta's record, its leaf textures, the pressed thick leaf, the stalk's
sky floor and the review camera's floor. The review fails the species on its openness and on the two
pictures whose subject the model cannot draw; the figures are under [Consequences](#consequences).
Task: none.

Summary: the plant core grows the hosta, the catalogue's first broad-leaved herbaceous rosette: a
clump of broad, deeply ribbed leaves on long channelled stalks from one crown at the soil, pale
lilac flowers on bare scapes, and leaves that collapse flat and yellow in autumn. The rosette growth
model and the thick leaf already named the species; what it needed was a leaf that its single-leaf
photograph could lay flat, a stalk the crown did not draw black, and a review camera that could
stand lower than a person's knee.

## Question

The catalogue's first herb is a hosta (*Hosta*, a plain green garden form near *H. ventricosa*). Its
record must pass the twelve rows of the [plant review](../plant-review.md) against its own reference
set. What must the plant core grow that the oak's and the ash's records could not ask for, and which
figures does the hosta's own record set?

## Rule

- A species passes only when every row passes on every reference picture
  ([plant review](../plant-review.md)). Row 6 is a band in both directions: a crown denser than its
  reference fails as surely as a thinner one.
- A behavior that another species could need sits behind an optional record field with a doc
  comment, a unit, a range check and a test. A change that only a herb makes states why.
- Every number in the record carries a comment naming the photograph it came from.
- Every budget holds at every tier, and the owner's caps for a ground plant are not raised for this
  species ([D-330](D-330-oak-crown-by-its-own-light.md)).

## Data

### What the hosta is

The reference set holds twenty-six stills and five videos. Its own index says the rubric's rows
shift for a plant with no wood: the "trunk" is the bundle of petioles, "bark" is the petiole's
surface, and the crown at the soil replaces the root flare.

| Trait | Pictures | The record's field |
| --- | --- | --- |
| One crown at the soil, its leaves on long stalks | 01, 02, 03, 21 | `growth`, the `rosette` model |
| Broad, deeply ribbed blades | 08, 09, 11, 24 | `foliage`, the `thick` kind, its `ribs` |
| The blade laid flat for its single-leaf picture | 11, 12, 24, 25 | `cuttings.leaf.pressed` |
| Pale lilac funnels on bare scapes | 18, 19 | `growth.scapes` and `extras` |
| Leaves yellow and flat in autumn, nothing in winter | 20 | `seasons`, `growth.collapse` |

### What the plant core had to grow

| Gap | Pictures | The change |
| --- | --- | --- |
| A single-leaf picture lays the leaf flat, and only a blade leaf could be pressed | 11, 12, 24, 25 | `CutLeaf.pressed` now presses a thick leaf too, and `CutLeaf.petiole` names the short stalk its picture shows |
| A stalk under its own shoot's leaves took the crown's sky, near zero, and drew black | 21, 22, 23 | `StemRun.leastSky`, and a leaf's stalk takes a fifth of the sky |
| A plant under a metre tall asked for a camera lower than the review floor allowed, so the fallback stood closer than the framing asked and clipped the plant | 01, 02, 17, 30 | the review's `LOWEST_EYE` falls from 0.30 m to 0.12 m |
| A thick leaf's near-level grid cost most of the cap, and the reference's mound needs more leaves than the cap allowed | 01, 02, 04 | two and a fifth columns a rib at high, three and a half at ultra, instead of two and a half and four |

### The choices

| Choice | Field and the hosta's value | Pictures | Presses on |
| --- | --- | --- | --- |
| A mound about 1.8 times as wide as tall | `size.aspect` 1.5, the fitted figure; the drawn plant measures 1.63 to 1.86 | 01, 02, 17 | Row 9, the all-round band |
| Six eyes on the crown, eight or nine leaves each | `growth.shoots` 6 ± 1, `growth.leaves` 8.5 ± 1 | 04, 21 | Variant bytes |
| The leaves' spiral | `growth.divergence` 137.5, `growth.tilt` and `arch` by leaf age | 04, 21, 23 | Rows 2 and 5 |
| Stalks 26 to 36 cm | `growth.stalk` by leaf age | 22: the stalks sheathe one another on a piece of crown | The mound's reach |
| Blades 30 cm on a 0.3 m spread | `foliage.leaf.length` 0.3 ± 0.03 | 11, 24: 20 to 30 cm long, about three quarters as wide | Row 4 |
| Eight vein pairs as pleats | `ribs` 8, depth 0.32, sweep 0.3 | 08, 09: the veins stand proud between pleats | Near-level triangles |
| Both faces' measured colour | `optics` 0.081, 0.188, 0.017 over and 0.338, 0.427, 0.144 under | 24, 25: the texture sources' measured means | Rows 4 and 10 |
| Lilac funnels on one side of a bare scape | `extras` flowers, six petals, 4.4 cm, 0.55, 0.45, 0.78 | 18, 19 | Blossom bytes |
| Autumn collapse | `seasons.autumn` and `growth.collapse` 35 degrees | 20 | Row 10 |

### The reference files

The figures are those of run `RUNDOC` at `COMMITDOC`, seed 11, variant 0, preset high. The sky gap
is the share of the crown's own box that shows background; the band is five hundredths above and two
below the reference's. The outline compares the two silhouettes scaled to the same height, with a
guide of 0.75. Colour is CIEDE2000, where about 2 is one visible step.

TABLE

## Look

Set the whole view beside its photograph and the first thing that gives the render away is the
photograph's shingled shell of blades against the render's fountain of leaves on visible stalks. The
blades themselves read as the species: the ribbed surface, the heart-shaped base and the short point
are the photograph's, and the two texture sources sit within two colour steps of their pictures.

## Decision

The record is the hosta's own, and the four changes above are built on it. The alternatives were a
leaf held in its plant shape (outline overlap 0.26 against the photograph's 0.85 pressed flat), a
crown camera that clipped the plant at every edge, and a grid fine enough that the owner's cap held
forty leaves against the reference's fifty.

## Consequences

- The hosta is a species folder with its record, its texture folder and its review slot file, and it
  appears in the species page and in the picture tests.
- A thick leaf can be pressed for its single-leaf picture, and its stalks keep a fifth of the sky.
- The review's camera floor lets a herb stand in its photograph's framing.
- The limits the review still finds are listed above with their figures. Each needs its own round.
