# guides-1-substance-11

## Finding as given

- page: guides/custom-shaders
- anchor: WGSL in sketch code, example `glow` (lines 111-127); "A whole shader reloads the page, because your own code draws it" (line 216)
- category: missing-content
- severity: medium
- claim: The page's main WGSL-in-code example is a whole shader. The term is defined only later (line 146), and no page says which call draws a whole shader, so the reader cannot use the example.
- evidence: docs/guides/custom-shaders.md:111-127, 146, 216; 'whole shader' appears elsewhere only in guides/add-ons.md and api/materials.md:855 (which says it throws E1215).
- proposedEdit: Replace the glow example with a surface function or effect. If whole shaders have a public use, name the call and link it; if not, say a sketch has no call that draws one.

## Verdict: partly

## Evidence

- docs/guides/custom-shaders.md:111-127: the tagged-literal example `glow` has `@vertex fn vs_main(@builtin(vertex_index) ...)` and `@fragment fn fs_main`. Under the plugin's rules this is a whole shader with one render pipeline. The term is first defined at line 146, after the example.
- packages/vite-plugin/src/wgsl.ts:164-175 (isDrawShader) needs `instance_index` too, so `glow` is not a draw shader. wgsl.ts:323-338 (planOf) makes it `kind: 'shader'`. The comment at wgsl.ts:159-162 says "a pass's own vertex shader reads the vertex index alone", which is the engine's own pattern, not a public one.
- Public calls that take compiled WGSL all refuse a vertex and fragment whole shader:
  - `materials.shader` throws E1215 for `kind: 'shader'` (packages/engine/src/scene/resources.ts:4871-4881).
  - `post.addEffect` and full-screen passes throw E1215 for "compiled WGSL of another kind" (docs/guides/custom-passes.md:569; docs/api/render.md:475).
  - `render.addPass({ kind: 'compute' })` takes a whole shader only when its source has a `@compute` entry point (packages/engine/src/scene/render.ts:1400-1412).
- So no public call draws the page's `glow` example. A reader who copies it gets a value that every call refuses. The core of the finding holds.
- The part that does not hold: "no page says which call draws a whole shader". A compute-only whole shader (line 146, last sentence) has a public call, `render.addPass({ kind: 'compute', wgsl })`, documented at docs/guides/custom-passes.md:505-561 and docs/api/render.md:227-293. The add-ons (grass-blades.wgsl, water fft.wgsl and bands.wgsl, wind grid.wgsl) all use compute-only whole shaders this way. Those pages do not use the words "whole shader", and custom-shaders.md:146 does not link to them. Every whole shader in the source tree that a public call uses is compute-only.
- Line 216 ("A whole shader reloads the page, because your own code draws it") is true for a compute pass's shader. It suggests the reader draws vertex and fragment whole shaders, which no public call lets them do.
- The second option of the proposed edit ("say a sketch has no call that draws one") would be wrong for compute shaders.

## Corrected claim

The tagged-literal example `glow` (lines 111-127) is a vertex and fragment whole shader. No public call draws one: `materials.shader`, `post.addEffect` and full-screen passes throw E1215 for it, and a compute pass takes only a whole shader with `@compute` entry points. The page defines "whole shader" only at line 146. It never links the one public use, compute passes, and line 216 suggests the reader's own code draws such shaders.

## Corrected edit

1. Replace the `glow` literal at lines 111-127 with a WGSL form that a public call takes. A short effect (`fn effect`, given to `post.addEffect`) works, or the surface function `rings` from line 30. Rename the `.wgsl` import at line 104 to match.
2. At line 146, say that a sketch uses a whole shader only as a compute pass's shader, and link [Compute passes](custom-passes.md#compute-passes). Say that WGSL with `@vertex` and `@fragment` entry points draws only as a full shader (an `InstanceIn` vertex input) or a draw shader (vertex and instance indices). Other render pipelines are for the engine's own passes, and no public call takes them.
3. At line 216, write: "A compute pass's shader reloads the page."
