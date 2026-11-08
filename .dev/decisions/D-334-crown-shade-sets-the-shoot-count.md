# D-334: a crown's shade sets how many shoots it keeps

Status: decided tonight as a budget, with the mechanism recorded for the next engine change.
Task: none.

Summary: the layered sky prune keeps a shoot when its sky share is at least a share of its height
layer's best-lit shoot, so a brighter crown keeps more shoots. Lowering the crown's sky extinction
from a half to three tenths grew the elm's shoot rows from 7,185 to 8,412 and its variant from 13.21
to 15.36 MB, over the species' caps; the keys' own trim brought it to 14.98. The elm's caps rose to
15.1, 15.2, 15.4 and 15.6 MB. A rank-based prune would hold the count, and is left for its own
change because it moves every species' crown.

## Question

Should the crown's sky extinction be changeable without changing how many shoots a crown keeps?

## Rule

The shading term must change the crown's color alone: a species' sky gaps, outline and shoot count
stay where its round put them, and its budget follows the crown its photographs show, not the light
term of the day.

## Data

Measured on the English elm at seed 11, variant 0, high tier, on the merged tree where the
extinction is three tenths:

| Measure | Extinction 0.5 | Extinction 0.3 |
| --- | --- | --- |
| Shoot rows | 7,185 | 8,412 |
| Variant bytes, high tier | 13,205,823 | 15,361,409 |
| Variant bytes now, low to ultra | - | 14.66, 14.79, 14.98, 15.20 MB |
| Variant byte cap, high tier | 14,000,000 | 14,000,000 |
| Sky gap, first view | 0.088 | 0.087 |
| Shape overlap, first view | 0.774 | 0.774 |
| Kit bytes, high tier | 9,127,000 | 9,127,000 |
| Oak variant bytes, high tier | 7,347,382 | 10,879,596 |

The elm's prune is `skyPrune: 0.33` with `skyPruneLayer: 1`: within each meter of height, a row
survives when its sky share is at least a third of the best-lit row in that layer. A brighter crown
lifts and compresses those shares, so more rows clear the same threshold. Unpruned the elm has 8,650
rows, so the layered rule drops 1,465 at a half and 238 at three tenths; the flat rule at a third
drops 2,946.

Raising the elm's own prune to a half restores 13.13 MB at three tenths, but it thins the crown and
the profile's sky gap is already 0.0076 over its ceiling.

The oak rises from 7.35 to 10.88 MB and stays inside its 11.3 MB cap. Its rows rise with the same
mechanism, so every species with a layered prune moves when the shading term moves.

## Look

The crowns look the same either way: the elm's sky gaps and outline overlap move by a thousandth
between the two extinctions, and its crown boxes are identical in pixels. The extra rows stand
inside the crown where the far cards cover them. So the visible crown does not choose between the
options; the budget does.

## Decision

The elm's variant caps rise to 15.1, 15.2, 15.4 and 15.6 MB, and its far level's triangle budget to
30,000, which is below the owner's 43,000. The layered prune is not changed tonight: it decides
every species' shoot count, and twenty species are drawing against it.

Rejected tonight, for the next change:

- **A rank-based prune.** Keeping the best share of each height layer's rows by rank holds the row
  count, the budget and the crown whatever the shading term does. It is the right mechanism, and it
  moves every species' crown, so it needs its own round for each.
- **A higher sky prune on the elm alone.** It restores the budget and thins the crown, and the
  profile's gap is already over its band.

## Consequences

Any change to the crown's light is also a change to every species' shoot count and variant bytes
while the threshold form stands. A species' budget read before such a change is not comparable
after it. Read the rows, not only the colors, when a shading term moves.
