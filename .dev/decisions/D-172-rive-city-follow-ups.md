# D-172: Rive City's techniques become M3's first tasks

Status: decided by the owner on 14 October 2026. Date: 2026-10-14. Task: M2-R37, M2-EX43, M3-A1 to M3-C2.

Summary: A study of Rive City, a flying-car city that Rive's runtime draws in the browser, found about ten techniques that make its look. Its 3D scene also crashed once its script memory passed 2 GB. The owner ruled that the engine gaps, add-ons and two flagship demos from the study are M3's first tasks. Lights, Swarm and City leave M2's showcase tier for the M3 flagship. The study's demo touches join M2-EX43, and the fix for signed memory addresses is an M2 task (M2-R37).

## Question

Which of the techniques that Rive City uses should null3D build, in which milestone, and how do they relate to the M2 work in progress?

## Rule

The owner rules from the study's findings and from the overlap with M2's tasks.

## Data

Rive City (studied on 14 October 2026) is not a 3D engine. Rive's 2D runtime (`@rive-app/webgl2` 2.44.2) plays one 29.6 MB file, and a script module inside the file draws the city through Rive's low-level GPU interface. That interface has the shape of WebGPU, and Rive translates its WGSL shaders at export for each GPU path, as null3D's build does ([D-13](D-13-shader-variants.md)). The page runs on the main thread.

| Figure | Rive City |
| --- | --- |
| City geometry | 251,560 triangles in 387 objects, 60 MB once inflated (426 ms on the main thread) |
| Moving things | 8,437 instanced cars moved in the vertex shader, 322 steam vents, 173 holograms, 192 billboards |
| Real lights | 16; the rest of the night glow is a procedural light field |
| Render passes | About 8, with 14 draw calls in the script's code |
| Frame rate, Mac, Chrome, WebGL2 | About 57 fps at High at 2880 × 1514; 64 to 72 fps at 1440 × 757 |
| Crash | After about 10 minutes: "wasm call trapped in host_obj_draw: Start offset -2147422160 is outside the bounds of the buffer". The script's memory passed 2 GB, and an address was read as a signed 32-bit number |

The techniques that give its look:

- interior mapping: a room behind each window, by a ray into a box in the facade's shader;
- a power-on wave that lights the city and raises it from a point;
- LCD billboards drawn with sub-pixels when near;
- wet roads with ripples and a planar reflection;
- volumetric fog marched per pixel and cleaned by TAA;
- light shafts;
- car materials made in the shader (flakes, seams, clear coat, carbon weave, leather);
- 2D interfaces drawn into textures on 3D surfaces;
- rain and steam drawn from the vertex index with no data;
- a lens grade: grain, color fringes, an anamorphic streak, sharpening and speed blur.

The same fault class existed in null3D on 14 October 2026. The render worker read the draw list's address from the shared `Int32Array` slots with `Atomics.load` (`packages/engine/src/render/scene-renderer.ts`). The page read the job workers' wake, stop and yield addresses the same way (`packages/engine/src/page/stop-jobs.ts`). Above 2 GiB these reads return negative numbers. The default memory maximum, 1024 MiB, keeps every address below 2 GiB, but a page may raise the maximum to 4096 MiB ([D-04](D-04-memory-maximum.md)). The fault was found by reading the code. The same day `9726a73ef` converted each such read with `>>> 0` (hard rule 31). The static check `tools/check-address-reads.ts` and the browser test `tests/image/signed-address.spec.ts` now guard it.

Overlap with M2, as of 14 October 2026:

- Already M2 tasks, so they stay in M2:
  - lit fog (M2-EX21, on main) and screen-space reflections (M2-EX22);
  - motion vectors (M2-EX25) and auto exposure (M2-EX31);
  - decals (M2-EX27), area lights (M2-EX28) and reflection probes (M2-EX32);
  - clear coat and sheen (M2-EX30);
  - weighted transparency (M2-EX33) and impostors (M2-EX34).
- Partial overlaps:
  - M2-F10 sharpens only after an upscale; M3-B1 reuses its RCAS shader at full scale.
  - [D-129](D-129-temporal-anti-aliasing.md) already defers temporal anti-aliasing until motion vectors exist; M3-A11 revisits it.
  - M2's prototype L8 measures the baked grading table; the grading controls were already set for after M2.
  - M2 clamps colour overflow; NaN is new.
- Direct overlaps:
  - M2-EX8's Lights, Swarm and City showcases, not started, against the Skyway flagship.
  - M2-EX43's demo upgrades against the study's demo touches.

## Decision

The owner ruled on 14 October 2026:

1. Lights, Swarm and City leave M2-EX8. The M3 flagship Skyway (M3-C1) covers all three. Town stays in M2-EX8 as the Night town showcase.
2. The study's demo touches join M2-EX43: rooms behind windows, the power-on wave, LCD screens, flying traffic and a lens grade. They go to the Night town scenes, Battle, Factory and the feature demos. They use custom shaders and effects, which main already supports.
3. The fix for signed addresses is an M2 task, M2-R37.
4. Everything else becomes M3's first tasks, before the rest of M3's work:
   - Engine (M3-A1 to M3-A11):
     - texture coordinates on raycast hits;
     - canvas uploads of changed rectangles within the frame's upload budget;
     - texture-array layers chosen in custom WGSL;
     - bloom levels readable by custom effects;
     - draws from a vertex count alone;
     - a maximum draw distance per object;
     - NaN clearing in HDR writes;
     - grading controls baked into the grading table;
     - a hero shadow that follows one object;
     - full-resolution sharpening;
     - a new look at temporal resolve once motion vectors are on main.
   - Add-ons (M3-B1 to M3-B6): a lens kit, facades with interior mapping and the power-on wave, in-world screens, weather, a car-paint material and traffic lanes.
   - Flagship demos (M3-C1, M3-C2): Skyway, a flying-car night city, and Showroom to street, a car configurator. Skyway shows the engine's real lights, instance scale, worker rendering and flat memory.

## Consequences

- M2-R37 converts every address read from the shared slots to an unsigned number (`>>> 0`). It adds a static check against signed address reads. It also adds a browser test whose page asks for a 4096 MiB maximum and grows the engine's memory past 2 GiB. [AGENTS.md](../../AGENTS.md#hard-rules) states the rule now (hard rule 31). [Addresses above 2 GiB](../implementation-notes.md#addresses-above-2-gib) explains it.
- M2-EX8 shrinks to Creek and Town. M2-EX43 gains the demo touches. M3-B1 to M3-B3 later turn the touches' shader code into add-ons and move the demos onto them.
- The add-ons follow the add-on rule: each loads its shaders on first use, and costs nothing when a page does not import it.
- Rive's shaders were read only to learn the techniques. null3D's code is written from the techniques, never copied from Rive's files.

## Addendum, 15 October 2026: example add-ons

The owner ruled on 15 October 2026 ([D-173](D-173-addon-hooks.md), ruling 5) that the six add-ons M3-B1 to M3-B6 are example add-ons, not npm packages. They are the lens kit, facades, screens, weather, car paint and traffic lanes.

- Each lives in `examples/addons/<name>/`, shaped like a package, under the engine's licences. It uses only the public API, and the import check covers it.
- Their image tests run through the examples. They carry no version promise, so other developers are free to build and sell better versions.
- The lens kit uses the core's sharpening (M3-A10), grading (M3-A8) and vignette, and adds none of its own.
- Weather says which feature makes each part of the rain: its streaks from M3-A5's draws, and splashes and steam from the particles add-on.
- Car paint's flakes use glints ([D-179](D-179-technique-rulings-2026-10-15.md), ruling 17).

## Addendum, 19 October 2026: level of detail comes first

The owner ruled on 19 October 2026 that M3's level-of-detail work comes before the tasks of this record, because it also corrects existing guidance. The work is M3-L1 to M3-L4, in [D-137](D-137-lod-groups.md)'s addendum of that day. This record's tasks follow it, in their own order.
