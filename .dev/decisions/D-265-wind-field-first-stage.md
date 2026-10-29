# D-265: The wind field's first stage, before a pass keeps its state

Status: decided. Built: stage one, the analytic field in `@null3d/wind`. Not built yet: stage two,
the advected core with its forces and fixed step, which waits on M3-V13. By the owner's ruling,
M3-V15 waits for M3-V13 and stays not done until stage two is built. Task: M3-V15.
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
- Hold mode draws the same picture on every run, so the field is a pure function of sketch time and
  of the pushes that the page made.
- The API and the WGSL sampling function do not move when the field gains its memory, so readers
  built on the analytic field keep working.

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
of one stream function in the ground plane, a push is a vortex, and a gust turns in rings about its
own center. Its base flow is constant along the ground and slower near it. No pressure solve is
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
confinement and the pressure solve that the plan describes. The field keeps two states, a reader
mixes them by the time between the field's steps, and a wake lasts after the body that made it has
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
  the steady field worked out from the air's settings, and a plant there still moves. The add-on
  reads the device's extensions to decide, and a test covers both answers.
- **The tier table waits:** the pressure steps, the field steps a second and the mixed states of the
  plan's table belong to stage two. M3-V14 measures the field that exists, and its rows are replaced
  when the core changes.
- **Docs and skills:** the wind page states that the field carries no state yet, and that a page
  reads it the same way before and after the change.
- **Evidence:** the add-on's tests prove the field moves a plant card, and that a frozen field fails
  those tests. The allocation figure and `check-addon`'s page, cost and allocation gates are owed
  while timing runs are barred, so this record claims none of them.
- **`sample` and the allocation gate:** the gate reads the add-on's page, and that page never calls
  `sample`, so the gate cannot see it. The call belongs in the benchmark harness as a switch when
  the gate first runs. It does not belong in the picture page, which would move every picture for a
  measure it does not need. Until then, a source test holds the functions that a frame calls to the forms that
  allocate: an object literal, an array literal, a function expression, a for-of and a `new`.
- **The add-on's own shader data counts against the shader budget:** the WebGL2 fallback effect's
  compiled data is most of the add-on's entry. At head `8d66b64ca`, the command in
  `docs/guides/add-ons.md`, `bunx @null3d/cli check-addon packages/wind --skip-browser`, reports the
  entry at 89.5 KB raw, and 13.8 KB with that import removed. Water's entry is 109.2 KB at that
  head. At that head the `sizes` gate failed on each add-on's own entry against the 64 KB code
  budget. M3-R25 counts an entry's inlined shader data in the
  shader budget, so both entries pass with no budget changed. `--skip-browser` leaves out the page,
  cost and allocation gates, which this record names owed.
- **The plugin's manifest, and what the check needs:** the command runs under node, and it finds the
  Vite plugin through the plugin's exported `package.json`. Without that export, node refuses the
  path, the tool finds no plugin and prints a skip for the shader and size gates. It then exits 0
  when every other gate passes, so a skipped check reads as a pass. The plugin exports its manifest,
  and `packages/cli/src/check-addon.test.ts` pins it. In a checkout whose plugin has no built files,
  node cannot load the plugin's TypeScript source: the shader gate fails and sizes skips. Build the
  plugin with `bun tools/build-package.ts vite-plugin`, or run the command with bun.

## The round 24 audit's findings

The round 24 audit left M3-V15 unticked with findings whose fixes belong to this task. The four
that are code are fixed here. The fifth is the solver, the forces and the fixed step. That is stage
two, which waits on M3-V13; V13 has since landed, and it is its own task.

- **The gust now travels.** `gust` writes a slot of its own, after the three push slots, so a
  page's pushes never push its gust out. Before, both shared one ring of four, and a page that
  pushed four times in a second lost its gust. A gust's wave center then moves along the heading at
  the gust's speed, so a gust sent where the air enters the scene crosses it. One test holds the
  gust in its slot under a page's pushes, and another holds a gust's center advancing where a
  push's stays.
- **A place outside the box reads the analytic field.** The sampling function clamped to the box's
  edge, which smeared the edge's local detail to the horizon. It now works the air out from the
  steady field at the height that the grid samples at. The reader gives it three vectors: the base
  wind, the gust and the swirl. The two agree at the box's edge, so there is no seam.
- **A device without float targets reads the field too.** Its box has no width, so every sample is
  the steady field, and a plant there moves. The device still keeps no pass, so it costs nothing.
- **The sampling file ships.** `shaders/field.wgsl` is in the package's `files` and in the pack
  check's required list, so a reader copies it from the installed package. The page's material and
  the docs page carry copies, and one test keeps every copy equal.
- **The namespace part still waits.** D-224's addendum says the shader build resolves only the
  engine's `null3d::` prefix. No add-on can import another add-on's WGSL module yet. The plan's
  RedGPU study line therefore accepts the copies for this task. It gives the add-on's own namespace
  to WGSL library modules from add-ons (the study's RES-1), which is not a task yet. This record
  keeps that reason, as hard rule 39 asks, rather than leaving the finding open without one.
