# D-62: Clip start times, clip weights and phase-synced 1D blends

Status: decided, 2026-10-05. Date: 2026-10-05. Task: M2-C9.

## Question

How should the animator start clips out of step, weigh clips that play together, and blend clips by a value such as speed? Games need all three to start a crowd out of step and to blend idle, walk and run. three.js has the first two (`action.time` and `setEffectiveWeight`), and ports map them directly. Animation is strict under [D-52](D-52-intent-parity.md), so poses must match three.js's `AnimationMixer` where three.js has the feature. A crowd must still allocate nothing per frame.

## Rule

- `play(name, { time, weight })` and `setWeight(name, weight)` exist, and their poses stay within the skinning matrix tolerance of [D-26](D-26-animation-clips.md) (1e-3) of three.js's for the same calls.
- A blend by a value keeps its clips' phases in step, by the rule that other engines use.
- A sketch can change clip weights and blend values every frame at no cost, as layer weights already allow ([D-28](D-28-animator.md)).
- S5 runs on clip weights and start times, as its three.js twin does, and its parity with the twin does not get worse.
- The four animator findings of the core review each have a test that fails before the fix.

## Data

### Against three.js

`bun bench/three-fixtures.ts` adds six scripts to the nine of D-28. `animator_scripts_match_three_js` makes the same calls in the core, with 0 and 2 job workers. The table gives the largest difference in a skinning matrix element.

| Script | three.js calls | Largest difference |
| --- | --- | --- |
| start time | `action.time = 0.3` before `play()` | 1.6e-5 |
| clip weights | two actions at weights 0.25 and 0.5 from their own times, then `setEffectiveWeight(0.75)` | 3.9e-4 |
| weights above one | three actions at 0.6, 0.9 and 0.5 | 2.8e-4 |
| weight and fade | `setEffectiveWeight(0.5)` then `fadeIn(0.4)` | 3.3e-4 |
| additive on the base layer | a base action and an additive action at 0.5, then `crossFadeTo` another base action | 8.4e-5 |
| phase-synced blend | two actions at the blend's shares, each with `timeScale` = its length over the weighted mean length, from one phase; then new shares | 2.5e-4 |

The earlier nine scripts stay within 1.7e-4. three.js has no blend by a value. So the blend script sets the shares and rates that the rule gives. It checks that the core moves the clips' times and blends the pose as three.js would.

### S5 against its twin

S5 used to walk on layer 0 and run on layer 1 at the layer weight. That matched the twin's two weighted actions only because the two weights add up to 1. S5 now plays both clips on layer 0 with `{ time, weight }`, and the twin sets `action.time` and `setEffectiveWeight`. Each character starts at its own time. A second generator draws it, so the rings and rates stay the same. `bun run parity --scene s5` on 5 October 2026 (MacBook Pro M5 Max, Chrome):

| GPU tier | Before (4 October) | After | three.js's two renderers |
| --- | --- | --- | --- |
| WebGPU, Mac's GPU | 0.27% | 0.261% | 0.46% before, 0.451% after |
| Compatibility, Mac's GPU | 0.33% | 0.307% | |
| WebGL2, Mac's GPU | 0.20% | 0.197% | |
| WebGPU, SwiftShader | 0.29% | 0.272% | 0.52% before, 0.536% after |
| Compatibility, SwiftShader | 0.32% | 0.293% | |
| WebGL2, SwiftShader | 0.20% | 0.193% | |

S5's image references changed on both sets: 3.5% to 3.6% of their pixels differ from the old ones, all in the characters' limbs.

### The review's findings

Each test failed against the code of main, then passed with its fix:

| Finding | Test | Before the fix |
| --- | --- | --- |
| R4-04: an additive play stopped the base clips of its layer, and a base play stopped additive clips | `an_additive_play_keeps_the_base_clips_and_a_base_play_keeps_the_additive_ones` | the base clip stopped |
| R4-05: a step track showed the key before the last at the end of a clip that plays once | `a_step_track_holds_its_last_key_at_the_clip_end` | 12 of 1,194 clips, first 16 frames at 25 fps, gave key 14, not 15 |
| R4-08: a time scale that is not finite froze a clip, and its fade out never ended | `a_time_scale_that_is_not_finite_moves_nothing` | the clip's time stayed NaN |
| R4-16 and X-01: freed joint runs did not merge | `freed_joint_runs_merge_and_return_to_the_end` | a 4-joint skeleton was refused with 4 free joints in two runs |

### Allocation

`frames_allocate_nothing` counts 0 allocator calls in 197 frames. Its crowd now also plays blends, and clips side by side from start times. Sketch code moves the blend values and the clip weights every frame. `bun run bench:allocation --animated 64` adds the same to its 64 characters on 5 October 2026. It passes on WebGPU and with `--gpu webgl2`. The weight and blend writes allocate nothing. So do the rare switches, which play a blend again or fade a clip to a new weight. Neither the crowd's code nor `playBlend` shows in the samples of either GPU path. So the crowd has no budget of its own. The crowd keeps its options and blend points in frozen constants, as [Frozen options are read once](#frozen-options-are-read-once) explains.

Before that rule, the switches allocated 8.5 bytes a frame on WebGPU: 7.0 in the crowd's code, where the browser inlined `play`, and 1.5 in `playBlend`. With inlining off (`--no-inline`), `play` and the code it calls showed 5.4 bytes a frame, and `playBlend` 0.9. A play with a fade and a weight made 36 bytes, a blend switch 12 and a cross-fade none. That is 16 bytes per switch, as measured. Each is one 12-byte number for each fraction read from an options object.

How the data was produced: `bun bench/three-fixtures.ts`, `cargo test -p null3d-core --test animation --test no_alloc`, `bun run parity -- --scene s5` with and without `CI=1`, and `bun run bench:allocation --animated 64` with and without `--gpu webgl2` and `--no-inline`, on 2026-10-05. The direct count is a loop of plays in Node 24.2 that read options of 4 to 9 shapes. The heap profiler sampled it every 64 bytes over 200,000 rounds.

## Decision

### A play with a weight joins its layer

`play(name)` takes over its layer: the layer's other clips of the same kind fade out, as D-28 decided. `play(name, { weight })` joins the layer's clips instead. The layer blends them by their weights, as three.js's mixer does. `crossFade` always takes over, with a weight too. So a three.js port of `clipAction(a).setEffectiveWeight(0.3).play()` becomes `play('a', { weight: 0.3 })` and blends as three.js does.

The rejected option was a separate `replace: false` option. It is explicit, but every port of actions that play together would need it on every play. A port that left it out would silently lose all but the last clip. With the rule chosen, a port that gives weights blends, and one that gives none takes over, as Unity's `Play` and Godot's `play` do.

A play replaces only clips of its own kind: a plain play fades out plain clips, and an additive play fades out additive clips. This fixes R4-04. In three.js, additive actions play beside base actions, and the mapping maps `makeClipAdditive` straight to `{ additive: true }`.

### Weights and fades multiply

A slot's weight is its own weight times its fade. three.js's effective weight is likewise its weight times its fade interpolant. three.js's `setEffectiveWeight` also stops a running fade. `setWeight` leaves the fade running. So a clip that fades out still leaves, while game code sets its weight every frame. A clip at weight 0 keeps its slot and its time moves on, as a three.js action at weight 0 still advances. A slot is free only when no play holds it.

### Weights and blend values live in engine memory

`setWeight` writes engine memory, as `setLayerWeight` does. The core keeps, for each slot, the clip that a play put there (its source, so an additive form counts as its clip). TypeScript scans the object's 8 slots for the clip and writes each slot's weight. `setBlend` writes the layer's blend value the same way. Neither crosses into the core, and neither passes a fraction to a call that the browser might not inline.

A play's numbers cross in a small array of engine memory too, not as call arguments. They are the fade, the speed, the start time or phase, the weight, and a blend's value. Each fraction passed to a call that the browser does not inline is boxed. In memory, the call boxes no number. A blend's value crosses with its play, and the core sets it, so the play and the value change in one call.

### Frozen options are read once

Reading a fraction from an options object makes a 12-byte number in Chrome, even in optimized code. A game passes `play` objects of many shapes, one for each call site of a game. Past four shapes, the browser reads the property through its generic lookup. That lookup copies the fraction into a new number. With four or fewer, an option that some shapes lack merges with `undefined`, so the value read is boxed again. Node 24 runs the same engine as Chrome. A direct count in it found 97 to 162 bytes for each round of plays, and none for the same loop without the reads. Freezing an object does not change the read itself.

So the animator reads a frozen options object, or a frozen points object of `playBlend`, once. It keeps what it read in a `WeakMap`, and later plays copy those numbers into engine memory with one `Float32Array.set`. A frozen object cannot change, so what the animator kept stays true. An object that is not frozen is read at every play, as before. Development builds check a frozen object's values the first time only.

The rejected options:

- Taking fractions as call arguments, as `crossFade(name, duration)` does. That changes the API, and an argument to a call that the browser does not inline is boxed too.
- Keeping what the animator read for any object, frozen or not. A game that changes an options object between plays would then get the old numbers.
- Leaving a budget of 8 bytes a frame for the switches. Each switch would then cost a game 12 to 36 bytes. The check would also hide any other allocation of that size in a crowd's frame code.

### The 1D blend keeps one phase

`playBlend({ idle: 0, walk: 1.4, run: 4 })` gives each clip a point. The two clips around the layer's blend value share it linearly, and past the ends one clip plays in full. This is PlayCanvas's 1D blend tree and Godot's `BlendSpace1D`.

Each clip's time moves at its length over the weight-averaged length of the blend's clips. Godot's cyclic sync modes (`scene/animation/animation_blend_space_1d.cpp`) and PlayCanvas's `syncAnimations` (`src/framework/anim/state-graph/anim-blend-tree-1d.js`) share this rule. A walk and a run of different lengths then complete their cycles together, so the feet do not slide. After each step, every clip's time is set to the first clip's phase times its own length, so rounding never lets them drift apart. The blend's clips all advance, even at a share of 0, so a clip that comes back has the right phase.

The rejected option kept each clip's own rate, as plain weights do. three.js has no blend by value, and a port that blends by weights keeps three.js's look with `play` and `setWeight`. The blend is the default for new code because it keeps steps together.

A blend's clips belong to it until a play takes over the layer, or `stop` stops one. Each then keeps the share and the rate the blend gave it, and fades out. A blend with no `phase` takes the phase of the layer's blend, or of the first of its clips that the layer plays. So a switch from a walk to a walk-and-run blend keeps the step. A new slot that a play starts for a clip of the blend takes that clip's time for the same reason.

### Slots

Each object keeps 8 slots. A three-clip blend that cross-fades to another three-clip blend uses 6, and a second layer that cross-fades uses 2 more. The test `two_blends_cross_fading_and_a_cross_fading_layer_fit_the_slots` fills all 8, with an additive clip in one of them. When all 8 hold clips, a play now first takes the slot of a clip that fades out: the one that counts least. The rule before took the slot that counted least. That could be a blend's clip at a share of 0, or a clip that just started to fade in.

### The review's findings

- R4-05: the clip's end samples the last key exactly. The fraction from the duration times the rate can round below the last frame in 32-bit floats.
- R4-08: a step or a move that is not finite moves nothing. A fade whose time left is not finite ends. A clip time that is not finite starts again from the clip's start.
- R4-16 and X-01: a removed object's joints merge with the free runs next to them. Joints at the end of those handed out are handed back. Each free run then has a live object's joints after it. So the list holds at most one run per object, and never grows past its capacity.

## Consequences

- `crates/null3d-core/src/animation/actions.rs` holds the plays, the blend's weights and phase, and the slot choice. The file `system.rs` holds the slots' sources, the blend values and the merge of freed joints. The file `clip.rs` samples the clip's end exactly.
- `animatorPlay` and the new `animatorPlayBlend` take their numbers from the play array (`ANIMATION_FIELD_PLAY_ARGS`). `animationArrays` also returns the slots' sources and the blend values.
- `setLayerWeight` and `setBlend` check the layer in every build, so a write never reaches another object's layers.
- S5 and its twin start each character at its own time, and blend by clip weights.
- `docs/api/animation.md` gains [Clip weights](../../docs/api/animation.md#clip-weights) and [1D blends](../../docs/api/animation.md#1d-blends). The mapping's `AnimationMixer` entry maps `time` and `setEffectiveWeight`. The develop skill's animation recipe uses a blend by speed.
- D-28's slot and joint-run sections now point here.
- Inertial transitions (M2-C10) switch what a layer plays; blends and clip weights keep weighted blending.
- The record is in the table in [README.md](README.md).
