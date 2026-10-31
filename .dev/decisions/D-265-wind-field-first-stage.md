# D-265: The wind field's first stage, before a pass keeps its state

Status: decided. Built: stage one, the analytic field in `@null3d/wind`. Built: stage two, the
advected core with its forces and its fixed step, on M3-V13's pass that keeps its state. Task:
M3-V15.
[D-241](D-241-vegetation-foundation.md) puts the fluid wind in an add-on of its own, and
[D-173](D-173-addon-hooks.md) makes it the twelfth foundation.

Summary: The fluid wind needs a solver that carries its state between frames, and the engine refuses
one (E1504). That read is M3-V13, which is not built. The wind add-on therefore starts with a field
that keeps no state. An analytic wind, incompressible by construction, fills a grid that follows the
camera. A page sets the base wind, sends a gust and pushes the air. The API and the sampling
function stay the same when M3-V13 adds the advected core.

**The field that M3-V15 ships is not the final one.** It has no advected core and no lasting wake.
Both wait on the repeated compute pass of M3-V13, and the pressure projection is left out for the
reason in "The decision". A reader of this record should not take the shipped field for the fluid
simulation that the plan describes.

## Question

What can the wind add-on build before M3-V13, so that a plant reads one field, when the engine cannot keep a
pass's state between frames?

## Rule

- The add-on stays inside the public API (AGENTS.md rule 12). It does not ask for an engine change
  that belongs to another task.
- A frame allocates nothing (hard rule 1).
- Hold mode draws the same picture on every run. The field there is a pure function of sketch time
  and of the pushes that the page made.
- The API and the WGSL sampling function do not move when the field gains its memory. Readers built
  on the analytic field keep working.

## Data

| Need | The engine at `m3-start`, 26 October 2026 | Source |
| --- | --- | --- |
| A pass that reads its last step | A pass that reads its own texture, or two that read each other's, throws E1504 | `docs/api/render.md`, Errors |
| Many solver steps in one frame | A pass runs its dispatch once. 40 Jacobi steps would need 40 passes, and a page's 32nd pass throws E1220 | `docs/api/render.md` |
| A field of several layers that swaps | No history read, so no swap | M3-V13, not built |
| Reading the field back on the CPU | No public call reads a pass's texels. M3-V13 adds one | `docs/api/render.md` |

M3-V13 is not on `m3-start`: `git log --all --grep="M3-V13"` finds no commit, `tools/task-evidence.ts`
has no entry for it, and no engine pass option names a history or a swap. The plan puts it before
M3-V15, so the field's memory is owed to that task, not to this one.

No timing run was made for this record, because the shared machine's rules barred benchmark and
timing runs. Every cost figure for the field is owed to M3-V14.

## Decision

The field is built in two stages, both under M3-V15.

**Stage one, built.** The analytic wind is incompressible by construction. Its swirl is the curl
of one stream function in the ground plane. A push is a vortex, and a gust turns in rings about
its own center. Its base flow is constant along the ground and slower near it. No pressure solve is
therefore needed to keep the air's volume. The test holds the discrete form's divergence under a
thousandth of the field's speed, so the air keeps its volume without one.

A grid that follows the camera samples that field into one `rgba16float` texture, which a reader
samples with one texture read. The texture holds the wind across the ground and the local speed in
its fourth channel.

The field is evaluated from sketch time and from the pushes' trail, so it is the same on every run
of a held frame. A page calls `createWind` once, then sets the base wind, sends a gust or pushes the
air at a point. The pushes ring holds the four newest, which fade over three seconds.

**Stage two, with M3-V13.** V13 is what lets one pass read its own last step and run its dispatch
several times in a frame. The core then becomes an advected solve in Stam's form, with vorticity
confinement and the pressure solve that the plan describes. The field keeps two states, and a reader
mixes them by the time between the field's steps. A wake then lasts after the body that made it has
gone. The grid, the box, the outputs, the sampling function and every reader stay as they are.

**The pressure projection is left out on purpose.** This field is incompressible by
construction, so a projection would remove nothing and no frame would run it. The code that ran it
would be dead. The test above is the measure that says so. The projection returns with the drag
input from the vegetation add-on's grid of canopy cover, which M3-V17 gives the wind. Drag adds
divergence, and the projection removes it.

## Consequences

- **Code:** `packages/wind/` holds the analytic field in TypeScript and the same formula in the
  grid's compute shader and in its WebGL2 fragment form. The TypeScript form serves the tests and
  the page's own CPU reads.
- **Why two shader copies:** the shader build resolves only the engine's `null3d::` library, so one
  shader cannot import another of the same add-on. The copies exist for that alone. A test holds
  them byte for byte equal, and a build that received an add-on's own modules would remove them.
- **What stage one cannot do:** a gust does not spread by itself, and a wake does not outlive the
  body. The pushes' trail stands in for the wake until M3-V13 lands.
- **A device that cannot hold the field:** a WebGL2 device without a float render target keeps no
  pass, so the add-on costs it nothing. Its box has no width, so every sample of every reader is
  the steady field worked out from the air's settings. A plant there still moves. The add-on
  reads the device's extensions to decide, and a test covers both answers.
- **The tier table waits:** the pressure steps, the field steps a second and the mixed states of the
  plan's table belong to stage two. M3-V14 measures the field that exists, and its rows are replaced
  when the core changes.
- **Docs and skills.** Stage one's page said the field carried no state yet. It said too that a
  page reads the field the same way before and after the change. Stage two describes the solved field.
- **Evidence:** the add-on's tests prove the field moves a plant card, and that a frozen field fails
  those tests. The allocation figure and `check-addon`'s page, cost and allocation gates were barred
  from stage one. Stage two's full run and `WIND_BUDGETS` give them, as "What the checks found when
  they first ran" states.
- **`sample` and the allocation gate.** The gate reads the add-on's page. That page never calls
  `sample`, so the gate cannot see it. The call belongs in the benchmark harness as a switch when
  the gate first runs. It does not belong in the picture page, which would move every picture for a
  measure it does not need. A source test holds the functions that a frame calls to the forms that allocate. Those are an
  object literal, an array literal, a function expression, a for-of and a `new`.
- **The add-on's own shader data counts against the shader budget.** This is the WebGL2 fallback
  effect's compiled data, which is most of the add-on's entry. At head `8d66b64ca`, a run of
  `bunx @null3d/cli check-addon packages/wind --skip-browser` reports the entry at 89.5 KB raw. With that import removed it reports 13.8 KB. Water's entry is 109.2 KB at that
  head. At that head the `sizes` gate failed on each add-on's own entry against the 64 KB code
  budget. M3-R25 counts an entry's inlined shader data in the
  shader budget, so both entries pass with no budget changed. The switch leaves out the page,
  cost and allocation gates, which the full run in "What the checks found when they first ran"
  takes.
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
the eddies, and the pressure solve keeps the air from piling up. The box's edge takes the analytic
air, so the grid and the far field meet there.

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
- **A place outside the box reads the analytic field.** The sampling function clamped to the box's
  edge, which smeared the edge's local detail to the horizon. It now works the air out from the
  steady field at the height that the grid samples at. The reader gives it three vectors: the base
  wind, the gust and the swirl. The two agree at the box's edge, so there is no seam.
- **A device without float targets reads the field too.** Its box has no width, so every sample is
  the steady field, and a plant there moves. The device still keeps no pass, so it costs nothing.
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
  inline. The budget table holds the six above with that reason, and the run passes. The docs do not
  promise that a call allocates nothing without that caveat.

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
  started. Such a device now reads the analytic field as this record promises. A test reads
  the stand-in's shape.
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

- **The field's per-frame loop is allowed.** `sample` calls `analyticVelocity`, which walks a ring of
  four fixed slots. Hard rule 42 names loops over objects, instances, vertices, pixels and draw-list
  commands. A fixed four-slot ring is none of those. Its work is constant, and the cost gate measures
  it within budget at all four presets. Moving it to a job worker for tidiness alone would add a task
  hop that this loop has not earned. The ruling is revisited if the ring stops being a fixed four.
- **The box's edge meets the analytic field; the cells beside it do not.** Each edge cell is set to
  the analytic air. A cell beside the edge carries advected air, which lags a push.
  Beside a push, the two differ by however far the push has travelled in that air. That is a
  limit of this stage. A blend needs its own measurement, and it is not in this branch.
- **A stall skips the air that it missed.** A frame that owes more cycles than one frame runs sets the
  solved time to now. Crediting only the cycles that ran would leave a debt that every later frame
  pays, which is the fault the fixed step exists to avoid.
