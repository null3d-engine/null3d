# porting-shaders-substance-10

## The finding as given

- Pages: porting/threejs-overview, porting/verification, porting/threejs-shaders, porting/threejs-postprocessing, porting/threejs-materials, porting/threejs-loop-and-threads, porting/react-three-fiber, porting/threejs-unsupported
- Anchor: whole pages (stats.json exampleLinks is empty for every page)
- Category: missing-content. Severity: medium.
- Claim: Three scenes run in both three.js and null3D from one description (battle, factory, night-town), with reference images of both. They are the best worked example of a port, of image parity and of timing both engines, and no porting page links them or any demo.
- Evidence: examples/compare/comparisons.ts:99,169,237; tests/image/references/chrome-real-gpu/webgpu/compare-night-town-threejs.png and compare-night-town-null3d.png
- Proposed edit: Overview "What gets faster" and verification "Compare performance": "Three scenes run in both engines from one description: [battle](https://github.com/null3d-engine/null3d/tree/main/examples/compare/battle/), [factory](https://github.com/null3d-engine/null3d/tree/main/examples/compare/factory/) and [night town](https://github.com/null3d-engine/null3d/tree/main/examples/compare/night-town/)." Shaders "onBeforeCompile patches": link battle (sway in WGSL vs GLSL added to MeshStandardMaterial). Other links per page as listed in shotsAndDemos.

Verdict: partly

## Evidence

- The gap is real. stats.json gives an empty exampleLinks list for every porting page. A search of docs/porting/*.md finds no link to examples/compare or to any demo. Other docs pages (concepts/shadows, guides/testing and more) do link examples, so the porting area is the odd one out.
- The three scenes exist: examples/compare/comparisons.ts:99 (code 'compare/battle/'), :169 ('compare/factory/'), :237 ('compare/night-town/'). The proposed URLs match the website contract for comparison code values.
- comparisons.ts:1-3: each comparison is scene.ts (one engine-neutral description, no engine imports), sketch.ts (null3D half) and three.ts (three.js half). So "from one description" is correct.
- Reference images of both halves exist for each scene, in both the webgpu and webgl2 tier folders (compare-<scene>-null3d.png and compare-<scene>-threejs.png).
- Battle does show the shader port the finding names: comparisons.ts note "Grass and flags sway ... WGSL surface and vertex functions in null3D, GLSL added to MeshStandardMaterial"; examples/compare/battle/three-shaders.ts:340,388,440,456 use onBeforeCompile.

## What does not hold

- "The best worked example of a port" overstates it. The scenes are not a three.js app converted to null3D. Both halves are written from a shared, engine-neutral scene description. They show matched output and timing, not the port steps (the overview's workflow). The link text must say "the same scene in both engines", not "a worked port".
- Timing caveat: by default the three.js half runs in a worker of its own (comparisons.ts:1-3 and the threeOnPage option at :28-31), unlike a usual three.js app on the main thread. A link from verification "Compare performance" must say so, or a reader will copy a setup that differs from their own app.
- Placement on the shaders page: the page already has a worked example "Wind sway from onBeforeCompile" (threejs-shaders.md:228). The battle link fits there better than in the mapping table section "onBeforeCompile patches" (:123).
- "Other links per page as listed in shotsAndDemos" names no target and no text. Only the three named placements can be checked and stand.

## Corrected claim

No porting page links any example. Three comparison scenes (battle, factory, night town) draw one engine-neutral scene description in both three.js and null3D, with reference images of both. They are a useful side-by-side of matched output, custom shaders and timing, though not a step-by-step port, and the three.js half runs in a worker by default.

## Corrected edit

- Overview, end of "What gets faster": "To see the same scene in both engines side by side, open the comparison scenes: [battle](https://github.com/null3d-engine/null3d/tree/main/examples/compare/battle/), [factory](https://github.com/null3d-engine/null3d/tree/main/examples/compare/factory/) and [night town](https://github.com/null3d-engine/null3d/tree/main/examples/compare/night-town/). Each draws one shared scene description with each engine."
- Verification, "Compare performance": the same three links, plus one sentence: "Their three.js half runs in a worker of its own by default, not on the page's main thread."
- Shaders, under "Wind sway from onBeforeCompile" (not the table section): "The [battle comparison](https://github.com/null3d-engine/null3d/tree/main/examples/compare/battle/) sways grass and flags both ways: WGSL vertex functions in null3D, and GLSL added to MeshStandardMaterial with onBeforeCompile in three.js."
- Drop the unspecified "other links per page".
