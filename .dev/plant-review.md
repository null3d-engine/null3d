# Plant review

A species is judged by a reviewer who wrote none of its work, against the reference set for that
species, row by row. This page states the standard, the eleven rows, the coverage rules and the
process. `.dev/plant-references.md` says how each measure works and what it cannot see.

## The rule

A species is judged as though it will be seen close up. Its anatomy, its branch subdivision in three
dimensions, its leaf clusters, its bark and its crown have to match the real plant, because a viewer
will walk up to it. A render that reads as a tree from twenty meters and as a bundle of cards from
two has failed, whatever it looks like from far away.

A species passes only when its structure, anatomy, appearance and quality match every reference
picture it has. Not a majority, and not the ones that flatter it. One failing row fails the species.

A species must also resemble its reference from a distance, and that is judged on shape, not on
color. Put the two whole views side by side and compare the silhouettes: where the crown's outer edge
runs, how far the widest part sits below the top, how far the lowest limbs reach, what angle the
major limbs leave at, how much trunk shows before the first fork, and whether the mass is one dome, a
vase, a spire or a set of separate pieces. Two pictures can hold the same colors and the same share
of foliage and still be different trees. A pixel-difference figure or a color match is not this test
and never substitutes for it.

Each species needs at least twenty reference pictures, most of them taken near the plant. They cover
the whole habit at distance and in profile, the crown from outside and from underneath, the major
limbs where they leave the trunk, how a limb forks and how it subdivides again, the fine twig
structure, leaf clusters at the end of a shoot, single leaves on both faces, bark at the base, at
mid-trunk and on a limb, the trunk's taper and root flare, and the silhouette. The set also carries
turning videos and usually a wind clip.

## The eleven rows

| # | Row | What is judged | Evidence |
| --- | --- | --- | --- |
| 1 | Structure | The skeleton: one stem or many, where the first limbs leave, the angles they leave at, how they fork, where the crown begins, and whether the silhouette is one solid shape or a set of pieces | The whole view against its reference, plus the skeleton view |
| 2 | Branch density | How many branches there are, how they are spaced along the trunk, and whether the spacing follows the species: whorled tiers for a conifer, alternate for a broadleaf, a fan for a palm | The skeleton view, counting the visible limbs |
| 3 | Branch length and taper | Whether a branch reaches far enough before it forks, and whether it thins along its length | The skeleton view and a close view of a limb |
| 4 | Leaf shape | The painted silhouette of one leaf: entire, toothed or lobed, its proportion, its tip and its base | The leaf close-up against the reference leaf picture |
| 5 | Leaf cluster density | How many leaves a cluster carries, how tightly they sit, and how a cluster meets its shoot | The leaf close-up and the crown close-up |
| 6 | Foliage density | How much of the crown's volume the foliage fills, and whether the gaps fall where the species puts them | The whole and crown views against the reference's own openness |
| 7 | Bark curviness | Whether the trunk and the limbs run straight, bend or curve, and whether the bark's surface reads as its own species | The skeleton view, and the trunk and limb close views |
| 8 | Bark color and texture | Whether the bark's color and figure match the species, or whether it is generic tinted bark | The trunk at close range: base, mid-trunk and limb |
| 9 | Proportions | Height against width, the crown's share of the height, and the trunk's diameter against its height | The whole view, measured rather than eyeballed |
| 10 | Color and season | Whether the foliage's color is the species' own, and whether a season variant is a variant of that color rather than a different hue pretending to be one | The whole view |
| 11 | Distinctness | Whether the species can be told from its nearest neighbor in the catalogue by silhouette alone | The two whole views side by side |

Row 11 is judged against a built neighbor, named in the verdict. A species with no built neighbor
states that instead of passing.

## Coverage

A plant's appendages are spread around its three dimensions in equal proportion, so that turning
around it never shows a lopsided tree. A crown that is full from the front and thin from the side, or
a set of limbs that all leave in one plane, fails even when every other row passes, because a viewer
walks round it.

The exception is a plant that is normally lopsided. It is named per species and never assumed: a
wind-sculpted tree, a willow leaning over water, a plant grown against a wall. A species claiming the
exception says so in its record and says why.

The same species is drawn at eight equal angles, and two figures are measured at each.

- **The crown's box is the rule.** Its width and height are the widest and tallest run of foliage in
  the picture, measured per angle. The largest and smallest of each must fall inside a tolerance that
  the growth form sets: 15 per cent either way for a conifer, 25 per cent either way for a broad dome
  or an open crown. A species of another form takes the broader band unless its reference shows a
  regular outline.
- **When the reference is less regular than the band, the reference sets the band.** A render more
  regular than its own reference is not a fault. The reviewer states the reference's spread beside the
  render's whenever it uses this.
- **The foliage area is a note, not a pass mark.** It says how solid the crown reads from each side.
  It moves with the orientation of the cards rather than with the plant's balance, so an open crown's
  area swings widely while its outline does not.

Every reference file must be compared, at its own angle for a video. A run that leaves a file
undrawn fails the species for coverage, whatever the rows say.

## What a fail looks like

Each of these is a fail on its own, and each is a fault an earlier standard let through.

- A crown whose silhouette is a different shape from the reference's, whatever the foliage does.
- Limbs that bend or fork differently from the reference's.
- Cards visible as cards at close range, or a branch that reads as a bundle rather than a limb.
- A trunk of the wrong proportion or taper, or a bark figure that is a pattern rather than bark.
- A part that hangs from nothing. A fruit, a flower or a catkin must meet the wood it grows from, in
  the record and in the picture. A part that floats has a sound outline, color and edge mixture, so
  no single figure catches it: the reviewer looks at what it is attached to and says so.

## What the reviewer reports

For each species: pass or fail, row by row, with the picture that shows it and the figure where a
number exists. Then one sentence for the species as a whole. Faults are listed in the order the owner
would notice them, not the order they are cheapest to fix.

A reviewer does not accept an argument about what a species should look like without a reference
picture or a measurement that shows it. A claim without evidence is a row left unjudged, and unjudged
is not passed.

Limits are reported singly, each with its figure, its reason and the alternative that was tried. A
limit is never a reason to stop work on the pictures it names.

## The process

1. **Draw a clean run.** The working tree must be clean, because the manifest names the commit it was
   drawn at and a reference holds only for the tree that drew it. Name every part: stills, every
   turning video and the wind clip.
2. **Record the run** in the species review file: run name, manifest commit, seed, variant and preset.
3. **Judge** row by row, against the run's own figures and the reference pictures.
4. **Write the verdict** to the species review file, with the pass list for the next round in priority
   order.
5. **Hand back.** A species is done when every row passes, or when each limit it misses is stated with
   its measured reason. The reviewer accepts a limit; it does not accept a limit as a reason to stop.

The reviewer is independent: it wrote none of the species' work. The figures it quotes name the commit
they were measured at, and a figure from another base is a note, not evidence.
