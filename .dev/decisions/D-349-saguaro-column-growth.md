# D-349: the saguaro grows as a ribbed column, with one spine-cluster card at every areole

Status: decided and built in the column growth model, the saguaro's record and texture folder, and
the plant review's skin close-ups. The owner approved the raise of the tree class's second-card-level
triangle cap to 52,000. The species stands down under D-334's fourth ruling until the twelve existing
species are complete. Task: M3-V4.

Summary: a saguaro's whole height is one ribbed stem that carries no crown, so no broadleaf model
draws it. The `column` growth model grows the stem and its arms as tubes, and the wood mesher draws
the ribs as a cross-section. Each areole on a rib crest carries one spine-cluster card from the
species' spine textures. One record field fixes a shoot's leaf turn, so every cluster lies with its
longest spine down the stem.

## Question

How does a plant whose whole body is one ribbed column grow and draw, when it has no crown, no
leaves and no twigs? Its close views must show ribs, areoles and spine clusters at the size the
reference shows them, and its budget must hold at every tier.

## Rule

- A species passes only when every row of the plant review passes on every reference picture
  ([plant review](../plant-review.md)).
- The reference index adapts the tree slots itself. An arm is a limb, and the arm junction is where
  a limb leaves. The leaf slots hold the spine clusters, which the index calls "what a renderer
  scatters along the ribs".
- Each new behavior sits behind an optional record field with a unit, a range check and a doc
  comment. With the field absent, every species grows as it did.
- Every budget holds at every tier.

## Data

The species grows 12.0 m tall and 4.1 m across, which is the fitted aspect of 0.34. Its six variants
carry 3 to 5 arms at 5.4 to 6.4 m, each running out 0.75 m, turning up over a quarter circle of
0.49 m and rising 2.6 to 3.8 m. A thicker arm and a longer run, at radius 0.22 m and 0.9 m, measured
worse on the second whole view (shape 0.43 against 0.50, width error 0.108 against 0.082), so the
record keeps the thinner arm. An arm is pinched to about half its girth where it leaves the stem. The stem is 0.8 m across at the foot and carries 14 ribs; an arm carries 12.
Nine woodpecker holes stand on the upper stem.

| Measure | Value | Tier |
| --- | --- | --- |
| Areoles on the largest variant | 11,002 bud sites, one shoot each | high |
| Nearest wood | 49,140 triangles | high |
| First card level | 92,764 triangles | ultra |
| Second card level | 40,127 triangles | ultra |
| Variant bytes | 5,403,629 | ultra |
| Kit bytes | 1,214,476 | ultra |
| Grow | 750 ms cold in Bun on a Mac, where the oak records 600 ms and grows in 2.5 to 4.7 s | high |

A geometry spine fan at every areole was measured at about 120 triangles a cluster. With 12,000
areoles it passes 1.4 million triangles at the nearest level alone, which no byte cap holds.

## Look

The reference brief settles the look: the two transparent texture sources exist to scatter spine
clusters along the ribs, so a card holds each cluster. A card carries the felt areole, the long
central spine and the radial ring at the size of the picture, and its alpha cuts the gaps. The
spine fans as geometry would read closer at a hand's distance, but they cost the triangle budget and
add nothing at the review's scale.

## Decision

- The `column` growth model grows the stem as one axis and each arm as another. An arm leaves from a
  node and runs out level, turns up over a quarter circle a few arm girths across, and rises parallel
  to the stem. It starts most of its own radius clear of the stem, so its weld meets a ring outside
  the parent.
- A few dormant sites on the upper stem carry a dark socket flush with the skin, for the
  woodpecker holes nearly every old saguaro's trunk shows.
- The wood mesher draws the ribs through the stem section it already supports: the pipe radius is
  each crest, and a groove cuts inward by the record's depth, scaled by the wood's girth. The same
  section shapes the arms.
- The grower places one areole bud at every rib crest along every axis. The instancer gives an areole
  one shoot whatever stretch of axis lies behind it, because the growth places every areole itself.
- The shoot class carries one card, whose picture is the species' spine texture. The new optional
  `ShootClass.azimuth` fixes the card's turn, so the longest central points down the stem on every
  areole rather than turning a random face to the viewer.
- The plant review draws the species' rib, areole and spine stills as skin close-ups, since there is
  no leaf or twig to cut.
- The tree class's second-card-level cap rises from 43,000 to 52,000 triangles, with room above the
  saguaro's measured figure. The owner approved the raise: the column keeps its areole cards at the
  farthest level, and the kit sits inside its own cap at 1.21 MB.
- The wind clip's motion is right in the plant: a saguaro is rigid, and the reference's only motion
  is the dust and grass at its foot, which the render's scene does not draw. Bands two to six agree
  within 0.009 of the reference and the base band differs for that reason.
- The review tool frames one limb for pictures 04, 05, 06 and 08, where the photographs show two
  arms and the stem's top at arm height. Picture 04 misses the second arm and the stem's top,
  picture 05 misses the trunk beside the arm, picture 06 misses the trunk the arm leaves, and
  picture 08 misses the arm's rise above the elbow. This is a tool limit, stated here with those
  four names rather than fitted by a record value.

## Consequences

- `packages/vegetation/src/grow/column.ts` and `packages/vegetation/src/wood/ribs.ts` are new.
- `packages/vegetation/src/species/saguaro/` holds the record, its fitted figures, and its entries.
- `packages/vegetation-textures/textures/saguaro/` holds the leaf and bark sets, built from slots 24,
  25, 26, 14 and 16.
- The review tool's reference rules send a cactus's single spine cluster and single areole to the leaf
  card, its ribs and areole rows to the skin, and its "arm" names to limb views. Its query takes a
  `barkHeight`, so a mid-trunk bark view stands in the trunk zone of a tall stem.
- A cut arm is wood: the wood mesher accepts a cut axis of the arm kind, as it accepts a cut limb.
- The whole views take the photographs' own ground light: a sky share of about a third and a sun
  strength of one and a half times the page's daylight. The profile view's colour difference sits at
  7.8, still past the visible-step band, so the remaining difference is the species' own tone.
- The arm-skin close-up's colour figure (32.5) measures the plant's whole upper region, not the skin,
  so it cannot judge the material. The rendered skin carries the photograph's own hue after the layer
  crops the arm from its grey backdrop.
- The reference photographs' arms lie in one plane and close up edge-on as they turn, where the
  rubric's coverage rule asks for appendages spread round the plant in equal proportion. The render
  spreads its arms, so its first whole view overlaps its planar reference at 0.30 while the profile
  passes at 0.50. The coverage rule is the owner's, and the tension is stated rather than fitted.
- A bark close-up draws the wood alone, so no bark picture can show an extra. The nest-hole picture
  takes the crown view, which frames the upper stem and draws the extras where the holes stand.
- The review tool reads a cactus's rib, areole and spine stills as skin close-ups, and its "arm"
  names as limb views.
