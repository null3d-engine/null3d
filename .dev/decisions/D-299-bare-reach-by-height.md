# D-299: a bough's bare reach follows its height in the crown

Status: superseded by [D-323](D-323-plant-core-three-scales.md): the first generator that this record describes is removed, and the plant core grows the plants. Task: none.

Summary: a conifer shows wood where its whorls stand apart and wraps its leader where they crowd, so
`leaf.startTop` lets a record vary a branch's bare reach between the crown's foot and its top. The
spruce takes 0.32 at the foot and 0.05 at the top, and its upper whorls now wrap the leader instead
of leaving it bare between them.

## Question

The spruce's cards began five per cent along each bough, which hid the wood where a bough leaves the
trunk. Moving them out to a third brought the boughs into view and left the leader bare for longer,
because the same span served the widest whorls at the foot and the crowded ones at the top. Can one
record value serve both ends of a tree whose shape changes as it rises?

## Rule

The two passing species must not move, both memory budgets must hold, the twenty-tree stand must
keep its frame rate at Low and Medium on the GPU's own clock, the crown must read correctly from the
standard camera and from below, and the change must state which row it was aimed at and which row it
moved.

## Data

| Measure | One reach for every bough | Reach by height |
| --- | --- | --- |
| spruce, twenty trees, Low, GPU | 12.55 ms, 60.0 fps | 12.68 ms, 60.0 fps |
| spruce, twenty trees, Medium, GPU | 16.38 ms, 58.6 fps | 23.33 ms, 59.8 fps |
| pine crown picture | `09fe45c1` | `09fe45c1` |
| whole built-in set | 35.12 MiB | 35.12 MiB |

How the data was produced: `target/tree-render/stand.ts` with `STAND_SECONDS=5`, governor off, one
browser; the review sketch's whole, crown and below views through `target/tree-render/render.ts`.

The whole built-in set is unchanged because the spruce is a review record and no built-in species
names `startTop`.

## Look

Aimed at the row for branch wood, which the crown view shows: boughs read as wood from the trunk
outward in the upper crown and the inner reach fades with height. The row it moved is the leader: in
the same view the top whorls now carry foliage close to the leader, where one reach for every bough
left a bare stick between them. From below the crown still closes, so the upper fill is not a shell.

## Decision

Take `startTop`. It meets the rule: the passing species byte-identical, both budgets held, sixty
frames a second at Low and Medium, and the two angles agree. Rejected: one span for every bough,
which cannot be right at both ends of the same tree, and a per-whorl list of reaches, which is a
value per branch rather than a property of the form.

## Consequences

`Species.leaf.startTop` is in the API guide with its validation. A record that leaves it out keeps
`start` on every branch, which the byte-identical pictures of the other species show.
