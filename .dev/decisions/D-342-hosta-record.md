# D-342: the hosta, a ribbed herbaceous rosette, and what a herb asked of the plant core

Status: decided and built: the hosta's record, its leaf textures, the pressed thick leaf, the stalk's
sky floor and the review camera's floor. The review passes seven of the twenty-six stills outright,
and it fails the species. The whole views are a tenth of sky too open. The pieces are a twentieth
too dense. Four pictures show a subject the model does not draw. The figures are under
[Consequences](#consequences). Task: none.

Summary: the plant core grows the hosta. It is the catalogue's first broad-leaved herbaceous rosette.
The plant is a clump of broad, ribbed leaves on long stalks from one crown at the soil. Pale lilac
flowers stand on bare scapes. The leaves collapse flat and yellow in autumn. The rosette growth model
and the thick leaf already named the species. Three things were still missing. A leaf that its single-leaf
photograph could lay flat. A stalk the crown did not draw black. A review camera that could stand
lower than a person's knee.

## Question

The catalogue's first herb is a hosta (*Hosta*, a plain green garden form near *H. ventricosa*). Its
record must pass the twelve rows of the [plant review](../plant-review.md) against its own reference
set. Two questions follow. What must the plant core grow that the oak's and the ash's records could
not ask for? And which figures does the hosta's own record set?

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
shift for a plant with no wood. The "trunk" is the bundle of petioles, and "bark" is the petiole's
surface. The crown at the soil replaces the root flare.

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
| A plant under a meter tall asked for a camera lower than the review floor allowed, so the fallback stood closer than the framing asked and clipped the plant | 01, 02, 17, 30 | the review's `LOWEST_EYE` falls from 0.30 m to 0.12 m |
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
| Both faces' measured color | `optics` 0.081, 0.188, 0.017 over and 0.338, 0.427, 0.144 under | 24, 25: the texture sources' measured means | Rows 4 and 10 |
| Lilac funnels on one side of a bare scape | `extras` flowers, six petals, 4.4 cm, 0.55, 0.45, 0.78 | 18, 19 | Blossom bytes |
| Autumn collapse | `seasons.autumn` and `growth.collapse` 35 degrees | 20 | Row 10 |

### The reference files

The figures are those of run `final-3` at `1d3fe976`, seed 11, variant 0, preset high. The sky gap
is the share of the crown's own box that shows background; the band is five hundredths above and two
below the reference's. The outline compares the two silhouettes scaled to the same height, with a
guide of 0.75. Color is CIEDE2000, where about 2 is one visible step.

| Reference | Judged | Deciding figures |
| --- | --- | --- |
| `01-whole-plant-distant.png` | Fail | Sky gap 0.21 against the photograph's 0.11, 0.10 above the band; outline 0.69; width error 0.124; leaf color 3.7; 2 pieces where the photograph shows 1 |
| `02-whole-plant-profile.png` | Fail | Sky gap 0.19 against 0.13, 0.06 above the band; outline 0.56; leaf color 4.9 |
| `03-whole-from-below.png` | Unjudged | Framed inside the crown, as a rosette has no stem to look up; edge directions 0.170 |
| `04-rosette-from-above.png` | Pass | Sky gap 0.08 against 0.10, inside the band; outline 0.39; leaf color 7.6 |
| `05-underside-of-leaves.png` | Unjudged | Framed inside the crown; edge directions 0.173 |
| `06-inside-rosette.png` | Unjudged | Framed inside the crown, the petioles' own view; edge directions 0.166 |
| `07-leaf-base-and-petiole.png` | Fail | The view frames a corner of the crown, not the blade's base: the render's box is 0.70 sky against 0.05 |
| `08-leaf-surface-ribs.png` | Unjudged | Framed as the whole plant, as the model has no fork view; edge directions 0.209 |
| `09-vein-network.png` | Unjudged | As 08; edge directions 0.225 |
| `10-leaf-margin-detail.png` | Fail | The photograph is a magnified margin and the view draws a leaf piece: width error 3.32 |
| `11-single-leaf-upper.png` | Pass | Outline 0.85; width error 0.064; leaf color 6.7 |
| `12-single-leaf-underside.png` | Pass | Outline 0.78; leaf color 6.3 |
| `13-crown-and-roots.png` | Fail | 9 pieces in the photograph and 0 drawn: the model has no root system and no above-ground crown |
| `14-petiole-section.png` | Fail | 1 piece in the photograph and 0 drawn: a section of a stalk is a drawing convention, not a surface |
| `15-petiole-base.png` | Unjudged | Framed inside the crown; edge directions 0.179 |
| `16-young-hosta-plant.png` | Unjudged | Drawn in the record's young form; edge directions 0.123 |
| `17-silhouette.png` | Fail | Sky gap 0.19 against 0.13, 0.06 below the band: the render is denser than the photograph |
| `18-flower-scape.png` | Fail | The photograph is one bare scape against sky and the view draws the whole plant in flower: gap 0.17 against 0.53; outline 0.26 |
| `19-flower-detail.png` | Fail | Outline 0.12; leaf color 6.8; 3 pieces where the photograph shows 1 |
| `20-autumn-collapse.png` | Pass | Sky gap 0.21 against 0.19, inside the band; outline 0.24; leaf color 12.1 |
| `21-branch-studio.png` | Pass | Sky gap 0.22 against 0.25, inside the band; outline 0.33; leaf color 7.4 |
| `22-subbranch-studio.png` | Fail | Sky gap 0.23 against 0.20, 0.03 below the band; outline 0.26 |
| `23-leaf-cluster-studio.png` | Fail | Sky gap 0.23 against 0.22, 0.01 below the band; outline 0.42 |
| `24-leaf-texture-upper.png` | Pass | Outline 0.81; leaf color 2.1 |
| `25-leaf-texture-underside.png` | Pass | Outline 0.80; leaf color 1.2 |
| `30-whole-with-landmark.png` | Fail | Sky gap 0.20 against 0.12, 0.08 above the band; outline 0.67 |
| `branch-turntable.mp4` | Fail | Mean outline 0.224, lowest 0.073 |
| `hosta-turntable-halfturn.mp4` | Fail | Mean outline 0.640, lowest 0.501; the crown box's spread 32 per cent wide and 133 per cent tall against the reference's 6 and 4 |
| `leaf-cluster-turntable.mp4` | Fail | Mean outline 0.266, lowest 0.107 |
| `subbranch-turntable-halfturn.mp4` | Fail | Mean outline 0.258, lowest 0.079 |
| `hosta-wind-motion.mp4` | Fail | The render's frames do not differ, so the motion reads 0.000 in every band against the reference's 0.03 to 0.15 |

Every one of the 31 reference files in use was drawn and compared, so coverage passes.

The species fails its review. Seven stills pass outright. The from-above and autumn views sit inside
their bands. The two whole views fail by a tenth of sky. The pieces fail by a twentieth. Four
pictures show a subject the model does not draw.

## Look

Set the whole view beside its photograph. The first thing that gives the render away is the
photograph's shingled shell of blades against the render's fountain of leaves on visible stalks. The
blades themselves read as the species. The ribbed surface, the heart-shaped base and the short point
are the photograph's. The two texture sources sit within two color steps of their pictures.

## Decision

The record is the hosta's own, and the four changes above are built on it. A leaf held in its plant
shape was rejected: its outline overlap was 0.26, against 0.85 pressed flat. A crown camera that
clipped the plant at every edge was rejected too. So was a grid fine enough that the owner's cap held
forty leaves, against the reference's fifty.

## Consequences

- The hosta is a species folder with its record, its texture folder and its review slot file. It
  appears in the species page and in the picture tests.
- A thick leaf can be pressed for its single-leaf picture, and its stalks keep a fifth of the sky.
- The review's camera floor lets a herb stand in its photograph's framing.
- The rows still failing, each with the round its figure names:
  - **Row 6, openness.** The whole views draw 0.21 and 0.19 of sky against 0.11 and 0.13. That is a
    tenth and a sixteenth too open. The from-above view draws 0.08 against 0.10, and the silhouette
    0.13 against 0.19. The two sides of this row want opposite changes of one figure. More leaves
    close the sides and over-close the top. The owner's cap for a ground plant holds the variant at
    1.62 MB of 1.70. The forty-nine leaves it carries cannot grow into the reference's fifty-odd.
  - **Rows 3 and 5, the pieces.** The three lifted pieces draw 0.22, 0.23 and 0.23 of sky against
    0.25, 0.20 and 0.22. The sub-branch and the cluster are a twentieth too dense.
  - **Rows 7 and 8, the petiole's surface.** Stills 13 and 14 show the lifted crown with its fleshy
    roots and one stalk cut across. The model draws no root system and no above-ground crown. A
    section of a stalk is a drawing convention rather than a surface, so both render nothing.
  - **Row 4, the leaf surface.** Still 10 magnifies the margin. The review has no view that frames a
    part of a leaf. Its figure compares a whole leaf against a magnified edge, which cannot be read.
  - **Row 10, the wind.** The wind clip's frames do not differ on some runs. On others they move
    three to ten times the reference, with no setting between. The measure is not yet repeatable on
    this machine, so the motion test cannot judge the species. The figures are 0.000 and 0.39 to
    0.69 against the reference's 0.03 to 0.15.

Every limit above is a round of its own, not a reason to stop. The next round takes the whole views'
openness, which is the row the owner would notice first.
