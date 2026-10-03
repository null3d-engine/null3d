# D-28: The animator: where play state lives, and how layers, masks, additive clips and events work

Status: decided, 2026-10-03; the phone and tablet timings of the step pending. Date: 2026-10-03. Task: M2-C2.

## Question

How should `object.animator()` play clips? It needs fades, layers, joint masks, additive clips, a time scale and events. A crowd of 500 characters must stay cheap, and a frame must allocate nothing. Fades and blends must match three.js's `AnimationMixer` where three.js has the same feature.

## Rule

- Every call that the plan lists for the animator exists and is tested: `play` with `fade`, `loop`, `speed` and `layer`, `crossFade`, `stop`, `setLayerWeight`, joint masks per layer, additive clips, a time scale and `onEvent`.
- Fades, masked layers and additive clips match what three.js gives for the same calls, within the skinning matrix tolerance of [D-26](D-26-animation-clips.md) (1e-3).
- An event fires once each time a clip's time passes it, whatever the frame's length and the number of job workers.
- A frame allocates nothing, with 64 characters that play, fade, stop, mask, add and fire events.

## Data

### Against three.js

The fixture script, `bun bench/three-fixtures.ts`, runs nine scripts through three.js's mixer at 60 steps a second. Each script plays clips as an animator call would, and records the pose at chosen steps. The core's tests in `crates/null3d-core/tests/animation.rs` make the same animator calls, with 0 and with 2 job workers.

| Script | three.js calls | Largest difference in a skinning matrix |
| --- | --- | --- |
| crossfade, fade in, time scale | `crossFadeTo`, `fadeIn`, `mixer.timeScale` | within 1.7e-4 for all nine |
| once, loops | `LoopOnce` with `clampWhenFinished`, `LoopRepeat` | |
| masked layer, masked layer at full weight, masked base layer | clips with the other joints' tracks taken out | |
| additive | `AnimationUtils.makeClipAdditive` and an additive action at weight 0.5 | |

The loop and finished events match three.js's counts in every script. A 0.75 s clip loops three times in 2.5 s, and a clip played once finishes once.

### Events

`an_event_fires_once_per_loop` passes a clip's start, middle and end events in four ways: 150 steps, two steps longer than the clip, backward, and once. Each event fires once per pass, and none while a finished clip holds its end. `events_come_in_order_of_instance_on_any_number_of_threads` runs 300 characters for 20 frames. It gives the same records, in the same order, on 0 and on 4 job workers.

### Allocation

`frames_allocate_nothing` counts 0 allocator calls in 197 frames. Its crowd has 64 characters of 40 joints. They play clips with fades, and stop and cross-fade them every 40 frames. Each has a masked layer, an additive layer and clip events. A third of the crowd still has clip times and weights that sketch code writes.

`bun run bench:allocation --animated 64` adds 64 such characters to S1 in Chrome on the Mac (MacBook Pro M5 Max, 3 October 2026). It passes on WebGPU and with `--gpu webgl2`, and the animator's places allocate 0 bytes a frame. The check found three faults on the way:

| Fault | Bytes a frame | Fix |
| --- | --- | --- |
| The check of the array views declared a function inside it, so the browser made room for that function on every call, even with nothing to remake | 29 | The rare remake moved to a function of its own, as instance batches do |
| The sketch's 64 calls a frame to `setLayerWeight` each passed a fraction to a call that the browser did not inline | 933 | The call shrank to one write through a small view check, which the browser inlines |
| Each cross-fade built the object's description for an error message, even when it succeeded | 24 | The description is built only on failure |

The frame loop's own place rose with the animated characters, from 169 to between 192 and 229 bytes a frame, within its budget of 240. The rise comes from code outside the animator. Each job worker that worked in a frame reports its busy time as a fraction, and each such reading is a new number object. The animation step gives more of the 16 job workers work. With `?jobs=2`, the place read 68 bytes with the characters and 71 without them.

### A fault in clip resampling

The masked base layer script first missed three.js's pose by 0.099. The fault was in [D-26](D-26-animation-clips.md)'s resampling. A clip that keeps its own key grid computes each frame's time in 64 bits. Its key times are 32-bit floats, and one can round up past the frame's time. A step track then took the key before. The resampler now counts a key within a millionth of the time as reached. The earlier fixture cases passed by chance: the two keys they hit held the same value.

How the data was produced: `bun bench/three-fixtures.ts`, then `cargo test -p null3d-core --test animation -- --nocapture` and `cargo test -p null3d-core --test no_alloc`, on 2026-10-03.

## Decision

### The core keeps the play state

Each animated object has 8 sample slots in the core. A slot that `play` fills keeps its clip, time, weight, speed, flags, layer and fade. One parallel loop on the job workers advances every slot's time and fade, collects the events it passes, then samples and blends. The animator in TypeScript only names clips and checks options. A call such as `play` crosses into the core once. Layer weights and the time scale are numbers in engine memory that the sketch writes directly. So a sketch can change them every frame at no cost.

The rejected option kept the play state in TypeScript and wrote each slot's time and weight before each step. That puts a loop over every character's clips on the sketch's thread each frame. The plan's crowd features, such as update rates by screen size and shared poses, would then cross the boundary every frame too. The core can apply them inside its own loop. Each number that crossed per frame would also be a fraction, and a fraction passed to a call that the browser does not inline allocates.

### Slots and layers

Each object has 8 slots, up from the 4 of D-26, and 4 layers. Two layers that each cross-fade between two clips, plus an additive clip, fill 5. The rest absorb quick changes of mind, such as a cross-fade back while the first still runs. When all 8 hold clips, a play takes the slot whose clip counts least now. A slot costs 32 bytes and an unused slot costs one comparison per frame.

Inside a layer, clips blend as three.js's mixer does, as D-26 settled: each clip counts only where it has tracks. Layer 0 blends with the rest pose below. Each layer above replaces the pose below by the layer's weight, times its own blend's weight up to 1. This is the override layer of Unity and Unreal. three.js has no layers. Its way to split a body is clips with tracks taken out, which blend half and half where both clips have tracks. With a layer at full weight, the upper body follows the wave alone. A masked layer at weight 1 gives what three.js gives for clips with the masked tracks taken out. The fixture checks both weights.

### Joint masks

A mask holds a weight from 0 to 1 per joint of a skeleton. It multiplies a layer's clip weights joint by joint, in the same SIMD loop that applies each clip's tracks. A call such as `setLayerMask(layer, 'Spine')` selects the named joint and every joint below it. The animator keeps each mask it makes for its skeleton. A mask on layer 0 sends the joints it leaves out to the rest pose.

### Additive clips

`play(name, { additive: true })` converts the clip once, at its first additive play, into its change from its first frame. That is what three.js's `makeClipAdditive` does with its default reference frame. Each rotation key becomes the first frame's rotation, inverted, times the key; translations and scales subtract. The converted clip keeps the source's key grid and 16-bit rotations, so the step samples it like any clip. The blend then adds it as three.js's `PropertyMixer` does: translations and scales add, and rotations multiply on the right. The rejected option subtracted the first frame at every sample, which doubles the work of every additive clip in every frame.

### Fades

A fade counts down in the object's time, which the time scale scales, as three.js's fade follows its mixer's time. A fade out starts from the clip's current weight. three.js starts every fade out from full weight, so a cross-fade back halfway through jumps there. A clip that finishes fading out leaves its slot.

### Events

Events live in the clip's data, by id, with the names kept in TypeScript. The step writes one record per event into one buffer of 1024 records, through an atomic count. Then it sorts the records in place by object and order. Sorting keeps the order the same on any number of job workers, so hold mode and tests see one order. More events than the buffer holds are counted, and development builds warn once. An event at the clip's end fires as the clip loops, with the start's events. A step longer than the clip fires each event once. The animator adds `'loop'` and `'finished'`, as three.js's mixer does; clip events cannot take those names.

The handlers run on the sketch's thread at the start of the next frame's update, before `onFixedUpdate` and `onUpdate`, as the plan asks. The sketch's update then sees what the clips reached, and a clip that a handler plays starts in that frame's step. The step runs after the frame's queued changes apply, and its time counts in the frame's transform time.

A first version ran the handlers right after the step, and timed the step and the handlers as phases of their own. Each phase boundary reads the clock once more per frame, and each reading is a new number object. The handlers now run in the update phase and the step counts with the transforms, so the animator adds no boundary. The cost is a frame of delay for a sound that a footstep starts, about 17 ms at 60 frames per second.

### Removing an object

Destroying an animated object removes its instance from the core. Its id and its run of skinning matrices go to the next instance that fits them, first fit. The matrix buffer never moves, so the threads that read it keep their views. Freed runs are not merged; a game that mixes many skeleton sizes and churns through them can use up the 65,536 joints sooner.

## How three.js handles it

Each three.js `AnimationAction` keeps its time, weight, fade interpolant, loop mode and time scale as JavaScript fields. Each frame, `mixer.update(dt)` walks every active action on the main thread. It advances each action, and accumulates each property through a `PropertyMixer`. It dispatches `'loop'` and `'finished'` events from inside that walk. An app calls `update` itself, once per mixer, so a crowd of 500 characters walks 500 mixers on the main thread. null3D keeps the same blend rules inside a layer, and runs the walk for every character in the core, on the job workers.

## Consequences

- `crates/null3d-core/src/animation/actions.rs` holds the play state and the advance; `system.rs` holds the layers, masks and additive blend; `clip.rs` builds additive clips.
- The animation calls are now part of the engine's core interface (`CoreGlue`), and `updateAnimations` takes the step in whole microseconds.
- `packages/engine/src/scene/animation.ts` holds the animator, and the rig that model loaders create. The glTF loader (M2-C7) creates rigs with `createAnimationRig` and animates objects with `animateObject`. Until it lands, only engine code and tests can give an object clips.
- The E1218 error page now covers animator calls.
- The crowd features (M2-C6) skip or share the advance and the sample inside the same loop.
- The phone and tablet timings of the step with the animator come from the [animation plan](../devices.md#the-animation-plan). Add them here.
- The record is in the table in [README.md](README.md).
