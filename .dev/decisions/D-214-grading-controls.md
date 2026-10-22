# D-214: Grading controls bake into a display-space table

Status: decided. Date: 22 October 2026. Task: M3-A8.

Summary: `post.set({ grading })` takes white balance, lift, gamma, gain, saturation and split toning. A job worker bakes them into a table of 32 texels a side. The final pass reads that table after the tone mapping on both GPU paths. A strong grade matches the analytic reference to under 0.65 of an 8-bit step, and a change of the values costs the frames no work.

## Question

The technique review (M3's approach note, and prototype L8) proposed one 32³ table with the tone curve baked in. That table is indexed by LogC-encoded HDR color up to about 59. Does this engine reach the same accuracy and the same cost with a display-space table instead?

## Rule

The baked table must match the analytic grade within one step of an 8-bit canvas, which is L8's recorded tolerance. Changing the grading values must do no work on a frame: no re-bake, no shader build, and no stall of the thread that draws.

## Data

The bake writes four half floats per texel. Its lookup takes the color's square root first, which places the texels closer together toward black. The analytic reference is `gradeColor` in `packages/engine/src/scene/grading.ts`, which the bake calls for each texel.

| Measure | Display-space 32³, square root lookup | Display-space 32³, linear lookup |
| --- | --- | --- |
| Worst error, a strong grade (warm balance, lifted toe, 0.8 and 1.2 gamma, a split tone), 17 colors an axis | 0.65 of an 8-bit step | 4.4 steps |

How the data was produced: `bun` over `bakeGrade` and `gradeColor` in the engine package on 22 October 2026, which `grading.test.ts` repeats as a unit test. Half floats matter. An 8-bit or clipped table pushed a channel that crosses white inside a texel's cell to 4.4 steps. Linear interpolation across the clip does not follow the reference.

## Decision

Bake the grading controls, and not the tone curve, into the table.

- The controls are display-referred: lift, gamma, gain and split toning are defined on the color that the canvas shows, after the tone curve. A display-space table therefore composes with the analytic curve exactly as a table that held the curve would. The two differ only by the table's resolution.
- The engine tone maps in the final pass on the HDR path and in each scene shader on the 8-bit path. A curve inside the table would replace the first path's curve. The second path would then fall back to the analytic curve, or need the table bound to every scene shader. One display-space table serves both paths, read after the curve as the `lut` table already is. Both paths then grade alike.
- The tone curve stays where it is, which leaves custom tone curves, the two-step pass, still views and the tone-mapping work in flight untouched.
- The job worker runs the bake, so a slider that changes a value each frame does not stall the sketch or the thread that draws. The sketch's thread writes the texels into one 3D texture. The final pass keeps the texels already on the GPU while the new ones upload, so no frame loses its grade.

## Consequences

- `post.set` takes `grading`, and `docs/api/post.md` and the post-processing concepts page describe it.
- The final pass binds a second 3D table, at binding 13 of its group, and sets the `GRADE` flag while it grades. A `lut` from a file still applies after the built-in table.
- The post effects demo sets its warm and cool looks from the controls, and the grading table makers in `examples/post-effects/grades.ts` go.
- A port that must match a color tool's look can still load its `.cube` file as a `lut`. The controls are null3D's own and have no three.js twin.
