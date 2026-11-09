# D-320: the self-organizing grower fills a measured envelope by light, and gives resource only to the buds that flush

Status: decided. The grower, its shadow grid, its envelope, shedding, pipe radii, bending and the
crown's light for the shoot rows are built. Task: none.

Summary: Broadleaves, pines, shrubs and hedges grow by Palubicki's self-organizing model with
Stava's bud fate, in a shadow grid whose only light lies inside an envelope measured from the
species' reference turntable. The pedunculate oak's test record fills its envelope with an IoU of
0.884 to 0.919 at eight angles in three variants, and grows in about 300 ms of one core warm.

## Question

How does a self-organizing plant grow so that it fills its reference silhouette from every side,
with a trunk, limbs and twigs that read as its species, the same bytes on every engine, within the
600 ms that `core/caps.ts` allows a tree?

## Rule

The plant core's acceptance for the grower ([D-323](D-323-plant-core-three-scales.md)): the oak
record's silhouette within its envelope at an IoU of 0.85 at eight angles; at least three macro
orders; a sweep of the apical control gives one leader and a spreading crown; shedding clears the
bole; bud sites carry resource and light; identical bytes in Bun and in a worker; growth within
600 ms in Bun.

## Data

| Measure | Variant 0 | Variant 1 | Variant 2 |
| --- | --- | --- | --- |
| IoU with the envelope, eight angles, lowest | 0.901 | 0.884 | 0.900 |
| IoU with the envelope, eight angles, highest | 0.919 | 0.911 | 0.916 |
| IoU with the reference turntable, eight angles | 0.71 to 0.85 | 0.73 to 0.84 | 0.72 to 0.85 |
| Nodes, axes, bud sites | 7,933, 2,654, 4,837 | 7,733, 2,562, 4,884 | 11,727, 3,783, 7,649 |

The envelope itself scores 0.72 to 0.89 against the same reference frames: the generated turntable's
tree drifts between views, so no single solid matches every frame, and the grown oaks come within
about 0.05 of that ceiling.

| Apical control λ (round test envelope) | 0.36 | 0.44 | 0.52 | 0.6 |
| --- | --- | --- | --- | --- |
| Stem reaches, share of the height, three variants | 0.36 to 0.51 | 0.69 to 0.83 | 0.85 to 0.96 | 0.86 to 1.00 |

Growth time: 280 to 460 ms of one core warm, 500 to 730 ms on the first growth of a process, which
includes compiling the code, on the Mac with every core busy with other work.

How the data was produced: the oak's envelope is the visual hull of 32 views of
`oak-turntable.mp4`, one every 11.25 degrees: each frame's tree is masked from the sky and the grass
by colour, scaled to its own height with the trunk at the centre, and bounds the crown in a slab
across the view at each height; the radius at each of 16 azimuths is the third-nearest bound, which
passes over the few views where the generated tree drifts. The silhouettes are the grower's
`skeletonSilhouette` and `envelopeSilhouette` at 96 cells over the plant's height, with each shoot
drawn as a disc of the species' mean shoot reach at its bud site and along the finest axes at the
species' shoots per metre, as the shoot instancer places them. `grow/self-organizing.test.ts`
measures the envelope figures; the reference figures came from the same silhouettes against the
masks of frames 1, 25, 49 and so on of the turntable.

## Look

- **Resource only to the buds that flush.** Palubicki's resource goes to every bud and a bud grows
  when its share reaches one internode; Stava's bud fate decides first which buds flush. Combined
  the first way, the dominated buds took most of the resource and grew nothing, and the oak stopped
  at 141 nodes. The stems' resource is still in proportion to the light of every bud, but it is split
  only among the buds that flush, so the crown fills its envelope (IoU 0.06 before, 0.89 after).
- **Steering by contrast of light.** A shoot leans toward the open cells around it by how much
  brighter each is than their mean. Weighting by light alone pulled every bud near the outline back
  inward, and the outer branches ran round the crown's surface in hoops; by contrast they keep their
  line and stop at the outline, which reads as the oak's angular limbs.
- **Stopping at the outline, not turning along it.** Shoots that turned along the outline drew the
  same hoops. A shoot stops where its next step leaves the envelope, with a last short internode
  where part of the step fits, so the crown reaches its outline.
- **A shoot turns aside from another axis's wood.** A record may give a `clearance` in metres and a
  `turning` in degrees. Where the next step would come within the clearance, the shoot tries
  headings at rising angles either side of its own. It takes the first that is clear and inside the
  envelope. It keeps to the side it turned to last, so it curves round the obstacle. It stops only
  where no heading within its most is clear. A new limb is weighed by its own order's girth, not
  the stem's. At seed 11, variant 0, a clearance of 0.3 m with a 30 degree turn cuts the node pairs
  inside the demanded distance. They fall from 30 to 16. The same setting holds the whole view's
  outline at 0.731, against 0.732 without the field. The review counts four pieces there, against
  one without the field: three leaf groups of 33 to 123 pixels stand under the crown. A clearance
  of 0.28 m with a 40 degree turn draws two pieces. The second is a leaf group of 41 pixels, and
  the outline holds at 0.745. No setting tried draws one piece. The oak's record sets neither field.
- **A card draws the twig it stands on.** A card's leaves may read as a piece in air where the
  twig under them is thinner than a pixel. A record may give `lod.cardStalk` in pixels. The card
  then draws a line from its bud site back along the stretch to the previous bud or the parent
  node. The vertex stage widens it to at least that many pixels across the twig's direction on
  screen. 0 or absent, a card draws no stalk. With a clearance of 0.28 m and a turn of 40 degrees,
  a stalk of 2 pixels brings the whole view to one piece. Its outline is 0.7469, against 0.7448
  without the stalk. Its sky gap closes from 0.1402 to 0.1354, against the reference's 0.1145.
  One pixel draws a broken line at that distance, so the piece stays. The other whole views close
  by 0.001 to 0.009, and no view gains a piece.
- **The clearance bites only where the wood is thick.** A record may give `clearanceThickness`,
  a share of the trunk's radius from 0 to 1. Wood below it does not keep the clearance, so thin
  twigs keep their own layout. With no floor, at a clearance of 0.3 m and a turn of 30 degrees,
  the whole view draws four pieces. Its outline is 0.7324 and its gap 0.1461. A floor of 0.35
  keeps the trunk, limbs and branches, and frees the twigs. It draws one piece, with an outline
  of 0.7344 and a gap of 0.1097 against the reference's 0.1145. The bole-and-crown test passes
  there. A floor of 0.5, the trunk and great limbs alone, draws seven pieces, 0.7072 and 0.1917.
  At 0.3 m the close pairs are nine fine and seven thick with no floor; fifteen and seven at
  0.35; sixteen and four at 0.5. Two axes that leave one node cannot be kept apart at any angle,
  so with fork siblings left out the tree without the clearance has twenty fine close pairs and
  ten thick: the rule's cut is thick wood's ten to seven, and the fine wood keeps its own layout.
  The oak's record takes a clearance of 0.3 m, a turn of 30 degrees and a floor of 0.35.
- **A lost leader hands on its role.** When an axis's leader bud died, the axis stopped there, and
  a stem whose leader died by chance below the crown left a stump with no shoot in the light to take
  over: 3 of 40 oaks at seed 11 died at 0 to 2.4 m (variants 8, 12 and 23). An oak replaces a lost
  terminal bud with the subterminal bud beside it. The grower now does the same: the live lateral
  bud at the axis's tip becomes its leader, turned in to the fork rule's narrowest angle from the
  axis's line, and a stem's leader below the crown is spared chance loss. No oak of the 40 dies.
  The relay is on unless a record turns it off; the stand-in species turn it off, so their frozen
  geometry stays the same.
- **The fork rule rights a shoot by its share of the wood.** An oak's thick forks leave at narrow
  angles, and its thin side branches at wide ones. The grown oak had about 300 thick forks a
  variant at 45 to 90 degrees. Each was a side shoot that took over from a withered leader, and
  the wood drew it as a mitred pipe. Now a side shoot that holds a fifth or more of its fork's
  wood turns toward its parent's line, while its own branch is still small. It turns by a few
  degrees a year, until it leaves at the rule's angle for its share. That angle is 80 degrees for
  the thinnest, 65 at a fifth and 15 once the shoot leads. Kinked growth goes with the rule. The
  wander kinks each internode about a heading that keeps half of it. A shoot then zigzags along a
  slowly drifting line, as an oak's shoots do; with all the wander in the heading, it drifted as a
  random walk. On six oaks at seed 11, no takeover leaves at over 35 degrees. No child of a fifth
  to three fifths leaves at over 65. The crown still fills its outline: 0.94 of the outline's
  reach in the low crown, and 0.95 over the whole. Rejected: narrowing each side shoot's opening
  angle by its share as it set out, which pulled the low crown in to 0.30 to 0.62 of the outline.
  Also rejected: turning grown limbs, which narrowed the crown.
- **The finest order branches on.** Side shoots past the deepest macro order keep that order. A
  strict cap made the deepest axes grow on for decades as long whips; with the cap on the order
  number alone, the outer crown branches as a tree does and the order count stays within the record.

## Decision

Grow by light and resource as above, in a shadow grid whose cell is the first year's internode or
larger, at most 96 cells across, updated as buds come and go. Shed side branches whose light per node
falls under the record's threshold, and those leaving a stem below the clean bole; a share stay as
stubs and their pipes stay in the wood below. Fit the pipe radii to the stem diameter at 1.3 m by
scaling each radius's excess over the twig's radius, so the twigs keep the record's radius and thick
forks keep the exponent's proportions. Bend the wood under its load, against a stiffness that grows
with the radius to the fourth, and turn the outer part of each axis back up by the record's share.

Rejected:

- **Space colonization markers in the envelope.** Their light is all or nothing, so shedding does
  not work with them (Palubicki et al. 2009, section 4.4), and the crown loses its hollow inside.
- **Scaling the grown plant to its height.** A uniform scale moves the outer branches out of the
  envelope; the grower reaches the envelope's top by growth instead.
- **A power law fit of the radii.** Raising every radius to one power fits the stem and keeps the
  twigs, but makes the record's exponent meaningless.

## Consequences

- `grow/self-organizing.ts`, `grow/envelope.ts`, `grow/stems.ts`, `grow/radii.ts`, `grow/bend.ts` and
  `crown/light-grid.ts` hold the grower. `grow/oak.fixture.ts` holds the oak's growth numbers and
  envelope for the tests, which the oak's species record copies.
- A skeleton's axes leave their parent node with `parentT` 0, and a child's first node is one
  internode out. Every axis but the record's stems has a parent whose chain reaches a stem: a stub
  stays only while the wood it stands on stays. One season can shed a branch and cut a branch on it
  back to a stub. That stub, and a stub on a stub, goes with the branch it stands on. Kept, it would
  float in the air with no parent, which the wood mesher skips. Without this rule the oak (seed 11)
  held 139 to 146 such stubs a variant. A unit test holds every axis of the oak at four seeds and
  three variants to a chain that reaches a stem, and the stems to the record's count. Node radii are pipe radii only; the wood mesher adds collars and flare.
- The crown's light (`crown/density.ts`, `crown/visibility.ts`) gives each shoot row the sky it sees
  through the leaf area of the other rows, 0 to 250, and a bent normal as an octahedral byte with Y
  up (x in the high four bits, z in the low four, a nibble n reading back as n / 7.5 - 1). The wood
  reads the same grid through `crownSkyAt`.
- A species' envelope comes from its turntable by the method above until the fitting tools
  measure it.

## A stool of stems in the open

A record may grow several stems from one stool. `StemSpec` gives `count`, `lean`, `stool` and
`fused`. Each stem stands on the plant's ring and takes its own flare, buttress and roots. The
stems share one light grid and one resource.

The rule that a stem's leader sees full light below the envelope's base is written for one stem.
It is a bole under its own crown. A stool's stems are separate trunks in the open below the
plant's first fork. The holm oak's reference has its lowest leaf at 0.09 of the height. So the
stems lost their light shelter there and competed from the bottom. Two of eight stems kept a girth
over 1 cm at 1.3 m.

The grower now shelters a stem's leader below the first fork when the plant has several stems.
That case needs `starts.length > 1` and a `divide`. Without them, the shelter ends at the
envelope's base as before. A single stem takes the second branch of the condition, so its growth
is byte for byte the old growth. The oak's records and tests do not change. The test
`grow/self-organizing.test.ts` grows a stool of eight stems with and without a fork. It requires
more stems with a trunk at 1.3 m when the fork is present.

At seed 11 on the holm oak's record, variant 0, the stems over 1 cm at 1.3 m went from 2 of 9 to
6 of 9. Variant 1 went from 4 to 7 of 8.

Rejected:

- **A larger `stems.count`.** Twelve stems did not raise the share of thick stems.
- **A wider shadow.** It made the crown run away and was stopped before a render.



The fused run grows straight up from the stool and the bud keeps that line, so a stem's lean was
lost above the fused length. The grower now gives a stem its lean back once it clears the fused
run; a single stem keeps `fused` 0 and takes no new path. The holm oak's stems then stand together
at the stool and splay above it into the wider envelope.

The stems of a stool fork at heights in an even stair round the record's divide height, each within
a fifth of it. A ring that forks on one plane heaps its limbs into one band of the shadow grid: the
first year's limbs shade each other to nothing, the shed rule removes them, and the plant stops at
its fork. At seed 11 on the holm oak's record, variant 5 stood 3.10 m tall against 8.36 m for
variant 0. With the stair it stands 7.4 m, and thirty plants over five seeds and six variants all
pass 6.5 m. One stem forks at the record's height, so a single-stem plant takes no new path: the
oak's eighteen skeletons at three seeds and six variants keep their digests.

A stool's clean bole clears every branch that starts below the bole height, and every branch whose
tip hangs below it. One stem keeps the older rule, which clears only the branches that leave the
stem itself. A chain of fine twigs can otherwise dive from the crown and hang in the open beneath
it: on the holm oak, one variant's lowest foliage stood at 0.47 m where its siblings stood at 2.6 to
2.9 m, and it carried more shoots than any other. With the stool's rule the six crown bases sit at
0.24 to 0.32 of their heights, and the oak's eighteen skeleton digests stay as they were.
