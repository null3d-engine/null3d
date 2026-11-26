# Shot and demo-link verdicts: concepts/culling

## Shots

### far-from-origin (reference): KEEP, with two caveats

- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-far-from-origin.png (also under compat and webgl2). The manifest builds `demo-<name>` from each demo's default view, so it shows the default view.
- The picture shows the keys and the brass wheel drawn sharp, which supports "What this means for your sketch".
- Caveat 1: the label with the distance from the origin is a page label (`ui.trackLabel` and `page.post`), so the GPU reference does not hold it. Nothing in the picture shows that the scene is 1,000 km out. The caption must say it, for example "2 cm keys 1,000 km from the origin, drawn without jitter".
- Caveat 2: the reference is 320 x 180 pixels. The keys are small at that size. Use it as is, or capture the same default view at a larger size.

### occlusion-on-off (scripted): REJECT as proposed

- The `?stats` overlay does not show `occludedEntries`. That figure comes only from `engine.measure` (packages/engine/src/page/frame-stats.ts). The overlay shows GPU time, draw calls, triangles, objects and the GPU steps (packages/engine/src/debug/stats-text.ts, overlay-look.ts).
- The page says the image with GPU occlusion culling matches the image without it. Two captures of the same street would look the same, and only a timing number would differ. That timing can even go up, which the page itself says. The pair does not show the reader anything that the text does not.
- The steps are incomplete. The comparison page starts a guided walkthrough that runs both engines. It needs `?compare=night-town&engine=null3d&walkthrough=off`. The night-town camera loops, so "the same camera" needs `?hold` or a held frame.
- The comparison already fixes the High preset on WebGPU (examples/lib/compare.ts), so "at the High preset" needs no step.
- Better alternative, if a picture is wanted under "The check during play": one capture of the night-town comparison on WebGPU, with `?compare=night-town&engine=null3d&walkthrough=off&stats=open&occlusion-check=off&hold`. Open the overlay's GPU list, which then shows the occlusion passes' own rows: "occluders", "depth pyramid" and "late cull" (PASS_ROLE_NAMES in packages/engine/src/generated/gpu.ts). That shows the extra GPU passes that the check weighs.

## Demo links

### far-from-origin/ (Culling far from the origin): KEEP, but move it

- The demo has no `code` value, so `far-from-origin/` is right. The folder exists.
- The sketch keeps objects relative to their grid cell and draws positions relative to the camera. That fits "What this means for your sketch".
- The page already links it under "Related pages". Move that link inline under "What this means for your sketch". Do not add a second copy.

### large-world/ (Grid cells over a large world): REJECT at "## Grid cells"

- The demo runs in large-world mode (`largeWorld: true` in examples/demos.ts) and uses batch origins. The page treats that as a separate mechanism and sends readers to the large-worlds page, which already links this demo.
- Under "Grid cells" it suggests that the demo shows plain grid cells. It does not.
- If a link is wanted on this page, put it on the sentence about the `largeWorld` option, in "What this means for your sketch".

### instances/ (Row-by-row culling of a large batch): KEEP, fix the wording

- `instances/` is the demo's `code` value.
- The demo holds 100,000 columns in one dynamic batch. The sketch says the engine "computes, culls and draws the rows in bulk". On WebGPU each row gets its own GPU culling test, and on WebGL2 a dynamic batch is tested row by row.
- Nothing on screen shows the culling. The link text should say what the reader gets: "a dynamic batch of 100,000 rows, each culled on its own".

## Concepts said to have no demo

- GPU occlusion culling: confirmed. No demo sets `gpuOcclusion` or uses the `?occlusion` switch. Every WebGPU demo at High or Ultra on a desktop runs it, but none shows it.
- Software occlusion culling on WebGL2: confirmed. No demo sets `softwareOcclusion`, `occluder: true` or `setOccluder`.
- Blockers from the asset tool: confirmed. No demo loads a model with blockers.
- setBounds and setFrustumCulled: WRONG for setBounds. The vertex-updates demo (`vertex-updates/`) calls `setBounds` on its pool water, because the waves lift the corners past the flat mesh's sphere. That is the page's own water example. The island showcase (`showcase/island/`) also calls `setBounds` on surf that its shader moves, in examples/showcase/island/sea.ts. `setFrustumCulled` has no demo.
