# D-346: sparseness thins the plant, the coarseness only smooths its mesh

Status: decided. Coarseness no longer prunes twigs or shoot rows; it reaches the wood mesher alone.
Sparseness keeps the drawn height in the record's band. Task: none.

Summary: The owner made the two dials a hard rule: sparseness is sparse foliage, polygon count is
how finely the plant is defined, and neither may move the other. The coarseness now changes only the
wood's rings and sides, so a coarser plant keeps every twig, shoot row, leaf and card.

## Question

What may each dial move? Before this record, the coarseness pruned up to 30 per cent of the finest
twigs and kept as few as 20 per cent of the shoot rows. The crown therefore thinned as the polygon
count rose, which the owner forbids: the polygon count must not change what the plant grows.

## Rule

- Sparseness moves how much foliage and wood the plant grows. It must not move the drawn top out of
  the record's height band.
- Polygon count moves how finely the same plant is expressed: the wood's edges, rings and sides, and
  the section sparsity. It must not change the twig count, the shoot rows, the leaf count, the card
  count or the crown's box.
- Each dial keeps its own work: a change to one leaves the other's figures where they were.

## Data

| Measure | Coarseness 0.2 | Coarseness 0.8 | Before the rule |
| --- | --- | --- | --- |
| Cards at the first card level | 3,178 | 1,190 | The crown thinned 63 per cent |
| Drawn shoot rows | as grown | as grown | Fell to 20 per cent |
| Crown top at sparse 0, 0.5, 1 | 20.16, 20.41, 18.76 m | | 24.54 m at sparse 0.5 |

How the data was produced: `bun test packages/vegetation/src/dials.test.ts` and
`bun test packages/vegetation/src/coarseness.test.ts` on the oak at the high tier, before and after
the change. The record's height band is 18 to 22 metres.

## Look

Not a look decision: the rule is the owner's, and both dials keep the plant's drawn form. The grid
draws that show the columns are recorded on the batch's state file.

## Decision

The coarseness reaches the wood mesher only. The twig prune and the shoot-row thinning are removed.
A triangle target still picks a coarseness, but only the wood mesh's range is reachable: a target
inside that range is met, and one below it takes the coarsest. This supersedes the pruning and
row-thinning stages of [D-314](D-314-plant-coarseness.md); its triangle-target and bytes rules
remain.

## Consequences

- `grow/coarsen.ts` keeps only the bare-wood trim that a record asks for.
- The shoot instancer keeps every row at every setting.
- The section sparsity stays a separate share, so the far level can still draw a handful of
  triangles without thinning the crown.
- The dial tests assert the crown's cards, leaves and box hold within 2 per cent as the wood
  coarsens, and that sparseness keeps the top in the record's band.
