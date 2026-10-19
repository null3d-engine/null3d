# D-193: Ambient occlusion's WebGL2 targets start without a clear

Status: decided. 19 October 2026. Task: M2-R33.

Summary: Each of ambient occlusion's three steps draws every texel of its target that a later pass
reads. Every read clamps inside the drawn corner. On WebGL2 those targets therefore start from what
the texture holds, not from a clear. A Safari 27 iPhone spent about 0.95 ms on each clear, and a
clear covers the whole target at any render scale. The clears turned out not to own the 3.6 ms that
ambient occlusion adds on that phone (see the addendum), so the decision rests on the whole-target
cost alone.

## Question

How does the engine stop ambient occlusion from costing an iPhone 3.6 ms of render-worker time a
frame on WebGL2? The same steps cost an iPad 0.2 to 0.7 ms.

## Rule

The frame makes a clear only where a later pass may read a texel that the frame's earlier passes did
not write. A clear costs the whole attachment on Safari's WebGL2 path. So a target that no read
leaves keeps its contents.

## Data

The 19 October 2026 iPhone 18 Pro run at `5949e07cf` measured the render worker's time per frame
with ambient occlusion off and on, in turns:

| Render scale | Off, ms | On, ms | Delta, ms | Device and browser |
| --- | --- | --- | --- | --- |
| 1 | 0.74 | 4.46 | 3.72 | iPhone 18 Pro, Safari 27.0 |
| 0.5 | 0.86 | 4.46 | 3.60 | iPhone 18 Pro, Safari 27.0 |

The cost is flat across the two render scales. The steps' targets are half the canvas each way at
any render scale. Each step's render pass cleared its whole target before it drew the corner that
the render scale sets. The call profile of 14 October 2026 (run `20261014-060504-ao-calls-sync`) put
4.07 ms in six `clear` calls a frame. It put 0.20 ms in two calls without ambient occlusion. That is
about 0.95 ms for each of the four clears that ambient occlusion adds.

The Mac's Safari 26.6.2 hides the iPhone's cost: ambient occlusion added 0.04 to 0.20 ms of
render-worker time there, before and after the change alike, which is the noise of a 0.6 ms frame.
The call profile shows the change instead. The count follows the engine's draw list, not the device:

| Clear calls a frame, ambient occlusion on | Before | After | Device and browser |
| --- | --- | --- | --- |
| Render scale 1 | 6 | 3 | iPhone 18 Pro before; Mac Safari after |
| Render scale 0.5 | 6 | 4 | iPhone 18 Pro before; Mac Safari after |

Ambient occlusion adds four clears a frame before, and one after: the prepass's depth. Without it,
the same frames make two clears at scale 1 and three at 0.5.

How the data was produced: `bun tests/real-browsers.ts --plan ao` and `--plan ao-calls-sync` on
each device, through the device runner. The iPhone figures come from the records in
[`tested-devices`](../tested-devices/iphone-18-pro-safari/20261018-030850-ao.md). The Mac runs are
`20261019-053734-ao`, `20261019-061226-ao` and `20261019-061308-ao-calls-sync` in
[`mac-safari`](../tested-devices/mac-safari/).

## Decision

The three steps create their targets with `Pass::creates_overwriting`
(`crates/null3d-render/src/graph.rs`). `frame_graph.rs` makes that declaration on WebGL2 only. It
also gives the prepass's stand-in color a load on WebGL2, because no pass reads that target and the
prepass has a render pass of its own there. The compiler's `plan_attachments` then gives each target
a load rather than a clear. The WebGPU path keeps its clear. A clear is cheap there, and a load
would read the whole target.

Every read of these targets clamps inside the drawn corner. The horizon and denoise steps do so in
`ao.wgsl`, the depth-weighted read in the opaque pass in `lib/gtao.wgsl`, and the pyramid in
`ssr.wgsl`. So no pass reads a texel that the frame did not write, and the images do not change.

## Consequences

- A WebGL2 frame with ambient occlusion makes three fewer clears. The frame-graph unit test holds
  the load operations and the recorded render pass flags.
- The WebGL2 image tests of ambient occlusion must match their references unchanged.
- The engine's docs for the render graph name the exception. A target is cleared at its first write
  only when its writer leaves a texel that a later pass reads.

## Addendum, 20 October 2026

The cloud run that this decision asked for measured the same cost after the change. On an iPhone 18
Pro in Safari 27.0 the render worker went from 0.78 to 4.44 ms at render scale 1, and from 0.88 to
4.44 ms at 0.5, at `7c69473f9`, which holds the change. The clears were therefore not the 3.6 ms
that ambient occlusion adds on that phone. The cost is flat across render scales and the frame holds
60 frames a second, so it is a wait at the frame's end, not slow frames. The horizon search and the
denoise draws, or the frame's fence, own what is left. The change stays: a clear still costs the
whole target, and the targets read only what their steps write. Two device measurements decide
what is left: a call profile of the frame, and a run that forces contact shadows, which skip the
horizon search. The records of both land in the tested-device pages with their figures.
