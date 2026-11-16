# D-226: An alpha-masked lit fragment under MSAA

Status: decided by the helper of M3-R6, for the owner's review. Measured on the owner's Mac in
Chrome and Safari. Not built: nothing follows from it, since the cost it measures stays under the
rule. Task: M3-R6.

Summary: A full screen of alpha-masked lit fragments costs at most 0.29 ms more than the same screen
of opaque fragments with MSAA on, in Safari, and nothing measurable in Chrome. The study's +22.5 ms
figure does not reproduce on this engine, so the pattern stays and no change lands.

## Question

The engine study measured a fragment shader that reads a runtime-sized storage array and then
discards at +22.5 ms under MSAA 4x against 1x on an Apple M4, and a fixed-size array at +2.9 ms
(chapter 03 of the study, kept outside the repository). null3D's ALPHA_MASK lit build does exactly
that: its fragment shader reads its material from a runtime-sized storage array, tests the alpha
last, after the lighting, and then discards. Does that pattern cost null3D the same on the Mac, in
Chrome and in Safari, and does a change have to land?

## Rule

A full screen of masked lit fragments may cost up to 1 ms more than the same screen of opaque lit
fragments under MSAA on the Mac, about 6% of a 60 Hz frame. That is the worst case for a scene, as
every pixel of the window then shades through the masked build. A larger cost is real, and a change
has to remove it. The study's two options are a fixed-size array, which the engine's growing
material table does not allow without a cap, and the values that the test needs passed through the
vertex stage, which the WebGPU vertex stage cannot read a storage buffer for.

## Data

The `alpha-mask-cost` page draws 24 lit quads in a 6 by 4 grid that fills the view once, with no
overlap, so every pixel shades one fragment. Diagonal bands of vertex alpha cut half of each quad's
fragments. The page swaps every quad between the masked build of the standard material and its
opaque build in turns, so both sides shade the same pixels of the same geometry and differ only in
the alpha test and the discard. The opaque build ignores the alpha, so it shades every pixel. The
masked build discards the clear bands, which the page's own pictures show: the bands take the
background's color and the opaque side has none.

The page sets `?prepass=off`, so no side is skipped by a depth already in the target, and
`?preset=high`, whose antialias mode is MSAA. `?aa=msaa` or `?aa=none` sets the antialiasing at the
engine's start. The masked build's cost is the difference between the two sides at one antialiasing
mode. The frame holds a culling step, one opaque pass and one final pass, so a full screen of masked
shading is the whole scene pass.

In the runs that commit `0ce99a741` records: Chrome 155.0.8059.85 on the MacBook Pro (Apple M5 Max, 18 cores, macOS 26.6.2), at a 1600 by 900
window in device pixels, in a quiet lane of the coordination queue with the machine's
1-minute load between 20 and 28 from other work:

| GPU path | Antialiasing | Opaque, ms | Masked, ms | Masked less opaque, ms |
| --- | --- | --- | --- | --- |
| WebGPU core | MSAA | 0.81 | 0.69 | −0.12 |
| WebGPU core | none | 0.71 | 0.64 | −0.07 |
| Compatibility mode | MSAA | 0.87 | 0.62 | −0.25 |
| Compatibility mode | none | 0.71 | 0.64 | −0.07 |
| WebGL2 | MSAA | 1.20 | 1.21 | +0.01 |
| WebGL2 | none | 0.81 | 0.81 | 0.00 |

Chrome draws MSAA for 0.10 ms more on WebGPU core, 0.16 ms more in compatibility mode and 0.39 ms
more on WebGL2, over the opaque side. The masked side is never slower than the opaque one by more
than 0.01 ms: the discard saves more sample writes than the alpha test costs.

In the same commit's runs, Safari 26.6.2 on the same Mac, at the runner's parked window of 800 by 485 points at
two device pixels each, about 1.55 million pixels, with the display at 60 Hz:

| GPU path | Antialiasing | Opaque, ms | Masked, ms | Masked less opaque, ms |
| --- | --- | --- | --- | --- |
| WebGPU core | MSAA | 2.23 | 2.52 | +0.29 |
| WebGPU core | none | 0.74 | 0.80 | +0.06 |
| Compatibility mode | MSAA | 2.79 | 2.94 | +0.15 |
| Compatibility mode | none | 0.74 | 0.79 | +0.05 |
| WebGL2 | MSAA | no timer | no timer | none |
| WebGL2 | none | no timer | no timer | none |

Safari has no GPU timer on WebGL2. Its WebGL2 pages drew at a 15.5 ms frame interval, which the
display's rate sets, and at 0.48 ms of CPU on the sketch worker and 0.40 to 0.48 ms on the render
worker; the mask moved neither.

How the data was produced: `NULL3D_ALPHA_MASK_COST=1 bun run test:browser -- alpha-mask-cost.spec.ts`
in Chrome, whose spec turns on `--enable-webgpu-developer-features` because Chrome otherwise rounds
the GPU timestamps it reports; and `bun tests/real-browsers.ts --plan alpha-mask-cost Safari --front`
for Safari. Each page runs 2 seconds of warm-up and then times each side for 2 seconds, three times,
and the figure is the median of the three.

## Decision

The masked build's cost stays under the rule on every path of both browsers. The largest figure is
Safari's +0.29 ms at 1.55 million pixels, against a limit of 1 ms. The part that MSAA adds to the
mask is 0.23 ms there, the difference between its two antialiasing modes, and that is the cost of
the discard alone spreading over the samples. Chrome shows no such part on any path: the masked side
costs the same as the opaque one within a tenth of a millisecond.

The study's figure does not transfer. Its measurement was of its own engine and its own shader on
older browsers, and the two causes that its documentation names do not appear here: Chrome's Tint
lookup of a runtime-sized array's length, of which nothing shows above the run-to-run spread, and
Safari's storage read inside a loop, which null3D's lit shader has none of, since it reads its
material once and never in a loop.

The pattern stays. No change to the shader, the material table or the instance data follows.

## Consequences

- Nothing changes in the engine, its shaders or its material table.
- `.dev/benchmarks.md` holds the page, the plan and the rule, so a later shader change or a browser
  change can be measured the same way.
- The `alpha-mask-cost` page, its browser test and the device plan stay in the repository as the
  measurement that answers the question again.
- A scene with large masked areas under MSAA may spend this cost freely: a full screen of it costs
  under a third of a millisecond on Safari and nothing measurable on Chrome, on this Mac.
