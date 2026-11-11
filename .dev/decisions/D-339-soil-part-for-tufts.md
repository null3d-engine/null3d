# D-339: A tuft's rhizome and roots draw in its merged foliage

Status: decided. The record block, the grower and the mesh are built and tested. The pictures'
color is pending, because a merged plant has no color role for a brown part.

Summary: A tuft may name a `soil` block, a rhizome and its roots, which draws as tubes in the same
merged foliage part as the blades. It costs 13,969 bytes and 536 triangles at the sedge's nearest
level, and leaves every unrhizomed plant byte-identical. The geometry moves the roots picture's
shape overlap from 0.32 to 0.42 and its width error from 0.632 to 0.347. Its color stays the
leaf's green until a color role exists.

## Question

A sedge's photographs show a short stout rhizome and dense roots at its crown. Its reference set has
two pictures of them. The tuft grower builds a crown axis and draws nothing under the shoots.
Should the base be part of the tuft model, and how should it draw?

## Rule

The base must stay inside the ground plants' variant cap. The sedge binds that cap at 1.535 of
1.60 MB at the low tier. It must leave every plant that does not ask for it byte-identical. It must
also move no material and no shader, so the trees and the other models stay as they are.

## Data

| Measure | Before | With the soil block | Device |
| --- | --- | --- | --- |
| Sedge kit bytes | 34,460 | 34,460 | this Mac, `high` detail |
| Sedge variant bytes | 1,778,021 | 1,791,990 | this Mac, `high` detail |
| Level triangles | 43,236 / 19,126 / 6,052 | 43,772 / 19,126 / 6,052 | this Mac, `high` detail |
| Unrhizomed plant digest | `1bf7ee25ee1f3386` | `1bf7ee25ee1f3386` | this Mac, seed 11, variant 0 |

How the data was produced: `bun` scripts built the sedge's kit with `buildKitNow`. They grew seed
11, variant 0 at `high` detail and read `kitBytesOf` and `variantBytesOf`. The "before" column
strips the soil block from the record. The picture figures come from run `sedge-soil6` at the
branch tip, stills only, at a 960 by 720 frame.

## Look

The geometry reads. The roots picture frames a bundle of sheaths with roots radiating below it. Its
shape overlap rises to 0.42, and its width error falls from 0.632 to 0.347. The color does not
read. The reference's sheaths and roots are brown, and the render's are the leaf's green, because
a merged plant has one material and no per-vertex color. The sedge's sheath pictures 08 and 15
record the same missing role. This record does not solve it.

## Decision

The base is a `soil` block on the tuft record. It draws as tubes in the merged `foliage` part and
at the nearest level only. Rejected:

- **A new part or material for the soil.** It would give the part a color, but it moves the plant
  material and every renderer that routes parts. That is too much for one pair of pictures, and
  the sheaths already need the role.
- **Drawing the base at every level.** That repeats 536 triangles and their bytes at two levels,
  where the crown hides them.
- **A rhizome field inside the grower.** No record could size it against its photographs.

## Consequences

`core/record.ts` gains `TuftSoil`, and `core/check.ts` validates it. `grow/tuft.ts` grows and
meshes it. `grow/ground.test.ts` holds its counts, its below-soil depth and the byte-identical
digest of an unrhizomed plant. The review page gains a `soil` view that frames a lifted crown, and
a `lifted` query switch that draws no ground. The sedge's record names a 4 cm rhizome of 1.1 cm
radius and 18 roots of 18 cm, 3 mm across. Meadow grass, the batch's other tuft, keeps its rhizome
absent and may name its roots. Pictures `09-new-shoots` and `14-roots-and-rhizome` now draw the
`soil` view. Their color rows wait for the material role.
