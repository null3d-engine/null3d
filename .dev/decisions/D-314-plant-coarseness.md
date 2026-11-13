# D-314: a page asks for a simpler plant by one coarseness or a triangle target, and moves every switch by one bias

Status: decided. Coarseness and the triangle target are built in the grower's pruning pass, the
shoot instancer and the wood mesher. The page's switch bias is built on the stand-ins' placement.
The real placement takes the same bias once it is built. Task: none.

Summary: One coarseness from 0 to 1 prunes up to 30 per cent of the finest twigs, the deepest first.
It keeps as few as 20 per cent of the shoot rows, spread evenly and grown up to 2.25 times. It
triples the wood's edge length. On the grown oak at the high tier, coarseness 1 cuts the nearest
level from 26.7 million triangles to 3.8 million. Its outline stays within 0.007 of the plant as
grown. A triangle target picks the coarseness within 1.6 per cent.

## Question

How does a page ask for a simpler plant, not only a coarser mesh of the same plant? And how does it
move every species' level switches at once? The `detail` tier only changes how finely the same
branches and leaves are meshed, and the switch distances live in each species' record.

## Rule

The owner's acceptance, measured on the self-organizing grower's oak:

- the same bytes at every setting;
- a coarser plant keeps its silhouette within its envelope, at an IoU no more than 0.05 below the
  plant as grown;
- triangle and byte counts fall at every step of coarseness;
- a triangle target is met within 10 per cent;
- the default (coarseness 0, no bias) gives the bytes of a plant grown without the options;
- stand-ins do not change.

## Data

The plant is the grower's oak (`grow/oak.fixture.ts`, seed 11) at the high tier. It takes the leaf
package's oak shoots and leaves (`leaf/oak.test-support.ts`) and the wood tests' bark. The nearest
level counts its wood and its shoot rows, each row at its prototype's triangles for the tier. Bytes
are the quantised parts, and the nearest level adds the shoot row table.

The outline is the IoU of the plant's silhouette with its envelope's, at eight angles. Each shoot
row draws as a disc as long as its shoot at its scale (`plantSilhouette`). The drop is the most that
any angle falls below the plant as grown.

| Coarseness | Nearest level, triangles | Nearest wood, bytes | First card level, triangles and bytes | Second card level, triangles and bytes | Outline, worst drop |
| --- | --- | --- | --- | --- | --- |
| 0 | 26,656,881 | 5,503,053 | 75,123; 3,447,564 | 35,762; 1,685,643 | 0 |
| 0.25 | 19,998,381 | 4,472,280 | 55,850; 2,570,718 | 26,714; 1,258,920 | 0.001 |
| 0.5 | 13,602,619 | 3,873,708 | 37,763; 1,727,511 | 17,972; 842,958 | 0.001 |
| 0.75 | 8,164,970 | 3,445,023 | 23,288; 1,047,810 | 10,917; 506,754 | 0.007 |
| 1 | 3,787,777 | 3,077,877 | 11,757; 501,504 | 5,247; 236,211 | 0.004 |

Variants 1 and 2 behave the same way. Their nearest levels fall from 24.8 and 35.8 million
triangles to 3.6 and 5.0 million, and their worst drops are 0.001 and 0.003. The wood's quick count
stands within 1.5 per cent of the mesher's count at every step on variants 0 and 1. It runs in 17 to
126 ms, against 1 to 4 seconds for the mesh.

| Tier and variant | Target | Coarseness picked | Triangles | Off by | Search |
| --- | --- | --- | --- | --- | --- |
| High, 0 | 20,000,000 | 0.258 | 19,796,353 | -1.0 % | 990 ms |
| High, 0 | 10,000,000 | 0.669 | 9,865,985 | -1.3 % | 516 ms |
| High, 0 | 6,000,000 | 0.871 | 6,011,484 | 0.2 % | 576 ms |
| High, 0 | 4,000,000 | 0.989 | 3,978,269 | -0.5 % | 279 ms |
| Low, 1 | 3,000,000 | 0.550 | 2,958,163 | -1.4 % | 898 ms |
| Low, 1 | 1,500,000 | 0.867 | 1,486,697 | -0.9 % | 636 ms |
| Low, 1 | 1,000,000 | 0.988 | 1,015,164 | 1.5 % | 303 ms |
| Low, 1 | 700,000 | 1 (the coarsest) | 975,501 | Beyond the coarsest | 158 ms |

The options that this record rejects, at coarseness 1 on variant 0 or 1, at the high tier:

| Option | Nearest level, triangles | Outline, worst drop |
| --- | --- | --- |
| Chosen: prune 30 %, deepest first; keep 20 % of rows evenly; grow up to 2.25 | 3,787,777 | 0.004 |
| Prune 40 %, deepest first; keep 25 % of rows evenly; grow 2 | 3,946,639 | 0.042 to 0.045 |
| Prune 40 %, dimmest first; keep 25 % of rows at random; grow 2 | 4,517,764 | 0.047 to 0.051 |
| Prune 60 %, dimmest first; keep 15 % of rows at random; grow up to 2.58 | 1,629,155 | 0.167 |
| Prune 60 %, dimmest first; keep the brightest 15 % of rows; grow up to 1.5 | 2,689,959 | 0.241 |
| Prune 40 %, dimmest first, no thinning | 16,720,349 | 0.103 |
| Prune 40 %, deepest first, no thinning | 14,779,935 | 0.081 |

The default gives the same bytes. The digests cover the oak's skeleton, shoot rows, crown light,
wind records, wood at three levels and two card levels. They cover a stand-in's whole asset too.
They are equal on the commit before these options and with them, with no coarseness or a
coarseness of 0. A stand-in gives the same digest at coarseness 0.7 and 0.8, and with a triangle
target.

How the data was produced: Bun 1.4.3 on the Mac, at a load average of 57 to 75. Other agents'
builds ran beside each sweep. Each sweep ran in one process. Scripts called the stages in order,
because the plant core's page side is not built yet. The times are of one core at that load. The
unit test `packages/vegetation/src/coarseness.test.ts` repeats the outline, the counts, the target and
the default on variants 0 and 1.

## Look

The chosen option looks best of those measured: its outline holds within 0.007 at every step. More
pruning, pruning the dimmest twigs first, or keeping the brightest rows opens the crown's lower side
and its edge, by 0.04 to 0.24. Shoots grown up to 2.25 times keep the crown's leaf area, so a coarse
crown is not see-through. Its leaves are larger up close. A page asks for coarseness for plants it
shows small, where the eye cannot see a leaf's size.

## Decision

One `coarseness` from 0 to 1 acts in three stages. So a coarser plant is simpler, and not only
meshed more coarsely.

- **Fewer of the finest twigs and buds** (`grow/coarsen.ts`). After any grower, a pass prunes up to
  30 per cent of the finest order's axes. Each pruned axis takes the axes it carries and their bud
  sites. The deepest axes go first: those whose nearest node stands furthest inside the crown's hull.
  The skeleton's own nodes outline the hull, in 12 bins of elevation by 24 of azimuth. Among twigs
  equally deep, the dimmest go first, by the light per node by which a self-organizing plant sheds.
  The pass runs on the finished skeleton. The wood that stays keeps its place, its pose under the
  full load and its pipe radii.
- **Fewer and larger shoots** (`leaf/instancer.ts`). The instancer keeps a share of its rows, down to
  20 per cent, spread evenly along their space-filling order. Each kept row grows by the inverse
  square root of the share, up to 2.25 times, so the leaf area holds.
- **Wood of fewer rings and sides** (`wood/tube.ts`). The edge round a ring grows up to three times.
  Rings then have fewer sides, and their steps along the axis grow with the edge.

A triangle target in place of the coarseness picks it. The core counts the shoot rows that the
instancer places, and the wood by a quick count (`wood/estimate.ts`), at a few values of coarseness.
It searches by false position on the count's logarithm, with the core's own logarithm, so every
script engine picks the same value. It stops within 2 per cent, or after six tries between the ends.
A target above the plant as grown gives coarseness 0, and one below the coarsest gives 1.

Options given to `prepareSpecies` are the kit's default, and a variant's own options replace them.
A variant's key holds its options, and holds none at coarseness 0. Stand-ins ignore the options.

The page's switch bias lives in the view that every `placePlants` call takes. One view then moves
the level switches of all the page's species at once. The bias counts in stops: each switch distance
is multiplied by two to the power of minus the bias. A bias of 0 multiplies by exactly 1.

Rejected:

- **Pruning the dimmest twigs first.** The dimmest twigs include the crown's whole lower side, which
  the sky lights least. The outline lost 0.103 from pruning alone.
- **Keeping the brightest rows.** It empties the crown's lower side too, with a drop of 0.241.
- **Thinning rows at random.** Clumps and gaps cost the outline about 0.003 more than even thinning
  along the space-filling order.
- **Pruning 40 per cent or more.** Past about 30 per cent the pass reaches twigs at the outline. The
  drop rose from 0.005 to 0.042.
- **Fewer macro orders in the grower.** The record's orders steer the tropisms and the bud angles, so
  fewer orders grow another plant. Each try of a target search would also grow the plant again.
- **A higher shedding threshold during growth.** The plant would shed more by its own rule. But the
  resource moves to the buds that remain, so the counts need not fall at every step. Each try of a
  target search would grow the plant again too.
- **Meshing the wood to count it.** The nearest wood takes 1 to 4 seconds, and the quick count well
  under 0.2 seconds. A variant grown without its nearest wood must not mesh it either.

## Consequences

- `coarseness.ts` holds `CoarsenessOptions`, `checkCoarseness`, `coarsenessFor` (the target search),
  `coarsenessKey`, `shootTriangles`, **`nearTriangles`** and **`switchScale`**.
- `GrowOptions` and `PrepareOptions` take the options. `SpeciesKitData` keeps the page's default.
  `PlantAsset` records the coarseness it grew at, and `DressInput` carries it to the instancer and
  the meshers.
- `PlaceOptions.view` is a **`PlantView`** with `switchBias`.
- `grow/envelope.ts` gains `plantSilhouette`, the outline of a dressed plant from its shoot rows.
- `docs/api/vegetation.md` ("Simpler plants") and `skills/null3d-develop/references/api-quickref.md`
  describe the options.
