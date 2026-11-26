# tree-structure-20

## Finding as given

- page: getting-started/first-scene
- anchor: ## Next steps
- category: missing-content
- severity: medium
- claim: There is no step after the first scene. 'Next steps' goes straight to API and concept pages, while a newcomer's next need is a real model, good light and a camera to move, which today takes three pages.
- evidence: first-scene 'Next steps' links api/objects, concepts/static-dynamic, concepts/instances, api/page only.
- proposedEdit: NEW getting-started/model-viewer 'Show a model': load a glTF model, set an environment map, add orbit controls, wait for firstFrame. List it first under 'Next steps', then examples and the deploy checklist.
- generatedSource: tools/lib/docs.ts (PAGES)

Verdict: partly

## Evidence

- The gap in "Next steps" is real. docs/getting-started/first-scene.md:124-129 links only api/objects, concepts/static-dynamic, concepts/instances and api/page. Nothing there points to models, environment light, camera controls, the cookbook, the project templates or the examples.
- "Takes three pages" is overstated. docs/cookbook/index.md:270-302 ("A loading screen for models") is one complete sketch that loads a glTF file with assets.loadGltf, loads an environment with assets.loadEnvironment, calls scene.setEnvironment and scene.setBackground, sets a camera, warms up pipelines, and says the page removes its loading screen when engine.firstFrame resolves. Only orbit controls are missing from it.
- Orbit controls have a short complete sketch at docs/api/controls.md:30-50 (createOrbitControls with target, damping and distance limits).
- docs/getting-started/project-structure.md:28 offers a `product` template (`bunx @null3d/cli create`) with orbit controls, a soft room light, shadows and the Neutral tone curve. That is a ready starting point for a model viewer, and first-scene does not link to it.
- A demo shows a glTF model with the built-in room environment: examples/demos.ts:641-651 (`gltf-model`, no code field, so its link is .../examples/gltf-model/).
- A new tutorial page would repeat the cookbook recipe almost line by line. AGENTS.md "Docs and skills stay in sync" rule 1 asks for one source per fact. A new page also needs a PAGES entry and its own upkeep. Links fix the reader's problem at a much lower cost.

## Corrected claim

"Next steps" on first-scene gives no route to the usual next task: show a real model with good light and a camera the user can move. The parts exist in two places (the cookbook recipe "A loading screen for models" and the orbit controls sketch on api/controls), plus the `product` project template, but first-scene links to none of them.

## Corrected edit

Do not add a new page. Rewrite "Next steps" in docs/getting-started/first-scene.md (a written page, not generated) so the first items answer "what now":

- [Show a model](../cookbook/index.md#a-loading-screen-for-models): load a glTF file and an environment, and wait for the first frame.
- [Orbit controls](../api/controls.md): let the user turn and zoom the camera.
- [Lighting and environment](../concepts/lighting.md): light types, environment maps and fog.
- [Project structure](project-structure.md): start from the `product` template, which has orbit controls and soft studio light.
- [glTF model example](https://github.com/null3d-engine/null3d/tree/main/examples/gltf-model/): a full sketch that shows a model on a turntable.
- Keep the four current links after these.

Optional: add the orbit controls lines (createOrbitControls and controls.update(dt)) to the cookbook recipe, so one sketch shows a model, light and a moving camera together.
