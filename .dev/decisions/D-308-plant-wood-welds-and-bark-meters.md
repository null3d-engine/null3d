# D-308: the plant core's wood welds each child onto its parent's own triangles, with bark in meters

Status: decided. The wood mesher (`packages/vegetation/src/wood/`) is built, and so is the
quantisation of every part (`lod/quantise.ts`). The mesher carries frames by parallel transport and
places rings by fit. It welds children with fillets and collars, and a fork's leaders take their
parent's last ring. It flares and buttresses the stem's foot, and maps the bark in meters. A large
mesh comes in parts of at most 65,536 vertices with 16-bit indices. Surface roots leave from the
buttress lobes, and bark peels in strips at the nearest level. Pending: the eyes of shed branches,
which rings far apart cannot hold as a mark at the vertices.
Task: none.

Summary: each side of a child's tube runs back to its parent's mesh. The crossing is the weld
vertex. On the grown oak no weld stands 0.002 mm off its parent, and `v` does not jump. The bark's
`u` wraps whole tiles round a ring where they fit. Its density stays within 25 per cent of its target
on every ring. The oak's nearest wood takes 5.2 to 7.9 MB from the Low tier to the Ultra tier.

## Question

How does the mesher join a child to its parent and map the bark? A joint must show no gap, no crease
and no tube inside another. The bark must keep its size from trunk to twig. How much may the nearest
wood of a tree take?

## Rule

The plant core's design sets the acceptance. Weld gaps stay under 1 mm. The bark's texel density
stays within 30 per cent of its target on every ring. `v` runs on from parent to child. Quantisation
moves no vertex by 1 mm. The look decides between options that meet the rule. The owner ruled that
quality comes before size, and approved larger memory budgets for near trees.

## Data

| Measure | Weld on the parent's triangles | Weld on a smooth cylinder | Child from the parent's axis |
| --- | --- | --- | --- |
| Largest weld gap, grown oak, nearest level | 0.0015 mm | 1 to 8 mm on the test oak | The tube runs through the parent's wall |
| Largest jump of `v` at a weld | 0.005 mm | 0.5 mm on the test oak | Not continuous |

| Measure | Whole tiles where they fit, true meters elsewhere | Whole tiles always | `u` from 0 to 1 once round |
| --- | --- | --- | --- |
| Worst bark density round a ring, grown oak | 25 per cent | 33 per cent (one to two tiles round) | 3 times too wide on a 0.5 m trunk, 16 times too narrow on a 1 cm twig |
| Worst density along an axis | 15 per cent | 15 per cent | Right |

| Tier | Nearest wood, largest of six oak variants | Triangles | Parts | Cap |
| --- | --- | --- | --- | --- |
| Low | 5.16 MB | 229,131 | 3 | 6 MB |
| Medium | 5.58 MB | 250,968 | 3 | 6.5 MB |
| High | 6.30 MB | 289,063 | 4 | 7.5 MB |
| Ultra | 7.82 MB | 368,422 | 5 | 9 MB |

The grown oak has 2,654 axes, 2,653 of them children of another axis. Before thin wood took fewer sides, rings by fit
and true meters, its nearest wood took 25 MB at the High tier. With 32-bit indices it took 6.2 MB on
one variant, against 4.8 MB with 16-bit parts.

How the data was produced: `bun test packages/vegetation/src/wood` runs the measures, with Bun 1.4.3
on the Mac. The file `wood/wood-measure.ts` measures each weld against the written triangles. The
density comes from each ring's span and perimeter. The tree is the self-organizing grower's oak
(`grow/oak.fixture.ts`, seed 11) with the test record's bark and stem foot. The sizes are the
quantised parts of variants 0 to 5. The other columns are the same measures on the mesher before each
change.

## Look

The weld on the parent's own triangles looks better. The joint shades as one surface. No slit shows
where facets stand inside a smooth cylinder. A fillet widens the child near the joint.
That matches the oak's references, whose limbs flare into the trunk. A fillet that lies flat along the
parent fights it for depth close up. So the fillet meets the parent at a slope of two. Whole
tiles leave no seam down the wood. Where no whole count fits, true meters keep the bark's size, with
one seam under thin wood. A tree with fewer finest axes would cost less, but would fail close-up
review, so the cap follows the oak's figures.

## Decision

- **Welds.** A distance query on the parent's rings finds each side's seam. The weld vertex then goes
  where that side's line crosses one of the parent's triangles. Where the parent's rings tilt apart,
  the whole line is searched. Failing that, the vertex goes to the nearest point of those triangles.
  Its `v` and normal come from that triangle's corners.
- **Thick children.** A child nearly as thick as its parent narrows at its foot. It fits inside the
  parent's least girth about the joint, and widens back within the blend.
- **Forks.** A thick child at its parent's end leads a fork. Thick means half the parent's girth or
  more. It takes the parent's last ring as its own first ring. It eases from the parent's girth to
  its own, and carries on the parent's bark tiles. A thinner child at that end hangs on the thickest
  leader. A side child can leave short of the parent's end with three quarters of the girth or
  more. It is then codominant: the parent's wood ends there as a fork and runs on as a second piece.
  Both arms rise from the fork as leaders. A dividing limb then draws as one fork, not as a limb
  pushed through the side of another. Each leader bends onto its own line over a curve with rings
  on it. The curve is one and a half girths long per radian of turn, so its inner side never folds.
  Each ring of the bend is a circle about that curve. The girth eases from the parent's own to the
  leader's, so the fork's collar swells wide at its base and the surfaces meet without a step at
  either end. Each side's `v` runs over the bend in step with the length of its own line, as a
  weld's does. A ring whose vertices each followed their own curve left the bend's rings oval, and
  the bark sheared up to three and a quarter times across the joint.
- **Blend rings** run from the seam to the child's own circle, closer together near the seam. Each
  side's fillet and the record's collar ease from that side's own seam. A blend vertex stays at least
  half a millimeter outside the parent. The normal turns from the parent's to the child's. Each
  side's `v` runs over the blend in step with that side's own length. A shared run stretched the
  bark up to 90 times on the long side of a steep child. On the oak, stretched bark near side joints
  fell from 9.7 to 1.9 square meters.
- **Bark.** The bark's `v` runs in meters, from the parent's `v` at the weld. A child's `v` may start
  whole repeats lower. A repeat holds a whole number of every layer's tiles, and the lower start keeps
  `v` within its 16 bits. The bark's `u` takes whole tiles where they keep plates within a quarter of their width.
  Wood of fewer than a few tiles round runs in true meters. A ring where the count changes is written
  twice, so no strip shears the bark.
- **The vertex.** `uv1.x` holds the pipe radius over 4 m. From it the plant shader picks young bark,
  zones by radius and the fade of displacement on thin wood. `uv1.y` holds the junction mask. The
  color bytes hold the wind record, the bend weight along the axis and the crown's sky visibility.
- **Rings** stand where a straight, evenly tapering piece stops fitting the axis. The piece may
  stray by a tenth of the radius or 2 per cent of its length. Rings stand on the axis's nodes where
  they can. Sides follow the girth, up to 96. Thin wood takes three or four sides and a plain point.
  Thick wood turns by less between two rings, down to about 6 degrees, so its bends draw as curves.
- **Kinks.** Each kink in an axis is rounded over a bend of six of the wood's radii. On each side,
  the bend takes at most 45 per cent of the internode. A twig whose rounding would be under 2 mm
  keeps its sharp crook. Without the rounding, a kink of 30 degrees in a limb 17 cm across drew as
  a mitred pipe in close-up. The closer rings on thick wood add about 19 per cent to the oak's
  nearest wood. With the forks and the rounding, that wood still holds 7 per cent fewer triangles
  than before, 199,000 on variant 0.
- **Parts.** A mesh of more than 65,536 vertices is split into parts that each hold at most that
  many, so every part's indices are 16-bit. That saves about a third of the wood's bytes.
- **Surface roots** leave from the buttress lobes, half buried along the ground, then dive. Each is
  a child of its stem and welds onto the flared foot.
- **Peeling strips** hang from their upper edge and curl out, at the nearest level only, in the
  record's peel zone. The outer face shows the bark under it. The inner face carries a pipe radius of
  zero, so the shader draws it with the young bark, the pale inner layer.
- **Stubs.** A dead stub left where a branch was shed carries a pipe radius of at least a quarter
  more than the young bark's. The shader then draws it with grown bark, like the wood it stands on.
  With its own pipe radius, a stub of 5 cm drew with the smooth young bark of a live shoot, a pale
  stick on the oak's trunk.
- **The cap** of one variant's nearest wood is per tier, from the oak's largest variant with about
  15 per cent to spare.

Rejected:

- **A weld onto a smooth cylinder.** A parent's facets stand inside the cylinder by their sagitta, so
  gaps of 1 to 8 mm open.
- **A child that starts on its parent's axis.** Its tube runs through the parent's wall. Its edge
  shows as a hard crease close up.
- **A fillet of a quarter circle.** It lies flat along the parent, where the two surfaces fight for
  depth.
- **Whole tiles always.** Between one and two tiles round, no count keeps the plates within 30 per
  cent.
- **A cap of 3 MB.** It would need cruder twigs or fewer finest axes than close-up review passes.

## Consequences

- The growers need not fill the skeleton's `barkV` and `barkU`. The mesher works out the bark from
  the geometry.
- A plant level may hold several parts of one name. `growNearWood` and `growNearWoodNow` give a list
  of parts. The plant's placement draws each part.
- The plant shader reads the wood vertex above.
- `ModelCaps.lod0WoodBytes` holds one figure per detail tier.
