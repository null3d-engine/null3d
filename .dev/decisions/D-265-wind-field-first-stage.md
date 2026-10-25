# D-265: The wind field's first stage, before a pass keeps its state

Status: decided. Date: 2026-10-26. Task: M3-V15. [D-241](D-241-vegetation-foundation.md) puts the
fluid wind in an add-on of its own, and [D-173](D-173-addon-hooks.md)'s addendum of 25 October 2026
makes it the twelfth foundation.

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

What can the wind add-on build now, so that a plant reads one field, when the engine cannot keep a
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

No timing run was made for this record: the machine was shared and the night's rules bar benchmark
and timing runs. Every cost figure for the field stays owed to M3-V14.

## Decision

The field is built in two stages. M3-V15 builds the first.

**Stage one, this task.** The analytic wind is incompressible by construction. Its swirl is the curl
of one stream function in the ground plane, a push is a vortex, and a gust turns in rings about its
own center. Its base flow is constant along the ground and slower near it. No pressure solve is
therefore needed to keep the air's volume. The test holds the discrete form's divergence under a thousandth of the field's
speed, so the air keeps its volume without one.
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

**The pressure projection is left out for now, on purpose.** This field is incompressible by
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
  body. The pushes' trail stands in for the wake until M3-V13 lands. A place outside the grid's box
  reads the box's edge, so the air is smooth rather than exact there.
- **A device that cannot hold the field:** a WebGL2 device without a float render target keeps no
  pass, so the add-on costs it nothing. Its readers sample a one-texel texture of the output's
  neutral black, and `sample` still gives the air. The add-on reads the device's extensions to
  decide, and a test covers both answers.
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
- **The size gate is not this add-on's fault:** at head `8d66b64ca`, the command in
  `docs/guides/add-ons.md`, `bunx @null3d/cli check-addon packages/wind --skip-browser`, builds the
  add-on and reports its entry at 89.5 KB raw against a 64 KB code budget. The WebGL2 fallback
  effect's compiled data is most of it: the same build with that import removed makes an entry of
  13.8 KB at that head. Water fails the same gate at 109.2 KB at that head. `--skip-browser` leaves
  out the page, cost and allocation gates, which this record names owed. M3-R25 owns the size
  fault, and neither the gate nor its budget changes here.
- **A check that used to skip, and what it still needs:** the command runs under node, and the Vite
  plugin did not export its `package.json`. Node refused the path, the tool found no plugin, and it
  printed a skip for the shader and size gates. It still exited 0 when every other gate passed, so a
  skipped check read as a pass. The plugin now exports its manifest, and
  `packages/cli/src/check-addon.test.ts` pins it. In a checkout whose plugin has no built files,
  node cannot load the plugin's TypeScript source: the shader gate fails and sizes skips. Build the
  plugin with `bun tools/build-package.ts vite-plugin`, or run the command with bun.
