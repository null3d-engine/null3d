# D-300: cards above a limb's axis do not make the limb read

Status: tested and rejected. Task: none.

Summary: lifting a live oak's foliage above its limbs by up to five times the limb's radius does not
make the limbs read through the crown. The crown's own depth hides them, not the height of the cards
on them, so the rule was removed rather than kept.

## Question

The rebuilt live oak is a dome wider than tall, and its heavy limbs do not show through the crown as
the reference's do. Does placing each card above its limb's axis, so the wood's under-line stays
open, make the limbs read?

## Rule

The limbs must read through the crown from the standard view and from below, the crown's fill and
width must not fall, the other species must not move, and the change must be measured from the drawn
file before it is described.

## Data

| Measure | Cards on the axis | Above by 1.4 radii | Above by 5 radii |
| --- | --- | --- | --- |
| crown fill | 41.9 % | 41.6 % | 42.8 % |
| crown width over height | 1.24 | 1.26 | 1.29 |

How the data was produced: `target/tree-render/render.ts` drawing the clump oak's whole view at 768
by 1024, the crown's green pixels measured over their bounding box by a script, the fill and the
ratio read from that mask rather than by eye.

## Look

Neither lifted version shows a limb through the crown. At 1.4 radii the picture is
indistinguishable from the axis version; at 5 radii the crown is slightly denser and no limb
appears. The reason is depth, not height: every limb has other limbs' foliage between it and the
camera, so opening the space under one card changes nothing while the crown behind it is full.

## Decision

Reject the rule and remove it. It meets none of what it was for: the limbs do not read, and the
small gains in fill and width are within what the same cards would give without it. Kept in the
record because the next person to try it will otherwise spend the same hour.

What would work, if the limbs are wanted: fewer cards in the crown's inner volume and more mass at
the limb ends, so the crown is a shell of clumps on wood rather than a filled dome. That trades
directly against the mass the same review asked for, and it is a decision about which of the
reference's two qualities matters more, not a record value.

## What this episode taught

Three plausible fixes went by before anything was measured. Cards above the limb line changed the fill by under a point and showed no limb. A shell of clumps would have traded the crown's mass for limbs that are still too small to see. A change to the crown would have answered nothing, because the crown was not the problem. The measurement that found the cause took ten minutes: the render's limbs are eight centimetres thick inside a thirteen-metre crown, where the reference's leave the trunk at nearly its own thickness.

So the rule: when a shape does not read against its reference, measure the geometry against the reference's before changing the foliage. Cards, fill and density are the cheapest levers to reach for and the easiest to blame.

The reference pictures decode normally; an early report that they could not was my page context, not the files. A dark-run mask on a photograph returns too many fragments to measure a trunk reliably, and the reference ratios in D-299's sibling record are estimates for that reason.

## Consequences

No code remains: the field, its validation and its placement were removed. The clump oak keeps the
cards on its limbs' axes, at 41.9 per cent fill and 1.24 wide over tall.
