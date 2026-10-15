# D-161: Crowd update rates and shared poses

Status: accepted. Built under the owner's ruling 2 of 8 October 2026 (vertex-shader skinning is the WebGPU default). Date: 2026-10-13. Task: M2-C6.

Summary: A far character's pose updates once every 1, 2 or 4 frames. A sketch gives each character that interval with `animator.setUpdateInterval`, and the `farAnimationInterval` quality setting gives the value for far ones. On the frames between two updates the engine samples, blends and composes nothing for that instance. It holds the last matrices and leaves the pose step unchanged, so the skinning pass skips the held pose too. Each update covers the frames its clips skipped, so they keep their real speed. The governor doubles the interval after every other live step. The task's shared-pose idea is met by the vertex-shader default. A crowd of one model draws in one instanced draw per part, and it shares the clip data. The compute path's skin-region sharing belongs to the pose stamp of M2-C8.

## Question

M2-C6 asks for crowd update rates and shared poses. Its text assumed compute skinning on
WebGPU: slower rates would save CPU sampling, and the compute pass's pose skip would save GPU work
as well. The owner's ruling 2 of 8 October 2026 made vertex-shader skinning the WebGPU default
(`SkinningMode::default() == VERTEX`), which is already on main. What of M2-C6 is still to build,
and how does a slower rate save work when every pass skins a character in its vertex shader?

## Rule

- A far character's pose updates every 1, 2 or 4 frames by preset, from a live setting. 1
  measures the same frame as today.
- A character the camera sees near updates in every frame, so nothing steps where the viewer
  looks. A sketch sets the intervals, because only the sketch knows which characters are far.
- A slower rate saves the CPU work of sampling, blending and composing on the frames it skips. On
  the compute skinning path it saves the GPU work of skinning a held pose too, through the pose
  step that M2-C8 added.
- No cost for a scene that never calls `setUpdateInterval`: no new work per frame, and no memory
  beyond one 32-bit word per animated instance.
- No allocation per frame (hard rule 1).

## Options

### Where the update rate lives

| Option | Verdict |
| --- | --- |
| The engine skips an instance's frame step for the frames between its updates, at an interval per instance | Chosen. The sampling, the blending and the compose all sit in one loop over instances, so one `continue` skips all of them |
| The sketch samples less often and writes the sampled pose back | Rejected. The sketch's thread does no sampling: the job workers do it in WebAssembly (design principle 6) |
| The engine applies one interval to every animated instance | Rejected. It would step the hero of a scene that never asked, and only a sketch knows which characters are far |

### How the frames between updates keep the clip's speed

| Option | Verdict |
| --- | --- |
| The update advances the clip by the frames it skipped, so its mean rate is the frame's rate | Chosen. It uses the step that last posed the instance, so a change of the interval takes effect at the next pose |
| The update advances by one frame, as usual | Rejected. A character would then animate at 1/interval of its speed |
| The engine sums the skipped time of each instance | Rejected. It needs a second per-instance array of floats, and the step that last posed the instance already gives the frame count exactly |

### The shared poses of the task

| Option | Verdict |
| --- | --- |
| The vertex-shader default already shares the work: a crowd of one model draws in one instanced draw per part and reads one clip's data | Chosen. The bucket and the clip data are shared, and M2-C8's pose stamp skips a held pose on the compute path |
| Add a per-pose skinned region that identical characters share, as the compute path once planned | Rejected. Vertex-shader skinning gives each pass the character's own vertices and its own joints, so a shared region saves nothing there, and the compute path's M2-C8 pose stamp already skips a repeated skin |
| Bake vertex animation textures for a very large crowd | Left to the asset tool as the plan allows; nothing in the engine depends on it |

### Where the governor acts

| Option | Verdict |
| --- | --- |
| The interval doubles last of all the governor's steps, and comes back first | Chosen. Stepping is visible, so it gives way after the render scale, the levels of detail, the shadows, bloom, ambient occlusion and the contact shadows, and returns before them |
| The interval doubles with the far cascades' steps | Rejected. The shadow steps are the plan's answer to a GPU-bound frame, and a CPU-bound crowd is a different cause |

## Decision

Build the update rate as above. The engine holds one interval per animated instance and poses an
instance only on the frames of its interval. `farAnimationInterval` (4, 4, 2 and 1 from Low to
Ultra) is the value a sketch gives to far characters, and the governor raises it by doubling. The
task's shared-pose wording is met by the vertex-shader default and M2-C8's pose stamp.

## Costs

- One 32-bit word per animated instance (4 KB at the table's 1,024 instances) and one more per
  instance for the step that last posed it.
- On a frame that skips an instance, the engine copies its matrices from the previous frame's
  buffer into this one, 48 bytes per joint. That is a memcpy against a full sample, blend and
  compose of the same joints, so the frame is much cheaper. It also keeps the draw list reading one
  buffer.
- The Rust test `a_slow_instance_poses_on_its_interval_alone` shows the schedule. An instance at
  interval 4 poses once in four frames, and its matrices carry over on the others. Its pose after
  five frames matches an instance that posed in every one, so its sampling work is a quarter of the
  crowd's. Its clips stay at their speed.

## Consequences

- `animator.setUpdateInterval(frames)` takes a whole number from 1 to 64, and `animator.updateInterval`
  reads it. A scene that never calls it updates every character in every frame, as before.
- A far character steps between its updates, which is why a sketch holds the near ones at 1. Its
  events reach the sketch's handlers on its next update, up to `frames` frames late.
- The engine's S5 benchmark uses the setting: it gives characters within 24 m of the camera 1 and
  the rest the governed interval. Its image and parity tests pass `?anim=every`, which holds every
  character at 1, so a held frame stays repeatable.
- The wall-clock saving on S5's busiest thread is owed: a quiet-Mac run of `bun run bench:profile
  --thread sketch --scene s5` with and without `?anim=every` records it. The figure goes into this
  record and the device record.

## Follow-ups

1. Stagger the updates of a crowd so one frame does not carry all of it, if a profile shows the
   burst. Today the instances of a crowd created together pose on the same frames.
2. Let a sketch say that a character is off screen. The engine then skips its sampling until the
   character returns, which the task's "off-screen characters skip sampling" asks for.
