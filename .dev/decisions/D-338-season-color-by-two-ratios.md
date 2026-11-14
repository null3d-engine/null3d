# D-338: a species' season color, fitted by two ratios

Status: decided and built in the bracken's record, with the figures below. The method applies to
every species that ships a season variant, and no other species has used it yet. Task: M3-V4.

Summary: a season's color is fitted in two steps. The season photograph's foliage over the summer
photograph's gives a per-channel ratio. That ratio multiplies the leaf's summer faces. If the render
then overshoots one channel, a second per-channel ratio on the rendered foliage against the
photograph's mean lands it. On the bracken the first step read 13.3 color steps against the autumn
photograph. The second read 0.8, while the summer faces stayed at 2.4 and 1.3.

## Question

How does a species fit a season variant as the species' own color in another season? The variant must
not be a different hue that happens to score. One set of leaf optics serves every season, so a season
change must not move the summer faces.

## Rule

- Row 10 of the [plant review](../plant-review.md) asks that a season variant is a variant of the
  species' color rather than a different hue.
- A color difference passes at 3 steps or less, where about 2 is one visible step.
- A season change may not move a summer face past the band. The summer faces are the mark.
- Each figure names the run it was measured in, because a figure from another base is a note.

## Data

The bracken's leaf optics carry the texture's measured linear face means, 0.105, 0.182 and 0.033 for
the upper face. The autumn color was first a guess, 0.3, 0.14 and 0.04. The two photographs' foliage
means are still `01` at `#74895e` and still `19` at `#986d49`.

| Measure | Value |
| --- | --- |
| Summer foliage, still `01` | `#74895e`, linear 0.175, 0.250, 0.112 |
| Autumn foliage, still `19` | `#986d49`, linear 0.314, 0.153, 0.067 |
| Photographs' ratio, per channel in linear light | 1.80, 0.61, 0.60 |
| First fit: reflectance, then transmittance | 0.189, 0.111, 0.020 and 0.216, 0.147, 0.030 |
| Rendered autumn foliage after the first fit | `#9c8443`, too green, 13.3 steps |
| Second ratio, rendered foliage against the photograph | 0.96, 0.64, 1.29 |
| Final fit: reflectance, then transmittance | 0.181, 0.071, 0.026 and 0.207, 0.094, 0.039 |
| Autumn color difference | 12.8 before, 13.3 after the first fit, **0.8** after the second |
| Summer faces | `24` at 2.4 steps and `25` at 1.3, unmoved |

How the data was produced: `bun run plants:review bracken --only stills --stills 19`, seed 11,
variant 0, preset high, with the species' slot file. The first fit was run `bracken-15`, the second
run `bracken-17`, both at the record that commits the values. The foliage means are the review's own
measure of each picture, in sRGB hex.

## Look

The second fit reads as the autumn photograph's rust. The first fit kept the red channel but stayed
too green. The rendered blade is the reflectance mixed with the light and the light through the leaf,
not the reflectance alone.

## Decision

Fit a season in two steps, and stop when the color difference is inside its band.

- Chosen: the photographs' ratio first, then a ratio on the rendered foliage if a channel overshoots.
  The second step is a ratio, so the result stays a variant of the same green.
- Rejected: a color picked by hand, as the first autumn value was. It read 12.8 steps and was not
  tied to the photographs.
- Rejected: the photographs' ratio alone. It lands the albedo ratio, but the rendered color also
  carries the light and the light through the blade, so it read 13.3 steps.
- Rejected: changing the leaf's summer optics to help the autumn. The summer faces are the mark, and
  the autumn override reaches the season alone.

## Consequences

- The bracken's record holds the final autumn reflectance and transmittance, with a comment naming
  the two ratios.
- A species with a season photograph fits it by the same two steps before its first verdict round.
- The review's row 10 figure moves from 12.8 to 0.8 without touching the summer pictures.
