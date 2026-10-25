# D-267: One GPU timing scope for each step of the frame and for an add-on's passes

Status: decided. Date: 2026-10-26. Task: M3-E6.

Summary: The draw list carries the scope of each GPU pass: the step of the frame that it records, named by the engine. The WebGPU timer keeps each timed pass's scope in the frame record, and the stats overlay lists the GPU time of each step. An add-on feature declares the render passes that carry its work, and the overlay adds up their time as the feature's own. A feature that records inside a pass of the engine's own reads `gpu not measured`.

## Question

D-173 asks the stats overlay to show each add-on's GPU time. D-199's decision 4 asks for one GPU timing scope per built-in step and per add-on feature. The frame records held a whole-frame GPU time and the times of up to seven passes. Those passes were named by their kind and order. How does a pass name the step it records, and how does a feature learn the time of its own passes?

## Rule

- A pass's scope is data. The engine writes it into the draw list, so the replay thread reads it without a call back to the sketch.
- The scope is stable across frames of one graph build and names a step of the frame in the overlay's words.
- A feature adds up only passes that its add-on declares, so no feature claims another's work.
- A page that never shows the figures pays nothing for them: the timer runs only while the page measures.

## Data

The engine's study chapter 04 records the method of a comparable engine. It wraps each feature in a GPU scope named `f.<name>`. Under GPU profiling it ends and reopens the pass at each in-pass feature, so each one is timed. Two parts do not carry over:

- null3D's `FeatureDraw` and `FeatureInstances` draw inside the engine's opaque or transparent pass, among the scene's other objects. Splitting that pass per feature would change the order that blended objects sort in, and the frame that the figures measured.
- WebGL2 runs one `TIME_ELAPSED` query at a time, so it times the whole frame and no pass.

The frame record holds the whole-frame time, the time of up to seven passes and their scopes. A pass after them adds its time to the last timed pass's. That step's figure then covers the rest of the frame, and its name ends in `and later`. The engine times one frame in eleven.

## Look

The overlay lists the frame's steps in the card's order. The work bars come first, then the add-ons' rows, then `GPU steps`. Each step above 0.005 ms takes one line. The add-ons' rows read like `water  gpu 1.70 ms  reflectionEvery 2  budget 1.7 of 1.7 ms`. Both lists sit inside the existing card, so its size and its look do not change.

## Decision

1. `crates/null3d-render/src/scope.rs` gives each pass a scope. It names the kind of step that the pass records, such as `OPAQUE` or `BLOOM`. The step's place among steps of that kind sits in the high 16 bits. `BeginRenderPass` and `BeginComputePass` carry it as their last operand. A step of several roles takes its first pass's role, because the GPU times the step as one pass.
2. The WebGPU timer keeps the scope of each of the first seven passes that it times. The frame record holds them in the counter slots that it does not use. The page names them with the same codes, through `packages/engine/src/shared/gpu-scope.ts`.
3. `FeatureDescription.gpu.passes` names the render passes that carry a feature's work. `defineFeature` checks each one and keeps its name and place. The overlay adds up the steps whose place is one of them.
4. A feature whose work has no pass of its own gives no `gpu`, and its row reads `gpu not measured`. The engine does not split a pass around a feature's draw. That would change the frame that the figures measured and the order blended objects draw in.
5. WebGL2 times the whole frame alone, so no step and no feature has a figure there.

## Consequences

- The water add-on declares its reflection pass as its GPU scope, and the overlay shows the pass's time on the water row.
- The splats add-on draws inside the transparent pass and reports no GPU time. A later task that needs it must split the transparent pass per feature on WebGPU only, and record what that does to the measured frame.
- `FeatureStats.scope` and `FrameStats.gpuSteps` are public. The `place` of each is internal and the docs leave it out.
- `docs/api/features.md`, `docs/api/debug.md` and `docs/guides/debugging.md` describe the scope, the steps and the limit of seven passes.
