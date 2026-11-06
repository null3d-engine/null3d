# D-325: a crowded shoot tip is a round rosette, and a cutting's wood is as old as its shoot

Status: decided. The shared shoot builder, the extras' scale range, the per-class stem and lateral
values, the oak's record and their tests are built. Task: none.

Summary: a shoot's crowded tip now spreads its leaves evenly round the stem instead of into one fan,
so a leaf cluster reads the same from every side. A shoot class may name its own wood girth and
lateral angle, so a three year spray is thicker and wider than this year's shoot. The cluster carries
six radiating leaves and a plump bud, and its turn's height spread falls from 61 to 48 per cent.

## Question

How does a crowded shoot tip arrange its leaves, and how does a cut piece show the wood its age earns?

## Rule

The per-species review rubric, rows 2 and 5. A leaf cluster carries five or six leaves round the
full tip, with the lowest down and out. Its crown box spread round a turn stays inside the form's
band of 25 per cent. A cutting is a branched brown shoot at its reference's width and size, with
thicker brown kinked wood.

## Data

Measured on the oak, seed 11, variant 0, preset high, against the species' reference folder. The run
`cuttings-base` holds the fan and the runs `quick4` and `turns1` hold the round rosette.

| Measure | Fan (before) | Round rosette (after) | Reference |
| --- | --- | --- | --- |
| Cluster still 11, shape IoU | 0.44 | 0.28 | - |
| Cluster still 11, crown box | 362 x 329 | 368 x 334 | 600 x 558 |
| Cluster still 11, sky gap | 0.13 | 0.22 | 0.14 |
| Cluster turn, height spread | 61% | 48% | 17% |
| Branch still 21, shape IoU | 0.21 | 0.24 | - |
| Branch still 21, width error | 0.166 | 0.131 | - |
| Branch turn, height spread | 26% | 37% | 4% |
| Sub-branch still 22, shape IoU | 0.31 | 0.36 | - |
| Leaf cluster, leaves carried | 3 or 4 | 6 | 5 or 6 |
| Cluster bud, length x width | 12 x 8 mm | 16 x 11 mm | 3 to 6 mm in `FACTS` |

The acorn's variant bytes are 7,879,590 of the 8,200,000 limit, at a share of 0.24.

## Look

A fan of six leaves collapses to a line when the camera turns across its plane. The round rosette
keeps its leaves visible all round the turn, and the cluster still carries six leaves round the tip
with the lowest down and out. The still's shape overlap falls because the reference's leaves overlap
in one dense plane, which a round rosette spreads apart. The turn's height spread falls, which is
the rubric's hard band.

The cluster's still loses 0.16 of shape IoU while its turn gains 13 points. The rosette is the
structure the reference's turning video shows, so it is the better look. The branch's turn loses 11
points of height spread, which its still's width error gains 0.035 on. The oak's branch turn already
failed the band before this change.

## Decision

A group of crowded tip leaves keeps each leaf's opening angle and divides the turn evenly round the
stem. A group of leaves at the shoot's own spacing keeps the skyward fan. The rule lives in the
shared shoot builder because every species' terminal rosette radiates round its tip. The oak's own
record sets the shoot classes' values.

A shoot class may name its own stem girth because an old twig is thicker than this year's shoot. This
holds for every species, so the field is shared and the oak sets a three year spray at 13 mm and a
two year shoot at 6 mm. A class may also name its lateral angle, and the oak's spray spreads at 60
degrees.

The extras' scale ring now stands at each row's crest between the profile's own points. The old
uniform resample skipped a shallow cup's shape, which left the acorn a flat pod. The oak's acorn
keeps ten profile points and gains three scale rings. Its share falls from 0.30 to 0.24 to stay
inside the variant byte budget.

Rejected: cutting the branch from the grown plant. Its thick wood is right, but its shoots are each a
metre long and the piece reads wrong: branch shape IoU 0.12 against 0.23 and sky gap 0.69. Its old
wood with grown shoots is a different structure from the reference's branch.

Rejected: a uniform resample of the whole acorn profile at twice the rings. It restores the shape but
adds about 45 vertices to each of the variant's acorns, which costs 2.28 MB and passes the byte
budget.

Rejected: six leaves a spray. The kit's byte cap is 5.3 MB and six leaves a shoot reach it at 5.32
MB, while the branch's width moves under 2 per cent.

## Consequences

`ShootClass` gains optional `stem` and `lateral` values. `ExtraShape`'s lathe gains an optional
`scaled` range. The API reference carries their doc comments. A crowded tip's leaves now spread round
the stem for every species with a rosette. The fan test is scoped to a shoot whose leaves stand at
the shoot's own spacing. The oak's stills and its three Mac plant pictures move.
