# D-346: the architectural grower builds a conifer from one leader and whorls of boughs

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

The Scots pine at seed 11, variant 0, grows 1 leader, 358 axes, 3,874 bud sites and 5,885 shoots.
It stands 19.14 m tall with its crown base at 9.36 m, and its three levels measure 94,299, 99,043
and 33,621 triangles. The fitted envelope comes from 32 views of `pine-turntable.mp4`. Its own
outlines overlap those views by 0.70 at their mean, so it stands as a cap rather than a target.

The first verdict round is `pine-r35`, at which 3 of the 12 rows passed. It predates the rim-twig
rule below, which removes only the few twigs that stood up to 0.13 m outside the drawn outline; the
plant's other figures stand. The crown-fill rounds after it are `pine-r38` to `pine-r46`; the last
of them gives whole-view shape IoUs of 0.54, 0.56 and 0.64, crown-box gaps of 0.17, 0.15 and 0.16
against the photographs' 0.19, 0.26 and 0.19, and leaf color differences of 6.5, 12.3 and 8.1.
The species stands down under the owner's ruling until the twelve existing species are complete;
its open rows and their causes are in the species' review record.

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
  leave the outline, and stops on the boundary. An axis whose parent already stands on the outline
  takes no step beyond it, so a rim twig never stands outside the crown. The shoot reach is kept
  clear first, so the needles fill the last hands of the outline.
- **The pipe model sets the girth.** Every terminal axis carries one pipe. The loads sum down the
  tree, and the radii are fitted to the species' diameter at breast height. Each axis keeps a share
  of its own girth from node to node, so a fork never draws as a cone.
- **Bud sites line the limbs, not only their tips.** A limb is not bare under its foliage: the
  lateral sites run along every axis below the finest from a bare inner share of its length outward,
  at a low vigor that keeps the run thin, and every tip carries a terminal site. Without them a
  conifer draws as bare orange limbs with a tuft at each end, which is the fault the first pine
  verdict and the giant sequoia's review both report. The shoot instancer turns the sites into the
  species' brushes, and its per-meter curve and clumping make the crown's plates.
- **A thin leaf needs a finer card.** A pine needle is 1.6 mm across, under one texel of the default
  64-texel card cell, so its card would draw only the bare twig. The record may name a cell of 64,
  128 or 256 texels at each tier. The pine takes 128 at the high tiers, which costs four times the
  card atlas memory and keeps the crown green at distance.

## Decision

Grow conifers by the architectural model. One leader carries whorls of boughs at the record's
spacing. Positional curves give each axis its length and angle, and sag and upturn bend it. The
envelope caps it, the outline is rounded toward its mean, and the pipe model gives it its girth.
Bud sites stand along the finest axes, along the limbs below them from a bare inner run outward,
and at every tip. A record may name the card cell at each tier, from 64 to 256 texels. The Scots
pine settles the numbers.
Rejected: the self-organizing grower for a pine, whose competition fills a dome. It cannot leave the
long bare bole and the flat separate plates.

## Consequences

- `grow/architectural.ts` holds the grower. `grow/envelope.ts` holds `smoothedVolume`, and
  `grow/envelope.test.ts` checks it. `grow/architectural.test.ts` holds one leader, the bud sites
  and the limb sites: it checks that a bough carries lateral sites along its length rather than a
  tuft at its tip. It also checks the chain of every axis to a stem, the same bytes twice and the
  envelope cap.
- `lod/card-bake.ts` reads `lod.cardCell`, and `lod/cards.test.ts` checks the finer atlas.
- The Scots pine's record, envelope, textures and review slot live under its species folder, the
  textures package and `tools/lib/plant-review/slots/`. Its leaf is the fascicle: stills 11 and 12
  frame the pair, and row 4 reads the bundle's width and shape against the single needle.

## Addendum: the demo stand-ins and the guard's gap

The demo loader draws a landed species as itself. When the Scots pine landed, the
contact-shadows page, which names a 15 m stand-in at 0.45 aspect, began drawing the real 20 m pine
at 1.12. Its approved picture moved by 13.6 per cent of the pixels on WebGL2, and CI's software draw
agreed. The shared grower is not the cause. The demo pages' stand-ins hash byte-identical at the
range's base and at its head, and so do the twelve species.

The guard covered the twelve species and no demo stand-in, so a plant drawn through the stand-in
path had no hash to prove it inert. The close is `tools/plant-mesh-hash.ts --standins`: every
page's stand-ins built from one table the pages import, with the page's own size, colors, seed and
sparseness. The table gives the same twenty hashes at the base and at the narrowed tip. A page can
also keep its stand-in explicitly with `keepStandIn`. The contact-shadows page sets it for its pine,
so its approved picture stays comparable until the page moves to the species. The pine's own drawn
look does not change.

The second route is the owner's, not the close. A page may draw the real species instead of holding
its stand-in: its spots, sizes and count are set for the real plant, the owner judges the look, and
the page's reference is redrawn with attribution to the drawing that replaced it. That is a change
taken on the owner's word, with a redrawn picture, and it is recorded here so the stand-in hold is
not mistaken for the only way a page may answer a landing.

## Addendum: a card level draws at the size of its leaf form

A card level drew a larger plant than the leaves it pictures. The record's `cardGrow` field
enlarged every card, by 4 on the weeping willow and 5.5 on the Scots pine. The second card level
grew each card it kept by the square root of two on every species.

The owner chose this fix over a redraw of the held island and Creek references. <!-- outside date -->
A redraw would have kept the fault and moved twenty-four pictures twice.

The rule: a card level draws each card at the size of its shoot. The second level keeps every
second card and each row that sets the extent of the leaf form. Those rows are the highest, the
ends across and in depth, and the farthest in each of sixteen sectors. A kept card grows to make
up the cover its level does not draw, and only inside the hull of the leaf form. A card with no
room where it stands draws back from the hull as it grows.

The field is removed from the record type and from nine records. D-332's rejected value and
D-335's measured one name a field that no later head holds. The change is
`feat(vegetation)!: draw every card level at the size of the leaf form`, at `7ea34898a`. Its
commit names the twenty-four pictures that move.
