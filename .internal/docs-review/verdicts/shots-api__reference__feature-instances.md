# Shot and demo-link verdicts: api/reference/feature-instances

Shots proposed: none. Demo links proposed: none. Nothing to disprove there.

## Concepts said to have no demo

### ComputeInstances: confirmed, with an indirect demo

No demo sketch calls `scene.addComputeInstances` itself. The grass add-on calls it on WebGPU
(packages/grass/src/grass.ts, when compute is on and the tier is not webgl2). The
vegetation-wind demo (code `vegetation-wind/`) draws 90,000 grass tufts through `createGrass`
with compute on by default, so it shows the result. A reader of an API reference page wants code
that calls the API, and this demo hides the call inside the add-on. Optional link with that
caveat: https://github.com/null3d-engine/null3d/tree/main/examples/vegetation-wind/
The only direct callers are test pages (tests/pages/sketches/feature-instances-*.ts), which are not
demos and cannot be linked under the website contract.

### addFeatureInstances: wrong page

This page does not document `addFeatureInstances`. Its only scene call is `addComputeInstances`.
`addFeatureInstances` lives in packages/engine/src/scene/feature-draws.ts (@category
api/feature-draws) and is documented on api/reference/feature-draws and api/feature-draws.
Drop it from this page's list. For the feature-draws pages: the splats demo (no code value, so
`splats/`) reaches it only through the splats add-on (packages/splats/src/system.ts), not in its
own sketch.
