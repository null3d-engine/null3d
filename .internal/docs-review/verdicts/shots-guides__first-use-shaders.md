# Shot and demo-link verdicts: guides/first-use-shaders

## Shot: first-use-network (manual)

Verdict: keep, with a corrected demo and steps.

- A manual shot is right here. The picture is of the browser's own network panel, which no reference image or script can make.
- The picture helps. The page is one table, and a reader cannot see the download it describes. One network row that appears after an action makes "downloads on first use" concrete.
- The named demo is wrong for the point. The post-effects demo turns bloom, ambient occlusion and depth of field on in its setup (examples/post-effects/sketch.ts, the first post.set call). Their shader files download together with the start files, before the first frame. The panel then shows no separate "first use" moment.
- Better demo: showroom (code `showroom/`). Its camera helper (examples/lib/cinematic.ts) calls scene.pick on a double press, and the focus switch is on by default. The pick shaders (`[first_use.picking]` in crates/null3d-shaders/shaders.toml) download only then. Pointer events do not load them: they cast a ray on the CPU (packages/engine/src/scene/pointer-events.ts).
- The picking demo does not work for this. It only uses pointer events and never calls scene.pick.

Corrected steps:
1. Open the showroom demo in Chrome on the WebGPU path. Open DevTools, Network panel, and type `shaders-` in the filter box.
2. Wait for the first frame. The start's shader files are listed.
3. Clear the list, then double-click the car.
4. One new row appears: the pick shaders' module, `shaders-picking-wgsl` (`-glsl` on WebGL2). A production build adds a hash to the name.
5. Take the shot with that one row selected.

Alt text stays: "The network panel shows a shader file that downloads on first use."

## Demo links

None proposed. Nothing to check.

## Concepts without a demo

- preload (createEngine's `preload` option): confirmed. No demo or comparison passes it. The examples page starts every demo. The showcases call `assets.preload`, which downloads files, not shader features.
