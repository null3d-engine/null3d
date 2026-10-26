# D-214: Grading controls bake into a display-space table

Status: decided. Date: 22 October 2026. Task: M3-A8.

Summary: `post.set({ grading })` takes white balance, lift, gamma, gain, saturation and split toning. A job worker bakes them into a table of 32 texels a side. The final pass reads that table after the tone mapping on both GPU paths. A strong grade matches an analytic reference to 0.91 of an 8-bit step on a 17-point grid, and 0.97 with a search between its points. At a saturated yellow it misses by 2.03 steps, which is over L8's one-step tolerance. The accuracy clause is therefore a limit for the owner to accept or reject, not a pass. A change stalls no frame, and one frame uploads the table.

## Question

The technique review (M3's approach note, and prototype L8) proposed one 32³ table with the tone curve baked in. That table is indexed by LogC-encoded HDR color up to about 59. Does this engine reach the same accuracy and the same cost with a display-space table instead?

## Rule

The baked table must match the analytic grade within one step of an 8-bit canvas, which is L8's recorded tolerance. Changing the grading values must do no work on a frame: no re-bake, no shader build, and no stall of the thread that draws.

## Data

The bake writes four half floats per texel. Its lookup takes the color's square root first, which places the texels closer together toward black. The first figures compared each table with `gradeColor` in `packages/engine/src/scene/grading.ts`, which the bake calls for each texel, and the table below is that comparison. The addendum below gives the figures from a reference written in the test file.

| Measure, a strong grade (warm balance, lifted toe, 0.8 and 1.2 gamma, a split tone), 17 colors an axis | Display-space 32³, square root lookup | Display-space 32³, linear lookup |
| --- | --- | --- |
| Worst error, against the bake's own function | 0.65 of an 8-bit step | 4.4 steps |

How the data was produced: `bun` over `bakeGrade` and `gradeColor` in the engine package on 22 October 2026. Half floats matter. An 8-bit or clipped table pushed a channel that crosses white inside a texel's cell to 4.4 steps. Linear interpolation across the clip does not follow the reference.

These figures show the table's resolution against the function that the bake calls. They do not show that the function is the grade the docs describe, and the unit test that repeated them was removed for that reason. The addendum below gives the figures from a reference written in the test file. On the same grid it gives 0.91 of a step, and the worst in the cube is 2.03 steps.

## Decision

Bake the grading controls, and not the tone curve, into the table.

- The controls are display-referred: lift, gamma, gain and split toning are defined on the color that the canvas shows, after the tone curve. A display-space table therefore composes with the analytic curve exactly as a table that held the curve would. The two differ only by the table's resolution.
- The engine tone maps in the final pass on the HDR path and in each scene shader on the 8-bit path. A curve inside the table would replace the first path's curve. The second path would then fall back to the analytic curve, or need the table bound to every scene shader. One display-space table serves both paths, read after the curve as the `lut` table already is. Both paths then grade alike.
- The tone curve stays where it is, which leaves custom tone curves, the two-step pass, still views and the tone-mapping work in flight untouched.
- The job worker runs the bake, so a slider that changes a value each frame does not stall the sketch or the thread that draws. The sketch's thread writes the texels into one 3D texture. The final pass keeps the texels already on the GPU while the new ones upload, so no frame loses its grade.
- The accuracy is a limit rather than a pass. A 17-point grid gives 0.91 of a step and its search 0.97. A 49-point grid gives 1.71 and its search 2.01. The worst in the cube is 2.03 steps, at a saturated yellow where the grade clamps a channel at zero. The owner accepts or rejects that limit.
- A tetrahedral read was implemented and measured for this record, and rejected. At 49 points it misses by 2.40 steps against 2.01. It has 17 channel samples over one step against 11, and its mean error is 0.049 against 0.043. The pass therefore keeps the sampler's linear filter.

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

## Addendum, 26 October 2026: the analytic check and the cost of a change

Status: decided, with the owner's design ruling still open above.

The first figures compared each table with the function that the bake calls for every texel. That
shows the table's resolution, not that the function is the grade the docs describe. The tests now
hold a reference written in the test file. It has a closed form for each control, and the
composite grade in its documented order. The display reference calls nothing of the engine. The
light one calls the engine's log encoding. The test still takes three things from it. The white-balance factors' tint and luma are pinned in
closed form. The log code's round trip is checked. The sRGB transfer applies to both sides of the
comparison, so it cancels.

| Measure, of an 8-bit step | Display table | Light table |
| --- | --- | --- |
| Worst error, 17 points an axis | 0.91 | 5.40 |
| The same, with the search around the grid's best colors | 0.97 | not searched |
| Worst error, 49 points an axis | 1.71 | 7.19 |
| The same, with the search around the grid's best colors | 2.01 | not searched |
| The worst anywhere in the cube, from 65 points and that search | 2.03 | not searched |
| Channel samples over one step, 49 points an axis | 11 of 352,947 | 36,829 of 352,947 |

The display table's worst is 2.03 steps, at red and green near white with blue at zero. The grade
clamps the blue channel at zero there, and the table holds 0.008 against a reference of 0.000. The
grid alone understates it: 49 points an axis give 1.71, and the search around their best colors
gives 2.01. The light table misses by five times as much on the same grid, at 10.4% of channel
samples, so its ranking is safe.

So the display table does not meet the rule's one step everywhere. It meets it on the grid the
record's figure came from and misses it at that saturated yellow. A tetrahedral read was built and
measured for this record, and rejected as worse. At 49 points it misses by 2.40 steps against 2.01, and
17 channel samples are over one step against 11. Its mean error is 0.049 against 0.043. The pass
therefore keeps its sampler's linear filter, and the one-step clause is the owner's decision.

The gamma description was wrong, and the demos prove it. The docs said that values below 1
brighten the shadows. The bake raises a channel to the power of one over its gamma, as color tools
do, so values above 1 brighten. The post effects demo's "warmer whites" only read warm that way:
its red gamma is above 1 and its blue below it. Both doc sentences now say above 1.

### The cost of a change

A change runs one bake of the table, 7.8 ms of one core here, in a job worker. The answer reaches
the sketch worker as a message. That thread then writes 131,072 texels as half floats, which takes
0.8 ms, and the render worker's next frame uploads 262,144 bytes. So a change costs a frame
one texture upload, and no bake, shader build or pipeline build. Until that upload the frames draw
the previous table, because the write replaces the texture's texels in place, so no frame loses its
grade. A second change drops the first change's answer when it lands, so a stale table never shows.

The figures come from Bun on this Mac on 26 October 2026 at a load near 110, so they are upper
bounds. The browser test `grading-switch` measures the frames themselves, on this Mac's GPU in
Chrome 155. It measures steady play, and one change with the window that lands it and the window
after it. It then changes a value in every frame for two seconds.

| On this Mac, 26 October 2026 | WebGPU | Compatibility | WebGL2 |
| --- | --- | --- | --- |
| The display's refresh rate, Hz | 60 | 60 | 60 |
| Steady frames: interval median and 99th percentile, ms | 16.665 and 16.670 | 16.665 and 16.670 | 16.665 and 16.670 |
| The window that lands one change: frames | 30 | 29 | 29 |
| Its interval median and 99th percentile, ms | 16.665 and 16.670 | 16.665 and 16.670 | 16.665 and 16.670 |
| Its uploaded bytes per frame | 9,948 | 10,230 | 9,842 |
| The window after it: interval median and 99th percentile, ms | 16.665 and 16.670 | 16.665 and 16.670 | 16.665 and 16.670 |
| Its uploaded bytes per frame | 1,492 | 1,492 | 1,104 |
| Presented frames per second, every window | 60.002 | 60.002 | 60.002 |
| GPU objects and pipelines, every window | 0 and 0 | 0 and 0 | 0 and 0 |
| Draws that a frame skipped, every window | 0 | 0 | 0 |
| A value that changes in every frame: frames | 119 | 119 | 120 |
| Its interval median and 99th percentile, ms | 16.665 and 16.670 | 16.665 and 16.670 | 16.665 and 16.670 |
| Its uploaded bytes per frame | 259,267 | 259,267 | 258,879 |

The window that lands a change holds about thirty frames, so its 99th percentile is its longest
frame or the one before it. That figure is the display's own period on all three paths. So the
frame that the change lands in is no slower than a steady one, and neither are the frames after it.
Its uploaded bytes rise by about 253,000 over steady play, which is one table, so exactly one frame
carried the bake. No frame was skipped: the presented rate held at 60.002, and no draw was skipped.
A value that changes in every frame carried a table on 99% of frames and kept the same intervals.

The change travels through a worker. The page started two job workers beside the sketch, the render
and its probe workers. The sketch worker's CPU time per frame stayed between 0.10 and 0.24 ms in
every window. A 7.8 ms bake on that thread would show. The render thread's frames kept the
display's period, which a bake there would not. The job workers' CPU does not reach the frame
figures, because their records count frame work and the bake is a task. The 7.8 ms above is the
bake's own time in Bun, not a thread's time in the page.

That frame keeps its grade: the texture's texels change in place, so a frame draws the old table or
the new one, never neither. A change that a newer one replaces is dropped when it lands, so a stale
table never shows.
