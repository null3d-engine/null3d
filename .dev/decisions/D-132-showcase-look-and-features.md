# D-132: A beautiful look for every demo, and more engine features before 1.0

Status: decided by the owner. It extends [D-117](D-117-showcase-features-before-1-0.md), and [D-142](D-142-more-techniques-before-1-0.md) adds eleven more techniques. The features are tasks M2-EX20 to M2-EX22, M2-F12, M2-J4 and M2-I4, and M2-EX19 cuts memory. Each feature's design and figures are in a record of its own. Built: particles ([D-131](D-131-particles.md)), light shafts and lit fog ([D-133](D-133-volumetric-fog.md)), screen-space reflections ([D-134](D-134-screen-space-reflections.md)) and contact shadows ([D-135](D-135-contact-shadows.md)). Also built: bump and displacement maps ([D-136](D-136-bump-displacement-wireframe.md)), LOD groups ([D-137](D-137-lod-groups.md)) and the memory cut ([D-130](D-130-memory-toward-threejs.md)). Motion blur and global illumination are M3 work.

Summary: Every demo, showcase scene and comparison must look very beautiful, with shaders, effects, particles and complex geometry. So particles, light shafts and lit fog, screen-space reflections, contact shadows, bump and displacement maps and LOD groups come before 1.0. Motion blur and global illumination join M3, and M2-EX19 brings memory toward three.js's without slower frames.

## Question

D-117 puts before 1.0 the features that the Creek showcase scene needs. The comparisons Battle and Night town and the busy page follow. Is a good figure enough for a demo or a comparison? Or must each one also look as good as the best scenes that people share? Which engine features does that look need, and when?

## Rule

The owner rules. The input is what Creek, Battle and Night town need for that look, and what the engine draws without each feature.

## Data

What the scenes need, against what the engine draws without the feature:

| Need | Without the feature | Feature and task |
| --- | --- | --- |
| Spray, mist, falling leaves and fireflies (Creek); sparks, smoke, explosions and debris (Battle); rain, steam and exhaust (Night town) | Sprite and point batches, which the sketch moves row by row. No emitters and no simulation on the GPU | The particles add-on, M2-EX20 |
| Sun through trees, and a glow around lamps and headlights | Height fog with a sun glow. Light in the fog ignores shadows | Light shafts and lit fog, M2-EX21 |
| Wet streets, puddles and polished floors | Planar reflections for flat surfaces ([D-120](D-120-planar-reflections.md)), and environment light elsewhere | Screen-space reflections, M2-EX22 |
| No light gap where an object meets the ground | Cascade shadows only. [D-53](D-53-technique-defaults.md) sets the design: inline, for the sun, on High and Ultra | Contact shadows, M2-F12 |
| Detail on stones, bark and ground | Normal maps only | Bump and displacement maps, M2-J4 |
| Dense, complex geometry far from the camera | The full mesh at every distance, though the asset tool makes levels of detail and stores each level's error | LOD groups, M2-I4 |
| Blur on fast motion | Not built | Motion blur, M3 |
| Light that bounces between surfaces | Environment light, from the built-in room or the sky, and the light probe grid ([D-146](D-146-light-probe-grid.md)) | Global illumination in M3, with a technique that phones can run, chosen there. DDGI is too heavy for phones |

The memory gap comes from the Factory comparison ([D-121](D-121-comparison-tier.md#figures-on-the-mac)). It is the browser's measurement of the whole page and its workers, on a Mac in Chrome:

| Factory at 50,000 moving parts | null3D, WebGPU | three.js, WebGLRenderer |
| --- | --- | --- |
| Scene graph mode | 240 MiB | 108 MiB |
| Instanced mode | 115 MiB | 17 MiB |

In the scene graph mode, null3D held 22 to 27 times three.js's count. A memory cut must keep that lead.

How the data was produced: the needs come from the owner's review of Creek's frames, and from the plans for Battle and Night town. The memory figures come from [D-121](D-121-comparison-tier.md#figures-on-the-mac).

## Decision

The owner ruled four points.

1. **The look bar.** Every demo, showcase scene and comparison must look very beautiful. Each uses shaders, effects, particles and complex geometry. A good figure does not excuse a plain scene. The owner said it of every demo and comparison, and of Creek, Battle and Night town by name.
2. **Features before 1.0.** Each one is a task in M2:
   - M2-EX20, the particles add-on;
   - M2-EX21, light shafts and lit fog;
   - M2-EX22, screen-space reflections;
   - M2-F12, contact shadows; M2-J4, bump and displacement maps; and M2-I4, LOD groups.
3. **M3 gains motion blur and global illumination.** Global illumination needs a technique that phones can run. M3 chooses it, with figures from the phones and the iPad.
4. **Memory.** M2-EX19 brings null3D's page memory toward three.js's, with no frame slower. The owner said: "minimise memory usage to get closer to the threejs amount whilst not compromising our engine performance". A cut that costs frame time is reported, not merged.

## Consequences

- **Tasks:** M2-EX19 to M2-EX22 hold the new work. The roadmap's M3 row holds motion blur and global illumination, and particles sit in M2. The plan's row on DDGI points to M3.
- **Each feature:** it ships the way any engine feature does, as [D-117](D-117-showcase-features-before-1-0.md#consequences) says:
  - a design note and a decision record with its figures;
  - tests and image references on all three GPU paths;
  - docs, skills and the three.js mapping;
  - its cost per preset, and near zero when no scene uses it;
  - a feature demo at the look bar of the generators demo.
- **Particles:** the add-on ships in 0.1.0, as [D-108](D-108-first-release.md) and [D-54](D-54-addon-modules.md) say.
- **Other records:** this record places particles in M2. D-53's list of gap features (row 21) and D-117's row for spray, leaves and fireflies give way to it. D-117's status and that row point here.
- **Examples guide:** [Examples](../examples.md) holds the look bar for the comparisons, and the table of engine features for the showcase scenes.
- **README:** the roadmap puts the particles add-on in 0.2, and motion blur and global illumination in 0.3.
