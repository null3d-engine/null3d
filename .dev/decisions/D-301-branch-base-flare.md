# D-301: a branch swells where it leaves its parent

Status: superseded by [D-323](D-323-plant-core-three-scales.md): the first generator that this record describes is removed, and the plant core grows the plants. Task: none.

Summary: `BranchLevel.baseFlare` widens a branch where it leaves its parent, drawn but not piped, so
a limb's joint reads as massive without thickening the trunk that carries it. The clump oak's
limb-to-trunk ratio rises from 0.25 to 0.86 against the reference's roughly 1.0.

## Question

A live oak's limb leaves its trunk at nearly the trunk's own thickness, and that is why the departure
reads as heavy. The generator gave a child a fixed quarter of its parent's radius at every taper, so
no record value could produce the joint. Can a branch swell at its base?

## Rule

The limb-to-trunk ratio must approach the reference's, the trunk-to-crown ratio must stay near it,
the other species must not move, both memory budgets must hold, and the drawn result must be measured
before it is described.

## Data

| Measure | Before | After | Reference |
| --- | --- | --- | --- |
| trunk diameter | 1.01 m | 1.01 m | not measured |
| limb diameter where it leaves | 0.25 m | 0.88 m | not measured |
| limb over trunk | 0.25 | 0.86 | about 1.0, estimated |
| trunk over crown width | 0.077 | 0.077 | about 0.09, estimated |

How the data was produced: the plant's own radii through `growSkeleton`, with the drawn radius taken
as the radius times the flare scale; the pictures through `target/tree-render/render.ts`. The
reference figures are pixel estimates from the photographs and are labelled as such: a mask over a
furrowed, mossy trunk fragments too finely to measure it reliably.

## Look

The delivered batch `live-oak-2026-11-03-0635` shows the crown unchanged, as a change below the
foliage should: 1.24 wide over tall and 41.8 per cent fill, against 1.24 and 41.9 before. The trunk
view shows the base at a metre across, and the skeleton view shows each limb swelling where it meets
the trunk. In the whole view a limb's bark shows through the crown's upper middle where none did
before.

## Decision

Take `baseFlare`, drawn and not piped. A fist attempt that scaled the pipe model's own radii made the
trunk three and a half metres thick, because the parent carries every child's base radius; the swell
is therefore a mesh scale that the pipe model never sees. Rejected: raising the child's share of the
parent globally, which thickens every joint and every trunk with it.

## Consequences

`BranchLevel.baseFlare` is in the API guide with its validation. A record that leaves it out draws
the pipe model's radius, which the byte-identical pictures of the other species show.
