# D-302: larger cards at the crown's rim even the silhouette but add no mass

Status: superseded by [D-323](D-323-plant-core-three-scales.md): the first generator that this record describes is removed, and the plant core grows the plants. Task: none.

Summary: `Leaf.rim` enlarges a crown's outer cards and thins them to every other one. Measured at
eight angles it narrows the rim's variation from 53.1 to 41.7 per cent and leaves its mean fill at
19.3 per cent, so it buys evenness and not mass.

## Question

The live oak's rim reads as a spray: thin cards spread evenly, with sky between them. Fewer, larger
cards at the outer third should read as a mass broken by tufts.

## Rule

The rim's own fill must rise, its variation round the tree must not grow, the crown's fill must stay
above a third, and the other species must not move.

## Data

| Measure | Before | After |
| --- | --- | --- |
| rim fill, mean of eight angles | 19.3 % | 19.3 % |
| rim fill, thinnest to fullest | 15.0 to 25.3 % | 15.8 to 23.9 % |
| rim variation, spread over the mean | 53.1 % | 41.7 % |
| crown fill, mean of eight angles | 35.3 % | 35.9 % |
| crown width over height | 1.23 | 1.23 |

How the data was produced: eight whole views at 45-degree turns through `target/tree-render/render.ts`
with the clump oak's record, each picture's foliage masked and its rim taken as the annulus beyond
two thirds of the crown's own half-width and half-height.

The line the crown must not cross is a third: below it the crown is a shell and gappy. At 35.9 per
cent the margin above that line is thin, and a further thinning of the fill would cross it.

## Look

The rim is more even round the tree and no fuller. In the standard view the edge still shows sky
between cards at the thinnest angles, so the spray the reviewer named is reduced in its variation and
not in its openness.

## Decision

Keep `rim`, because evenness round the tree is one of the owner's rules and it improved by a fifth
with no loss of crown fill. Record plainly that it does not close the rim: the mass must come from
somewhere else, most likely from the limb ends carrying more of the crown's cards rather than the
crown's volume spreading them.

## Consequences

`Leaf.rim` is in the API guide with its validation. A record that leaves it out draws every card the
same size.
