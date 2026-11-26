# Verdict for api-3-substance-06

## The finding as given

- id: api-3-substance-06 (slice api-3, role substance)
- page: api/render
- anchor: ### WebGL2, line 445: "The engine draws a compute pass on WebGPU only."
- category: contradiction
- severity: medium
- claim: The section says a WebGL2 page runs the `fallback` as a full-screen pass, then ends by saying compute passes draw on WebGPU only. The reader cannot tell whether a pass with a fallback works on WebGL2.
- evidence: docs/api/render.md:441, 445; packages/engine/src/scene/render.ts:612-615 (fallback layers on WebGL2).
- proposedEdit: Replace the last sentence with "Without a fallback, the pass runs on WebGPU only, and `render.addPass` throws E1220 on WebGL2."
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/api/render.md:441 opens the section: "A WebGL2 page runs the `fallback` WGSL as a full-screen pass."
- docs/api/render.md:445 ends the same section with "Give no fallback when the work needs atomics or shared memory. ... The call then throws E1220 on WebGL2. The engine draws a compute pass on WebGPU only." The last sentence has no qualifier. Read alone, it says every compute pass is WebGPU only, which goes against line 441. The intended meaning (a pass without a fallback) is only implied by its position.
- packages/engine/src/scene/render.ts:597-607 (`addCompute`): on WebGL2, a pass without `fallback` throws through `invalid('render.addPass', ...)`, which is E1220. A pass with a fallback goes on to `addFullscreenPass` (render.ts:612 onward). So the code supports the finding: a pass with a fallback does draw on WebGL2. The finding's line range 612-615 points at the fragment-form setup, not at the throw; the throw is at 603-607. This does not change the claim.
- The call name `render.addPass` is correct (render.ts:532), and E1220 is the right code (errors table at docs/api/render.md:474 lists "A compute pass on WebGL2 with no fallback").
- Nothing else on the page or in a linked page resolves the ambiguity at this spot. The options table (line 304) says the fallback runs "in its place" on WebGL2, which agrees with line 441, so the last sentence of 445 is the odd one out.

## Corrected edit

The proposed sentence is right in substance, but it repeats the sentence before it ("The call then throws E1220 on WebGL2."). Replace the last two sentences of line 445 instead:

Old: "The call then throws E1220 on WebGL2. The engine draws a compute pass on WebGPU only."
New: "Without a fallback, the pass runs on WebGPU only, and `render.addPass` throws E1220 on WebGL2."
