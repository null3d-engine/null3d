# D-306: the self-organizing grower fills a measured envelope by light, and gives resource only to the buds that flush

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

The plant core's acceptance for the grower ([D-305](D-305-plant-core-three-scales.md)): the oak
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
