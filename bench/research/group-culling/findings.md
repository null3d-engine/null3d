# Group-level culling: what it would drop, and whether to build it

Branch `research/group-culling` from `58dafca09` (perf/walk-view). Scripts, pages and results are in `bench/research/group-culling/` (`scripts/`, `pages/`, `results/`). Large files (models, Bistro download, depth images, three.js build) are in `target/group-culling/`, outside git; `scripts/prepare.ts` rebuilds them.

## Summary

- **Desert walk, camera pass:** groups of 64 for the 4 heaviest copies of each mesh drop 3.54 M to 2.60 M triangles by view and facing alone (-27%). The hidden test brings it to 2.33 M. Whole-copy occlusion for the other copies brings it to 1.55 M (three.js: 1.69 M). The arches carry almost all of it: 1.67 M now, 0.75 M after view and facing, 0.49 M with the hidden test. Three.js draws 0.18-0.35 M of arch triangles.
- **Desert walk, shadows:** groups culled by each cascade's box drop 1.12 M of 4.39 M caster triangles per frame (-25%), almost all near arches in cascade 0. K=4 slots get 1.08 M. Pieces in cascades would get only 0.09 M.
- **Bistro street view (heavy-app case):** 1.17 M now; groups 0.86 M by view and facing (-27%), 0.78 M with the hidden test. Whole-copy occlusion gets 2%. Shadows: groups drop 0.21 M of 3.16 M per frame (-7%). three.js: 0.43 M.
- **Bistro wide view, over the roofs:** 1.97 M now; view and facing gain little (1.87 M), the hidden test gains a lot (1.24 M); with whole-copy occlusion too, 0.96 M.
- **Whole-copy GPU occlusion at Medium does not pay.** A busy run first suggested a ~1 ms gain in the desert walk. The re-time at Medium (3 rounds, production builds, indirect path) found culling made the frame longer on most pages, also with its check deciding, and gain only in the Island's views, inside their noise. Medium keeps it off; D-22 and D-40 record the figures. See [GPU occlusion at Medium](#gpu-occlusion-at-medium-re-timed).
- **Estimated saving of slots, desert walk:** about 0.3-0.5 ms for the camera's view and facing tests, minus a group pass of about 0.05-0.15 ms. Shadows: 0.15-0.25 ms, minus a similar pass. Bistro street: about 0.1 ms net, under 3% of its frame.
- **Recommendation:** build slots for the camera pass with view and facing tests first, then the hidden test at group level, then shadows. The re-time also shows the main pass costs only about 0.2 ms per million triangles at Medium (desert walk: 0.70 ms for 3.54 M), so every saving below is likely at the low end of its range.

## Method

- **CPU model** (`scripts/model.ts`, `run-model.ts`) copies the engine's own rules:
  - per copy: frustum on the base sphere; level when error x scale x (H x P11 / 2 px) < distance; hide when the diameter is under 1 px (`cull.wgsl` `level_of`, `levels.rs`). Measured levels switch at once at Medium, so there is no fade band.
  - pieces, camera only: frustum, plus cone with `CONE_MARGIN` (`piece_shows`).
  - shadows: cascades placed as `shadows.rs` `fit_cascades` (3 cascades, 2048 texels, 150 m, lambda 0.65, blend 0.1); casters culled by the box planes with the face toward the light open; level and hiding measured in texels (1 texel); whole levels. Per frame, the far cascades count one third each (`farCascadeInterval` 3 at Medium).
- **Groups:** meshoptimizer 1.3.0 `buildMeshlets` (cone weight 0.25), 64 or 128 triangles, inside each piece, for levels of 4,096 triangles or more. Bounds from `computeMeshletBounds`. Tests run in order: off screen, facing away (camera only), hidden.
- **Hidden test:** depth drawn on the CPU at 1920 x 1080 from each copy's chosen level and kept pieces (the desert ground at full detail). Pyramid as `pyramid.wgsl`: level 0 at half size, farthest of 4 x 4 pixels. Sphere test as `cull.wgsl` `occluded`, with the same interval bounds. Two depths:
  - full: the frame's depth, the steady state of two-phase culling;
  - D-40: only copies spanning a sixteenth of the screen, plus the ground.
  They differ by under 2% everywhere, so tables give the full one.
- **Slots:** per mesh, the K copies with the largest chosen level, then the nearest. Bistro has one copy per mesh, so per-mesh K covers every copy; for Bistro, N is a budget for the whole scene.
- **Scenes:**
  - desert walk: 40 camera times over the measured lap.
  - Amazon Lumberyard Bistro exterior: CC BY 4.0, from casual-effects.com `Exterior.zip`, SHA-256 `f612ba0d8a65811afe0d48a023d31e5b43ac40b78e9b12d15e2b7dc8923c29d4`, 2.84 M triangles, 1,306 objects, no textures. Built with `null3d assets convert`, then `assets optimize --lod --no-blockers --bvh 0`, and scaled to meters. Two fixed views (`pages/bistro-views.js`): street at head height; wide at 45 m over the block.
- **Ground:** the desert ground draws from its cluster tree, so it is left out of the model's counts (0.06 M measured).
- **Level plans:** both scenes carry their levels in the files, so the runtime level-plan bug (fixed in 6460966bc) does not touch these counts. No run reported E1420 or any engine problem.

### The model against the engine (browser counts, triangles per frame)

| View | Engine | Model |
| --- | --- | --- |
| Desert walk, all | 3.57 M | 3.56 M + ground 0.06 M |
| arch / boulder / pebble / column | 1.56 / 0.885 / 0.73 / 0.146 | 1.56 / 0.87 / 0.79 / 0.16 (medians) |
| Desert, shadows on | 7.79 M | 3.62 + 4.39 per frame (ground's shadow not modelled) |
| Desert, whole-copy occlusion held on (counts include the occluders' pass) | 4.86 M | 4.6 M (1.81 occluders + 2.70 main + ground twice) |
| Bistro street / wide | 1.170 / 1.966 M | 1.17 / 1.97 M |
| Bistro shadows on, still camera (all cascades) | 7.15 / 7.02 M | 1.17 + 5.99 / 1.97 + 5.05 |
| Bistro, whole-copy occlusion held on | 1.98 / 2.58 M | 2.15 / 2.39 M |

## Desert walk (means over the lap, M triangles)

### Camera pass

| Kind | Now | Off screen (64) | Facing away | Hidden | After all three |
| --- | --- | --- | --- | --- | --- |
| arch | 1.67 | 0.71 | 0.20 | 0.26 | 0.49 |
| boulder | 0.89 | 0.01 | 0.03 | 0.12 | 0.73 |
| pebble | 0.82 | 0.00 | 0.00 | 0.00 | 0.81 |
| column | 0.16 | 0.00 | 0.00 | 0.00 | 0.15 |
| all | 3.54 | 0.73 | 0.24 | 0.38 | 2.18 |

At 128 triangles: 0.71 / 0.20 / 0.34, 2.28 after all three.

| Slots (64) | Groups tested | View and facing | Plus hidden | Plus whole-copy occlusion for the rest |
| --- | --- | --- | --- | --- |
| none (now) | 0 | 3.54 | 3.54 | 2.70 (whole-copy occlusion alone) |
| K=2 | 23,051 | 2.66 | 2.49 | 1.68 |
| K=4 | 27,265 | 2.60 | 2.33 | 1.55 |
| K=8 | 29,682 | 2.57 | 2.22 | 1.47 |
| K=16 | 30,322 | 2.57 | 2.19 | 1.45 |
| all copies | 30,340 | 2.57 | 2.18 | 1.45 |

At 128, K=4: 2.65 / 2.41 / 1.63, with half the groups. Slot copies at K=4 hold 1.82 M and keep 0.88 M after view and facing. The earlier "1.9 M with 64-triangle groups" lies between "plus hidden" and "plus whole-copy occlusion", so it likely included some hidden culling.

### Shadows (casters frustum only, whole levels now)

| Cascade | Texel | Now | Off box, pieces | Off box, 64 | 128 | K=2 | K=4 | K=16 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 1.9 cm | 2.22 | 0.07 | 0.92 | 0.91 | 0.86 | 0.92 | 0.92 |
| 1 | 4.5 cm | 2.60 | 0.03 | 0.41 | 0.40 | 0.28 | 0.40 | 0.41 |
| 2 | 15.6 cm | 3.91 | 0.01 | 0.17 | 0.17 | 0.03 | 0.09 | 0.17 |
| per frame | | 4.39 | 0.09 | 1.12 | 1.09 | 0.96 | 1.08 | 1.11 |

Per kind, per frame: arches 1.89 M (1.07 M off box), pebbles 1.68 M (0), boulders 0.67 M, columns 0.15 M. The pebbles' shadow cost comes from their count of copies (16,566 in cascade 2), which groups cannot change.

### Aerial view (control)

3.22 M now; groups take it to 3.04 M, and whole-copy occlusion hides 2% of triangles. Shadows: 1.20 M per frame, of which groups drop 0.08 M.

### three.js r187 meshlets, same lap

| Kind | Alone | With the ground (minus the ground's 0.35 M) |
| --- | --- | --- |
| all | 1.69 M | |
| arch | 0.35 | 0.18 |
| boulder | 0.75 | 0.37 |
| pebble | 3.00 | 1.67 |
| column | 0.55 | 0.42 |
| ground | 0.35 | |

Kinds do not add up to the total, because three.js's occlusion lets each kind hide the others. The gap to null3D is in the arches (null3D 1.56 M). On columns, null3D draws fewer than three.js. three.js's shadow page fails on every try with a TSL error (`AssignNode.generate`), so its shadow count here comes from the earlier runs (~1.9 M).

## Bistro (one frame per view, M triangles)

| View | Now | Off screen (64) | Facing | Hidden | View and facing | Plus hidden | Whole-copy occlusion alone | Everything |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| street | 1.17 | 0.28 | 0.03 | 0.08 | 0.86 | 0.78 | 1.15 | 0.78 |
| wide | 1.97 | 0.06 | 0.04 | 0.63 | 1.87 | 1.24 | 1.44 | 0.96 |

- **By kind, street view:** buildings 0.46 M (0.17 M off screen), props 0.34 M, foliage 0.30 M, street 0.07 M.
- **By kind, wide view:** foliage carries the hidden share: 0.35 M of 0.65 M.
- **Slot budget:** the street view reaches its full gain with the 64 heaviest copies of the scene, or 32 for 0.86 M with the hidden test. The wide view needs about 128 (N=64 gives 1.32 M).
- **Groups tested:** 14,109 (street) and 20,609 (wide).
- **Shadows per frame:** street 3.16 M, groups drop 0.21 M; wide 1.84 M, groups drop 0.18 M. Pieces in cascades drop nothing.
- **three.js:** 0.43 M in the street view. The wide view's run was stopped to free the GPU; it is still to run.

## Expected GPU time saved

Per-triangle costs come from the kind-filtered runs. These runs were taken while the machine was busy (load 7-8), so they are rough until the quiet re-time:

- **Main pass, desert:** about 0.3-0.45 ms per million triangles (arch 0.43, boulder 0.28, pebble 0.36, column 0.48).
- **Shadow pass:** 0.15-0.23 ms per million (arch casters 0.31 ms for 2.03 M; pebble casters 0.33 ms for 1.41 M).
- **Bistro:** its main pass is not bound by triangles: 4.6 ms for 1.17 M triangles in 4,033 draws. Those runs also used the still-camera mode. The page now sways the camera by 1 mm so that later timing runs avoid that mode.

**Group pass cost.** The model gives 14,000-30,000 groups tested per camera pass, against the 50,000-100,000 that `findings-small-groups.md` assumed. It also gives 0.6-0.9 M kept triangles to rewrite, about 11-16 MB of index traffic. That puts the pass at about 0.05-0.15 ms per pass, the low half of the earlier 0.1-0.2 ms estimate.

| Scene, step | Triangles dropped | Gross | Group pass | Net |
| --- | --- | --- | --- | --- |
| Desert, camera view and facing, K=4 | 0.94 M | 0.28-0.42 ms | 0.05-0.15 | **0.15-0.35 ms** |
| Desert, plus group hidden test | +0.27 M | +0.08-0.12 ms | occluder pass, see below | ~0.1 ms more |
| Desert, shadows K=4 | 1.08 M/frame | 0.16-0.25 ms | 0.05-0.15 | **0.0-0.2 ms** (cascades partly overlap other work) |
| Desert, whole-copy occlusion at Medium (no new code) | 0.83 M | re-timed: main pass 0.70 ms off, 0.66 ms held on | occluder pass 0.16 ms, culling 0.07 ms | **a loss: frame 36% longer held on, 18% with the check** |
| Bistro street, camera, all copies | 0.31 M (+0.08 hidden) | 0.09-0.14 ms | ~0.05 | **~0.05-0.1 ms** |
| Bistro wide, hidden test plus whole copies | 1.0 M | 0.3-0.45 ms | occluders ~0.95 M depth only + pyramid ~0.1 | **~0.1-0.2 ms** |
| Bistro shadows | 0.21 M/frame | 0.03-0.05 ms | 0.05 | ~0 |

The busy run's 2.05 to 0.84 ms drop did not come back in the re-time: the hidden pebbles and boulders cost little to draw, so hiding them saves less than the occluders' pass costs.

## Would group-level occlusion pass null3D's self-check (D-40: at least 10% hidden, frame no longer than 102%)?

- **Desert walk: yes.**
  - Share: 69% of copies in view are hidden, and 40% of the groups that pass view and facing.
  - Time: in the engine, with whole-copy occlusion held on, the main pass fell by about 1.2 ms for a 0.20 ms occluder pass. With the check active, the run's median count (3.78 M) shows the check kept the passes on for much of the lap.
  - At group level it pays more if the early phase draws last frame's visible groups. Today's occluder pass draws whole near arches (1.81 M triangles); visible groups would be about 0.6 M.
- **Bistro street: no.**
  - Share: 14% of visible groups are hidden, but only 7% of triangles; whole copies, 2%.
  - Time: an occluder pass of about 0.8-1.0 M depth triangles to save 0.08 M fails the time test. The check would turn it off, as it should.
- **Bistro wide: probably yes, narrowly.**
  - Share: 52% of visible groups and 48% of copies are hidden.
  - Time: about 1.0 M saved against about 0.95 M depth-only, single-sample occluder triangles plus the pyramid.

## Recommendation

**Build it, camera view first.** Step order:

1. **(Done, rejected) whole-copy GPU occlusion at Medium.** The re-time below shows no gain, so slots come first.
2. **Slots in the camera pass with view and facing tests,** K=4 per mesh and groups of 64. A scene of unique meshes also needs a scene-wide budget of about 64-128 slots. This drops 27% in the desert walk and in the Bistro street, with a small group pass.
3. **Hidden test per group** (two-phase, history per slot). Its gain shows in views over occluders (Bistro wide -0.63 M; desert -0.27 M). It also lets the occluder pass draw visible groups instead of whole heavy occluders.
4. **Shadow slots, frustum only.** Desert -25% of caster triangles, mostly cascade 0's arches. Bistro -7%. Shadow triangles are cheaper, so this comes last. Pieces in cascades are not a substitute (0.09 M).

128-triangle groups keep about 90% of the gain with half the groups. Choose them if the group pass's cost shows up in the re-time.

## Uncertainties

- **Timing:** every millisecond figure comes from single runs on a busy machine, load 7-8. The per-million-triangle costs, the whole-copy occlusion saving and the group pass cost (an estimate, not measured) all need the quiet re-time.
- **Model fit:** the model matches the engine's totals to within 1% on both scenes, and each kind to within 10%. It leaves out the ground's tree and the piece check that switches pieces off when they cut under 20%.
- **Depth:** the hidden test uses a CPU depth image, not one read back from the engine. It matches the engine's picture by eye, and the engine's count with occlusion held on to within 6%. Two-phase culling is modelled in its steady state (slow camera); fast turns hide less.
- **Group builder:** grouping used `buildMeshlets` with cone weight 0.25. `buildMeshletsFlex` or spatial grouping would give somewhat different facing shares.
- **Slots:** chosen by the largest level and then the nearest copy. A slot copy changing hands is not modelled. Bistro's per-mesh K is meaningless (one copy per mesh); a scene-wide budget stands in.
- **three.js:** its Bistro wide view and all its shadow counts are missing. Its Bistro street count (0.43 M) is below the model's best (0.78 M); the cause, perhaps its own level choice, is not explained.
- **Build:** `bun run build` on this branch fails its size check: the threaded WebAssembly file is over its 600 KB budget. The files are built and the CDN build is complete, so this does not touch the counts.

## GPU occlusion at Medium, re-timed

Chrome for Testing on the Mac, Medium, production builds, no frame cap, indirect path (Chrome on this Mac always takes it now), 3 rounds with the modes in turns. GPU time per frame: median of the rounds' medians, with the fastest and slowest round in brackets, and the change against off.

| Page | Off | Held on | Check deciding | Hidden, held on |
| --- | --- | --- | --- | --- |
| Desert walk | 0.86 (0.84-0.90) | 1.16 (1.12-1.27), +36% | 1.01 (0.97-2.09), +18% | 4,465 |
| Desert walk, shadows | 2.70 (2.69-2.98) | 3.18 (3.16-3.20), +18% | 3.04 (2.94-3.30), +12% | 4,511 |
| Desert aerial | 0.67 (0.65-1.57) | 0.88 (0.88-0.90), +31% | 0.84 (0.67-2.46), +24% | 1,351 |
| Desert aerial, shadows | 1.18 (0.92-1.31) | 2.73 (1.17-2.86), +132% | 1.11 (1.06-2.57), -6% | 1,352 |
| Bistro street | 2.18 (2.16-2.23) | 4.95 (2.58-5.38), +127% | 4.73 (4.26-4.96), +117% | 3 |
| Bistro wide | 3.70 (3.70-5.42) | 5.87 (5.74-5.95), +59% | 5.81 (5.24-5.85), +57% | 636 |
| Island town | 6.71 (6.28-6.82) | 6.13 (5.99-7.26), -9% | 6.30 (6.29-6.83), -6% | 4,290 |
| Island opening | 4.44 (4.14-4.61) | 4.08 (4.04-4.43), -8% | 4.27 (4.18-4.30), -4% | 4,242 |
| S1 | 1.32 (1.20-1.33) | 1.78 (1.36-1.80), +35% | 1.33 (1.15-1.35), +1% | 0 |
| S2 | 0.15 (0.15-0.15) | 0.25 (0.15-0.26), +69% | 0.13 (0.13-0.15), -13% | 0 |
| S3 | 1.24 (0.80-1.29) | 1.34 (1.15-1.48), +8% | 1.13 (0.82-1.30), -8% | 0 |
| S4 | 0.56 (0.48-0.57) | 0.73 (0.62-1.02), +29% | 0.57 (0.47-0.58), 0% | 1,608 |
| S5 | 4.63 (3.32-4.92) | 4.68 (4.38-4.98), +1% | 4.72 (3.59-4.74), +2% | 0 |
| S6 | 1.24 (1.22-1.32) | 1.26 (1.22-1.37), +2% | 1.27 (1.21-1.28), +2% | 3,398 |
| S7 | 0.53 (0.53-0.54) | 0.31 (0.27-0.37), -42% | 0.20 (0.20-0.26), -63% | 0 |

- **The check's choice:** in every page, the median frame with the check deciding hid nothing. The check kept the passes off for most of each run.
- **Why no gain:** hiding thousands of objects did not shorten the main pass at Medium (desert walk 0.70 ms off, 0.66 ms held on), while the occluders' pass costs 0.16-0.27 ms and the culling about 0.07 ms more.
- **Two costs not from hiding:** in the Bistro, the setting alone made the main pass about 2 ms longer, with the check deciding too, while culling hid 0-3 objects. S7 moved the other way with nothing hidden. Both need a look in the engine; neither is explained.
- **Noise:** other helpers' builds raised the one-minute load to 8-17 during many pages. A repeat of the loaded pages at lower load (17 of 36 done before it was stopped, `results/medium-occlusion-desert-bistro-partial-repeat.json`) spread as widely, with the desert walk's held-on runs at 2.00-2.38 ms.
- **Decision:** Medium keeps occlusion off. The prepared change stays as `medium-occlusion.patch`. D-22 records the table, and D-40 records the rejection and the Bistro cost. Tables in `results/medium-occlusion-tables.md`.

