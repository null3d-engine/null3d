# Verdicts: screenshots and demo links for concepts/render-graph

## Shots

### graph-dump: keep, with corrected steps

The picture helps. "The text dump" tells the reader to paste the text into a Graphviz viewer. A picture of the result shows what they will get.

The steps are wrong. The post-effects demo never calls `render.dumpGraph()`, and it has no switch that prints the graph. A development build publishes an inspection bridge on the page (`window.__null3dInspector`, in `packages/engine/src/page/engine.ts`). Its `graph` call returns the dump (`packages/engine/src/debug/channel.ts`). The CLI's MCP server has the same call as its `render_graph` tool.

The post-effects demo is also a poor choice. It turns on bloom, ambient occlusion, reflections, an outline, depth of field and more. Its graph has dozens of passes, and a left-to-right Graphviz layout of them is too wide to read at docs width. The security-camera demo is smaller. It also shows a sketch's scene pass and its copy pass, which the page describes.

Corrected steps:
1. Run the security-camera demo (`examples/security-camera/`) in a development build, on WebGPU, on a device that draws HDR color. The page's own sample dump uses this setup.
2. In the browser console, run `(await __null3dInspector.inspect('graph')).graph`.
3. Render the text with `dot -Tsvg`, then export it as `docs/images/concepts/render-graph/graph-dump.webp`.

If the post-effects demo stays, crop the picture to the core passes.

### motion-view: drop

The source is mislabeled. "Use webgpu/motion-vectors.png" names a reference image, not scripted steps. The file exists at `tests/image/references/chrome-real-gpu/webgpu/motion-vectors.png`. It comes from the image test `motion-vectors`, whose sketch calls `debug.view('motion')`, so it does show the motion view.

The image itself does not help a reader. It is 320 x 180 pixels and almost black. Brightness reaches full only at 16 pixels of motion per frame, and the motion in this scene is much smaller. A reader sees a dark rectangle with one dim red box. The section explains the vectors well in text.

If a picture is still wanted, it must be a scripted capture at a larger size, with motion fast enough to show color. The slide case of the same sketch (`?case=slide`) moves a box 8 pixels per frame. That is still only half brightness.

### devtools-webgpu-passes: drop

A "manual" shot is for the browser's own developer tools. Chrome's developer tools cannot inspect WebGPU render passes or their load and store operations. To capture one, you need an outside tool or extension. The page cannot rely on that.

The dump already shows what the shot would show. Each render-pass cluster lists its targets with their load and store, for example "sceneColor: clear, discard, resolve". The graph-dump shot covers this, so the "Phone GPUs" section can refer to it.

## Demo links

- `security-camera/`, a sketch's scene pass into a texture: keep. The code exists in `demos.ts`. Its sketch calls `render.addPass({ kind: 'scene', ... })` and shows the pass's texture on a monitor. The page already links this demo under "Related pages". Move that link up to "The engine's passes" so it does not appear twice.
- `multiple-views/`, views from `scene.createView`: keep. The demo has no `code` field, so its code is its name plus a slash, and the folder exists. Its sketch calls `scene.createView` for a split layout and an inset.
- `post-effects/`, the text dump: drop. The demo never calls `render.dumpGraph()` and has nothing about the dump. A reader who follows the link finds nothing about the dump. No demo calls it. The only caller is a test sketch (`tests/pages/sketches/wind-field-cost-sketch.ts`).

## Concepts said to have no demo

- Compute passes that a sketch adds: confirmed. No demo or comparison calls `render.addPass({ kind: 'compute' })`. Only test sketches do: `compute-pass`, `feature-instances-compute` and `crowded-read`.
- Switching passes on and off: confirmed. No demo shows it. The weather add-on (`examples/addons/weather/index.ts`) calls `render.setPassEnabled` so that its mirror pass draws every second frame on the low and medium presets. Its only user with a mirror pass is the night-town comparison (`compare/night-town/`). That comparison sets the pass to draw in every frame, so the pass never switches off. The add-on code is a useful code sample, but it is not a demo.
- The graph's errors: confirmed. No demo raises E1502 to E1505. Only test pages do.
