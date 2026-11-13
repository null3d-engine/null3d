# D-355: sparseness removes parts from one grown plant

Status: decided and built. A plant grows once, at its full density, and a sparser plant is that
plant with shoots and branches removed. The picture references of plants drawn at a sparseness
above 0 are owed a redraw. Task: none.

Summary: The owner ruled that sparseness removes parts from the same plant. A sparser plant is a
strict subset of the denser one and stays one connected body. Its leaves are removed and never
shrunk. The removal order comes from one walk of the grown plant, so every limb keeps the plant's
share of its own foliage. No octant strays more than 0.087 from that share.

## Question

How does a plant become sparser? Sparseness used to grow a second, thinner plant. It multiplied the
grower's branching chance and scaled every shoot down. So the sparse plant was a different plant
with smaller leaves, and each sparseness value took a new growth.

## Rule

The owner's words set the rule.

- Sparseness reduces the foliage and the branches within a given tree.
- A sparse plant is a strict subset of the full plant. It stays connected. Leaves are removed and
  never shrunk.
- At the default, the foliage is as dense as the reference needs. Sparseness reduces it on demand.
- At its maximum, the plant keeps the trunk, the great limbs and a minimum of foliage.
- The removal is even round the crown and through its height at every value.

## Data

The foliage a plant keeps, and the wood that carries it, at five sparseness values. Each cell is
shoot rows, then axes. The sedge and the hosta carry no shoot rows, so their cells count end axes
(leaves, flower stalks and roots), then all axes.

| Species | 0 | 0.25 | 0.5 | 0.75 | 1 |
| --- | --- | --- | --- | --- | --- |
| Pedunculate oak | 3,772 / 1,553 | 2,904 / 1,501 | 2,037 / 1,383 | 1,169 / 1,071 | 302 / 427 |
| Scots pine | 2,668 / 280 | 2,068 / 277 | 1,467 / 274 | 867 / 267 | 267 / 200 |
| Silver birch | 6,174 / 1,211 | 4,800 / 1,195 | 3,427 / 1,176 | 2,053 / 1,095 | 679 / 785 |
| Hawthorn | 3,755 / 987 | 2,920 / 980 | 2,084 / 969 | 1,249 / 889 | 413 / 537 |
| Sedge | 1,071 / 1,251 | 830 / 1,010 | 589 / 769 | 348 / 524 | 107 / 213 |
| Hosta | 63 / 71 | 49 / 57 | 35 / 43 | 20 / 28 | 6 / 11 |
| Saguaro | 10,188 / 6 | 7,896 / 6 | 5,603 / 6 | 3,311 / 6 | 1,019 / 6 |

The nearest level's wood falls more slowly than its axes, because the trunk and the great limbs hold
most of its triangles. At the low tier the oak's nearest wood is 218,284 triangles as grown and
118,117 at sparseness 1, and the birch's is 144,442 and 122,411.

How evenly the foliage goes. The plant's foliage is split into eight octants about its middle. An
octant's kept share is compared with the whole plant's kept share. The figure is the largest
difference in any octant that holds 40 carriers or more.

| Order | Worst octant | Where |
| --- | --- | --- |
| Places by reversed bits along one walk of the plant | 0.087 | A sedge's octant of 116 leaves. No tree's octant passes 0.031 |
| Weights that let a whole branch go early | 0.358 | A beech's octant of 776 shoots kept 19 per cent when the plant kept 55 |

How the data was produced: `bun test --conditions=null3d-source
./packages/vegetation/src/sparse.test.ts` states the contracts, on seven species and two seeds at
the low tier. The counts are from seed 11, variant 0. The octant figures come from twelve species,
four seeds and six sparseness values, in one process on the development Mac.

## Look

The options differ in look. Removing shoots keeps every leaf at the size the reference shows. The
crown keeps its outline, because each axis that stays keeps its outermost shoot. Scaling the shoots
down made a sparse crown of small leaves, which no reference shows. The even order looks better
than the order that drops whole branches early. That one opened a hole in one side of the crown at
middling values. The decision takes the removal and the even order.

## Decision

A plant grows once. `grow/sparse.ts` then gives every foliage carrier a place in one order. A
carrier is a shoot row, or an end axis on a plant that carries no rows. A sparser plant keeps the
first carriers of the order and every axis from each of them to the root.

- **The order.** A walk from the root lists the carriers. Along each axis it runs from the tip to
  the base, and it lists a branch's carriers where the branch leaves. So the foliage of each axis is
  one run of the list. The places come from the reversed bits of the list index. The carriers kept
  so far then stand spread along the whole list. Every run holds its share to within about twice the
  logarithm of the list's length. A limb, a branch and a twig each keep the plant's share of their
  own foliage.
- **Tips stay.** Each axis's first carrier, the one nearest its tip, takes the earliest place of its
  run. An axis that stays therefore keeps its whole length and ends in the foliage it grew. No
  branch ends bare, and the crown keeps its outline.
- **What never goes.** The stems stay: the axes with no parent that are stems or a ground plant's
  crown. The great limbs stay. A great limb is a limb or an arm that leaves a stem with enough
  girth: at least the record's `sparse.limbs` share of the radius of the thickest limb on that
  stem. The share is 0.5 when not given. The wood to the plant's highest node stays, and so does
  the shoot whose cards reach highest. So every sparseness has the same height.
- **The floor.** At sparseness 1 the plant keeps the record's `sparse.foliage` share of its
  carriers, 0.1 when not given. The count between is linear in the sparseness.
- **The wood.** An axis stays whole or goes whole. Its nodes and radii are the grown plant's. The
  wood is meshed again from the axes that stay.
- **Every level.** The card levels and the far bake read the same thinned plant. Some cards no
  longer touch the level's wood or another card. A card level draws the branch under each of those,
  as one straight run of three sides. So no level drops a card that the sparseness kept.
- **No second growth.** A thread keeps the last eight plants as grown. A change of sparseness cuts
  the kept plant.
- **Same choices.** A thinned plant records the index each axis, bud site and shoot row had as
  grown. The extras, the bark's peel, a column's ribs, the stem's flare and the wind phase key on
  those. So the fruit that stays hangs where the grown plant hung it.

Rejected:

- **Growing a thinner plant** (the earlier form). It is a different plant at each value, its
  leaves shrink, and each value costs a growth. The owner ruled it out.
- **An order by position alone**, such as the shoot rows' space-filling rank. It is even in space
  but knows no branch, so it cannot keep each axis's tip. A branch can lose its last shoot while its
  neighbours keep theirs.
- **Weights that let whole branches go early.** They cut more wood, but they are uneven, as the
  data shows.
- **Trimming each axis back to its last shoot.** The crown's outline shrinks as it thins, and an
  axis's own key changes, which moves a ground plant's leaves.

The floors that eight species named were shares of a regrown plant: limbs, leaf area and
coarseness. Each of those species now names a share of its shoots. That share holds the leaf area
of its former sparsest form: its former share of shoot rows times its former leaf share.

| Species | Former shoot rows at 0 and at 1 | Former leaf share | `sparse.foliage` |
| --- | --- | --- | --- |
| Pedunculate oak | 3,772 and 745 | 0.42 | 0.08 |
| European beech | 6,222 and 1,503 | 0.38 | 0.09 |
| Silver birch | 6,174 and 1,199 | 0.55 | 0.11 |
| Hawthorn | 3,755 and 805 | 0.5 | 0.11 |
| Common alder | 4,872 and 1,349 | 0.5 | 0.14 |
| Weeping willow | 2,144 and 698 | 0.5 | 0.16 |
| Common ash | 1,395 and 726 | 0.5 | 0.26 |
| Holm oak | 2,160 and 1,355 | 0.5 | 0.31 |

The bracken keeps six of its fifteen fronds, as before: 0.4. Only the owner changes a floor.

## Consequences

- `GrowOptions.sparse` acts on every species. A species that named no floors used to ignore it.
- `GrowOptions.leaves` and `GrowOptions.limbs` are gone, with `withSparse`, `withLeaves` and
  `withLimbs`. Sparseness no longer raises the coarseness or the section sparsity. It changes what
  the plant holds, and the polygon dial changes how finely that is drawn
  ([D-348](D-348-two-dials-keep-their-own-work.md)).
- `variantKey` holds the sparseness, so a sparse plant and the plant as grown no longer share a
  cache entry.
- A stand-in species and a cut piece grow as they are at every sparseness.
- A sparse plant's nearest wood is meshed at the tier's own fineness. The former sparse form
  coarsened it, so a sparse plant's nearest level can hold more wood triangles than before.
- Every picture of a plant at a sparseness above 0 changes.
