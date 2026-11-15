# D-360: a leafy shoot's card stalk draws in the foliage's tone

Status: decided and built as the optional record field `lod.cardStalkFoliageTone`. The silver birch
names it; no other record does. Task: none.

Summary: a card's twig line is wide at a whole view. It drew the young bark's tone, so a weeping
shoot's card read as a bare brown strand and decided the distant crown's color. Drawn in the mean
leaf's tone, the silver birch's distant crown falls from 55.2 to 17.6 per cent brown-leaning pixels.
Its foliage color difference falls 14.46 to 10.19, and the autumn view's 13.55 to 6.19. The line
keeps its geometry, width and material, so the outline, the crown's foliage share and the triangles
do not move.

## Question

A card level replaces a shoot's leaves with a card. The card stands on a line drawn at a least width
of several pixels. On a species whose shoots hang as leafy chains, the line covers a large share of
the crown. The line's tone is the young bark's, so as the engine drops to cards the crown's color
follows the twigs rather than the leaves. A tree that reads green close up then reads brown at a
distance. How does the line keep the cover that closes the plant's pieces without deciding the
crown's color?

## Rule

- A record that names `lod.cardStalkFoliageTone` draws the line in a mean leaf's tone. The tone is
  the upper face's reflectance and roughness from the header, shifted by the season's color as a leaf
  is. It is shaded as foliage inside the crown. A record that does not name it draws the young bark's
  tone at its own shade, as its judged pictures did.
- The line's geometry, width, join and material stay as they are. Its own cover closes the pieces
  and carries the crown's foliage share, so neither moves with the tone.
- The tone is a record's choice, not a shared default. A default would move every species that draws
  a line, and the other species' pictures were not measured for this fault.
- The header's card-stalk texel's fourth number carries the marker, and the plant shader and its
  view-face copy read it. A record that does not name it writes the same header and draws the same
  pixels it did.

## Data

Measured on the silver birch. The fix is `lodcolour-clean2`, drawn at commit `6e1078436`, which is
clean, with seed 11, variant 0 and preset high. The control is `lodcolour-verify-base3`, at the base
commit `7b656bc31` with the field absent. Each run draws stills alone (`--only stills`). Each run
names the species' slot file, which is `tools/lib/plant-review/slots/silver-birch.json`. The distant
still `01-whole-distant` draws at the first card level, 42.57 m from the plant, in a 768 by 516
frame.

| Measure, 01-whole-distant | Control | Fix | The photograph |
| --- | --- | --- | --- |
| Pixels leaning brown, R > G (by 3 or more) | 55.2 (52.9) per cent | 17.6 (15.7) per cent | none by eye |
| Pixels leaning green, G > R (by 3 or more) | 40.8 (37.4) per cent | 78.6 (76.3) per cent | - |
| Mean color over the plant's pixels | 149, 136, 119 | 135, 150, 110 | foliage mean 122, 134, 121 |
| Foliage color difference, CIEDE2000 | 14.46 | 10.19 | - |
| The crown's foliage share | 0.90 | 0.90 | 1.00 |
| Sky gap enclosed by the crown's outline | 0.1631 | 0.1631 | 0.1976 |
| Shape IoU | 0.58 | 0.58 | - |

The distant crown's foliage cluster reads `#958572` in the control and `#869369` in the fix. The
photograph's reads `#7a8679`. The plant's pixels are the texels under half the matte's brightness,
32,693 in both runs.

| Other stills | Control | Fix |
| --- | --- | --- |
| `20-autumn-yellow` foliage color difference | 13.55 | 6.19 |
| `20-autumn-yellow` sky gap | 0.1308 | 0.1308 |
| `11-leaf-cluster` (leaf form, 0.6 m) | 13.1, pixel-identical | 13.1, pixel-identical |
| `04-crown-outside`, `05-crown-underneath`, `19-drooping-twig-ends` (card level) | - | pixels differ; no pair figure moves |

How the data was produced: the review tool drew stills 01, 04, 05, 11, 19 and 20 in each state,
through the shared heavy queue. Each run used the species' slot file, seed 11, variant 0 and preset
high. A Bun script read each color still and its matte. A texel under half the matte's brightness is
plant. A pixel leans green when its green exceeds its red, and brown when its red exceeds its green,
both with and without a three-level allowance. The strict figure comes first in each cell. The
foliage color difference, the gap, the crown foliage share and the shape are the tool's own figures
from each run's `metrics.json`.

Levers measured and refused on the same view:

- **The card's cell.** At the earlier head, `lod.cardCell` 128 draws 30.4 per cent of the crown's
  pixels green-leaning and 65.9 brown-leaning, against the 64 cell's 31.5 and 64.7. The cell changes
  texels, not the line's share of the crown, and four times the atlas per doubling buys no color.
- **The line's width.** `cardStalk` 3 lowers the foliage color difference, but it takes the crown's
  foliage share from 0.90 to 0.836. That is under the photograph's 1.00 less the 0.10 allowance,
  because the line's own foliage-material pixels close the crown's cover.
- **Removing the line.** `cardStalk` 0 takes the foliage share to 0.75 and leaves the pieces
  unclosed.

The switch pixels cannot restore the leaf form at this view. `01-whole-distant` stands at 42.57 m.
The first card level runs from 2.449 to 106.378 m, and the second starts at 106.378 m. Holding the
leaf form to that distance needs the first switch at about 14 pixels of shoot, a seventeenth of the
record's 240. That draws the near foliage's triangles across every mid-distance view. Raising the
second switch moves the coarser level in sooner, the reverse of holding the leaves.

## Look

The control's crown is a curtain of brown strands with green flecks, where the photograph is a green
curtain of leafy hanging shoots. The fix's strands read as foliage in shade: dark green lines among
green leaves, and the crown reads green at the distance it was brown. The card-level close views
(`04`, `05`, `19`) keep their own look: their leaves cover the line at those distances, and their
twigs still show as wood. The autumn view's lines turn with the leaves, so the crown reads gold
rather than green.

## Decision

Chosen: the optional `lod.cardStalkFoliageTone`, taken by the silver birch. Rejected: removing the
line, which leaves the pieces unclosed and the crown's foliage share at 0.75. Rejected: the narrower
line, which takes the share under its band. Rejected: a finer card cell, which moves neither color
figure. Rejected: a shared default. It would move the beech, alder, ash, cypress, holm oak, pine,
willow and the other species that draw a line. Those pictures were not measured for this fault.

## Consequences

- `packages/vegetation/src/core/record.ts` holds `lod.cardStalkFoliageTone`. The species header's
  card-stalk texel carries it in its fourth number (`packages/vegetation/src/render/records.ts`).
- `packages/vegetation/src/render/plant.wgsl` and `plant-viewface.wgsl` draw the line in the mean
  leaf's tone, from the upper face's reflectance and the season's shift. They keep the young bark's
  tone where the record does not ask.
- `packages/vegetation/src/render/records.test.ts` holds the header marker and both shaders' two
  tones.
- The silver birch names the field in `packages/vegetation/src/species/silver-birch/record.ts`.
  Every other species' header and pixels are unchanged.
