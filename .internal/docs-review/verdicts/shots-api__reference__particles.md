# Verdicts: api/reference/particles (shots and demo links)

## Shots

None proposed. Nothing to check.

## Demo links

### particles/ at "## `createParticles`": keep, with a narrower concept

- The code `particles/` exists in examples/demos.ts (demo `particles`, "Campfire glade").
- The sketch (examples/particles/sketch.ts) calls `createParticles` five times (fire, embers, smoke, leaves, fireflies). It spreads `particleTextures` presets into each one (flame, spark, smoke, leaves, glow). It also sets wind on the smoke each frame with `set`.
- It does NOT use sub-emitters. No `subEmitters` option appears in the sketch or anywhere under examples/. Only the unit test in packages/particles/src/system.test.ts uses it.
- Fix: change the concept to "createParticles, particleTextures, per-frame set (wind)". Drop "sub-emitters" from the link text.

## Concepts said to have no demo

### ParticleBuffer used directly: confirmed, no demo

- No demo or add-on under examples/ makes or writes a particle buffer itself. All of them (particles, showcase/creek via flora.ts and air.ts, the weather add-on, and the water package's waterfall) go through `createParticles`.

### Sub-emitters (added): confirmed, no demo

- The proposal said the particles demo shows sub-emitters. It does not, and no other demo does. Record sub-emitters as a concept with no demo.
