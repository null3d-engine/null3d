# api-1-substance-03

## Finding as given

- page: api/engine
- anchor: ## The start, line 36; ## What the engine reports, line 155
- category: contradiction
- severity: medium
- claim: Line 36 says createEngine picks the GPU path 'never from browser or GPU names'. Line 155 says the direct draw path is measured only on an Apple GPU in Safari or on iPhone/iPad, with reason not-apple-gpu-in-webkit, which comes from a check of the adapter names and user agent. 'draws buckets directly' is also unexplained.
- evidence: docs/api/engine.md:36, 155. packages/engine/src/gpu/webgpu/draw-path-probe.ts:7-9 and :95.
- proposedEdit: Line 36: 'picks the build and the GPU tier from those tests. One measurement, the draw path on WebGPU, runs only on an Apple GPU in WebKit, where its cost is known.' Line 155: replace 'draws buckets directly' with 'issues one draw call for each group of objects, instead of indirect draws that the GPU's culling fills'.

Verdict: survives

## Evidence

- docs/api/engine.md:36 says the engine picks "the build and the GPU path from those tests, never from browser or GPU names". No exception is given on this page.
- docs/api/engine.md:155 says the direct draw path is picked only on an Apple GPU in Safari or any browser on iPhone and iPad, and names the reason `not-apple-gpu-in-webkit`.
- packages/engine/src/gpu/webgpu/draw-path-probe.ts:93-95 (`skipDrawPathProbe`) returns `not-apple-gpu-in-webkit` when `appleGpuInWebKit(info, userAgent)` is false.
- packages/engine/src/shared/webkit.ts: `appleGpu` matches the word "apple" in the adapter's vendor, architecture and description names; `isAppleWebKit` reads the user agent. So the draw path choice reads both GPU names and the browser name. The claim about the code is correct.
- The linked page docs/concepts/backends.md:154 admits the exception ("The engine itself reads a name only to work around a measured cost ... The direct draw path is such a case"). That does not fix engine.md:36, which states an absolute rule on its own page and links nowhere for the exception.
- The tier itself is picked from feature tests (backends.md:21), so the "not from names" part is true for the tier. Only the absolute "never" is wrong.
- "bucket" appears once on engine.md (line 155) and is not defined there. backends.md:35 describes "one draw for each group of objects that share a pipeline, a mesh and a material" and then uses "bucket", so a reader of engine.md alone meets an undefined term.

## Corrected edit

The proposed line 36 edit drops the true and useful point that the tier does not come from names, and "where its cost is known" is vague. Better:

Line 36: "`createEngine` tests what the browser offers, and picks the build and the GPU path (tier) from those tests, not from browser or GPU names. One later choice on WebGPU does read names: a start-up measurement of the draw path runs only on an Apple GPU in WebKit ([Never branch on GPU names](../concepts/backends.md#never-branch-on-gpu-names))."

Line 155: replace "says whether the device draws buckets directly" with "says whether the engine draws each group of objects that share a pipeline, a mesh and a material with a direct draw, culled on the CPU, in place of the indirect draws that the GPU fills in".
