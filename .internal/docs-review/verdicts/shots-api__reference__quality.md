# Shot and demo-link verdicts: api/reference/quality

## Shots

None proposed. A reference page of types needs no picture.

## Demo links

- quality.set -> forest/ (under "## `Quality`"): KEEP.
  The code `forest/` exists in examples/demos.ts (demo "forest", "Levels of detail").
  Its sketch (examples/forest/sketch.ts) calls `quality.set({ lodThreshold: ... })` when the
  reader presses L, and reads `quality.settings.lodThreshold` first. It also registers
  `quality.onChange(forest.fit)`. The demo's L control ("Levels of detail on or off") makes the
  change visible on screen. It is a short, clear use of `set` and `onChange`.
  Note: the link is for `set`, not `setPreset`. A run-time preset switch is in the shared showcase
  helper (examples/lib/showcase-effects.ts, used by showcase/creek, island and skyway), but it is
  buried in a large menu handler and is not a better link for this page.

## Concepts said to have no demo

- quality.setBudget: CONFIRMED. No file under examples/ calls `setBudget`.
- QualityGovernor: CONFIRMED. No demo reads `quality.governor` or any of its members
  (steps, farAnimationInterval, lowest, ...). Some demos turn the governor off through the
  `governor` setting (showroom, the compare sketches, showcase/creek, showcase/island), but
  that is a QualitySettings value, not the QualityGovernor interface.
- PresetCheck: CONFIRMED. No file under examples/ reads `engine.mode.presetCheck` or the
  PresetCheck type. examples/lib/compare.ts reads `engine.mode.preset` only.
