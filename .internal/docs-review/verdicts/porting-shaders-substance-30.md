# porting-shaders-substance-30

## Finding as given

- page: shaders/surface-functions
- anchor: ## Vertex offsets, line 532 'The forest demo's tree material does both from one value.'
- category: missing-content
- severity: low
- claim: The page names a demo without a link, so the reader cannot find it.
- evidence: examples/demos.ts (forest, code 'forest/')
- proposedEdit: 'The [forest demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest/)'s tree material does both from one value.'

Verdict: survives

## Evidence

- docs/shaders/surface-functions.md:532 ends the `swayDistance` bullet with "The forest demo's tree material does both from one value." with no link. stats.json lists no example links for this page (exampleLinks: []), and a search of the page finds no github.com link and no other mention of the forest demo.
- examples/demos.ts:952-955: the demo `forest` exists, with code `forest/`. So the proposed URL fits the website contract.
- The page's claim is true. examples/forest/sketch.ts:22,58,61 builds the tree material with `createSway(ctx, { wind })` and `sway.material(...)`. examples/lib/sway.ts:395,413,426 puts one `swayDistance` value (default SWAY_DISTANCE, line 10) on the material, and the WGSL at line 246 fades the offset to nothing by `material.swayDistance`. So the demo does declare the distance and fade by it from one value.
- Cost to the reader: the sentence points at a worked example but gives no way to reach it. A link fixes this at no cost. Severity low is right.

## Corrected edit

The proposed edit puts "'s" straight after the link, which reads badly in rendered text. Better:

"The tree material of the [forest demo](https://github.com/null3d-engine/null3d/tree/main/examples/forest/) does both from one value."

Note: the link opens the demo's folder, where the sketch calls the shared sway helper. The fade itself lives in examples/lib/sway.ts, which is not a demo code, so the contract allows only the demo-folder link.
