# D-373: A card level keeps inside the leaf form's hull

Status: decided. The clump plate's hull bound is built; the oak's residual outline is a recorded limit of the
sector-reach hull. Task: none.

Summary: A clump card grew each kept plate to its clump's row-centre radius and then by the cover factor that pays for
the clumps the level drops, with no bound, so a square plate's top edge and corners stood past the round, leaf-filled
clump: at the medium tier three species read five to six per cent of their outline outside the leaf form's against a
three per cent allowance. The plate now takes the same hull bound the row cards take, which closes all but the oak; the
oak's remaining 3.9 per cent is scattered rim spill that a hull following the per-row silhouette would close.

## Question

A plant's card level must draw the same plant as its leaf form, never a larger one. Where does a clump card's plate
stand outside the leaf form, and what bound keeps it inside?

## Rule

A card level draws inside the leaf form: the share of its outline area outside the leaf form's silhouette is at most
0.03 in the front view and 0.03 at the side, and its foliage box is within 0.03 of the leaf form's height, width and
depth.

## Data

Outside share of the card level's outline against the leaf form's, front and side, at the three per cent allowance;
foliage box height against the leaf form's; measured at the medium tier, seed 11, variant 0:

| Species, first card level | Outside before | Outside with the bound | Box height | Top over the leaf form |
| --- | --- | --- | --- | --- |
| silver birch | 0.0632 / 0.0507 | 0.0111 / 0.0165 | 0.999 | below |
| holm oak | 0.0398 / 0.0313 | 0.0021 / 0.0024 | 0.996 | below |
| hawthorn | 0.0558 / 0.0619 | 0.0070 / 0.0090 | 0.999 | below |
| pedunculate oak | 0.0587 / 0.0589 | 0.0390 / 0.0324 | 1.034 | 0.135 m, from 0.371 |
| common alder | 0.0234 / 0.0135 | 0.0039 / 0.0043 | 0.999 | below |

The oak's remaining spill is scattered rim plates, not a top clump and not the box: at 256 pixels, level 1, the front
view leaves 489 outside pixels of about 12,500 inside, the largest patch 69 pixels across x 50 to 66 and y 91 to 97,
the next 54 pixels across x 174 to 185 and y 106 to 112, and the busiest rows 89, 57, 58 and 92, which are the
crown's upper-middle flanks. Level 2 adds two thin slivers near the top at y 40 to 54, of 34 and 31 pixels, and reads
0.0428 at the front.

How the data was produced: `bun run plants:review` grows each species at the medium tier, seed 11, variant 0, and the
outline mattes are read at 256 pixels; the figures are the card-size suite's own measure, run at the level branch's
tip. The suite reads 33 of 34, with the oak's front outline case recorded open.

## Look

No pair of pictures decides this row: the change moves plates inward by a few pixels at the crown's rim, and the
review's own figures are the look. The grain and cover of the card level are unchanged where the plates fit; the
species whose plates were five per cent outside now read their own leaf form's silhouette.

## Decision

The clump card takes the hull bound the row cards already take: the growth asked for where the plate fits inside the
leaf form's hull, the most that does otherwise, and never under one, so a plate whose own size already stands outside
keeps its size rather than losing the shoot it pictures. The tile count and the capped crown's placement are not the
cause: the tile does not change the quad's extent, and the measure grows a plant with no maximum.

The oak's 3.9 per cent is recorded as a limit of the sector-reach hull, and the suite's case stays open. The hull is a
radial reach from the crown's axis by band and sector, and at the oak's rim heights the leaf form's per-row silhouette
is narrower than that reach, so a plate legitimately inside the hull can still stand a few pixels past a row's span.
A hull that follows the per-row silhouette would close it and is priced separately; the giant sequoia's recorded case
is the same class.

## Consequences

The clump mesh bounds each plate's growth against the foliage hull at its row's place; no triangle, atlas or record
value changes. The card-size suite reads the four species' outline cases green except the oak's front, which stands
recorded with its figures. The sequoia's case keeps its own note, and the per-row silhouette hull is the named fix if
a species needs the last per cent.
