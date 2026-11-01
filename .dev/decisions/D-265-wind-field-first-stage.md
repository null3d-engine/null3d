# D-265: The wind field, on a pass that keeps its state

Status: decided and built. The wind add-on, `@null3d/wind`, holds the analytic field and the advected
core with its forces and its fixed step, on M3-V13's pass that keeps its state. Task: M3-V15.
[D-241](D-241-vegetation-foundation.md) puts the fluid wind in an add-on of its own, and
[D-173](D-173-addon-hooks.md) makes it the twelfth foundation.

Summary: The fluid wind needs a solver that carries its state between frames. The engine's history
pass gives it one. One compute pass keeps two states of a grid that follows the camera. Each cycle
pulls the air toward an analytic field, injects the pushes and the gust, advects the air, and solves
the pressure. A page sets the base wind, sends a gust and pushes the air. The API and the sampling
function stayed the same as the field gained its memory.

## Question

How does the wind add-on keep one field, so that every plant, flag and smoke card reads the same
air, and that field carries the air from one frame to the next?

## Rule

- The add-on stays inside the public API (AGENTS.md rule 12). It does not ask for an engine change
  that belongs to another task.
- A frame allocates nothing (hard rule 1).
- Hold mode draws the same picture on every run. The field there is a fixed step from sketch time
  and from the pushes that the page made.
- The API and the WGSL sampling function do not move as the field gains its memory. Readers built
  on the analytic field keep working.

## Data

| Need | The engine at `m3-start`, 26 October 2026 | Source |
| --- | --- | --- |
| A pass that reads its last step | A pass that reads its own texture, or two that read each other's, throws E1504 | `docs/api/render.md`, Errors |
| Many solver steps in one frame | A pass runs its dispatch once. 40 Jacobi steps would need 40 passes, and a page's 32nd pass throws E1220 | `docs/api/render.md` |
| A field of several layers that swaps | M3-V13's history pass gives the swap | `docs/api/render.md` |
| Reading the field back on the CPU | No public call reads a pass's texels, so the add-on keeps its CPU form | `docs/api/render.md` |

The field's frame cost belongs to M3-V14's measurements. This record claims none of them.

## Decision

The field has two parts, both under M3-V15.

**The analytic field.** The analytic wind is incompressible by construction. Its swirl is the curl
of one stream function in the ground plane. A push is a vortex, and a gust turns in rings about
its own center. Its base flow is constant along the ground and slower near it. No pressure solve is
therefore needed to keep the air's volume. The test holds the discrete form's divergence under a
thousandth of the field's speed, so the air keeps its volume without one.

A grid that follows the camera samples that field into one `rgba16float` texture, which a reader
samples with one texture read. The texture holds the wind across the ground and the local speed in
its fourth channel.

The field keeps its state, and a held page runs the same cycles at the same times, so its picture is
the same on every run. A page calls `createWind` once, then sets the base wind, sends a gust or
pushes the air at a point. The pushes ring holds the three newest pushes, which fade over three
seconds, and a gust's own slot after them, so a page's pushes never push its gust out.

**The advected core.** M3-V13's pass reads its own last step and runs its dispatch several times in a
frame, so the core is an advected solve in Stam's form, with vorticity confinement and the pressure
solve that the plan describes. The field keeps two states, and the shader whose run comes next reads
the one before. A wake lasts after the body that made it has gone. The grid, the box, the outputs,
the sampling function and every reader stay as they are.

**The projection runs.** The advected core injects the pushes and the gust, which add divergence, so
each cycle ends with the pressure's slope taken out of the air. The solve stays as it is until the
vegetation add-on's grid of canopy cover gives the wind its drag input (M3-V17); drag adds more
divergence, not a new step.

## Consequences

- **Code:** `packages/wind/` holds the analytic field in TypeScript and the same formula in the
  grid's compute shader and in its WebGL2 fragment form. The TypeScript form serves the tests and
  the page's own CPU reads.
- **Why two shader copies:** the shader build resolves only the engine's `null3d::` library, so one
  shader cannot import another of the same add-on. The copies exist for that alone. A test holds
  them byte for byte equal, and a build that received an add-on's own modules would remove them.
- **What the field does:** a gust travels from where a page sends it, and a wake lasts after the
  body that made it, because the advection carries both.
- **A device that cannot hold the field:** a WebGL2 device whose float targets fail the engine's own
  clear-and-read probe keeps no pass, so the add-on costs it nothing. Its box has no width, so every
  sample of every reader is the steady field worked out from the air's settings. A plant there still
  moves. The add-on reads the engine's `hdr` flag, which is that probe's answer, and a test covers
  both answers.
- **The tier table waits:** the field steps a second and the mixed states of the plan's table belong
  to M3-V14's measurements. Its rows follow the field that exists.
- **Docs and skills:** the wind page describes the solved field, the sampling copy and the far
  field, and the develop skill shows the calls.
- **Evidence:** the add-on's tests prove the field moves a plant card, and that a frozen field fails
  those tests. The full `check-addon` run gives the page and cost gates, and the `--wind` allocation
  run gives the add-on's per-frame figure.
- **`sample` and the allocation gate.** The allocation switch of the benchmark harness makes S1
  create the wind and calls `sample`, `update`, `gust` and `push` in every frame, so `WIND_BUDGETS`
  judges every place that the sample path reaches. CI runs that switch on each GPU path. The
  add-on's own page never calls `sample`, so a source test holds the functions that a frame calls to
  the forms that allocate: an object literal, an array literal, a function expression, a for-of and
  a `new`.
- **The add-on's own shader data counts against the shader budget.** This is the WebGL2 fallback
  effect's compiled data, which is most of the add-on's entry. At head `8d66b64ca`, a run of
  `bunx @null3d/cli check-addon packages/wind --skip-browser` reports the entry at 89.5 KB raw. With that import removed it reports 13.8 KB. Water's entry is 109.2 KB at that
  head. At that head the `sizes` gate failed on each add-on's own entry against the 64 KB code
  budget. M3-R25 counts an entry's inlined shader data in the
  shader budget, so both entries pass with no budget changed. A `--skip-browser` run leaves out the
  page, cost and allocation gates, which the full run takes.
- **The plugin's manifest, and what the check needs:** the command runs under node, and it finds the
  Vite plugin through the plugin's exported `package.json`. Without that export, node refuses the
  path, the tool finds no plugin and prints a skip for the shader and size gates. It then exits 0
  when every other gate passes, so a skipped check reads as a pass. The plugin exports its manifest,
  and `packages/cli/src/check-addon.test.ts` pins it. In a checkout whose plugin has no built files,
  node cannot load the plugin's TypeScript source: the shader gate fails and sizes skips. Build the
  plugin with `bun tools/build-package.ts vite-plugin`, or run the command with bun.

## Stage two, on the pass that keeps its state

M3-V13 landed, and the field now keeps its state. One history pass holds two states of the grid and
runs the whole cycle. A cycle is the forces and the advection, twenty Jacobi iterations of the
pressure, and the projection. Its stage rides in the state's fourth number. A frame sets `steps` to
the runs the sketch time owes, and the engine swaps the states between them.

The step is fixed at a sixtieth of a second. A frame runs the cycles that the sketch time owes,
counted from the start of that time. A held page steps its sketch's updates up to the held time. The pass runs
with each step, so a held picture carries the air that the hold built. A page held at nothing
draws one cycle from the analytic field, and a page held later carries whatever moved since.

Each cycle pulls the air toward the analytic field. That field is the base wind, the swirl and the
traveling gust of place and time. The pushes and the gust are injected where a page sends them. The
advection then carries them, so a wake outlives the body that made it. Vorticity confinement keeps
the eddies, and the pressure solve keeps the air from piling up. The box's edge takes the steady
field that a reader past the box works out, so the grid and the far field meet there. A page's
pushes and the gust that it sends act inside the box.

Both GPU paths run it. The WebGL2 fragment form reads the state of the run before through
`effectColor`, which the engine gives an effect. It therefore reaches a texel's neighbours as the
compute shader does.

`sample` gives the analytic field and the events, not the solved air. The CPU cannot mirror a solve
that lives on the GPU, so the call keeps its form for a page's own motion.

## The round 24 audit's findings

The round 24 audit left M3-V15 unticked with findings whose fixes belong to this task. The four
that are code are fixed here. The fifth was the solver, the forces and the fixed step. That is stage
two above, which waits on M3-V13; V13 landed and the add-on builds on it.

- **The gust now travels.** `gust` writes a slot of its own, after the three push slots, so a
  page's pushes never push its gust out. Before, both shared one ring of four, and a page that
  pushed four times in a second lost its gust. The add-on's own CPU field moved no card of the
  page's between the two held times. The same simulation moves 35 more cards now than the page
  without the gust. A gust's wave center then moves along the heading at the gust's speed, so a
  gust sent where the air enters the scene crosses it. One test holds the gust in its slot under a
  page's pushes, and another holds a gust's center advancing where a push's stays.
- **A place outside the box reads the steady field.** The sampling function works the air out from
  the steady field at the height that the grid samples at, rather than smearing the box's edge to the
  horizon. The reader gives it three vectors: the base wind, the gust and the swirl. The box's edge
  takes the same field, so the two agree there; a page's pushes and sent gust act inside the box.
- **A device without float targets reads the field too.** Its box has no width, so every sample is
  the steady field, and a plant there moves. The device still keeps no pass, so it costs nothing.
  The field check draws the page with no grid between two held times, so the reader is measured
  rather than only read.
- **The sampling file ships.** `shaders/field.wgsl` is in the package's `files` and in the pack
  check's required list, so a reader copies it from the installed package. The page's material and
  the docs page carry copies, and one test keeps every copy equal.
- **The noise hash made objects.** The wind's allocation run showed the hash that the field's noise
  reads at 196 bytes a frame, against a budget of 4. Read as an unsigned 32-bit number, about half
  of its values pass 2147483647. That is the largest whole number that Chrome keeps in the value
  itself, so it made an object of each. The same 32 bits read as signed are the same hash. The top
  24 bits that the noise reads come out the same, so each step wraps with `| 0`. A test holds 2,000
  hashes inside the range. The reference test still matches the engine's integer hash.
- **The sample path boxes fractions.** The run names six places of the add-on's. Each is the
  browser boxing a value, not the add-on making an object. Every one computes, receives or hands on
  numbers, and the arrays they write belong to their caller and are made once. The run on the production pages measures, at the least sample and at the most:

  | place | bytes a frame | most |
  | --- | --- | --- |
  | `analyticVelocity src/analytic.ts` | 186.0 | 188.5 |
  | `value3 src/analytic.ts` | 47.9 | 51.7 |
  | `lattice src/analytic.ts` | 11.7 | 140.6 |
  | `(anonymous) null3d/addons.ts` | 24.7 | 28.1 |
  | `sample src/wind.ts` | 9.8 | 12.7 |
  | `owedSteps src/wind.ts` | 4.0 | 6.2 |

  The sketch worker reads 752.7 bytes a frame in all. The engine's own frame path is 544 of them.
  The engine answers this boxing the same way at its own places. Its `BUDGETS` table gives S1's
  camera step 48 bytes a frame. The setters' places come from `SETTER_BUDGETS`. The reason is the same: Chrome boxes a fraction that a function does not
  inline. Each budget leaves room for the run-to-run noise above the place's steady figure, and less
  than one boxed fraction more, so a new per-frame object fails the run while a sample that moves a
  few bytes still passes. CI runs the switch on each GPU path. The docs carry the caveat beside the
  promise that a sketch may call the add-on in every frame.

- **The namespace part still waits.** D-224's addendum says the shader build resolves only the
  engine's `null3d::` prefix. No add-on can import another add-on's WGSL module yet. The plan's
  RedGPU study line therefore accepts the copies for this task. It gives the add-on's own namespace
  to WGSL library modules from add-ons (the study's RES-1), which is not a task yet. This record
  keeps that reason, as hard rule 39 asks, rather than leaving the finding open without one.

## What the checks found when they first ran

The checks that measure the field found three faults in the add-on's own page and stepping. A
fourth sat in the check that judges the wake.

- **A held page drew an empty grid.** The warm-up set the pass's runs when the page made the field,
  and the page's updates then set them again before any frame drew. A held page draws one frame at
  the end of sixty updates, so the last update's setting won. That one owed no cycle at a hold under
  a second. A live page ran no air for its first second for the same reason. The field now
  counts its cycles from the moment the page makes it. The control pair of the field check went
  from 0.28048 of the channels changed to 0.00000, and its gust pair measures 0.05102 to 0.05618.
- **A device without a grid could not make the wind at all.** Its stand-in texture was built from a
  float array. The texture's default format takes bytes, so the add-on threw E1208 while the page
  started. Such a device reads the steady field, as this record promises. A test reads the stand-in's
  shape.
- **The page's capture mode could not find its sketch.** It built the sketch's address from a
  template literal inside `new URL`. The bundler resolves such an address from the literal alone,
  so the lookup missed and the engine asked for a module named `undefined`. The page names the
  module literally now, and sets the switches on the address afterwards.
- **The wake check judged the wrong thing.** At eight levels of change a one-pixel lean counts as
  nothing, so the pushes read as absent. The check now holds two pages at the same time: the one
  that pushes the air, and the one that turns `?push=0`. It compares them at one level. The pair
  measures 0.07940, 0.05505 and 0.07452 of the channels changed on this Mac's card, and 0.07955,
  0.05506 and 0.07448 on its software GPU. With the pushes off on both pages it measures 0.00000.
  The difference is the trail, and a held pair is the same on every run.
  An earlier live pair read 0.002 on the software WebGL2 path. That was the live run's own
  frame-count noise: the held pair reads 0.07448 there, so the WebGL2 push path is sound.

## Rulings on this stage

- **The field's per-frame loops stay in TypeScript.** Hard rule 42 names loops over objects,
  instances, vertices, pixels and draw-list commands, and an add-on ships a frame loop through the
  task hook. These two loops are over a fixed ring of four slots: the sample's walk of the pushes and
  the gust, and the write of the same slots into the pass's values. A fixed four-slot ring is none of
  the rule's list, its work is constant, and the sketch's own arrays are made once. A task hop would
  also break `sample`, which a page calls and reads without waiting (hard rule 4). The cost gate
  measures the work within budget at every preset. The ruling is revisited if the ring stops being a
  fixed four.
- **The box's edge takes the steady field.** Each edge cell is set to the steady field that a reader
  works out past the box, and the projection leaves it there, so the grid and the far field agree at
  the edge. A cell beside the edge carries advected air, which lags the pushes and the gust. A page's
  pushes and the gust that it sends therefore turn the air inside the box only.
- **A stall skips the air that it missed.** A frame that owes more cycles than one frame runs sets the
  solved time to now. Crediting only the cycles that ran would leave a debt that every later frame
  pays, which is the fault the fixed step exists to avoid.
