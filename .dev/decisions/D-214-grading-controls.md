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

## Addendum, 25 October 2026: the picture judgement against the table over light

Status: the display-space table stands as the default, on the pictures and the figures below. The
owner's hard rule 40, made the same day, asks for the better look. This record was therefore
reopened. Its choice had replaced the table over high dynamic range light that the plan proposed, and
no picture had judged the two. The owner still decides between them, and the branch carries the other
design behind `?grading=hdr` until that ruling.

The question was narrow. The banked controls are identical. The designs differ only in where the
table reads the picture. The light table holds the graded linear light of its place, found from the
ARRI LogC codes the plan names. The pass applies the exact tone curve after it. The display table
holds the graded display color and the pass applies it after the curve.

### The figures

Both tables are 32 texels a side. Both were matched against their own analytic reference,
`gradeColor` and `gradeHdrColor`, over a 17-point ramp on each axis. The grade is the strong one in
`grading-hdr.test.ts`: a warm balance, a lifted toe, 0.8 and 1.2 gamma, saturation 0.85 and a split
tone.

| Worst error, of an 8-bit step | Display table | Light table |
| --- | --- | --- |
| Strong grade | 0.91 | 4.80 |
| Neutral | 0.07 | 2.01 |

The light table loses its accuracy near black, where the LogC axis gives the darkest light only
about two texels. A grade that misses by five steps of the canvas is a quantisation that the eye
sees. The display table keeps the same grade within a step everywhere.

One grade on both designs drew the same four scenes, and the two pictures differ a lot:

| Scene | Mean pixel distance between the designs, of 255 |
| --- | --- |
| The lens kit's test wall | 109.2 |
| The atmosphere demo | 116.7 |
| The night town demo | 120.7 |
| The skyway showcase, with its own grade | 10.3 |

Each design's two GPU paths agree, so the comparison is fair. The light table read on WebGPU is
compared with the analytic grade of the WebGL2 scene shaders. The two differ by a mean of 0.61 of a
step, and at most 4. The display table differs by 0.53 across its paths. Its picture also matches the
references that the lens kit's test already keeps, within one step of the canvas. The default
therefore renders as it did before this branch.

### Look

The two designs make one set of numbers mean two different grades, so neither wins every scene.

| Scene, one grade on both designs | Which looks better | Why |
| --- | --- | --- |
| The lens kit's bright test wall | Display | The light table pales the wall and turns its saturated columns and bars near white. The display table keeps the wall's color and separation |
| The skyway showcase, with its own night grade | Display | It keeps the contrast and the depth between the towers. The light table hazes the city |
| The night town demo, with a strong grade | Light | It raises the shadows, so the town, the pines and the lamp glow read. The display table crushes them |
| The atmosphere demo, the same strong grade | Light | The ridges and the clouds read instead of sinking into the sky |

The LogC code is a logarithm of the light, so one set of numbers acts on the light far harder there.
A gain of 1.12 on the code multiplies the light at middle gray by about 1.8, and the gamma acts the
same way. That is what brightens the two dark scenes. The scenes the light table wins show a
difference of grade strength, not of image quality. At one grade, at the same strength, the light
table bands where the display table does not.

Rule 40 decides for the display table:

- At one grade it is the more accurate design, by five times, and its error stays under the step that
  the eye sees.
- Its controls keep the display-referred meaning that the user docs and the port mapping give them.
  That is also the meaning a color tool's lift, gamma, gain and split toning carry.
- It costs one 3D texture read in the final pass. The light design also grades every pixel in the
  scene shaders on the 8-bit path. That is a logarithm, a power and an exponential per channel, which
  is frame time on a phone.

### What the branch holds

- `packages/engine/src/scene/grading-hdr.ts` bakes the light table. It also holds the reference that
  the tests compare the table with.
- `crates/null3d-shaders/wgsl/lib/grade.wgsl` grades light in a scene shader. A `GRADE_HDR` flag
  sends it to the final pass before the tone curve, and to the 8-bit path's scene shaders.
- The grade's 24 values joined the post-processing block, which grew from 64 to 88.
- A cleared background draws the background's own color while the light table grades. A lift raises
  black, and a clear alone would keep it.
- `?grading=hdr` and `?grading=display` pick the design, and `display` is the default. A ruling for
  one of them deletes the other's bake, shader module and switch.

