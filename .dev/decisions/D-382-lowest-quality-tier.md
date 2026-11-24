# D-382: The lowest quality tier, taken when the half-scale floor still misses

Status: decided and partly built. The owner approved the tier. The settings surface, the page's
start switch, and the governor's entry, exit and cooldown are built, with their tests. The depth
prepass is a live setting in the core. The mandatory cuts change live settings, which the Creek
scene reads. The further cuts are measured on the Galaxy Tab S8 and ranked below. Code: the quality
presets, the governor, the quality settings, the page's settings bridge, the Creek scene's feature
flags, the tests and the docs. The preset check also enters the tier when Low draws far below its
target ([D-392](D-392-check-fast-exit-and-governor-target.md)), and a stored check keeps it.

Summary: A live lowest tier below the quality presets. The tier is entered when the render scale has
sat at the preset's floor, and the judged frames still miss. In the tier the scale floor falls to a
third. The sun's cast shadows go off. Bloom goes off. On WebGL2 the depth prepass goes off. The tier
leaves when the frames have room for the governor's sustained window. The further cuts sit behind
flags that only the tier changes. They are the water reflection, the particles, the sky volume and
the plant detail. Each cut is kept only when the S8's measurement shows its gain. No other preset
changes its look. Every new setting's rows at the four presets equal the behavior before this
record.

## Question

Some tablets choose Low and then sit at its floor of half the render scale. Their frames still miss.
The Galaxy Tab S8 (Adreno 730) reads 67 to 117 ms at 0.50, or 9 to 20 frames a second. The Galaxy Tab
A9 Plus (Adreno 619) draws its first frame at 107 to 140 s. It then loses its graphics process. What
should the engine do for that class? How far should it go?

## Data

- The prototype ran as page switches. The S8 went from 4.5 to 5.3 frames a second to 18.4 on WebGPU.
  On WebGL2 it went from 9.0 to 24.9. The A9 Plus drew at 1.6 frames a second, where it had lost its
  context. The switches were a third-size scale, shadows off, bloom off and the WebGL2 prepass off.
  They applied at the start of the page. The sources are `reports/tab-a9-e1404.md` and the device
  records.
- The garden's cost split on the Mac at High on WebGPU is in `reports/perf-garden.md`. The plants'
  main pass is 61 per cent of the frame. The cloud sea is 16. The water, falls and particles together
  are under 10. The cloud steps and half the particles are the cheap cuts. They are worth 15 to 40
  ms. The device splits differ, and this tier's ranking uses those.
- The further cuts ran on the S8 at Low. The render scale was pinned at 0.333, with no shadows and
  no bloom, over 60 s a page. The run is 20261122-024706-ultralow-cuts. Its pages ran on the probe
  branch at 44d9ca1a5, whose address switches stood in for the tier's flags. Each page follows a
  base page.
  The last page removes a layer that draws nothing distinct, as the run's control. The medians of
  the GPU time saved follow. The frame intervals are not used: the base pages ranged over 33 to 50
  ms, and the control moved 16.6 ms. The control's GPU time moved 0.07 ms, which is the run's noise.

| Cut | What the page left out | GPU ms saved | Draws | Calls a frame |
| --- | --- | --- | --- | --- |
| the water reflection | quarter size, one frame in 16 | 3.70 | 230 | 326 to 231 |
| the water | the creek and its falls | 6.26 | 230 to 222 | 232 to 222 |
| the particles | the air's mist and motes | 0.36 | 230 to 226 | 232 to 228 |
| the maple leaves | the leaves that the maples shed | 5.24 | 230 to 224 | 232 to 226 |
| the plants | the garden's plants | 17.24 | 230 to 116 | 232 to 118 |
| the cloud sea | the cloud sea and its mist | 10.45 | 230 to 227 | 326 to 322 |
| the falls | the two waterfalls | 0.33 | 230 to 225 | 326 to 225 |
| the fog | the volumetric fog | 0.07 | 230 | 232 |
| the underwater layer | the control | -0.07 | 230 to 229 | 232 |

The owner ruled on the look losses. The tier keeps the planting, the cloud sea and the creek. It
takes two cuts only: the reflection at a quarter size, and the maple leaves beyond 60 m. It does
not take the plants, the cloud sea, the creek, the particles, the falls or the fog. A coarser
planting level would be the next lever, and it waits for the owner.

## Decision

1. **The tier is a governor state, not a preset.** It exists only below the active preset. The
   entry reuses the governor's failed-raise and lower-trial hysteresis. The governor enters the tier
   after the scale has held at the preset's floor through the sustained window, while the judged
   frames still miss. It exits only on the sustained-room window that raises a step. One cooldown,
   equal to that window, follows an exit so a device cannot flap. It is reversible.
2. **The tier is also an explicit start choice.** A page switch pins it, so tests and devices can
   measure it. The chooser starts a known weak class in it. The governor stays the default path for
   everyone else. The four presets' behavior is unchanged.
3. **The mandatory cuts are four.** In the tier the scale floor falls from the preset's to a third.
   The sun's cast shadows go off. Bloom goes off. On WebGL2 the depth prepass goes off. The first
   three are live settings. The prepass is fixed when the frame builder starts today, so this
   decision makes it live. The core exposes the prepass as a live setting. The frame graph's
   `set_depth_prepass` follows it each frame. The tier flips it. A page that starts in the tier gets
   the prepass off from its first frame.
4. **The settings surface** has two new live flags, `castShadows` and `bloom`. `depthPrepass` becomes
   live. Every preset's row equals today's behavior, so no other preset changes. The owner keeps two
   further cuts, and both use what exists. One is the reflection passes' share, `reflectionScale`, at
   a quarter. The other is the maple leaves beyond 60 m, which the scene hides with the leaves mesh's
   own level switch. No new flag is needed for them. A sketch reads the cuts through the settings and
   `quality.governor.lowest`. The tier is the only writer.
5. **The further cuts are measured one at a time, and the owner keeps two.** Each was measured alone
   on the S8, in the tier's state, and ranked below by gain. A cut is kept only when its gain is
   above the run's noise, and its look loss is acceptable to the owner. The kept cuts are the
   reflection share and the leaves beyond 60 m. The plants, the cloud sea, the creek, the particles,
   the falls and the fog are not cut. The next lever would be a coarser planting level, and it waits
   for the owner.
6. **No other preset's look changes.** The settings' four preset rows reproduce the current behavior
   exactly. The tier's values live in the tier code. The docs state the tier and its cuts. The preset
   table shows only the values the other presets keep.

## Alternatives rejected

- **A fifth preset.** Its rows would ripple through every setting. They would also ripple through the
  add-ons' preset rows, such as the water's reflection cadence and the vegetation's. The docs and the
  tests would change too. A preset also cannot be entered or left by the governor's rules. The tier
  is conditional and reversible by nature.
- **A device list.** The chooser's facts can start a weak class in the tier. The tier's activation
  stays the frame judgment, not a name.
- **Cutting the scene's cost instead.** The plants' main pass is the frame, and it is also the
  fidelity reviewer's first gap. That is a look decision for the owner, not a tier.

## Code

- `packages/engine/src/quality/presets.ts`: the new settings and their four-preset rows, the live
  class of `depthPrepass`, and the tier's values.
- `packages/engine/src/quality/governor.ts`: the tier's entry, exit and cooldown, and their trials.
- `packages/engine/src/page/engine.ts` and `packages/engine/src/sketch/runner.ts`: the start switch,
  and the bridge that applies the tier's cuts and gives the settings back.
- `crates/null3d-*`: the live prepass in the frame builder.
- `examples/showcase/creek/`: the scene reads the tier's flags for the shadows, bloom, reflection,
  particles, cloud sea and plant detail.
- `packages/water/`: the reflection's off and quarter-size values where the cheap path needs them.
- Tests: the preset rows equal the old behavior. The governor enters and leaves the tier. The live
  prepass changes the passes without a restart. The sketch applies each flag. The docs and the
  preset docs list the tier.
- The ranking table and the kept-cut list fill as the S8's measurements land.
