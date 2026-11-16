# D-272: A pass records what it draws for

Status: decided and built. Task: M3-A9.

Summary: Each GPU pass carries a label from the frame graph: its role and its place among the passes of that role, such as `shadow cascade 1` or `shadow hero`. The GPU timer records the label with the pass's time, so a cost record attributes a figure to a named pass even when the passes before it change from frame to frame. The label costs one word per pass in the draw list and uses the spare words of a frame record.

## Question

What identity should a GPU pass carry, so that a cost record can give a figure for a named pass, such as the sun's hero shadow, when the number of passes before it changes from frame to frame?

## Rule

- A pass's figure belongs to the same name in every frame of a run, whatever passes run before it.
- The change adds no allocation per frame and no GPU work while the page does not measure.
- A pass with no label keeps a name from its kind and its place among the passes of that kind, such as `render 1`, so a hand-made draw list reads the same.
- No fixed limit changes.

## Data

The far shadow cascades draw in one frame of two or of three. The hero tile draws in every frame while the car moves, and in none while it rests. So the hero's pass is the third, fourth or fifth render pass of a frame, and a figure per slot mixes it with a cascade.

The timer times seven passes one by one: `GPU_TIMED_PASSES` is the seven phase slots after the copies. A pass after them adds its time to the last one, as it did before. The hero's pass is among the first render passes, so the label reaches it.

The hero cost spec (`tests/image/hero-cost.spec.ts`) times the same scene with the hero off and on, four rounds each. It ran beside the queue's fresh-project test, with the 1-minute load at 3.1 to 4.9. Its moving cases are where the label adds a figure: the `shadow hero` part of the frame. The run's record is [the Mac's hero cost run](../tested-devices/macbook-pro-chrome/20261028-143438-hero-cost.md).

| GPU path | Preset | Hero tile | `shadow hero`, moving (ms) |
| --- | --- | --- | --- |
| WebGPU | High | 1,024 | 0.025 |
| WebGPU | High | 2,048 | 0.052 |
| WebGPU | High | 4,096 | 0.327 |
| WebGPU | Medium | 2,048 | 0.098 |
| Compatibility | Medium | 2,048 | 0.087 |
| WebGL2 | Medium | 2,048 | no split |

The off side has no `shadow hero` part in any case, and a still hero names none, because its tile rests. Across the moving cases the tile reads 0.025 to 0.327 ms, while the frame's GPU time changed by -0.374 to +0.293 ms. Each figure is separate from every cascade's part, so the label names the pass that the slot could not.

## Look

The options draw the same picture. The label changes no pass, no texture and no draw, so the image tests' references do not move.

## Options

| Option | Verdict |
| --- | --- |
| A: the pass's slot, which names a pass by its kind and its order | Rejected. A pass that a far cascade sometimes precedes changes slot, and a median then mixes two passes. [D-219](D-219-hero-shadow.md) could not give the hero's pass a figure for this reason |
| B: draw every far cascade in every frame, so every pass keeps a stable slot | Rejected. It changes the shadow work on both sides of a comparison, so a cost run compares the hero against a different scene. It also removes the saving that the cascades' turns give. The owner chose the label route over this interim |
| C: name a pass by the target that it draws into | Rejected. The cascades and the hero draw into layers of one shadow atlas, and the final pass and a custom effect may both draw into the canvas. A target names neither the pass's purpose nor the distinguished pass |
| D: the frame graph's role and the pass's place among the passes of that role | Chosen. The graph declares a role for every pass and knows its place: a cascade's index, a tile's layer, a bloom step. It is the identity that the frame's own structure already holds |

## Decision

A label is a `u32`: the role in the low 16 bits and the place in the high 16 bits. `BeginRenderPass` and `BeginComputePass` carry it as their last operand. The WebGPU timer stores the label of each timed pass in the frame's record, and `gpuPassStats` names each part by the role's name and its place where the role prints one.

- A render pass that holds several declared passes takes the role of its first, which is the one that opened it: the camera's `opaque` pass with its resolve is `opaque`.
- A compute pass takes the role that all of its dispatches share, or `compute` when they differ, because the GPU times the dispatches as one pass. The culling passes of a frame therefore show as `compute`.
- The atlas's last layer is the sun's hero tile while the light names a hero. `TilePasses` carries that layer, and the graph labels the pass `shadow hero`. A still hero draws no pass, so its side of a run has no such part.
- A pass with no label, as a hand-made draw list may have, keeps the name that the timer gave it before: its kind and its place among the passes of that kind, such as `render 1`.

The cost of recording:

- The draw list grows by one word per pass. The hero demo's frame has five to ten passes.
- Each GPU record holds seven labels, in the words that the record kept spare after its counters. The writer fills one word per timed pass and allocates nothing.
- The backend reads the label with the pass's other operands. The timer's per-pass figures and the frame's total are unchanged, so every cost record that reads the numbers still reads the same numbers.

## Consequences

- `crates/null3d-gpu/src/pass_role.rs` holds the roles and their names. `drawlist.rs` generates `PASS_ROLE_NAMES`, `PASS_ROLE_PLACES` and `PASS_ROLE_PLACE_SHIFT` into `gpu.ts`.
- `frame_graph.rs` labels the passes that it records. `exposure.rs`, `fullscreen.rs`, `physical_sky.rs` and `feature_rows.rs` label the passes that they record themselves.
- `shared/metrics.ts` reads and writes `passRoles` in a GPU record, and `page/frame-stats.ts` names the parts.
- [The debug page](../../docs/api/debug.md) lists the names that a measurement prints.
- [D-219](D-219-hero-shadow.md) gains the hero's own pass figure for the moving cases.
