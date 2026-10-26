# D-199: M4's feature work and the engine study's tasks go into M3

Status: decided by the owner. The task lists hold the moved tasks and the study's tasks. The tasks themselves are M3's work, and each task's record says what of it is built. M2 finishes before M3 starts.

Summary: The 21 feature tasks that D-173 and D-179 put in M4 are in M3 with new IDs, so M4 holds only release readiness: the API freeze, the device-lab pass, the size budgets, full fuzzing and the public benchmarks. The recommendations of a study of a closed-source native engine join M3 as 18 new tasks and changes to 7 existing ones. Built-in renderer features stay internal, GPU grass stays dropped, and D-180 stays deferred until after 1.0.

## Question

The owner said that M4 is mostly release readiness. Where does M4's feature work go, and which recommendations of the engine study does null3D adopt before 1.0?

## Rule

- M4 holds release work only. Every feature task goes into M3, so the releases of M4 ship it: 0.1.0, then a final 0.2.0 ([D-108](D-108-first-release.md)).
- A study recommendation is adopted as it was written, with its priority and its own condition ("in M3 if capacity allows, else after 1.0" stays as it is).
- The owner's other rulings stay in force unless this record names them: D-180 stays deferred, D-179's dropped techniques stay dropped, and hard rule 14 (no GPU names) stays.

## Data

### The engine study

A study read a closed-source native game engine: its shipped kit, its headers and shaders, a sample game, and the decompiled code of 96.6% of the game program's functions. Nothing of that engine was run, so the study holds no timings of its own. It is kept outside the repository, and public files do not name the engine. Its findings that bear on null3D:

- The engine's speed comes from temporal upscaling (it shades 25 to 44% of the pixels), effects at reduced rate that the temporal resolve cleans up, uploads of changed data only, and few draw calls.
- Its built-in effects register through the same public feature registry that game code uses (35 registrations in the sample game). The registry gives extensibility, not speed.
- Its memory model takes one fixed 4 GiB memory in the browser and never grows it. null3D's growing memory suits the browser better: Safari on the iPad holds 3 engine memories at 4 GiB and 6 at 1 GiB ([D-04](D-04-memory-maximum.md)).
- Its renderer has no render graph and sorts every visible object into draw groups again each frame. null3D's graph compiles only on change, and its WebGPU draw groups are rebuilt only when the scene's structure changes.
- Its grass and particles run in compute shaders, so they have no WebGL2 path. null3D's closed-form particles measured 3.59 ms at 1 million particles against 3.99 ms for a compute simulation on WebGPU ([D-131](D-131-particles.md)), and run on all three GPU paths.
- Its own docs and code show faults that null3D can test for: an alpha-masked MSAA shader pattern measured at +22.5 ms on an Apple M4, an untaken shader branch that cost about 0.75 ms, a lookback sort that took 458 ms against 19 ms for a wait-free sort on an M1 Max, a broken compressed-texture path that only ETC2-only devices reach, and compute passes with no readiness or device-limit check.

### M4's feature tasks

[D-173](D-173-addon-hooks.md) and [D-179](D-179-technique-rulings.md) put 21 tasks in M4: the glTF intent gaps (4), six API features, the add-on platform items (4), hooks H1, H2 and H8, H4 as a fallback, the FFT ocean, the script-tag build and the temporal upscaler.

## Decision

1. All of M4's feature tasks move into M3. M4 keeps the API freeze, the device-lab pass, the size budgets, full fuzzing of all loaders and the public benchmarks. The plugin interface version is built in M3 and freezes with the API in M4.
2. The new IDs are M3-G1 to M3-G4 (glTF intent gaps), M3-K1 to M3-K6 (API features), M3-D6 to M3-D9 (add-on platform), M3-E8 to M3-E10 (H1, H2, H8), M3-F9 (FFT ocean), M3-F10 (temporal upscaler) and M3-O1 (script-tag build). H4's fallback task merges into M3-E7. `tools/hooks/task-ids.txt` does not list the M4 feature IDs.
3. The study's tasks join M3 as M3-R1 to M3-R18:
   - M3-R1 (P0): one public feature description that every D-173 hook is an instance of, built before H3. It names the frame point, the declared reads and writes, the ready, quality, resize, reset and destroy callbacks, published outputs with neutral defaults, lighting slots, an order band and a view mask. A test writes one real built-in feature against it; the test does not ship and moves no built-in.
   - M3-R2: probation and ceilings in the quality governor. M3-R3: a memory register per allocator in the stats overlay. M3-R4: an offset allocator for GPU sub-ranges, in M3 if capacity allows. M3-R5: a GPU frame-time method that is correct on tile GPUs.
   - M3-R6 and M3-R7 (P0): measure the alpha-masked lit shader with MSAA, and the untaken 5x5 shadow-filter branch on Low.
   - M3-R8: the bitmask AO prototype. M3-R9: depth-fitted light-cluster slices and occupancy words. M3-R10: sky maps that refresh only when the sun moves. M3-R11: evaluate a static shadow cache. M3-R12: build only listed shader permutations, in M3 if capacity allows.
   - M3-R13: robustness tests for every compressed-texture family, compute readiness and device limits.
   - M3-R14 to M3-R17: a timed script for `bunx @null3d/cli shot` and `test`, an input and frame-time recorder, an agent hook in the starter templates, and skill additions.
   - M3-R18: state in the docs that null3D sends nothing to any server, with a test, and list every ported upstream in each package's notices.
4. Existing tasks take the study's details. M3-A11 (temporal resolve) is P0 and starts at M3's start, with the study's answers to the D-129 faults as test cases. M3-A8, M3-A10 and M3-F2 take the study's technique details. M3-E6 shows one GPU timing scope per built-in step and per add-on feature. When the particles add-on's drawing leaves the core, it goes through H3.
5. Built-in renderer features stay internal. They do not move onto the public hooks, because each thing that they need would become public API to freeze at 1.0, which D-173 refuses for the render graph's internal passes. A feature that leaves the core, such as particle drawing or the Creek's water, goes through the public hooks.
6. D-180 stays deferred until after 1.0. When it restarts, its step trait takes the shape of M3-R1's feature description, so that built-in steps and add-on features are the same kind of node in the graph, and a built-in moves onto it only when it needs major work.
7. GPU grass stays dropped (D-179 ruling 20). H2 (M3-E9) keeps the splats' GPU culling as its first user, to confirm in the task.
8. Nothing else of the engine's memory model or caching is adopted. A fixed memory, fixed capacities and a per-frame job-plan cache do not fit null3D, which has a growing memory, growing tables ([D-103](D-103-growing-object-tables.md)) and no ECS.

## Consequences

- The private plan and M3's task list hold the moved tasks and the study's tasks.
- `tools/hooks/task-ids.txt` lists the M3 IDs and none of M4-A1 to M4-D2.
- The docs and skills give the moved features M3's label, 0.3: `tools/lib/docs.ts`, `docs/data/threejs-mapping.json`, the README's roadmap and both skills.
- D-173, D-179 and D-180 point here. D-54 and D-129 name M4 for the plugin interface version and the temporal upscaler, and this record moves both into M3.
- `AGENTS.md` add-on rule 14 states point 5.
- The guide for phones gives the iPad's WebGPU buffer point from D-12, 2,528 MiB.
- A head-to-head benchmark against the studied engine would need its licensed build tool, which contacts its vendor. The owner has not asked for one.
