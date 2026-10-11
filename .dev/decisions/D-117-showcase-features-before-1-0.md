# D-117: Showcase engine features move before 1.0

Status: decided by the owner on 8 October 2026. The features are tasks M2-EX13 to M2-EX18. Each one's design and figures go into a record of its own when it is built.

Summary: The showcase scenes must reach the quality of the "Cozy creek" reference. So every engine feature they need moves before 1.0. These are per-row values in instance batches, environment light from the sky with time of day, planar reflections, transmission and depth of field. A temporal anti-aliasing prototype comes too.

## Question

The showcase scenes should look as good as the best three.js scenes that people share. Should the engine features those scenes need wait for their places on the roadmap, or move before 1.0?

## Rule

The owner rules. The input is what a reference scene needs and what the engine has today.

The reference is "Cozy creek", a three.js scene shared on 8 October 2026. It shows:

- clear water over a stony bed, with glints and floating leaves;
- dense grass and leafy plants with soft shadows;
- rocks and a cave;
- time-of-day presets (afternoon, golden hour, blue hour, night, studio);
- a depth-of-field switch.

## Data

The engine on main on 8 October 2026, against what the reference needs:

| Need | State on 8 October | Roadmap before this decision | Task now |
| --- | --- | --- | --- |
| Grass and plants that cast and receive shadows | Instance batches neither cast nor receive shadows | M2-R6, with its record D-115 | M2-R6, no change |
| Grass that sways out of step, with per-blade tint | Batch row colours are stored but not drawn; surface and vertex functions read no per-row values | Not planned | M2-EX13 |
| Light and reflections that follow the time of day | The generated sky lights nothing; only the built-in room makes an environment | Not planned | M2-EX14 |
| Water that reflects its banks | Scene passes can mirror the scene by hand, but have no clip plane | M3 | M2-EX15 |
| Water that shows its bed, bent by its ripples | No transmission | After 1.0 | M2-EX16 |
| Depth of field | Not built; custom effects read one pixel, so they cannot blur | After 1.0 | M2-EX17 |
| Dense grass without shimmer in motion | MSAA and alpha to coverage, with no temporal anti-aliasing | After 1.0 | M2-EX18, a prototype first |
| Spray, falling leaves, fireflies | Sprites | The particles add-on, M3 | M3, no change |

Caustics, glints, foam, water flow and wind are recipes on top of these features: surface functions and vertex offsets. They are not engine features of their own.

How the data was produced: an inventory of the engine's rendering features, made on 8 October 2026 from the docs and the code. The needs come from frames of the reference's video.

## Decision

All the features above move before 1.0. The owner said: "we should move ahead whatever engine features we need for this into pre1.0 work."

The temporal anti-aliasing work starts as a prototype. It measures whether dense grass shimmers without it, and what a temporal pass costs. The owner then rules on shipping it, from that data.

## Consequences

- **Tasks:** `m2-breakdown.md` gains tasks M2-EX13 to M2-EX18. The roadmap's M3 row lists the pulled features.
- **Technique review:** the rows for transmission, depth of field, temporal anti-aliasing and planar reflections in [Technique review, October 2026](../technique-review-2026-10.md) point here.
- **Each feature:** it ships the way any engine feature does:
  - a design note and a decision record with its figures;
  - tests and image references on all three GPU paths;
  - docs, skills and the three.js mapping;
  - a measurement before and after on the Mac, the S24+ and the iPad.

  Its cost when no scene uses it stays near zero, and it fits the download budgets.
- **Showcase scenes:** the first one is Creek, in `examples/showcase/creek/`. Its terrain, stones, grass and water are made in code. Trees, plants and the cave mouth are built by script in Blender, and live in the sample-assets repository. [Examples](../examples.md#showcase-scenes) says how the showcase tier works.
