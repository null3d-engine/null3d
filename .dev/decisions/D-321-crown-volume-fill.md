# D-321: fill a crown through its volume, not only along its limbs

Status: superseded by [D-323](D-323-plant-core-three-scales.md): the first generator that this record describes is removed, and the plant core grows the plants. Task: none.

Summary: a species record may give `leaf.volume` a share of its crown cards that stand where the
crown's outline puts them rather than on the line between two nearby twigs. The aspen and the birch
take it, and both crowns close from three lobes on a stem into one mass, at no measurable frame cost.

## Question

A filled crown placed every card on the line between two neighbouring twigs. A species whose limbs
are few and long therefore carried one foliage lobe per limb. The aspen and the birch then read as
three masses on a pole, however many cards their records asked for. Should a crown be able to fill
the space between limbs that are not neighbours?

## Rule

The crown must read as one mass from the whole view and from below, the two passing species must not
move, the catalogue's array guard (35.5 MiB) and a scene's budget (25 MB at Low and Medium) must
hold, and the twenty-tree stand must keep its frame rate at Low and Medium on the GPU's own clock.

## Data

| Measure | Record as it was | With `volume` |
| --- | --- | --- |
| aspen, twenty trees, Low, GPU | not measured | 6.03 ms, 60.0 fps |
| aspen, twenty trees, Medium, GPU | not measured | 6.68 ms, 59.6 fps |
| birch, twenty trees, Low, GPU | not measured | 4.39 ms, 60.0 fps |
| birch, twenty trees, Medium, GPU | not measured | 4.29 ms, 60.0 fps |
| whole built-in set | 33.95 MiB | 35.12 MiB |
| pine crown picture | `09fe45c1` | `09fe45c1` |
| clump-oak crown picture | `cbd6b774` | `cbd6b774` |

How the data was produced: `target/tree-render/stand.ts` with `STAND_SECONDS=5`, governor off, one
browser; the budget tests in `packages/vegetation/src/generate.test.ts`; the pictures through
`target/tree-render/render.ts` with the review sketch's whole, crown and below views.

The array total rose because the birch, which had no crown fill, now takes 0.35 of it. The aspen's
total is unchanged: `volume` moves cards that its fill already placed, it does not add any. The two
passing species' crown pictures are byte-identical, so their verdicts rest on unchanged evidence.

## Look

Whole view: the aspen was three vertical lobes with air between them and is now one broad oval of
foliage from a fifth of its height to its top. The birch was three leaf masses on a stem and is now
one crown that closes the space between its limbs, with the trunk still showing through it. The
crown and below views show the same fill from underneath, so neither crown is a shell that closes
from one angle only.

## Decision

Take `volume`. It meets the rule: one mass from both angles, the passing species byte-identical, both
memory budgets held, and sixty frames a second at Low and Medium for both species. Rejected: raising
`fill` alone, which adds cards inside the same lobes and cannot bridge them; and giving the two
species more limbs, which changes their structure rows rather than the fill.

## Consequences

`Species.leaf.volume` is in the API guide with its validation. A record that leaves it out behaves
exactly as before, which the byte-identical pictures of the other five species show.
