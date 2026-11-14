# D-356: the saguaro grows as a ribbed column, with one spine-cluster card at every areole

Status: decided and built in the column growth model, the saguaro's record and texture folder, and
the plant review's skin close-ups. The tree class's second-card-level triangle cap rises for the
species, and the owner's confirmation of that raise is pending. Task: M3-V4.

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

The species grows 12.0 m tall and 3.8 m across, which is the fitted aspect of 0.32. Its six variants
carry 4 to 6 arms at 5.3 to 6.3 m, each on an elbow of 1.3 m and a rise of 3.2 m. The stem is 0.8 m
across at the foot and carries 14 ribs; an arm carries 12.

| Measure | Value | Tier |
| --- | --- | --- |
| Areoles on the largest variant | 13,013 bud sites, one shoot each | high |
| Nearest wood | 52,207 triangles | high |
| First card level | 112,381 triangles | ultra |
| Second card level | 50,452 triangles | ultra |
| Variant bytes | 6,860,113 | ultra |
| Kit bytes | 1,214,476 | ultra |
| Grow | 750 ms cold in Bun on a Mac, where the oak records 600 ms and grows in 2.5 to 4.7 s | high |

A geometry spine fan at every areole was measured at about 120 triangles a cluster. With 13,000
areoles it passes 1.5 million triangles at the nearest level alone, which no byte cap holds.

## Look

The reference brief settles the look: the two transparent texture sources exist to scatter spine
clusters along the ribs, so a card holds each cluster. A card carries the felt areole, the long
central spine and the radial ring at the size of the picture, and its alpha cuts the gaps. The
spine fans as geometry would read closer at a hand's distance, but they cost the triangle budget and
add nothing at the review's scale.

## Decision

- The `column` growth model grows the stem as one axis and each arm as another. An arm leaves from a
  node, runs out level, turns through a quarter circle at the elbow and rises parallel to the stem.
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
- The tree class's second-card-level cap rises from 43,000 to 52,000 triangles, which holds the
  saguaro's 50,452. That raise waits for the owner's confirmation.

## Consequences

- `packages/vegetation/src/grow/column.ts` and `packages/vegetation/src/wood/ribs.ts` are new.
- `packages/vegetation/src/species/saguaro/` holds the record, its fitted figures, and its entries.
- `packages/vegetation-textures/textures/saguaro/` holds the leaf and bark sets, built from slots 24,
  25, 26, 14 and 16.
- The review tool reads a cactus's rib, areole and spine stills as skin close-ups, and its "arm"
  names as limb views.
