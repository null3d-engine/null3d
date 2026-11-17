# D-375: The planned model takes a rosette family

Status: decided; the rosette block ships with the tree fern, and a plant review round judges its
pictures. Task: M3-V4.

Summary: A crown of fronds from one growing point is a rosette block on the planned model. It lays
one socket a frond with the rank's piece. It takes the crown's box from the pieces' reach and keeps
whole fronds under sparseness and a triangle maximum. A single crown patch would put about 160
sockets in the measured crown. It would also leave the dead skirt one color.

## Question

How does the planned model grow a plant that branches on no woody axis? The plant is a rosette of
whole fronds from one point, with a dead skirt on its own piece.

## Rule

A frond is one socket. It is priced at the record's piece and is one clump under a maximum. The
fronds make the crown's box. Sparseness and a maximum keep whole fronds in a spread rank. The shared
cap rule and the price table do not change. The plant must stay a plausible rosette at sparseness 0
to 1 and at 400 triangles up. Every foliage part stays above the ground.

## Data

The tree fern is the first rosette. Its draft was probed in memory at seed 11, variant 0. No picture
was drawn.

| Measure | The rosette block | One crown patch |
| --- | --- | --- |
| Living sockets | 32 by rank | about 160 from the planned fill |
| Dead skirt | 16 sockets on a brown piece | the living piece's color |
| Pieces a socket names | one by rank | one for all |
| Crown's box | the fronds' reach: 4.24 m tall, base 1.34 m, 1.00 of the height wide | the wood's: 0.72 of the height |
| First card level, high | 2,880 triangles, against the directed fern's 2,136 and a 15,000 budget | the patch's cards |
| Near form, high | 9,738 triangles, against the directed fern's 5,982 and a 90,000 budget | the patch |
| 400 triangles | 40 fronds, each a card; the shape holds | the patch's cards, not the fronds |

Sparseness keeps 50, 43, 35, 28 and 20 sockets from 0 to 1, split between living and dead as 35/15,
29/14, 25/10, 19/9 and 12/8. The height, crown base and crown box hold. Maturity 0.1 to 0.8 grows
0.86 to 3.32 m. Every crown stays above the ground. At 400 triangles the cap keeps the 35 living
fronds and 5 dead ones, and its levels draw 256, 397 and 400 triangles. The frame plan has no NaN,
one stem and no children. The record check, the type check and the rosette's unit cases pass.

How the data was produced: a probe grew the draft over `planFrame`, `planTree` and `growPlanned`. It
ran at seeds 3, 11 and 12 and variants 0 to 3. It also ran at five sparseness values, four maxima and
four ages. The probe is in the build folder of the vegetation session, beside the species' plan.

## Look

No picture has been drawn yet. The review round is the look. It reads the living fountain, the brown
skirt and the croziers at 01, 02, 18 and 03. It sets them beside the directed fern's drawing of the
same views. The eye decides. The first three levers are the frond count, the outer rank's leaving
angle and the frond piece's scale.

## Decision

Take the rosette block, by the lead's ruling. It keeps the ranks, the dead skirt's own piece, the
crown's box from the fronds and a card a frond under a maximum. A single crown patch is rejected. It
springs the fronds from a ball rather than one point. It draws the skirt in the living color. It reads
its crown from the wood. It also cannot keep a card a frond at a low maximum.

## Consequences

`Planned` gains an optional `rosette` block. The record check gains its rules. The planned grower
fills a rosette's sockets from the block. It takes the crown's box from the pieces and keeps a
rosette's stem whole at every maximum. The tree fern's record moves to the planned model. Its
directed frond-crown record is removed. The frond-crown grower still serves the date palm. A rosette
states its trunk's height in the plan's height curve. Its frame is the trunk, and the crown stands
above it.
