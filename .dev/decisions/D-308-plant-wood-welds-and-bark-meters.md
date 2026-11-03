# D-308: the plant core's wood welds each child onto its parent's own triangles, with bark in meters

Status: decided. Built: the wood mesher in `packages/vegetation/src/wood/` and the quantisation of
every part in `lod/quantise.ts`. The mesher carries frames by parallel transport and places rings by
fit. It welds children with fillets and collars, flares and buttresses the stem's foot, and maps the
bark in meters. Pending: forks that split their parent's last ring, surface roots and peeling fins.
Task: none.

Summary: each side of a child's tube runs back to its parent's mesh. The crossing is the weld
vertex. No weld stands a micrometer off its parent, and `v` does not jump.
The bark's `u` wraps whole tiles round a ring where they fit. Its density stays within 25 per cent
of its target on every ring.

## Question

How does the mesher join a child to its parent and map the bark? A joint must show no gap, no crease
and no tube inside another. The bark must keep its size from trunk to twig.

## Rule

The plant core's design sets the acceptance. Weld gaps stay under 1 mm. The bark's texel density
stays within 30 per cent of its target on every ring. `v` runs on from parent to child. Quantisation
moves no vertex by 1 mm. The look decides between options that meet the rule.

## Data

| Measure | Weld on the parent's triangles | Weld on a smooth cylinder | Child from the parent's axis |
| --- | --- | --- | --- |
| Largest weld gap, test oak of 94 axes, all levels | 0.0007 mm | 1 to 3.3 mm (8.5 mm with rings 0.5 m apart) | The tube runs through the parent's wall |
| Largest jump of `v` at a weld | 0.002 mm | 0.5 mm | Not continuous |

| Measure | Whole tiles where they fit, true meters elsewhere | Whole tiles always | `u` from 0 to 1 once round |
| --- | --- | --- | --- |
| Worst bark density round a ring, test oak, every tier and level | 25 per cent | 33 per cent (one to two tiles round) | 3 times too wide on a 0.5 m trunk, 16 times too narrow on a 1 cm twig |
| Worst density along an axis | 0.7 per cent | 0.7 per cent | Right |

| Measure | High tier | Ultra tier | Low tier |
| --- | --- | --- | --- |
| Nearest-level wood of the test oak | 46,051 vertices, 75,400 triangles, 1.42 MB quantised | 74,394 vertices, 127,551 triangles, 3.09 MB | 26,622 vertices, 40,459 triangles, 0.80 MB |

How the data was produced: `bun test packages/vegetation/src/wood` runs the measures, with Bun 1.4.3
on the Mac. The file `wood/wood-measure.ts` measures each weld against the written triangles. The density
comes from each ring's span and perimeter. The trees are the hand-built test tree and test oak of
`wood/wood-test-tree.ts`. The other columns are the same measures on the mesher before each change.
The sizes come from `meshWood` and `quantise` on the test oak. The species package's oak replaces the
test oak in these figures when it lands.

## Look

The weld on the parent's own triangles looks better. The joint shades as one surface. No slit shows
where facets stand inside a smooth cylinder. A fillet widens the child near the joint.
That matches the oak's references, whose limbs flare into the trunk. A fillet that lies flat along the
parent fights it for depth close up. So the fillet meets the parent at a slope of two. Whole
tiles leave no seam down the wood. Where no whole count fits, true meters keep the bark's size, with
one seam under thin wood.

## Decision

- **Welds.** A distance query on the parent's rings finds each side's seam. The weld vertex then goes
  where that side's line crosses one of the parent's triangles. Its `v` and normal come from that
  triangle's corners.
- **Blend rings** run from the seam to the child's own circle, closer together near the seam. Each
  side's fillet and the record's collar ease from that side's own seam. A blend vertex stays at least
  half a millimeter outside the parent. So the fillet never curves back into it on the sharp side of
  a crotch. The normal turns from the parent's to the child's. In a steep crotch it bends toward the
  child's just enough to face out.
- **Bark.** `v` runs in meters of bark, from the parent's `v` at the weld. `u` takes whole tiles
  where they keep plates within a quarter of their width. Elsewhere `u` runs in true
  meters. The count holds along an axis while it still fits. A ring where the count changes is
  written twice, so no strip shears the bark. The girth scale divides both: thin wood shows a finer
  figure.
- **The vertex.** `uv1.x` holds the pipe radius over 4 m. From it the plant shader picks young bark,
  zones by radius and the fade of displacement on thin wood. `uv1.y` holds the junction mask. The
  color bytes hold the wind record, the bend weight along the axis and the crown's sky visibility.
- **Rings** stand where a straight, evenly tapering piece stops fitting the axis or its radius. Near
  the ground they stand every half radius. Sides follow the girth, up to 96.

Rejected:

- **A weld onto a smooth cylinder.** A parent's facets stand inside the cylinder by their sagitta, so
  gaps of 1 to 8 mm open.
- **A child that starts on its parent's axis.** Its tube runs through the parent's wall. Its edge
  shows as a hard crease close up.
- **A fillet of a quarter circle.** It lies flat along the parent, where the two surfaces fight for
  depth.
- **Whole tiles always.** Between one and two tiles round, no count keeps the plates within 30 per
  cent.

## Consequences

- The growers need not fill the skeleton's `barkV` and `barkU`. The mesher works out the bark from
  the geometry.
- The plant shader reads the wood vertex above.
- Forks, surface roots and peeling fins follow in the same package.
