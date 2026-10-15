# D-179: Technique and deferral rulings of 15 October 2026

Status: decided by the owner on 15 October 2026, at about 10:40 (UTC+8). The owner asked to settle every item that was set for after 1.0. Only WebXR stays after 1.0. Some items wait on a study that is already planned (rulings 15, 16 and 24). A few smaller items from the same brief got no ruling ("Items not ruled on"). Date: 2026-10-15. Task: M3-plan.

Summary: M3's global illumination is a leak-free probe volume on the L1 probe grid. Splats in M3 get detail levels, streaming, a budget and depth mixing. Glints, directional light maps, video textures, `three-compat` and the river and lake water come in M3. The glTF gaps, six API features, the script-tag build and the FFT ocean come before 1.0. ACES stays in the core. Many lights, the temporal upscaler and TAA hang on M3-A11's temporal resolve. Six techniques that no planned demo needs are dropped. WebXR comes after 1.0, as its own milestone. The new work is about 50 to 60 helper-weeks beyond the M3 list of 15 October.

## Question

A research session from 12 to 14 October 2026 asked which rendering techniques three.js lacks. It read three.js r186 and the r187 branch, recent talks and papers, six engines and the browsers' GPU features. [Technique review, October 2026](../technique-review-2026-10.md#newer-techniques-october-2026) records what it found. Its findings never reached git, and its rulings were never asked.

On 15 October 2026 the owner said: "let's not leave anything till after 1.0 let's decide now". So every item that the records, the mapping and the plans set for after 1.0 needed a ruling: build it before 1.0, or drop it.

## Rule

- Intent parity is strict; looks are "equivalent or better" ([D-52](D-52-intent-parity.md)). What a glTF file means is intent, so a gap there is a bug.
- Build before 1.0 what changes the shape of the frozen API, or what a glTF file means.
- Core or add-on follows [D-54](D-54-addon-modules.md) and [D-173](D-173-addon-hooks.md): one place per feature.
- A technique that no planned demo needs is dropped, not left for later.

## Data

The research found that three.js has caught up on screen effects. Its r186 release and r187 branch hold a basic SSGI, a temporal upscaler (`TAAUNode`), FSR 1, TRAA and SSR. They also hold weighted blended transparency, screen-space shadows, clustered point lights, an L2 probe grid and a splat renderer. So null3D leads on quality, detail levels and phone speed, not on having a feature. The inventory, the 17 ranked techniques and the sources are in [Technique review, October 2026](../technique-review-2026-10.md#newer-techniques-october-2026).

Costs are in helper-weeks (hw), the coordinator's estimates from the size of similar tasks on main.

| # | Item | Cost | Phone cost |
| --- | --- | --- | --- |
| 12 | Leak-free probe volume | About 3 hw | About 0.1 to 0.3 ms (estimate); 32 to 48 bytes per probe |
| 14 | Splats' wider scope | About 3 hw beyond the add-on | Spark ships 0.5 to 2.5 million splats per device budget |
| 15 | Many lights at a fixed cost | 1.5 hw to prototype, 2 more to ship | Published: +0.66 ms on an Adreno 610 at one sample per pixel, about 1.5 ms at 50 lights |
| 16 | Temporal upscaler that keeps MSAA | About 3 hw | Snapdragon GSR 2 targets under 2 ms on a Snapdragon 8 Gen 3 |
| 17 | Glints | Part of M3-B5 | About 0.3 to 1 ms on a full screen (estimate) |
| 18 | Directional light maps, `NEEDLE_lightmaps` | About 1.5 hw | About 0.1 ms; twice the light-map memory (estimate) |
| 19 | Water: river and lake; FFT ocean | About 2 hw each | Ocean about 0.5 ms for 3 bands at 128² (estimate) |
| 21 | glTF gaps | About 6 hw | Iridescence and anisotropy need WebGL2 texture units |
| 22 | Video textures | About 2 hw | Upload cost per frame, within the upload budget |
| 23 | `three-compat` | About 1 hw | None in the core |
| 25 | Script-tag build | About 2 hw | None |
| 26 | Six API features; `CubeCamera` | About 4 to 6 hw; 0.5 hw | Per feature |
| 28 | WebXR | 4 to 6 hw, after 1.0 | |

## Decision

The owner ruled on 15 October 2026, at about 10:40 (UTC+8), with the words "i approve all other stuff", after the coordinator's adjusted list. "Adjusted" marks a ruling where the coordinator moved a "1.x" recommendation before 1.0, as the owner asked.

### Techniques from the three.js comparison

12. **M3's global illumination is a leak-free probe volume** on M2-EX29's grid ([D-146](D-146-light-probe-grid.md)). Each probe gains a validity mask, so light does not leak through walls. A separate sky-occlusion term holds how much sky each probe sees. The live sky colour multiplies it, so time of day needs no new bake. This follows Unity 6's adaptive probe volumes, which ship to phones. three.js's grid has neither. The volume runs on WebGL2 too.
13. **Probe detail stays L1** ([D-146](D-146-light-probe-grid.md)). L2 needs seven reads per pixel against three. three.js's L2 `LightProbeGrid` is a look under D-52, so the port maps it and lists the difference.
14. **Splats in M3** get detail levels, streaming, a splat budget, depth mixing with meshes, and `KHR_gaussian_splatting` and SPZ files. three.js's splats have none of the first four.
15. **Many lights at a fixed cost** (HypeHype's stochastic tile lighting): a prototype in M3. It ships only if M3-A11 ships a temporal resolve, because its noise needs temporal cleanup. Otherwise it is dropped.
16. **A temporal upscaler that keeps MSAA:** M4 if M3-A11 ships a temporal resolve, otherwise dropped. three.js's `TAAUNode` needs MSAA off.
17. **Glints** (Deliot and Belcour, 2023) make M3-B5's car-paint flakes. No web engine checked has them, and the flakes stop shimmering far away.
18. **Directional light maps and reading `NEEDLE_lightmaps`** come in M3, in the core. Light maps that a glTF file carries are intent.
19. **The water add-on** gets river and lake water in M3, after splats. Adjusted: the FFT ocean comes before 1.0 too, in M3 or M4, about 2 hw. It is H1's first user ([D-173](D-173-addon-hooks.md)).
20. **Dropped from the plan:** GPU grass, OpenPBR, hair, distance-field shadows, moment transparency and screen-space bounce light. No planned demo needs them. Other developers may build the ones that fit an add-on.

### Other items that were set for after 1.0

21. **glTF intent gaps come in M4,** before 1.0: `KHR_animation_pointer` with property animation, iridescence, anisotropy, and transmission and thickness maps. Files that use them draw wrong today. About 6 hw.
22. **Video textures come in M3,** with the in-world screens, which share M3-A2's upload path.
23. **ACES stays in the core.** It is one curve, already tested strictly, so it is a shared building block like flat clouds. The `three-compat` add-on comes in M3 with Reinhard, Cineon, and `OutlinePass`'s glow, pulse and blurred edge. This changes [D-53](D-53-technique-defaults.md)'s ruling 4 and settles [D-79](D-79-lighting-defaults.md)'s ruling 5.
24. **TAA:** M3-A11 rules. If it says no, TAA is dropped, not deferred, and the three.js mapping says so ([D-129](D-129-temporal-anti-aliasing.md)).
25. **The script-tag build** (test T-32) comes in M4. It lets people try null3D in CodePen-style pages before the 1.0 launch.
26. **Adjusted: six API features come in M4,** about 4 to 6 hw. They are multiple views, gizmos, spot-light cookies and CSS3D labels. The others are a material override for a whole pass and a tone-mapping flag per material. `CubeCamera` maps to a reflection-probe update in M3.
27. **Browser-gated items are adopted as browsers ship them,** with no date: multi-draw indirect, 64-bit atomics, mesh clusters, the visibility buffer, ray tracing and subgroups. The GPU layer keeps their capability flags.
28. **WebXR is not in 1.0.** It comes after 1.0, as its own milestone. The owner, after asking what it is: "oh yes, webxr can come later". It is the one exception to "nothing after 1.0". The main-thread draw mode keeps working, so WebXR can arrive without a redesign.
29. **The research findings are recorded now:** in [Technique review, October 2026](../technique-review-2026-10.md#newer-techniques-october-2026) and in the three.js mapping, its docs page and the porting skill.

### Items not ruled on

The brief also listed smaller items with a recommendation. The owner's rulings above do not name them, so they stay open:

- rooms and portals; cluster culling for large static meshes; virtual texturing;
- the impostors' three-view blend, bake helper and `assets impostor` command;
- lit fog for transparent surfaces and particles;
- the follow-ups of levels of detail, of outlines, of transmission's back faces and of MSAA with FXAA;
- surface functions that read the scene's lights, for toon shading;
- the memory items of [D-130](D-130-memory-toward-threejs.md): exact upload arenas and tables, and the two always-on threads.

## Options rejected

- **Leave additive features for 1.x minor releases.** The brief recommended it for H1, H2, H8, the ocean and the six API features, since adding to the API breaks nobody. The owner wanted every item settled before 1.0.
- **L2 probes, for strict comparison with three.js.** Seven reads per pixel on phones, for a difference that is a look under D-52.
- **ACES moved to `three-compat`.** Every port that set ACES would need an install, for one curve with no hook.
- **A bake add-on.** The bake stays in the core, as D-146 built it.
- **Particle collision with the depth buffer.** The particles add-on has no simulation pass ([D-131](D-131-particles.md)).

## Consequences

- **Records:** [D-52](D-52-intent-parity.md), [D-53](D-53-technique-defaults.md), [D-79](D-79-lighting-defaults.md), [D-129](D-129-temporal-anti-aliasing.md), [D-142](D-142-more-techniques-before-1-0.md) and [D-146](D-146-light-probe-grid.md) gain addenda that point here.
- **Technique review:** a new section holds the research. It gives what three.js gained and still lacks, the browsers' GPU features, the 17 techniques with their verdicts, and the sources. The `three-compat` contents, the ACES porting verdict, and the gap rows for TAA, light maps, water and WebXR change.
- **The three.js mapping:** new entries for `TAAUNode`, `TRAANode`, `FSR1Node`, `SSGINode`, `LightProbeGrid`, the clustered lights, `GaussianSplat`, `SunLight` and the screen-space shadows. Entries that said "after 1.0" now give the version that brings the feature. WebXR says "not in version 1", and TAA says "no equivalent" until M3-A11 rules. The porting skill and the develop skill follow.
- **README:** the roadmap's 0.3 and 1.0 steps gain the features of these rulings.
- **Plans:** the new tasks join M3's and M4's task lists.
