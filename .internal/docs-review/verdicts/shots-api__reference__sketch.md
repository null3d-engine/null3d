# Verdicts: shots and demo links, api/reference/sketch

## Shots

None proposed. Nothing to check.

## Demo links

### "fixed steps and seeded runs" -> `replay/` at `## SketchCallbacks`: REJECT

- The code exists: demos.ts gives the replay demo (Deterministic simulation) the code `replay/`.
- The demo does not show the concept at this heading. No file in examples/replay calls `onFixedUpdate`, `fixedRate` or `maxFixedSteps`. The page part (page.ts) steps the simulation by ticks with its own clock (`TickClock` in session.ts) on `requestAnimationFrame`. The sketch only draws the camera that the page sends, in `onUpdate`. The seed is the demo's own mulberry32 generator in sim.ts, not the engine's seeded `Math.random`.
- Also, the word "replay" on this page (`SketchEngine.held`, `firstFrame`, `downloads`) means the engine's own replay mode. A link to a demo called "replay" next to those words suggests that the demo uses that mode. It does not.
- Better link: `https://github.com/null3d-engine/null3d/tree/main/examples/hold-mode/` (the hold-mode demo has no code value, so `<name>/`). Its sketch sets `fixedRate: 120` through `defineSketch`'s options, moves 400 balls in `onFixedUpdate(step)`, and its header says that `?hold=3` makes the engine seed `Math.random` and step the sketch, so the held frame is the same on every run. That shows fixed steps, `SketchOptions.fixedRate`, and the seeded held run that `SketchEngine.held` describes. Place it at `## SketchCallbacks` (or `## SketchOptions`).
- Second choice, for `maxFixedSteps` as well: `compare/battle/` (comparisons.ts) passes `{ fixedRate, maxFixedSteps: 8 }` and uses `onFixedUpdate`. It is a large comparison scene, so hold-mode is the clearer first link.

## Concepts said to have no demo

### SketchPreferences: CONFIRMED, no demo

No sketch in examples/ reads `ctx.preferences`, `reducedMotion` or `onChange`. Only two unit tests stub `preferences: { reducedMotion: false }`, and the demo shell (lib/run.ts, index.html) checks the browser's reduced-motion setting itself, outside any sketch. None of these shows the sketch API.
