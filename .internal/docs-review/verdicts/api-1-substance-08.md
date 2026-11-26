# api-1-substance-08

## The finding as given

- page: api/feature-instances
- anchor: ## A draw of quads line 78; ## The buffers line 118
- category: unclear
- severity: medium
- claim: The example calls draw.setInstances(rows, liveCount) with names that are never defined, with no check for the WebGL2 path that the comment describes. The compute snippet uses an undefined fill shader. Neither snippet runs.
- evidence: docs/api/feature-instances.md:76-78, 115-121.
- proposedEdit: Define the rows (for example a Float32Array of 16 floats per row for 100 rows) and call setInstances only when engine.capabilities.tier is 'webgl2'. Show the few lines of fill WGSL that write the count and a row, or link to packages/grass/src/grass.ts as a working user.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/api/feature-instances.md:59-79 is a full sketch (`export default defineSketch(...)`), so a reader will copy it whole. Line 78 uses `rows` and `liveCount`, and neither is defined anywhere on the page. That part holds: the sketch does not compile as written.
- The "no check for the WebGL2 path" part is wrong. `ComputeInstances.setInstances` in packages/engine/src/scene/feature-instances.ts:164-191 works on both paths. On WebGPU it uploads the rows into the draw's own buffer and sets the count; on WebGL2 it writes the instance batch. The class comment at line 96-99 says the same: draw "with `setInstances`, or from a compute pass". A tier check around the call would teach the reader that the call is WebGL2-only, which is false. The page's own comment at line 77 ("A page without compute fills both on the CPU") already leans that way and is part of the confusion.
- The second snippet (lines 114-122) is a fragment, not a sketch: `render`, `draw` and `fill` all come from outside it. Fragments after a full example are normal. Line 124 gives the two storage declarations the shader must use. So "does not run" is true but costs less here. A short fill shader would still help, because the page never shows how a row is laid out in WGSL or how the count is written atomically.
- The proposed link to packages/grass/src/grass.ts is outside the website contract, which allows demo links only to examples/<code>. No demo in examples/ uses addComputeInstances, so there is no demo to link. grass.ts:403-455 is the only real user, and it reads the tier only to choose between this API and plain createInstances.

## Corrected claim

The full sketch under "A draw of quads" calls `draw.setInstances(rows, liveCount)` with names it never defines, so it does not compile. The compute snippet under "The buffers" names a `fill` shader that the page never shows. `setInstances` needs no tier check: it works on WebGPU and WebGL2 alike.

## Corrected edit

- In the sketch, replace line 78 with a few lines that build the rows and then call `draw.setInstances(rows, n)`, with no tier check. For example, a Float32Array of 16 floats per instance for a small grid: rows of an identity matrix with the translation in each row's `w` (floats 3, 7, 11), and the material index (`draw.materialIndex`) in the first id word. Change the comment on lines 76-77 to say that `setInstances` fills the rows from the CPU on every tier, and that an add-on with compute can bind `draw.instances` and `draw.counts` instead, as "The buffers" shows.
- Under "The buffers", define `fill` above the addPass call: a short WGSL compute entry that uses the two declarations from line 124, stores one row and does `atomicStore(&counts, 1u)`. If the full shader is long, put it in a `<details>` block titled "Technical details: a fill shader that writes one row", and keep the main text readable with the block closed.
- Do not link to packages/grass/src/grass.ts; the website contract allows only examples/ demo links.
