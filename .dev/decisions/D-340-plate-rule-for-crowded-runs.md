# D-340: a plate rule for a shoot's crowded runs

Status: decided and built as the optional field `shoots.placement.plate`, off by default. No species
sets it. The European beech tried it in two measured runs and left it unset, so its crown's grain
stays a stated fault. Task: none.

Summary: A blade spans 0.38 per cent of the beech's crown width, where the photograph's plates hold
about 1.2. The photograph's crown therefore reads as plates about three blades across. The shoot
builder can hold a run of crowded nodes to one face. The rosette's fan face does the same for a tip.
Two measurements broke the beech's crown, one confounded and one clean. Its whole views drew 2, 8 and
11 pieces against the same record's 1, 4 and 7. The rule shingles within a run and not between
neighbouring plates, so the field stays for a species whose plates can overlap one another.

## Question

Can the shoot builder make the photograph's overlapping plates, where no thinning field can?

## Rule

- The change is an optional record field, off by default, so a plant that does not set it draws as it
  did.
- A run is a stretch of consecutive nodes whose internodes crowd above a switch of 0.25.
- The run's face is its first crowded node's sky. Every blade of the run keeps it.
- A test holds a run's blades to one face with the field, and shows them turning apart without it.

## Data

| Trial | Classes carrying the crowding and the face | Pieces, 01 / 02 / 18 |
| --- | --- | --- |
| Confounded, `beech-r63` | short and spray, runs of three | 11 / 10 / 12 |
| Assay, `beech-r65` | spray only, runs of two | 2 / 8 / 11 |
| The same record without the field | none | 1 / 4 / 7 |

The joins held in both trials. Measured against each blade's own stem, the radial's along-stem share
is at most 0.002. A plate therefore sits flat on its twig. Row 1's box held at 1.478 through the
confounded trial.

## Look

A flat plate projects as a blade cluster. Within a run the blades overlap as a shingle. But the run's
own edge stands clear of the next plate. The crown's rim therefore breaks into pieces at the scale
the plates were meant to fill. The photograph's plates overlap their neighbours, which this rule does
not do.

## Decision

Chosen: keep the field and its test in the builder, off by default, for a species whose plates can
shingle over one another. The beech leaves it unset. Rejected: the beech's use, which fragments its
crown in both the confounded and the clean measurement. The grain stays a stated fault of the leaves'
size. One blade spans 0.38 per cent of the crown against the photograph's 1.2. A larger leaf fails
row 4.

## Consequences

- `shoots.placement.plate` in `packages/vegetation/src/core/record.ts`, the run face in
  `packages/vegetation/src/leaf/shoot.ts`.
- `packages/vegetation/src/leaf/shoot.test.ts` holds the run to one face with the field.
- The beech's record sets neither the field nor the crowding curve. The handoff states the grain
  fault and both measurements.
