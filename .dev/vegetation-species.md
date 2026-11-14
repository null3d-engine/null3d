# Vegetation species

This guide states where each of the vegetation add-on's twenty species stands. For each it gives the
plant that ships, its side-by-side verdict and its open faults with their figures. It also gives its
reference conflicts, its costs against its caps, and what it needs next. [Plant review](plant-review.md) holds the
standard these verdicts apply, and [the vegetation process](vegetation-process.md) says how the work runs.

Read the figures this way. A round is named by its species and the commit it was drawn at, such as
`pedunculate-oak-963981822`. A sky gap gives the photograph's figure first and the drawing's second.
Read it like for like: the color-still gap at `01` and `02`, the half-dark gap at `18`. A leaf color
figure is the review's color difference, where about 2 is one visible step. A level is named where it
matters: the leaf form, the first card level or the second.

## The twenty at a glance

"Directed" is the new structure: a frame with ranked sockets and branch pieces, or the habit module of a
non-tree form. "Old grower" is the plant the add-on shipped before. A species ships its old grower until
its new structure passes the gate and a ready branch switches it.

| Species | Gate | Judged round | Ships |
| --- | --- | --- | --- |
| Pedunculate oak | Passed, narrowly; held on its confirming round | `0bc6547f1`; confirmed at `963981822` | Directed |
| Holm oak | Passed, plainly | `92226623a` | Directed |
| Scots pine | Passed | `f35754914` | Directed |
| Common ash | Passed, narrowly | `706139ce0` | Directed |
| Italian cypress | Passed, plainly | `3fa5d861a` | Directed |
| Sedge | Passed; holds at its shipped files | `8bf4c3d5c`; confirmed at `743390cef` | Directed |
| Bracken | Passed | `65344adbc` | Directed |
| Saguaro | Passed | `0765d087a` | Directed |
| Date palm | Passed, narrowly | `c6da1d7a8` | Directed |
| Weeping willow | Passed, plainly | `5ff18694d` | Directed once its ready branch merges |
| Tree fern | Passed, narrowly | `a8e7144cf` | Directed once its ready branch merges |
| Common alder | Passed on form; its condition met | `235c80c6a`; condition met at `c364864a1` | Directed once its ready branch merges |
| Hosta | Passed; both its conditions met | `c0daa59ff`; conditions met at `743390cef` | Directed |
| Silver birch | Not passed | `963981822` | Old grower |
| Hawthorn | Not yet drawn as a real round | none | Old grower |
| Meadow grass | Passed narrowly on build, on one condition | `743390cef` | Old grower until its card level draws its heads on their stems |
| European beech | Not yet drawn | none | Old grower |
| Olive | Not yet drawn | none | Old grower |
| Giant sequoia | Not yet drawn | none | Old grower |
| Bamboo | Not passed; level with the old one | `0c90f46f1` | Old grower |

## Draw a round again

1. Merge the shared line into the species' own line first, so the round has the review tool's camera
   fixes and the shared code. Resolve hunk by hunk, as [the process](vegetation-process.md#merges-into-the-shared-line) says.
2. Draw from a clean tree at the line's newest pushed head. The manifest names the commit, and a figure
   holds only for the tree that drew it.
3. Run `bun run plants:review <species> --run <species>-<commit> --out <folder>` through the machine's job
   queue, one drawing at a time. A run drawn on another line judges cameras only, and its name says so
   with `-cameras-`.
4. A plant whose whole views draw at the leaf form also draws one whole view at a card level, so both
   levels are judged.
5. Set the round beside its fair floor and its photographs, eye first, as the gate says.

## Pedunculate oak

The pilot of the rework and its gate. A directed frame of six low limbs and three crown limbs carries
lobed masses with bays between them. Its branch ends stand closer than a piece's width, so the crown
reads closed.

- **Gate:** passed narrowly at `0bc6547f1` against the fair floor, an even shell of foliage on a post. The
  confirming round `963981822` holds the win, with overlap 0.71, 0.73 and 0.63. It adds the shared
  support branches, the pieces tipped out of their clumps and the leaf faces from its own pictures.
- **Open faults:** Leaf color 7.6 at `01` against the fair floor's 4.5, a gray sage where the photograph is
  dark green. Sky a little too open at `01` (0.12 against 0.19) and `02` (0.09 against 0.17). `18` at the
  band's edge (0.22 against 0.20). A notch in `02`'s top. A bottle bole. A few pale thin twigs across the
  sky at `02`, to read close up.
- **Card levels:** over half the first level's cards hang from other cards, the farthest 1.74 m from drawn
  wood. They read as foliage on wood at `01` and `02`.
- **Costs:** its own budgets are its measure and a twentieth. Its variant takes 11.86 to 12.48 MB by tier,
  its second card level 44,600 triangles and its first 150,000.
- **Next:** color, then the bole's shape.

## Holm oak

A dome of dense evergreen leaf on a vase of eight to ten stems from one foot.

- **Gate:** passed plainly at `92226623a` against a ball on sticks.
- **Open faults:** Too closed at `01` (0.110 against 0.050) and `18` (0.129 against 0.070). A coarse flat
  leaf in large shingles where the photographs show a fine surface flecked by pale undersides. From below,
  one straight trunk under a dark ceiling where the photographs show crooked stems and a lit lattice.
- **Next:** the leaf's size and its pale underside, then cover.

## Scots pine

Tiers of blue-green plates on long limbs over an orange upper bole.

- **Gate:** passed at `f35754914` against the old pine's dense crown.
- **Open faults:** Too closed at `02` (0.259 against 0.202) and `18` (0.275 against 0.217). Thin, lacy
  plates. A top dome standing apart. One floating piece at `01`.
- **Next:** fuller plates, then the top.

## Common ash

A whole round crown of fine spray on a clear straight bole with steep limbs.

- **Gate:** passed narrowly at `706139ce0` against lopsided antler limbs.
- **Open faults:** Too open at `02` (0.187 against 0.283). Near-white bark where the photograph's is
  gray-brown. Narrow lower sides. With the shared support branches its second card level reads more open
  than its leaf form, 0.3532 against 0.2860. That fails the card size test on the shared line. Its ready
  branch carries the mend.
- **Reference conflicts:** `02` and `18` are recorded as other trees.
- **Costs:** Variant bytes 7,002,000 to 7,273,000 by tier. First card level 89,600. Second 22,800. The leaf
  form 2,500,000.
- **Next:** the card levels' cover, then the bark.

## Italian cypress

A closed dark green column of fans round a tinted inner body.

- **Gate:** passed plainly at `3fa5d861a` against a thin ragged column on a showing stem. Its line's newer
  `23898aa1a` is not judged.
- **Open faults:** Too closed at `01` (0.050 against 0.013). Flat fishbone fans close up. A see-through rim.
  A pointed top at `01`.
- **Costs:** about 1.03 million triangles drawn at once, against the old grower's 105.8 million.
- **Next:** the fans' form close up.

## Sedge

A wide mound of arching blades with flowering stems round the whole tuft.

- **Gate:** passed at `8bf4c3d5c` against the old, fuller tuft. The round at its shipped files,
  `743390cef`, holds the pass and is nearer. Its flowering stems arch over the mound all round, and the
  sky at `02` is inside (0.37 against 0.36).
- **Open faults:** The first card level draws a near-black smear of vertical streaks. Its spikes draw as
  loose dashes floating over the mound, and its leaf color is 31.6 at `02`. Every card-level drawing of
  the sedge shows this. The lower blades read blue-gray, and the spikes are dark.
- **Reference conflicts:** `01` (an upright fountain) against `02` (a wide mound). Picture `02` and the
  turning video govern.
- **Next:** the card level's color and its spikes, by testing the card bake's color for thin blades first.

## Bracken

A patch of single fronds, each a broad lacy leaf on its stalk.

- **Gate:** passed at `65344adbc` against three tufts of palm-like fronds.
- **Open faults:** Too open at `01` (0.245 against 0.452) and too closed at `18` (0.557 against 0.364). One
  flat level of leaves where the photograph has tiers. Straight stalks. Pale color. The nearer leaves smear
  at `18`. Its `02` is to be read again on the lone-frond slot.
- **Next:** leaves in tiers.

## Saguaro

A ribbed column with four arms in one plane, the plane facing camera `01`.

- **Gate:** passed at `0765d087a`, plainly at `01`.
- **Open faults:** The inner arm tips 0.02 of the height high. Banded elbows from below. The cork ends on a
  ruled line.
- **Reference conflicts:** `18` (two tiers of arms) and `07` (one arm on its own collar) are other plants.
  Picture `02` reads as a pole by the one plane the owner chose.
- **Next:** the arm tips.

## Date palm

A fountain of forty feathery fronds on a tall patterned trunk.

- **Gate:** passed narrowly at `c6da1d7a8`: the first card level draws fronds. The old palm is a wire
  star with a second palm at its foot.
- **Open faults:** Too open at every view (`01` 0.201 against 0.489, `02` 0.189 against 0.402, `18` 0.413
  against 0.559). The dates draw at about a twentieth of the photograph's share. The brown dead fronds. The
  close frond too dark (#505744 against #979b8a). Leaflets in dashes at the first card level.
- **Next:** cover, then the dates and the dead fronds.

## Weeping willow

A dome whose curtain of strands hangs nearly to the ground from arching limbs.

- **Gate:** passed plainly at `5ff18694d` against starbursts of straight sticks.
- **Open faults:** The curtain drawn in vertical bars. Bare arch hoops over the top. Khaki leaves and bark
  where the photograph is yellow-green and gray-brown. Too open at `01` (0.022 against 0.118) and too closed
  at `18` (0.306 against 0.138). No limb fork at `08`. The strands read as dark spokes from below.
- **Next:** fine soft strands, then the arches.

## Tree fern

An even fountain of fine twice-divided fronds over a brown bell of dead fronds, on a straight flared
trunk.

- **Gate:** passed narrowly at `a8e7144cf` against a cycad on a bottle trunk.
- **Open faults:** Leaf color 10.5 at `01` against the old fern's 4.2, darker olive than the photograph.
  Wispy frond tips. The skirt's brown too dark. A little too open at `01` (0.235 against 0.32) and `18`
  (0.30 against 0.37). No croziers.
- **Costs:** The near form at high up to 250,000 triangles. The kit 1.9 MB at high and 3.1 MB at ultra.
- **Next:** the green, then croziers.

## Common alder

One crown widest low on a straight leader with near-level limbs.

- **Gate:** passed on form at `235c80c6a`, on the condition that the young wood's pink haze goes. The
  condition is met at `c364864a1`, which switches with the young-bark tint.
- **Open faults:** A web of reddish-brown twigs between the leaves. Leaves paler than the photograph's.
  Drawn at 0.66 to 0.74 of the photograph's scale. `02` an oval, not the narrow cone.
- **Reference conflicts:** `02` and `18` (a narrow cone, crown base low) against `30` (a broader crown).
  Picture `30` and the turning video govern. Picture `01`'s outline is void by its river bank.
- **Next:** scale, then the twigs' cover.

## Hosta

A low mound of heart-shaped leaves whose rim leaves hang tips down.

- **Gate:** passed at `c0daa59ff`, narrowly at `01` and plainly at `02`, on two conditions, both met at
  `743390cef`. The black leaf is gone: a leaf's flutter phase byte had landed on the sheath kind's value.
  The picture of `02` at the first card level reads as the leaf form's mound, with no black leaf.
- **Open faults:** Too closed (`01` 0.12 against 0.07, `02` 0.13 against 0.07). A flat top where the
  photograph domes. A closed disc from above. Narrow at `02`. Pale lime at `01`. The cut pieces' few
  splayed leaves.
- **Next:** the dome, then cover.

## Silver birch

- **Gate:** not passed at `963981822`. At the first card level the whole crown draws rust-brown, in straight
  hanging bars (leaf color 30.4 and 28.6). The old birch is a green oval on a white stem.
- **Open faults:** The crown's color. Strands in bars, not fine and pendulous. A spindly frame at `18`. The
  white bark is right.
- **Reference conflicts:** `18` is narrower than `01` at the same turn. `01` governs. `33` is a second form.
- **Next:** test whether its cards picture leaves at all.

## Hawthorn

A mound on many stems, leafy to the ground, in autumn with haws.

- **Gate:** no real round yet. Its frame sheet reads as the photograph's build, against an old grower that
  stands on two or three stems.
- **Open faults, by the sheet:** The leaf form a see-through screen of twigs. No haws drawn. No thorny
  shoots past the rim.
- **Costs:** Leaf form cap about 1,380,000 triangles. Near cap at the reference view about 861,000. Its
  first card level must fit 155,000.
- **Next:** a real round with its haws.

## Meadow grass

A vase of blades to half the height, with open feathery heads on tall stems above it.

- **Gate:** passed narrowly on build at `743390cef`, against the old grower's single mass of blades with
  dot heads. It ships once its first card level draws its heads on their stems.
- **Open faults:** At the first card level the blades draw as streaks and the heads float off their stems.
  The blades are pale and sparse, and the heads lime where the photograph's are buff. Too open at `01`
  (0.49 against 0.59) and `02` (0.51 against 0.74). Drawn at 0.63 of the photograph's scale at `02`.
- **Reference conflicts:** `01` and `02` ask for opposite sky; recorded.
- **Next:** the card level's heads, then the blades' density and color.

## Bamboo

A clump of straight culms from one foot.

- **Gate:** not passed at `0c90f46f1`; level with the old grower, a lime fountain of thick culms
  arching over at the top. The new clump has the photograph's straight culms, a narrow foot and sheath
  rings. The old keeps the full crown.
- **Open faults:** The plume narrow and sparse, its leaves smudged at the first card level where the
  photograph shows fans of narrow pointed blades. Too open at `01` (0.13 against 0.28). Lime culms
  with no node rings, where the photograph's are gray-green with tan nodes.
- **Reference limits:** no fact sheet. The pictures show an 11 cm cane on a 6 m clump, recorded as a
  limit of the reference.
- **Next:** the leaves as blades in fans, and a fuller, wider plume.

## European beech, olive and giant sequoia

None of the three has a real round of its new structure yet. Their floors:

- **European beech:** a haystack of fine dull twigs. A new beech with a visible bole, a dome and bright
  green leaf beats it.
- **Olive:** a small flat-topped tree, right in its gray-green with pale flecks. Its variant caps rise to
  about 6,820,000 bytes.
- **Giant sequoia:** a conifer on a red pole with its foliage wound round it. Its bark is right.
