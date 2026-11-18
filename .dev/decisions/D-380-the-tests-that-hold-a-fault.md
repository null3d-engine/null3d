# D-380: Every fault found in review gets a test before its fix lands

Status: decided, with all seven tests written. Task: none.

Summary: Each fault found in review during one day of the vegetation release now has a test that
fails on it, so the same fault cannot land twice. The rule is general: when a review finds a fault,
the fix lands with the check that would have caught it, not after it.

## Question

One day's review found a shader reading the wrong header channel, an experiment swept into a landing,
a triangle maximum silently discarded, nine stale registration cases, a species run drawn against
another species' photographs, and a demo that failed its own memory limit and drew no plants. Which of
these can a test catch, and where does each test live?

## Rule

A fault that a machine can see becomes a test in the same landing as its fix. A fault only an eye can
see becomes a picture in the species' evidence, not a test. A test may not be loosened to make a
species pass; a threshold taken from evidence names the evidence in its comment.

## Data

| Fault found | The check that catches it | Where it lives |
| --- | --- | --- |
| The card gate read the header's second channel while the writer wrote the first | a table over every named header texel comparing the writer's channel with each shader's read | the vegetation render tests |
| A stopped card-link experiment rode into a landing inside an unrelated commit | a rail freezing the card mesh digest at both card levels for the oak and the alder | the vegetation card tests |
| A named triangle maximum was thrown away when the plant's own plan sat under it | the all-species low-cap test: the maximum is applied, one connected body, a foliage share, a crown box, and no wood outside the crown's foliage | the vegetation level tests |
| Nine species kept a stale frame-registration line | one invariant: a frame-grown species is in the list and a planned one is absent, for every registered species | the species tests |
| A new record field could ship with a bad value | every registered species' record is run through the record check | the species tests |
| A species run was drawn against another species' photographs | the review tool refuses a run whose reference folder names another species | the plant-review tests |
| A demo drew its plants only after the last build, and a regrow mixed two builds' plants | the fill's tests: a plant lands as its own grow finishes, the list keeps the species' order, a species that cannot grow leaves its slot empty, a fill that a newer one took the field from stands nothing, and a claim taken before any work stops the build before it | the vegetation demo's tests |

## Look

None of these are look decisions. The look faults of that day are the tile grid, the cover
factor and the plate's grain, recorded in D-365, D-366 and D-367 beside their pictures.

## Decision

The rule stands: a review fault lands with its test. All seven are written. The meadow's fault
came after the streaming change let the field fill plant by plant. Its test reads that change:
the fill is a module of its own, driven by held promises rather than a page. The meadow takes its
claim on the field before it clears or loads anything, and the fill's tests hold the claim's own
rules; the meadow's order of work is read in its code, not in a test.
