# D-329: the review frames a limb for the secondary-branching and winter pictures

Status: decided and built. The review's limb view, and the two slot rules that use it. The round-8
review is pending. Task: none.

Summary: pictures 09 and 20 show a limb with its side twigs, but the review drew a bole fork for 09
and the whole winter plant for 20. The new limb view frames a limb of the reference's own thickness
at the crown's edge, seen from below and beside it. The 09 edge figure falls from 0.261 to 0.047, and
20 now draws its winter twigs and their buds. The shoot builder already stands an axillary bud at
every leaf node: 8, 18 and 79 in the three prototypes, 8.8 to 13.5 mm long. The winter still hid them
because its view drew the wood alone.

## Question

The reference's secondary-branching and winter pictures show a limb with its side twigs at close
range. Which view makes the render show the same thing, so the row 3 figures measure the plant?

## Rule

The review works in the order framing, content, light, then data
([plant references](../../.dev/plant-references.md)). So a picture of a limb's twig system must be
compared with a render of the same piece of the plant at the same scale. A close-up compared with a
whole plant, or with a bole fork, gives a figure about the comparison.

## Data

| Picture | Measure | Old view | Limb view |
| --- | --- | --- | --- |
| 09 secondary branching | Edge directions | 0.261, `fork` at 2.5 m | 0.047 |
| 20 winter architecture | Shape IoU | 0.35, whole plant, wood only | 0.21 |
| 20 winter architecture | Width error | 0.205 | 0.224 |
| 20 winter architecture | Sky gap, render against reference | 0.50 against 0.53 | 0.59 against 0.53 |
| 20 winter architecture | Color difference | 10.0 | 13.1 |

How the data was produced: `bun tools/plant-review.ts pedunculate-oak --refs <the two files> --run
limb6 --only stills`, at `1a423f99a` with this change. The old figures are run `final7` at
`d0d1bcc2`. Its 09 figure is the same 0.26 that `foot1` gave at `13aebfe1`.

The 20 outline figures do not compare like with like across the two columns. The old render was the
whole plant's silhouette beside a limb close-up, so its 0.35 says nothing about the plant. The new
figures compare a limb close-up with a limb close-up at the reference's own scale. Both are low,
since the outline measure reads how much of the frame two branch arrangements fill. It does not read
the architecture. The color figure moved the other way because the frame now holds more of the
limb's bark, and that bark is paler than the reference's. The bark row measures that surface in its
own views, where it reads 3.8 against the photograph (D-328).

## Look

The reference 09 and 20 both stand a limb across a plain backdrop with its side twigs spread round
it, the sky behind. The old 09 render was a wall of bark ridges with a few leaves at the edge. The
old 20 render was a whole tree's silhouette. The limb view draws a limb entering from one corner
with twigs and their bud clusters against the sky. The buds stand at the twig joints and at their
tips.

## Decision

The limb view draws the picture, and slots 09 and 20 use it. Each slot names the limb's thickness and
the frame's height in meters, taken from its reference. Slot 09 takes 25 mm and 600 mm; slot 20 takes
50 mm and 350 mm. The view takes the axis whose radius at the named share stands nearest that
thickness. Among those it takes the one that reaches furthest from the stem, so the limb stands at
the crown's edge with nothing thicker in front of it. The camera stands beside the crown's edge,
below the limb. Thus the wood runs across the frame and the sky stands behind it.

Rejected routes:

- **Keep the whole winter plant for 20.** The reference is a close-up of one limb. The outline
  figures then describe the comparison, not the plant.
- **Keep the bole fork for 09.** It frames the trunk and the first fork, and the render filled the
  frame with bark ridges. Every species' slot 09 was drawn there, so every species' row 3 figure
  described its bark.
- **The twigs view for 20.** It stands inside the crown at a shoot tip, so a thicket fills the frame
  and no sky stands behind the twigs.
- **Dropping the wood-only flag from the whole winter view.** The buds then draw, but on a whole
  tree they are specks. The shape figure moved 0.35 to 0.36, and the color figure worsened.

## Consequences

`tests/pages/lib/plant-review/views.ts` gains the limb view, and
`tests/pages/sketches/plant-review-sketch.ts` gains its camera.
`tools/lib/plant-review/references.ts` maps slots 09 and 20 to it. The skeleton view keeps its own
purpose, a whole winter plant drawn as wood alone, but no slot uses it. The span and thin query
fields now serve a bark view and a limb view. Every species with a secondary-branching picture is
now judged on the limb view, so their row 3 figures change. The oak's is the only one measured so
far.

## Note on picture 16

Picture 16 (`bark on limb`) is judged by edge directions, 0.225. Its reference shows a limb in
context, with twigs and sky round it, while the bark-limb view frames a wall of bark at 0.8 m. The
figure therefore measures the framing, not the bark: a bark wall's edge directions are its ridges,
and a limb in context's are its twigs and sky. The pair needs a view at the reference's framing
before its figure says anything about the surface.
