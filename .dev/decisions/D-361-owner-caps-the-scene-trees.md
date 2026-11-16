# D-361: The owner caps each scene's trees by preset and accepts the redrawn pictures

Status: decided by the owner; Creek's cap is built on the milestone branch and the forest's is in
its gate. Task: M3-V11, M3-V12.

Summary: The owner ruled: "Make the scenes cheaper on mobile" and "Do whatever you have to, get those
tasks finished". Each canopy tree in Creek and the forest demo takes a triangle maximum from its
preset. The maximum is 400 at Low, 700 at Medium, 1,100 at High and 1,500 at Ultra. The crowns draw
coarser, so the pictures move. The moved references are redrawn and accepted. The cap is not raised
to keep the old pictures.

## Question

The iPad's Creek rows read 87.71 ms at High and 118.10 at Ultra. Their ceilings are 62.5 to 67.1 and
71.1 to 99.0 ms. The forest's rows miss on the scene alone, with the wind switched off. One oak's
nearest level drew 657,452 triangles at High. May the demos cap their trees, and may the pictures
that the caps move be redrawn?

## Rule

The cap is the owner's answer for the mobile rows. A cap is a preset's ceiling on one tree's
triangles at its nearest level. The vegetation add-on shares that ceiling across the tree's parts.
Each part's share follows its share of the visible outline. The crown therefore keeps its silhouette,
and the wood it hides gives up its triangles first. A stand-in species grows as it is, because the
add-on has no budget for it.

The pictures are a consequence of the cap, not a separate look choice. A coarser crown draws
different pixels. A reference that keeps the old ones fails its test. The owner's decision to make
the scenes cheaper covers the redraw. The drawn pictures are recorded with their run.

## Data

| Measure | Figure |
| --- | --- |
| Caps at Low, Medium, High, Ultra | 400, 700, 1,100, 1,500 triangles a tree |
| The oak's nearest level at High | 657,452 to 1,096 triangles |
| The oak's nearest level at Ultra | 19,642,402 to 1,498 |
| Pixels moved, WebGPU, compatibility, WebGL2 | 4.156, 3.240, 4.222 per cent |
| iPad Creek High, before and after | 87.71 to 85.87 ms |
| iPad Creek Ultra, before and after | 118.10 to 117.95 ms |
| Triangles in the iPad's High window | 3,130,000 to 2,200,000 |

How the data was produced: the triangle counts come from the species' own grown levels. They were
grown at sparseness 1, seed 7, four variants, in the add-on's budget report. The picture movement
comes from `bun run test:images -g demo-creek` on this Mac's GPU. It was run against the references
of the head before the cap. The iPad rows come from the vegetation plan at `650b60fa6` in Safari
26.6.1 on the iPad Pro 13 2025. Each page held render scale 1. The rows before the cap come from the
same plan at `1c6785724`. The redraw was made on this Mac's GPU on all three tiers. The software set
follows from CI's drawing.

## Look

The caps make the crowns coarser. That is the owner's choice for the mobile frame. The redrawn
references are the look the demo now has, not a stale acceptance. The same cap draws them on every
device.

## Decision

The caps and their redrawn references are taken. Raising the caps to keep the old pictures was
rejected: it keeps a cost the owner ruled against. Leaving the references unredrawn was rejected:
the picture test then fails on every run.

## Consequences

`examples/showcase/creek/plants.ts` and `examples/forest/sketch.ts` carry their preset ceilings.
`examples/lib/plants.ts` passes the ceiling to the add-on. The Creek and forest references are
redrawn in both sets. The measurement after the cap shows the caps buy triangles, not frame time. The
iPad's High window lost 930,000 triangles and 1.84 ms. At High the later passes read 73.8 ms of the
frame's 85.9 ms, and those passes hold the opaque pass and what follows. The rows therefore stay
open. The pixels the later passes shade are the cost that remains, not the near trees' triangles.
