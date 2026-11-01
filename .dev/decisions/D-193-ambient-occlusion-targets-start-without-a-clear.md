# D-193: Ambient occlusion's WebGL2 targets start without a clear

Status: decided, built and measured. The 3.6 ms that ambient occlusion adds on the iPhone does not
come from the clears. The prepass's unwritten stand-in color owns it, and the prepass now attaches no
color on WebGL2. Task: M2-R33.

Summary: Each of ambient occlusion's three steps draws every texel of its target that a later pass
reads, and every read clamps inside the drawn corner. So on WebGL2 those targets start without a
clear, which covers the whole target and costs a Safari 27 iPhone about 0.95 ms. The clears do not
own the 3.6 ms that ambient occlusion adds on that phone. The prepass's unwritten stand-in color
does, and a depth-only framebuffer removes that charge
([D-269](D-269-the-prepass-stand-in-color.md)).

## Question

How does the engine stop ambient occlusion from costing an iPhone 3.6 ms of render-worker time a
frame on WebGL2? The same steps cost an iPad 0.2 to 0.7 ms.

## Rule

The frame makes a clear only where a later pass may read a texel that the frame's earlier passes did
not write. A clear costs the whole attachment on Safari's WebGL2 path. So a target that no read
leaves keeps its contents.

## Data

Two iPhone 18 Pro runs measured the render worker's time per frame with ambient occlusion off and
on, in turns. The run at `5949e07cf` clears the steps' targets, and the run at `7c69473f9` loads
them:

| Targets | Render scale | Off, ms | On, ms | Delta, ms | Device and browser |
| --- | --- | --- | --- | --- | --- |
| Cleared, `5949e07cf` | 1 | 0.74 | 4.46 | 3.72 | iPhone 18 Pro, Safari 27.0 |
| Cleared, `5949e07cf` | 0.5 | 0.86 | 4.46 | 3.60 | iPhone 18 Pro, Safari 27.0 |
| Loaded, `7c69473f9` | 1 | 0.78 | 4.44 | 3.66 | iPhone 18 Pro, Safari 27.0 |
| Loaded, `7c69473f9` | 0.5 | 0.88 | 4.44 | 3.56 | iPhone 18 Pro, Safari 27.0 |

The cost is flat across the two render scales. The steps' targets are half the canvas each way at
any render scale. A step's render pass that clears its target clears all of it before it draws the
corner that the render scale sets. The call profile run `20261014-060504-ao-calls-sync` puts
4.07 ms in six `clear` calls a frame, and 0.20 ms in two calls without ambient occlusion. That is
about 0.95 ms for each of the four clears that ambient occlusion adds.

The Mac's Safari 26.6.2 hides the iPhone's cost: ambient occlusion adds 0.04 to 0.20 ms of
render-worker time there, with cleared and loaded targets alike, which is the noise of a 0.6 ms
frame. The call profile shows the difference instead. The count follows the engine's draw list, not
the device:

| Clear calls a frame, ambient occlusion on | Cleared targets | Loaded targets | Device and browser |
| --- | --- | --- | --- |
| Render scale 1 | 6 | 3 | iPhone 18 Pro cleared; Mac Safari loaded |
| Render scale 0.5 | 6 | 4 | iPhone 18 Pro cleared; Mac Safari loaded |

With cleared targets ambient occlusion adds four clears a frame. With loaded targets it adds one:
the prepass's depth. Without ambient occlusion, the same frames make two clears at scale 1 and three
at 0.5.

How the data was produced: `bun tests/real-browsers.ts --plan ao` and `--plan ao-calls-sync` on
each device, through the device runner. The iPhone figures come from the records in
[`tested-devices`](../tested-devices/iphone-18-pro-safari/20261018-030850-ao.md). The Mac runs are
`20261019-053734-ao`, `20261019-061226-ao` and `20261019-061308-ao-calls-sync` in
[`mac-safari`](../tested-devices/mac-safari/).

## Decision

The three steps create their targets with `Pass::creates_overwriting`
(`crates/null3d-render/src/graph.rs`). `frame_graph.rs` makes that declaration on WebGL2 only. The
compiler's `plan_attachments` then gives each target a load rather than a clear. The WebGPU path
keeps its clear. A clear is cheap there, and a load would read the whole target.

The prepass, whose stand-in color no pass reads, attaches no color at all on WebGL2. It draws into a
depth-only framebuffer whose draw buffers are `NONE`, so no color is bound with it and no unused
color is invalidated ([D-269](D-269-the-prepass-stand-in-color.md)).

Every read of these targets clamps inside the drawn corner. The horizon and denoise steps do so in
`ao.wgsl`, the depth-weighted read in the opaque pass in `lib/gtao.wgsl`, and the pyramid in
`ssr.wgsl`. So no pass reads a texel that the frame did not write, and the images do not change.

The loads stay although the clears do not own the iPhone's cost. A clear costs the whole target,
and the targets read only what their steps write.

## What owns the rest of the cost

A loaded target still costs the same 3.6 ms as a cleared one. The horizon search, the denoise
draws and the frame's fence were the suspects; none of them owns it. The prepass's stand-in color
owned it. That color was attached and never written, and the pass's end invalidated it. Safari 26.6
and later charges render-worker time for that, and the charge follows the texture's size
([D-269](D-269-the-prepass-stand-in-color.md)).

The profile's 0.95 ms for each clear above was this charge, read as a clear. The same page measures a
clear of the full-canvas target at 0.22 to 0.24 ms. It measures the unwritten color at 3.78 to
3.92 ms. The stand-alone page charges the iPads too: 3.26 ms on the iPad 10 and 12.28 ms on the iPad
Pro 13. The engine's own frame on the iPad 10 pays it in frame time, 4.8 to 7.2 ms, which is the
stand-alone figure scaled by the larger drawing buffer. Its render worker shows only a slice of that,
0.52 against 0.64 ms, because its frame is GPU-bound
([D-269](D-269-the-prepass-stand-in-color.md)).

The 0.2 to 0.7 ms quoted above came from the Medium preset's frame, measured before the prepass's
stand-in color became a load. It does not show that the iPads are free of the charge.

The prepass's stand-in color is the only attachment of this kind in the engine, as D-269's search
shows, so this decision's rule stands unchanged for the three steps' targets.

## Consequences

- A WebGL2 frame with ambient occlusion makes one clear for it, where cleared targets make four. The
  frame-graph unit test holds the load operations and the recorded render pass flags.
- The WebGL2 image tests of ambient occlusion match their references.
- The engine's docs for the render graph name the exception. A target is cleared at its first write
  only when its writer leaves a texel that a later pass reads.
- On WebGL2 the prepass that a screen step splits from the opaque pass attaches no color: its draw
  buffers are `NONE`, so Safari binds no unused color and invalidates none. The framebuffer holds one
  depth target, as a shadow cascade's does.
- The frame-graph test walks every step of the ambient occlusion frame and refuses any other color
  that a pass loads and then discards.
