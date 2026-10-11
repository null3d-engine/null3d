# D-132: A beautiful look for every demo, and more engine features before 1.0

Status: decided by the owner on 11 October 2026, between about 07:55 and 08:15 (UTC+8). It extends [D-117](D-117-showcase-features-before-1-0.md). The features are tasks M2-EX20 to M2-EX22, M2-F12, M2-J4 and M2-I4, and M2-EX19 cuts memory. Each feature's design and figures go into a record of its own when it is built.

Summary: Every demo, showcase scene and comparison must look very beautiful, with shaders, effects, particles and complex geometry. So particles, light shafts and lit fog, screen-space reflections, contact shadows, bump and displacement maps and LOD groups start now, before 1.0. Motion blur and global illumination join M3, and M2-EX19 brings memory toward three.js's without slower frames.

## Question

D-117 moved before 1.0 the features that the Creek showcase scene needs. The comparisons Battle and Night town and the busy page came next. Is a good figure enough for a demo or a comparison? Or must each one also look as good as the best scenes that people share? Which engine features does that look need, and when?

## Rule

The owner rules. The input is what Creek, Battle and Night town need for that look, and what the engine has today.

## Data

The engine on main on 11 October 2026, against what the scenes need:

| Need | State on 11 October | Roadmap before this decision | Task now |
| --- | --- | --- | --- |
| Spray, mist, falling leaves and fireflies (Creek); sparks, smoke, explosions and debris (Battle); rain, steam and exhaust (Night town) | Sprite and point batches, which the sketch moves row by row. No emitters and no simulation on the GPU | The particles add-on, M3 | M2-EX20 |
| Sun through trees, and a glow around lamps and headlights | Height fog with a sun glow. Light in the fog ignores shadows | After 1.0, with god rays as a custom-effect recipe in M3 | M2-EX21, light shafts and lit fog |
| Wet streets, puddles and polished floors | Planar reflections for flat surfaces ([D-120](D-120-planar-reflections.md)), and environment light elsewhere | After 1.0 | M2-EX22, screen-space reflections |
| No light gap where an object meets the ground | Cascade shadows only. [D-53](D-53-technique-defaults.md) set the design: inline, for the sun, on High and Ultra | M2-F12, a P1 task near the end of M2 | M2-F12, started now |
| Detail on stones, bark and ground | Normal maps only | M2-J4, a P1 task | M2-J4, started now |
| Dense, complex geometry far from the camera | The asset tool makes levels of detail and stores each level's error. The engine draws only the full mesh | M2-I4, a P1 task | M2-I4, started now |
| Blur on fast motion | Not built. A custom effect cannot read the frame before | After 1.0 | M3 |
| Light that bounces between surfaces | Environment light, from the built-in room or the sky. A probe grid is planned for M3 | Global illumination with DDGI was judged too heavy for phones. It was a candidate for desktop presets after 1.0 | M3, with a technique that phones can run, chosen there |

The memory gap comes from the Factory comparison ([D-121](D-121-comparison-tier.md#figures-on-the-mac)). It is the browser's measurement of the whole page and its workers, on a Mac in Chrome:

| Factory at 50,000 moving parts | null3D, WebGPU | three.js, WebGLRenderer |
| --- | --- | --- |
| Scene graph mode | 240 MiB | 108 MiB |
| Instanced mode | 115 MiB | 17 MiB |

In the scene graph mode, null3D held 22 to 27 times three.js's count. A memory cut must keep that lead.

How the data was produced: the states come from the docs and the code on main on 11 October 2026. The needs come from the owner's review of Creek's frames, and from the plans for Battle and Night town.

## Decision

The owner ruled four points on 11 October 2026.

1. **The look bar.** Every demo, showcase scene and comparison must look very beautiful. Each uses shaders, effects, particles and complex geometry. A good figure does not excuse a plain scene. The owner said it of every demo and comparison, and of Creek, Battle and Night town by name.
2. **Features before 1.0, started now.** Each one is a task that starts at once:
   - M2-EX20, the particles add-on, from M3;
   - M2-EX21, light shafts and lit fog, from after 1.0;
   - M2-EX22, screen-space reflections, from after 1.0;
   - M2-F12, contact shadows; M2-J4, bump and displacement maps; and M2-I4, LOD groups. These three were M2 tasks already, and now start early.
3. **M3 gains motion blur and global illumination.** Global illumination needs a technique that phones can run. M3 chooses it, with figures from the phones and the iPad.
4. **Memory.** M2-EX19 brings null3D's page memory toward three.js's, with no frame slower. The owner said: "minimise memory usage to get closer to the threejs amount whilst not compromising our engine performance". A cut that costs frame time is reported, not merged.

Until the particles add-on lands, the scenes draw their particles with sprites behind a small interface of their own. They switch to the add-on when it merges.

## Consequences

- **Tasks:** `m2-breakdown.md` gains M2-EX19 to M2-EX22. The roadmap's M3 row adds motion blur and global illumination, and moves particles to M2. The plan's row on DDGI now points to M3.
- **Each feature:** it ships the way any engine feature does, as [D-117](D-117-showcase-features-before-1-0.md#consequences) says:
  - a design note and a decision record with its figures;
  - tests and image references on all three GPU paths;
  - docs, skills and the three.js mapping;
  - its cost per preset, and near zero when no scene uses it;
  - a feature demo at the look bar of the generators demo.
- **Particles:** the add-on still ships in 0.1.0, as [D-108](D-108-first-release.md) and [D-54](D-54-addon-modules.md) say. Only its milestone moves.
- **Earlier records:** D-53's list of gap features for M3 (row 21) and D-117's row for spray, leaves and fireflies placed particles in M3. This record moves them to M2. D-117's status and that row point here.
- **Technique review:** the rows for particles, motion blur, volumetric light and screen-space reflections in [Technique review, October 2026](../technique-review-2026-10.md#gaps-ranked) point here. A line under the table adds global illumination.
- **Examples guide:** [Examples](../examples.md) holds the look bar for the comparisons, and the table of engine features for the showcase scenes.
- **README:** the roadmap moves the particles add-on to 0.2, and adds motion blur and global illumination to 0.3.
