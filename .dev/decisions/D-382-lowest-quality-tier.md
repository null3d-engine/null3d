# D-382: The lowest quality tier, taken when the half-scale floor still misses

Status: decided and partly built. The owner approved the tier. The settings surface, the page's
start switch, the governor's entry, exit and cooldown, and the depth prepass as a live setting are
built, with their tests and docs. The mandatory cuts change live settings, which the Creek scene's
flags will read. The further cuts are
being measured on the Galaxy Tab S8, and are ranked here as they land. Code: the quality presets,
the governor, the quality settings, the page's settings bridge, the Creek scene's feature flags, the
tests and the docs.

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
4. **The settings surface** has two new live flags, `shadows` and `bloom`. `depthPrepass` becomes
   live. Every preset's row equals today's behavior, so no other preset changes. The further cuts
   use the existing settings where they exist. These are `reflectionScale`, `softParticles`,
   `cloudSteps`, `lodThreshold`, `lodShadowThreshold`, `farAnimationInterval`, `aoScale`, `ssrScale`,
   `fogSlices`, `bounceRays`, `contactShadowSteps`, `bloomSize` and `shadowFilter`. New tier flags
   cover the cuts the engine has no setting for. They are the water reflection off, the particle
   systems off, the sky volume off and the plant detail. A sketch reads the flags. The tier is the
   only writer.
5. **The further cuts are measured one at a time.** Each is built behind its flag, measured alone on
   the S8 at both paths, and ranked here by gain. The order follows the perf report. The water
   reflection goes off first, then to quarter size. Next are the particles off and a shorter leaf
   switch. Coarser plant levels follow. Then come the sky volume off, the cloud sea's steps, the
   falls and the dome. A cut is kept only when its gain is above the run's noise. Its look loss must
   also be acceptable to the owner.
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
- `packages/engine/src/quality/governor.ts`: the tier's entry and exit, its place in the step order,
  and the cut flags it sets.
- `packages/engine/src/page/engine.ts`: the `quality.set` bridge for the live prepass and the flags.
- `crates/null3d-*`: the live prepass in the frame builder.
- `examples/showcase/creek/`: the scene reads the tier's flags for the shadows, bloom, reflection,
  particles, cloud sea and plant detail.
- `packages/water/`: the reflection's off and quarter-size values where the cheap path needs them.
- Tests: the preset rows equal the old behavior. The governor enters and leaves the tier. The live
  prepass changes the passes without a restart. The sketch applies each flag. The docs and the
  preset docs list the tier.
- The ranking table and the kept-cut list fill as the S8's measurements land.
