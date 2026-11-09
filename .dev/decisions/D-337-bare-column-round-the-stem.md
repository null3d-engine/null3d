# D-337: a bare column round a stem below the record's line

Status: decided and built as the optional record field `shoots.placement.bareBole`. The European
beech sets a 4 m radius below 0.17 of its height, with a 15 degree lift of its shoots. The
pedunculate oak and the common ash leave the field unset and place exactly as they did. Task: none.

Summary: The beech's bole did not read because its low skirt covered it. A shade line could not
reach the skirt. Raising it from 0.06 to 0.25 moved each whole view's sky gap by about a thousandth,
and the picture did not change. A record may now keep a bare column round each stem below a share of
the height. The beech's 4 m column clears the trunk's own stretch and opens the crown's underside.
The skirt beyond it still covers the bole to the fork, which stays a stated limit.

## Question

What keeps the trunk and the great limbs from reading through the crown? What record rule clears
them without removing the low skirt that the photographs show at the rim?

## Rule

- The change is an optional record field, off by default, so a species that does not set it places
  exactly as it did.
- The radius and the height share are record values, not constants, so another species sets its own.
- The rule reads each shoot row's own position, so a shoot that spreads from an outside bud into the
  column goes too.
- The placement keeps to the engine's own maths, which the mathematics rule enforces.

## Data

Measured at the beech's own runs, seed 11, variant 0, preset high, stills only. Each run's figures
name its whole views' sky gap. The reference's gaps are 0.0686, 0.0442 and 0.1065.

| Change | 01 gap | 02 gap | 18 gap | Whole view pieces, 01 / 02 |
| --- | --- | --- | --- | --- |
| Shade line 0.06 | 0.0825 | 0.0765 | 0.0844 | 3 / 4 |
| Shade line 0.25 | 0.0865 | 0.0784 | 0.0845 | 1 / 4 |
| Column 1.2 m | 0.0848 | 0.0777 | 0.0864 | 3 / 4 |
| Column 4 m | 0.0854 | 0.0784 | 0.0870 | 3 / 4 |
| Column 4 m, lift 15 | 0.0898 | 0.0810 | 0.0898 | 2 / 2 |

The shade line moved each gap by about a thousandth from 0.06 to 0.25. The inner skirt's growth
light therefore stands above the line. The column took the silhouette's pieces from 7 to 5 by
removing low rim shoots. The 15 degree lift gave the two whole views their best piece counts. It
raised the silhouette back to 9 blade groups at the rim.

## Look

At 4 m the trunk shows from the ground to about a meter and a half. Sky and meadow show under the
crown's flanks. The bole to the fork still does not read. The covering foliage stands 4 to 17 m from
the trunk, between a side camera and the bole. The photographs get their bole from a skirt that is
high toward the camera and low at the flanks. The crown's placement cannot vary the skirt's height by
azimuth, so that part stays a limit.

## Decision

Chosen: the optional column, the beech at 4 m and 0.17 of its height, with the 15 degree lift.
Rejected: a stronger shade line, which does nothing above 0.15. A wider column would delete the
skirt the photographs show at the rim. A layered sky prune does not carry the silhouette's margin of
under a thousandth. A growth floor would cut the rim's low foliage rather than the inner skirt.

## Consequences

- `shoots.placement.bareBole` in `packages/vegetation/src/core/record.ts`, the row test in
  `packages/vegetation/src/leaf/instancer.ts`, and the range check in `core/check.ts`.
- `packages/vegetation/src/leaf/foliage.test.ts` places a synthetic skeleton with buds inside the
  column below its line, inside it above the line, and outside it. It also holds that an unset record
  places exactly as before.
- The bole to the fork remains a stated limit for the beech.
