# D-337: the architectural grower builds a conifer from one leader and whorls of boughs

Status: decided and built as `grow/architectural.ts`, with the Scots pine as its first species. The
grower, its envelope cap, its pipe radii and its bud sites are in place, and the pine's twelve rows
are measured under [Consequences](#consequences). Task: none.

Summary: A conifer need not compete for light like a broadleaf. One leader grows to the measured
height. Rings of boughs leave it at the record's spacing. Each bough, branch and twig takes its
length and angle from its position in the crown. It stops at the species' envelope, and its girth
comes from the pipe model fitted to the trunk. The shoot prototypes stand on the finest axes.

## Question

How does the first conifer grow a bare bole under a flat crown of separate needle plates? Its
whorled limbs must read as its own species. It must grow inside the same 600 ms that
`core/caps.ts` allows a tree.

## Rule

The plant core's acceptance for a growth model ([D-323](D-323-plant-core-three-scales.md)) is a
skeleton that divides into its orders. Its crown must stay inside the species' outline, its bytes
must match on every engine, and it must grow within the time cap. The Scots pine adds a leader that
reaches its height, three orders below it, and a crown base at the share its pictures give.

## Data

The Scots pine at seed 11, variant 0, grows 1 leader, 540 axes and about 6,400 bud sites. It
stands 19.14 m tall, and its crown base is at 0.52 of the height. The fitted envelope comes from 32 views of `pine-turntable.mp4`. Its own outlines overlap those
views by 0.70 at their mean, so it stands as a cap rather than a target.

The reference's twelve rows are measured in `pine-r35`. The whole views give a shape IoU of 0.29,
0.32 and 0.34. Their crown-box gap is 0.41 and 0.48 against the photographs' 0.19 and 0.26. Their
leaf color difference is 9.4 and 13.8. The plant stands 20.56 m tall and 19.54 m wide. The young form gives a shape IoU of 0.60. The close and bark views
and the rows that fail are listed in the species' review record.

## Look

- **A whorl is one year's growth.** The leader's nodes carry rings at the record's spacing, each
  with its boughs spread evenly round it and turned a little from ring to ring. The rings stand far
  enough apart that their foliage reads as separate plates with sky between them. Small boughs
  between the rings break the candelabra, as the reference's irregular limbs do.
- **Position in the crown sets each axis.** A bough's length and angle come from its height in the
  crown, and its branches and twigs from their position along it. The lowest boughs run out longest
  and the upper ones shorten, which gives the flat-topped umbrella.
- **A measured outline is rounded toward its mean.** The hull is as irregular as the views it came
  from. The grower blends each height's radius half the way to the mean of its azimuths. The
  narrow sides lift, the widest stays within the reference's own spread, and no view draws a crown
  half the width of its neighbor.
- **The envelope caps the wood, not the leaves.** Each axis marches out until its next step would
  leave the outline, and stops on the boundary. The shoot reach is kept clear first, so the needles
  fill the last hands of the outline.
- **The pipe model sets the girth.** Every terminal axis carries one pipe. The loads sum down the
  tree, and the radii are fitted to the species' diameter at breast height. Each axis keeps a share
  of its own girth from node to node, so a fork never draws as a cone.
- **Bud sites stand on the finest axes and at every tip.** A lateral bud sits on the bark beside
  its twig; a tip carries a terminal bud. The shoot instancer places the species' brushes. Its
  per-meter curve and clumping make the crown's plates.
- **A thin leaf needs a finer card.** A pine needle is 1.6 mm across, under one texel of the default
  64-texel card cell, so its card would draw only the bare twig. The record may name a cell of 64,
  128 or 256 texels at each tier. The pine takes 128 at the high tiers, which costs four times the
  card atlas memory and keeps the crown green at distance.

## Decision

Grow conifers by the architectural model. One leader carries whorls of boughs at the record's
spacing. Positional curves give each axis its length and angle, and sag and upturn bend it. The
envelope caps it, the outline is rounded toward its mean, and the pipe model gives it its girth.
Bud sites stand on the finest axes. A record
may name the card cell at each tier, from 64 to 256 texels. The Scots pine settles the numbers.
Rejected: the self-organizing grower for a pine, whose competition fills a dome. It cannot leave the
long bare bole and the flat separate plates.

## Consequences

- `grow/architectural.ts` holds the grower. `grow/envelope.ts` holds `smoothedVolume`, and
  `grow/envelope.test.ts` checks it. `grow/architectural.test.ts` holds one leader and the bud
  sites. It also checks the chain of every axis to a stem, the same bytes twice and the envelope cap.
- `lod/card-bake.ts` reads `lod.cardCell`, and `lod/cards.test.ts` checks the finer atlas.
- The Scots pine's record, envelope, textures and review slot live under its species folder, the
  textures package and `tools/lib/plant-review/slots/`. Its leaf is the fascicle: stills 11 and 12
  frame the pair, and row 4 reads the bundle's width and shape against the single needle.
