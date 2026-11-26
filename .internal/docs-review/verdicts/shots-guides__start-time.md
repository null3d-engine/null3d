# Verdicts: guides/start-time (screenshots and demo links)

## Shots

### network-protocol-size (manual): KEEP, source corrected
Developer-tools capture, so "manual" is the right source type. It helps: the page tells the reader to compare the core's transferred size with its size and to read the Protocol column, and a picture shows where both are.
The source has no page and no setup. The alt text promises `h2`, but the plugin serves HTTP/1.1 by default in `vite` and `vite preview`. A capture with the defaults shows `http/1.1`.
Corrected source: production build of the demos served by `vite preview` with the null3D Vite plugin's `http2: true` option (or a deployed host that speaks HTTP/2). Open any demo, for example `examples/index.html?demo=character`. In DevTools Network: Disable cache, Slow 4G, show the Protocol and Size columns, filter on `wasm`, reload. The row for `null3d_bg-<hash>.wasm` shows `h2` and about 0.6 MB transferred against 2.0 MB.

### waterfall-gaps (manual): DROP as proposed
The "before" half cannot be made. The current character sketch already starts its sky light map and its Knight together (`Promise.all` of `assets.skyEnvironment()` and `assets.loadGltf`). No demo keeps the old one-after-the-other order, so the gap picture needs code that does not exist. The page's own measured gain on this demo is small (8.55 s to 8.2 s), and the light map's download is only its 12 KB maker code, so even an "after" waterfall shows little.
If a picture is wanted: capture two copies of the page's own statue-and-sky example sketch (one that awaits each load in turn, one that starts both first) on Slow 4G. That is a throwaway sketch, not a demo, so it is not reproducible from the repository. Better to leave this section without a picture.

### creek-first-frame (scripted): KEEP, steps corrected
The picture helps: it shows what "draw the first frame before the large models" means (the cliff, water, clouds and steps first; statue, gate, lanterns, boulders and plants later). The creek sketch does this (`examples/showcase/creek/sketch.ts`, setup around lines 319-445: `firstFrame.then(() => loadGarden(ctx))` and `firstFrame.then(() => loadPlants(ctx))`).
Problems with the given steps:
- "Capture the live page at engine.firstFrame" is not a step a script can take as written. The demo page exposes the engine only with the `?bench` switch (`window.__null3dEngine`). On a local server the models land a few frames after the first frame, so the capture races them.
- "engine.held true" is not something a caller sets. Hold mode (`?hold`) or the creek's `?grown` switch gives the finished scene.
- The existing reference `tests/image/references/chrome-real-gpu/webgpu/demo-creek.png` shows the finished garden, but it is only 320x180, too small for a docs picture, and it is a held frame at 0.5 s on the camera route.
Corrected steps: (1) Open `examples/index.html?demo=creek&bench` from a production build. Stall every request for the garden and plant model files (`.../creek-garden/*.glb` and the plant files) with a script route that does not answer. Await `window.__null3dEngine.firstFrame`, then capture the canvas. (2) Open `examples/index.html?demo=creek&bench&grown` at the same canvas size, await `firstFrame`, and capture at once, so the camera route is at the same opening pose. Put the two side by side.

## Demo links

- showcase/creek/ (first frame before the large models): KEEP. Code exists in demos.ts. The sketch starts the garden and plant downloads from `ctx.engine.firstFrame` on a live page, and waits for them in hold mode, a replay and `?grown`, as the page's code sample does.
- showcase/island/ (stored pipeline list on phones): DROP. Code exists, but the stored list is automatic engine behavior in every demo. The island sketch has no code about it, and nothing on screen shows it. A reader who opens the link learns nothing about the list. The island is only the demo that the page's figures come from.
- splats/ (scan that streams after the first frame): KEEP. Code `splats/` (no code field, so the name). The sketch awaits `splats.ready` (nearest chunks) and streams the rest behind its frames; `?grown` and held frames await `splats.settle()`. Place it beside the paragraph on streaming content.
- character/ (first view's downloads started together): KEEP, with a note. Code `character/` (no code field). The sketch starts the sky light map and the Knight model together with `Promise.all`, with no `await` before them. But it builds the courtyard first and starts the loads near the end of the setup, not on its first lines, so the link text should say "two loads started together", not "downloads at the top of the setup".

## Concepts said to have no demo

All four confirmed. No demo shows them:
- The early core script: added by the Vite plugin to every production page; no demo code shows it.
- Compression and cache headers: host settings; no demo.
- HTTP/2 on the host: set in the examples' build config, not in any demo.
- A service worker registered after the first frame: no demo or example registers a service worker.
