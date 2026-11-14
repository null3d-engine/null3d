# D-325: a crowded shoot tip is a round rosette, and a cutting's wood is as old as its shoot

Status: decided. The shared shoot builder, the extras' scale range, the per-class stem and lateral
values, the oak's record and their tests are built. Task: none.

Summary: a shoot's crowded tip now spreads its leaves evenly round the stem instead of into one fan,
so a leaf cluster reads the same from every side. A shoot class may name its own wood girth and
lateral angle, so a three year spray is thicker and wider than this year's shoot. The oak's cluster
carries eight leaves round one plump bud, which closes its sky gap to the reference's and recovers
the shape overlap the first rosette lost.

## Question

How does a crowded shoot tip arrange its leaves, and how does a cut piece show the wood its age earns?

## Rule

The per-species review rubric, rows 2 and 5. A leaf cluster carries five or six leaves round the
full tip, with the lowest down and out. Its crown box spread round a turn stays inside the form's
band of 25 per cent. A cutting is a branched brown shoot at its reference's width and size, with
thicker brown kinked wood.

## Data

Measured on the oak, seed 11, variant 0, preset high, against the species' reference folder. The fan
runs are `fan-merged` and `fan-branch-merged`; the round rosettes are `short8`, `short8-turn` and
`turns-rosette-merged`. All were taken after the merge of `origin/pkg/s0` at `2be80e4e1`, so one
measure judges both sides. The cut-piece pictures are byte-identical across that merge.

| Measure | Fan | Round rosette, 6 leaves | Round rosette, 8 leaves | Reference |
| --- | --- | --- | --- | --- |
| Cluster still 11, shape IoU | 0.42 | 0.30 | 0.44 | - |
| Cluster still 11, width error | 0.248 | 0.287 | 0.203 | - |
| Cluster still 11, sky gap | 0.20 | 0.22 | 0.13 | 0.14 |
| Cluster still 23, shape IoU | 0.41 | 0.29 | 0.46 | - |
| Cluster turn, height spread | 27% | 69% | 34% | 17% |
| Cluster turn, width spread | 45% | 50% | 22% | 57% |
| Branch still 21, shape IoU | 0.23 | 0.24 | 0.24 | - |
| Branch still 21, width error | 0.167 | 0.131 | 0.131 | - |
| Branch turn, height spread | 26% | 23% | 23% | 4% |
| Branch turn, width spread | 31% | 22% | 22% | 98% |
| Sub-branch still 22, shape IoU | 0.33 | 0.38 | 0.38 | - |
| Cluster bud, length x width | 12 x 8 mm | 16 x 11 mm | 16 x 11 mm | 3 to 6 mm in `FACTS` |

The branch turn on this base passes both band figures at 22 and 23 per cent. An earlier comparison
put the fan's height spread at 26 and the rosette's at 37. That comparison was not clean: the fan
figure came from a run on the old base, and the rosette's from a run whose alignment started at
another angle. On one base the round rosette is better on both figures.

The acorn's nut is 2.5 cm across and hangs 7 cm below its tip. At the review's `19` framing it draws
90 px wide in a 768 px picture. The reference's nut draws 170 px in 1024. That is 11.7 against 16.6
per cent of the frame. The acorn cluster draws 39 per cent of the frame width against the
reference's 45. The earlier 5.5 per cent came from a camera that stood 0.55 m from one nut.

The acorns take one to three at a site, at a share of 0.12. The variant reads 8,021,428 bytes of
the 8,600,000 limit, less than the single acorn at the higher share.

The radiating rosette darkens the crown by one colour step, from 8.7 to 9.7 at still 01. A leaf
transmittance of 1.3 times the recorded value carries it without moving the leaf-texture rows:

| Measure | Recorded | Rosette | Rosette and transmittance |
| --- | --- | --- | --- |
| Crown 01 | 7.9 | 9.7 | 8.3 |
| Crown 02 | 5.9 | 7.8 | 6.5 |
| Cluster still 11 | 2.5 | 3.0 | 2.5 |
| Leaf texture 24 | 2.3 | 2.3 | 2.3 |
| Leaf texture 25 | 2.4 | 2.4 | 2.4 |
| Oak turn | 3.2 | 3.2 | 3.3 |

## Look

A fan of six leaves collapses to a line when the camera turns across its plane. A round rosette of
six leaves keeps its leaves visible, but it leaves gaps. Its still's shape overlap falls to 0.30.
Eight leaves fill those gaps. The still returns to 0.44 and 0.46, and its sky gap meets the
reference's 0.14 at 0.13. The turn's height spread falls from the six-leaf rosette's 69 per cent to
34. Six or seven of the eight stand visible, which is the reference's own count.

The cluster still's outline overlap is recovered and its sky gap is right, so the round rosette is
the better look. The branch's still keeps the spray's overlap and gains 0.036 of width error. Its
turn passes both band figures on this base.

## Decision

A group of crowded tip leaves keeps each leaf's opening angle and divides the turn evenly round the
stem. A group of leaves at the shoot's own spacing keeps the skyward fan. The rule lives in the
shared shoot builder because every species' terminal rosette radiates round its tip. The oak's own
record sets eight leaves for its crowded tip, because its reference cluster's blades overlap into a
dense plate.

A shoot class may name its own stem girth because an old twig is thicker than this year's shoot. This
holds for every species, so the field is shared and the oak sets a three year spray at 13 mm and a
two year shoot at 6 mm. A class may also name its lateral angle, and the oak's spray spreads at 60
degrees.

The extras' scale ring now stands at each row's crest between the profile's own points. The old
uniform resample skipped a shallow cup's shape, which left the acorn a flat pod. The oak's acorn
keeps ten profile points and gains three scale rings, and its cup and nut grow to the fact sheet's
2.5 cm.

The acorn's cup now stands 2.6 cm across against its nut's 2.2, with a sharp shoulder, so it reads
as a cap at the review's framing. The wider cup crosses the card level's speck test: a 3.2 cm acorn
draws as a 4 px speck on the whole tree. The speck threshold rises from 3 to 5 px, which keeps the
acorns off the far levels and the variant at 8,021,428 bytes.

The raise was checked across every extras entry in the repository. One species ships extras: the
oak. Its acorn is the only extra on a plant with shoots, and at the first card level it spans 3.0 to
4.2 px with its cup, the band the raise drops. The other entries are test fixtures and the ground
plants. The ground plants carry no shoots, so their card levels use the extra's own size rather than
its pixel span, which the raise does not touch. The test fixtures span 0.7 to 3.0 px at the first
card level on the test oak's short shoots, below both thresholds; the coned fixture's 4 cm cone
spans 10.3 px, above both. So no other species loses an extra.

`ExtraSpec.count` gives how many stand at one site. The oak's acorns take one to three on a stalk
and their share falls from 0.24 to 0.12, so the variant reads 8,021,428 bytes against the 8,600,000
limit, less than the single acorn at the higher share.

Rejected: cutting the branch from the grown plant. Its thick wood is right, but its shoots are each a
metre long and the piece reads wrong: branch shape IoU 0.12 against 0.24 and sky gap 0.69. Its old
wood with grown shoots is a different structure from the reference's branch.

Rejected: widening the spray's laterals. Every lever that widens its foliage box also thins it,
because a longer lateral carries the same leaves. A lateral angle of 75 degrees takes the box from
0.79 to 0.83 wide over tall and the still's shape IoU from 0.24 to 0.21. A lateral unit of 1.0 takes
the box to 1.07 and the overlap to 0.21. The wide and dense branch needs six leaves a shoot, which
reads 5.32 MB against the kit's 5.3 MB cap.

Rejected: a uniform resample of the whole acorn profile at twice the rings. It restores the shape but
adds about 45 vertices to each of the variant's acorns, which costs 2.28 MB and passes the byte
budget.

The review's fruit view now frames the stalk and the acorns it carries, at the share of the frame
that the reference's own close-up gives the cluster. The cluster's drawn width goes from 16 to 39
per cent of the frame against the reference's 45, and a nut from 42 to 90 px in 768 against the
reference's 170 px in 1024. Most of the earlier 5.5 per cent was the framing, not the record's size.

Rejected: six leaves a spray. The kit's byte cap is 5.3 MB and six leaves a shoot reach it at 5.32
MB, while the branch's width moves under 2 per cent.

## Consequences

`ShootClass` gains optional `stem` and `lateral` values. `ExtraShape`'s lathe gains an optional
`scaled` range, and `ExtraSpec` gains an optional `count`. The API reference carries their doc
comments. A crowded tip's leaves now spread round the stem for every species with a rosette. The fan
test is scoped to a shoot whose leaves stand at the shoot's own spacing. The rosette test checks the
leaves' turn round the stem rather than the oak's numbers. The oak's stills and its three Mac plant
pictures move.
