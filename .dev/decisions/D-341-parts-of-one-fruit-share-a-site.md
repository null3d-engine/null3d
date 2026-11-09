# D-341: the parts of one fruit hang on one twig

Status: decided and built as the optional field `extras[].group`. The European beech sets it on its
three fruit entries. Task: none.

Summary: An extra picks its sites by a hash that includes its own entry number. A burr, a cup and
its nuts therefore almost never shared a shoot. Still 19 drew two bare nuts with no cupule around
them. Extras that name one group now pick the same sites, and each part keeps its own tip share and
offset. The beech's burrs within 6 cm of both a valve cup and a nut pair rose from 0 to 161 of 283.

## Question

How do the parts of one fruit hang together on one twig?

## Rule

- The change is an optional record field, so a record that names no group draws as it did.
- Extras that name one group draw at the same sites.
- Each part keeps its own `tipShare` and `offset`, so a group orders its parts along the shoot.
- A test holds two grouped extras to the same sites. It shows the same pair apart without the field,
  and a grouped pair at different tip shares apart.

## Data

| Measure | No group | Group 0 |
| --- | --- | --- |
| Burr copies on the grown plant | 293 | 283 |
| Valve cups | 278 | 283 |
| Burrs within 6 cm of a valve cup and a nut pair | 0 | 161 |

With the group, the burr to nearest nut stands 0.045 m at the median and 0.093 m at the longest.
Twenty-two burrs stand under 0.015 m from a nut, which is the contact the photograph's two cupules
nearly make.

How the data was produced: a node growth of the beech record at seed 11, variant 0, autumn, high
tier, through `buildKitNow` and `growPlantNow`. The extras' vertices were read from the mesh by the
entry byte in their color. A burr copy is a run of vertices with no jump over 5 cm between
neighbours, and a valve cup is 16 vertices. Distances are between nearest vertices, in metres. The
two columns differ in one thing: the three fruit entries name group 0 or they do not.

## Look

The group looks better. Without it, still 19 shows two glossy nuts with no cupule around them and no
burr beside them. With it, every nut pair carries its valve cup, and a burr stands on the same shoot.
The two cupules read as the photograph's pair.

## Decision

Chosen: the group field, and the beech sets group 0 on its three fruit entries. The burr's tip share
stands 0.02 nearer the tip than the split cupule, so it hangs higher on the shoot. Each part stands
0.02 m to its own side, so the cupules clear one another. The count rose from 0 to 161 of 283 burrs.
Rejected: one shared point for all three parts, which stacks the nuts inside the burr and hides the
valves. Rejected: a per-part offset with no shared site, which moved each part against its own
shoot and measured 0.

## Consequences

- `leaf/extras.ts` picks a group's sites by a hash slot of its own, past the entries' slots.
- `core/record.ts` carries `Extras[].group`, a whole number from 0 to 15, and `core/check.ts` holds
  it there.
- `leaf/extras.test.ts` holds the shared sites and the height order. `core/check.test.ts` holds the
  range.
- Still 19's matte covers 99.1 per cent of the frame, because the fruit view sits inside the crown.
  Its piece count is the frame, not the fruit, so that view's judgement leaves it out.
