# api-1-substance-09

## Finding as given

- Page: api/feature-instances, api/features
- Anchor: feature-instances intro line 26 and line 77; features ## Adapters line 287
- Category: wrong-claim. Severity: medium.
- Claim: The pages say that on WebGL2 "the page gives" the count. In null3D the page is the thread that calls createEngine. The count comes from draw.setCount and draw.setInstances, which the sketch calls.
- Evidence: docs/api/feature-instances.md:26, 77, 133-134; docs/api/features.md:287; packages/engine/src/scene/feature-instances.ts:169.
- Proposed edit: Replace "the page gives it" / "from the page" with "the sketch gives it with draw.setCount" in all three places.

Verdict: survives

## Evidence

- docs/api/feature-instances.md:26 says "On WebGL2 the page gives it."
- docs/api/features.md:287 says the count comes "from the page on WebGL2".
- The docs define "page" as the main thread. docs/concepts/architecture.md:33 and :39 say the sketch runs in a worker and the main thread holds "the page and a thin engine shim". Other pages use "page" the same way (audio.md:139, features.md:261).
- The example on the same page (feature-instances.md:58-79) calls `scene.addComputeInstances` and `draw.setInstances` inside `defineSketch`. So the sketch, in its worker, gives the count.
- packages/engine/src/scene/feature-instances.ts:151-188: `setCount` and `setInstances` both set the count. On WebGL2 they set the instance batch's active count. Nothing on the main thread is involved.
- So a reader who takes "page" at its defined meaning would look for a main-thread call that does not exist. The claim holds.

## Refinement of the edit

The proposed text fits lines 26 and 287, but not line 77, which is a code comment with other words. It also names only setCount, while the page's own example uses setInstances, which sets the count too (feature-instances.ts:169-188, and the page at 133-134).

Better edit:
- feature-instances.md:26: "On WebGL2 the sketch gives it, with `draw.setInstances` or `draw.setCount`."
- feature-instances.md:77 (code comment): "On WebGL2, which has no compute, the sketch fills both on the CPU, which draws the same picture."
- features.md:287: "The count comes from the GPU on WebGPU, and from the sketch on WebGL2."
- The TSDoc of `setCount` at packages/engine/src/scene/feature-instances.ts:151 says "a page without compute". It feeds docs/api/reference/feature-instances.md. Change it to "a path without compute" or "WebGL2" for the same reason.
