# errors-substance-09

## Finding as given

- page: errors/E1506
- anchor: "# E1506: Feature draw after the first frame"
- category: term-before-definition, severity: medium
- claim: 'A device that draws its scene directly' and 'the direct path' are never explained. The title's 'Feature draw' does not match the API page's name, 'Add-on instance draws'. The fix writes addComputeInstances(), but the method is scene.addComputeInstances. The page does not say which devices take the direct path, or how to test it with ?direct=on. 'The frame records no draw' conflicts with the example, which says 'the frame failed'. In fact every frame fails until the draw is destroyed.
- proposedEdit: Title 'Add-on instance draw after the first frame'. New cause text naming scene.addComputeInstances(), saying each frame fails and draws nothing until the draw is destroyed. Add the devices that draw directly (engine.capabilities.directDraws) and ?direct=on. Link api/feature-instances.
- generatedSource: packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts

Verdict: partly

## Evidence

- docs/errors/E1506.md:9-23 shows the page. "draws its scene directly" and "the direct path" appear in the cause with no explanation. It does not say which devices draw directly, and it does not mention engine.capabilities.directDraws or ?direct=on. This part holds. A newcomer on a Mac or iPhone has no way to learn why this happens only on their device.
- The title is "Feature draw", but the only API that triggers the error is scene.addComputeInstances. In crates/null3d-render/src/gpu_driven/mod.rs:1781-1792, the frame refuses only when settings.feature_instances() is not empty. It does not refuse for addFeatureDraw draws. docs/api/feature-draws.md ("Add-on feature draws") documents addFeatureDraw, so the title can point a reader at the wrong API. The page for the right API is docs/api/feature-instances.md ("Add-on instance draws"). This part holds.
- The fix (packages/engine/src/errors/fixes.ts:163-164) writes "addComputeInstances()" with no "scene.". Other fixes name the owning object, for example render.dumpGraph() and materials.shader. This part holds, but it is minor.
- "The frame records no draw" against "the frame failed": the core returns an error for the whole frame, so nothing draws (gpu_driven/mod.rs:1790, and errors/core-failure.ts:186-190 turns code 1506 into "<call> failed: ..."). The two are not truly in conflict, because a failed frame does record no draw. The sentence is ambiguous, though: a reader can take it to mean that only the late draw is skipped. The claim that every frame fails until the draw is gone is correct, because the check runs on each frame while the draw exists. The page already says this in the fix: "Destroy the draw to let the frames draw again" (fixes.ts:164). So the cause text is vague, but the page does not leave the reader unaware. This part of the claim is overstated.
- "Link api/feature-instances" does not fit this source. Error pages are rendered from plain strings in codes.ts and fixes.ts. No error page has a Markdown link (no docs/errors/E*.md contains "](../"). The fix text also goes into the runtime error message (packages/engine/src/errors/engine-error.ts:1-4), where a Markdown link would show as raw text. A link needs a change to the error page renderer in tools/lib/docs.ts, for example a "see also" field. A plain sentence that names the page also works.

## Corrected claim

The page uses "draws directly" and "the direct path" without saying what they are or which devices use them (Apple GPUs in Safari, and every browser on iPhone and iPad, after a start-up measurement). It also does not say how to check the path (engine.capabilities.directDraws) or how to force it (?direct=on). The title "Feature draw" can send readers to addFeatureDraw, which never raises this error. Only scene.addComputeInstances does. "The frame records no draw" is vague: the whole frame fails, on every frame, until the draw is destroyed. The fix does say that destroying the draw restores the frames. There is no real conflict with the example.

## Corrected edit

In packages/engine/src/errors/codes.ts (E1506):
- title: "Add-on instance draw after the first frame"
- cause: "scene.addComputeInstances() made a draw after the engine recorded its first frame, on a device that draws its scene directly. On that path the CPU counts every draw and keeps no indirect draw, so a count that the GPU writes has nowhere to go. Every frame then fails and draws nothing until you destroy the draw. Only some devices draw directly: an Apple GPU in Safari, or any browser on iPhone and iPad, when a start-up measurement finds it faster. engine.capabilities.directDraws says which path the engine took."

In packages/engine/src/errors/fixes.ts (E1506):
"Create the draw in the sketch's setup, and await scene.addComputeInstances() there, before the first frame. A device that draws directly fixes that choice at its first frame. Destroy the draw to let the frames draw again. To test this path on any WebGPU device, add ?direct=on to the page's address."

Do not put a Markdown link in these strings, because the fix also becomes the runtime error message. If the page needs a link to api/feature-instances, add a "see also" field to the error page renderer in tools/lib/docs.ts.
