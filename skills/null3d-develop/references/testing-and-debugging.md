# Testing and debugging null3D projects

Engine docs: `guides/testing`, `guides/debugging`, `errors/index`, `cli/null3d`.

## Contents

1. Commands
2. Image tests in hold mode
3. Behavior tests
4. Testing on real devices
5. Debugging tools
6. The MCP server for agents (0.3)
7. Error codes
8. Troubleshooting table
9. Before you ship

## 1. Commands

| Command | What it does |
| --- | --- |
| `bunx vite` | Dev server; the null3D Vite plugin adds the cross-origin isolation headers and compiles WGSL. Editing a shader reloads the page; hot reload comes in 0.2 |
| `bunx @null3d/cli shot --out shot.png [--time 2.0] [--size 1280x720] [--gpu webgl2] [--page /other.html]` | Draws one held frame of the page headless and saves it, plus `shot.json` with the frame's time, number and GPU tier and the page's errors and warnings. When no frame is drawn, it says why and exits with 1 |
| `bunx @null3d/cli test` | Type checks with the project's TypeScript, runs its `lint` script, and draws each image test in `null3d.json` headless on each of its tiers, against its reference. Prints one line per result with the image files, and exits with 1 when one fails |
| `bunx @null3d/cli test --gpu webgpu,webgl2` | Draws the image tests on these GPU tiers only |
| `bunx @null3d/cli test --update-references` | Keeps each new or changed image as its reference; check the images before committing them |
| `bunx @null3d/cli bench [--gpu webgpu,webgl2] [--page /other.html]` | Builds the project for production and measures the page headless: 5 fresh runs of 30 seconds, each after 5 seconds of warm-up. Prints the median and the spread of CPU time per frame by thread, GPU time and frame rates, and saves every run's figures in `bench.json` |
| `bunx @null3d/cli bench --runs 3 --seconds 10 --warmup 5 --size 390x844` | Measures with fewer or shorter runs, or in another window size in CSS pixels. Compare only runs made with the same options on the same computer |
| `bunx @null3d/cli doctor` (0.3) | Checks versions, headers, asset CORS, and the capabilities of the local browser |
| `bunx @null3d/cli docs show <id>` / `bunx @null3d/cli docs search "<words>"` (0.3) | Prints docs for the installed engine version |

The `shot`, `test` and `bench` commands are built, and `test` runs image tests only. Until `docs show` comes, read the docs in `node_modules/@null3d/engine/docs/` (SKILL.md section 1).

Every command prints short text results (pass or fail, reasons, file paths), so you can read them directly. Open the image files it names when a visual check fails.

## 2. Image tests in hold mode

Hold mode draws one frame at a set sketch time, the same frame on every run (`guides/testing`).

```ts
// page.ts
const engine = await createEngine({
  canvas,
  sketch: new URL('./sketch.ts', import.meta.url),
  hold: 1.5, // seconds of sketch time; ?hold=1.5 in the page address does the same
});
const { width, height, pixels } = await engine.captureFrame(); // the held frame, RGBA8, top row first
```

- The engine seeds `math.random` in the sketch's thread, makes `Math.random` draw from it, and runs the setup. It steps the sketch from time 0 to the held time in fixed steps of 1/60 second, with no frame loop. Then it draws that one frame and reads it back through the engine.
- `createEngine` resolves once the frame is read back. `engine.mode.hold` holds the time, or `null` in a live engine. A bare `?hold` holds at the `hold` option's time, or at 0.
- The engine publishes the result as `window.__null3dHold`: `{ ok: true, time, frame, tier, width, height, pixels, stats }`, or `{ ok: false, code, error }` at the first failure. `stats` holds the held frame's figures in the form that `engine.measure()` returns. A test runner waits for it, so a page that failed never costs a timeout.
- The first error stops the hold: E1407 for a bad time, and E1408 for an error in `onUpdate` or the core. E1408 gives the sketch time of the error. A live engine would log that error and carry on.
- Keep one reference image per GPU tier, and force the tier with `?gpu=`. Tiers, and software and real GPUs, can differ slightly at edges, so compare with a small tolerance, such as three.js's 0.1%.
- Pixels come back through the engine, never through a canvas screenshot, because some browsers alter canvas reads for privacy.
- When a comparison fails, open the actual image and the diff before deciding whether the code or the reference is wrong.
- Hold mode has no frame-budget governor. The held frame draws at the highest render scale, with the quality settings as set. So the image does not depend on how fast the computer is.

Keep held frames the same on every run:

- Move things with `time.now` and `dt` (also `time.dt`), or in `onFixedUpdate`, never `Date.now()` or `performance.now()`. Every hold runs the same fixed steps.
- Draw random numbers from `math.random` or `Math.random`, which hold mode seeds; `crypto.getRandomValues` is not seeded.
- Await every asset in the setup, because the hold starts when the setup resolves.
- Pass test settings in the sketch module's address, such as `new URL('./sketch.ts?view=harbor', import.meta.url)`, and read them from `import.meta.url` in the sketch. Page messages reach the sketch only after the hold.

List the image tests that `bunx @null3d/cli test` runs in `null3d.json` in the project's folder (engine docs `cli/null3d`):

```json
{
  "tests": [
    { "name": "start", "sketch": "sketch.ts", "hold": 1.5 },
    { "name": "harbor", "sketch": "sketch.ts?view=harbor", "hold": 4, "size": "640x360", "tiers": ["webgpu", "webgl2"] }
  ]
}
```

- A test gives a `sketch` module, or a `page` to open when the page's `createEngine` options change the image. The size is 320 x 180 pixels, and the tiers are all three, unless the test gives others.
- References live in `tests/references/<environment>/<tier>/<name>.png`. Commit them. Each run saves its images, and a diff for each failure, in `test-results/null3d/`.
- A new test fails until it has a reference. Open its image, and keep it with `--update-references` only when it shows what you meant to draw.

## 3. Behavior tests

The engine has no runner yet for sketch logic with scripted input. Until it does, test logic in two ways:

- Keep game rules in plain modules that take numbers and arrays and import nothing from the engine, and test them with `bun test`. The sketch calls them from `onUpdate` or `onFixedUpdate`.
- Put a scene into a state for an image test through the sketch module's address, such as `sketch.ts?score=90`, and check the held frame. Hold mode gives the sketch no input.

## 4. Testing on real devices

URL switches for the dev server (engine docs `guides/testing`):

| Switch | Effect |
| --- | --- |
| `?gpu=webgpu`, `?gpu=compat`, `?gpu=webgl2` | Force a GPU tier, if the device supports it |
| `?threads=off` | Single-threaded build |
| `?render=main` | Render on the main thread |
| `?display-check=off` | Where the main thread draws, stop the two frame callbacks that draw nothing now and then to measure the display's refresh rate while the frames run slower than it, to measure their cost (`guides/testing`) |
| `?sketch-thread=main` | Run the sketch on the main thread, over the `sketchThread` option |
| `?uploads=copy` | On WebGL2, copy each upload out of shared memory first, as browsers that refuse shared memory need |
| `?compile=wait` | On WebGL2, wait for each shader program's compile at its first draw, as browsers without `KHR_parallel_shader_compile` do |
| `?shaders=fresh` | Make the browser compile every shader again, as on a first visit, to time a cold warm-up |
| `?check=fresh` | Measure the quality preset again, as on a first visit, instead of taking the preset check's stored result (`concepts/quality-presets`) |
| `?compression=bc`, `?compression=astc,etc2`, `?compression=none` | Keep KTX2 textures to the compressed formats that the list names, as on a device with only those. `none` uploads them uncompressed (`api/textures`) |
| `?wake=message` | Make the worker threads wake each other with messages, as browsers without `Atomics.waitAsync` do, such as Firefox before 145 |
| `?hdr=off` | Take the 8-bit color path, where the scene shaders tone map themselves, as devices without float color targets do (`concepts/backends`) |
| `?depth=reversed-gl` | On WebGL2, force a depth mode: `reversed`, `reversed-gl` (as in browsers without `EXT_clip_control`, such as Firefox) or `standard` (`concepts/backends`) |
| `?latency=pipelined`, `?latency=low` | Latency mode |
| `?prepass=on`, `?prepass=off` | Turn the depth prepass on or off over the `depthPrepass` option, to compare GPU time (`concepts/quality-presets`) |
| `?cells=off` | Cull every object, with no grid cell out of view skipped first, to measure what skipping cells saves (`concepts/culling`) |
| `?skinning=vertex` | On WebGPU, skin in the vertex shader of each pass instead of once per frame in a compute pass, to compare GPU time (`api/animation`) |
| `?half=on`, `?half=off` | Do the scene shaders' color math at half precision, or at full precision; WebGPU needs the device feature `shader-f16`, and `engine.capabilities.halfPrecision` says which one the engine took (`guides/testing`) |
| `?preset=low`, `?preset=medium`, `?preset=high`, `?preset=ultra` | Fix the quality preset, within the GPU path's highest (`concepts/quality-presets`) |
| `?jobs=4` | Start this many job workers, from 1 to 255, instead of the logical cores minus 2 |
| `?memory=2048` | Set the maximum of the memory that worker threads share, in MiB, up to 4096, over the `memory` option of `createEngine`; the default is 1024 |
| `?fps=30` | Hold drawing at this many frames per second, at most the display's rate, to compare runs on displays of different refresh rates |
| `?queue=3` | Let this many frames wait unfinished on the GPU instead of 2; `?queue=off` sets no limit, as browsers do on their own (`guides/performance`) |
| `?hold=1.5` | Hold mode: step the sketch to 1.5 seconds, draw that one frame and publish it as `window.__null3dHold`; a bare `?hold` holds at the `hold` option's time, or at 0 |
| `?bench` | Publish the running engine as `window.__null3dEngine`, where a benchmark tool calls `measure`; `bunx @null3d/cli bench` adds it |

Reaching the dev server:

- Android phone: connect by USB and run `adb reverse tcp:5173 tcp:5173`; the phone opens `http://localhost:5173`, which counts as a secure context. Plain `http` on a network address does not, and Chrome 154 asks before loading it.
- iPhone or iPad: serve HTTPS with a local certificate through the Vite plugin's `https` option (`getting-started/hosting`). Install the root certificate on the device, and trust it in Settings > General > About > Certificate Trust Settings. Debug from Safari on a Mac through the Develop menu.
- Record the device, browser version, GPU tier and preset with every result: `engine.capabilities.tier` and `engine.mode.preset` give the last two. `bunx @null3d/cli doctor --device` (0.3) will print them all.

## 5. Debugging tools

Engine docs: `api/debug`, `guides/debugging`.

| Tool | Shows | Builds |
| --- | --- | --- |
| `debug.stats(true)` in the sketch | An overlay over the canvas with the GPU path, the preset, the render scale, the frame rates and the CPU time per thread and phase | Every build |
| `debug.frameStats()` | The overlay's figures for the sketch, as means over about half a second. It allocates nothing, so read it every frame if you need to | Every build |
| `await engine.measure(5)` on the page | Every figure of section 3 of `references/performance.md`: CPU, GPU, frame rates, uploads, rebuilds, pipelines, memory | Every build |
| `debug.view('normals')`, `'depth'`, `'wireframe'`, `'overdraw'`; `'lit'` to go back | The whole scene with one debug shading in place of every material. Views ignore maps, alpha and custom shaders | Development only |
| `debug.line`, `box`, `sphere`, `arrow`, `axes`, `grid`, `frustum`, `light` | Lines for one frame, so call them in `onUpdate` in every frame that needs them | Development only |
| `debug.skeleton` (0.2) | The bones of a skinned mesh | Development only |

In a production build, the debug drawing calls and `debug.view` do nothing, but the code that computes their arguments still runs. Wrap work that only feeds them in `if (import.meta.env.DEV)`. A debug view's first frame builds its pipelines, so objects can be missing for a few frames after a change.

## 6. The MCP server for agents (0.3)

`bunx @null3d/cli mcp` starts a Model Context Protocol server connected to the running dev session. Its tool names can change until `guides/agents` is stable:

| Tool | Use |
| --- | --- |
| `null3d_list_objects` | Names, handles, types, static or dynamic, layers |
| `null3d_get_object` / `null3d_set_transform` / `null3d_set_material` | Inspect and adjust objects live |
| `null3d_capture` | A PNG of the current frame |
| `null3d_stats` | Frame phases, buckets, uploads, memory, tier, preset |
| `null3d_errors` | Recent engine errors and console output |
| `null3d_render_graph` | The compiled render graph as DOT text |
| `null3d_set_quality` / `null3d_set_gpu` | Switch preset or GPU tier (tier changes reload the page) |

Live changes through the MCP server are for exploring; put the final values into code and tests.

## 7. Error codes

Every engine error is an `EngineError` with a code, the object's name, what failed, and the fix:

```
E1203: setPosition() got NaN for x on "Player" (slot 12). Check the value computed before this call.
```

Each code has a docs page, such as `errors/E1203`, with the full explanation. Release builds remove most checks, so reproduce problems in a development build.

## 8. Troubleshooting table

| Symptom | Likely cause | Fix | Docs |
| --- | --- | --- | --- |
| Blank canvas; console mentions `SharedArrayBuffer` or `crossOriginIsolated` | No isolation headers | The null3D Vite plugin, or set COOP `same-origin` and COEP `require-corp` on the host | `getting-started/hosting` |
| Blank canvas; console shows CORS errors for models or textures | Assets from another origin without CORS or CORP headers | Serve them with `Access-Control-Allow-Origin` or `Cross-Origin-Resource-Policy` | `getting-started/hosting` |
| E1422 or E1423 at the start, with the build's files on a CDN | The policy lacks `blob:` in `worker-src` or the CDN in `connect-src`, or the CDN sends no CORS header | Add the policy items and `Access-Control-Allow-Origin` on every build file; `Cross-Origin-Resource-Policy` alone does not serve | `getting-started/hosting` |
| Canvas works, nothing visible | No active camera, camera inside an object, or objects outside near and far | `scene.setActiveCamera`; check positions with `debug.axes`; widen near and far | `api/cameras` |
| Objects draw black | No light reaches them: standard materials need a directional or ambient light | `scene.createDirectionalLight` and `scene.createAmbientLight`; check that the lights share a layer with the camera | `api/lights` |
| An object does not move, or a development build logs E1110 | A static object's values changed without a setter | The setter, or `dynamic: true` | `concepts/static-dynamic` |
| A row of an instance batch does not move | A static batch's row written without `markDirty` | `markDirty(start, count)`, or `dynamic: true` on the batch | `concepts/static-dynamic` |
| Error: stale handle | The object was destroyed earlier | Drop your reference when you destroy; check the frame number in the message | `concepts/handles` |
| Colors too dark or washed out | Texture color space | `'srgb'` for color maps, `'linear'` for data maps | `concepts/color-management` |
| Lighting much brighter or darker than expected | Light units (physical, like three.js r155+) or exposure | Retune intensities; check `post.set({ exposure })` | `concepts/lighting` |
| The background differs from the page's CSS color | Exposure and tone mapping change the background too | `post.set({ toneMapping: 'none' })`, or `createEngine({ transparent: true })` over a CSS background | `concepts/color-management` |
| Shadows missing | A light or object not casting, a receiver not receiving, or out of range; a spot or point light without a tile, past the preset's `shadowTiles`; point lights on a preset without `pointLightShadows` | `castShadows` on light and caster, `receiveShadows` on the receiver, `shadowTiles`, `pointLightShadows` | `concepts/shadows` |
| Shadow acne or peter-panning | Bias | Adjust `shadow.bias` and `normalBias` in small steps | `concepts/shadows` |
| Flicker between overlapping surfaces | Z-fighting | Separate the surfaces; raise the near plane | `api/cameras` |
| Blended objects in the wrong order | Sorting by the center of each object's bounds; surfaces that cross have no right order | `setRenderOrder`; split large blended meshes; `depthWrite: false` on surfaces that cross | `concepts/materials` |
| Works on WebGPU, broken on WebGL2 | A feature without a fallback | Check capabilities; test with `?gpu=webgl2` | `concepts/backends` |
| Shader works in Chrome, fails in Safari or Firefox | A WGSL feature or limit they lack | Follow the portable WGSL rules | `shaders/wgsl-rules` |
| A console warning that the browser took the GPU away, then the scene draws again | A driver reset or a GPU crash; the engine started a new device and drew the whole scene again | Nothing, unless it repeats. `gpuLosses` in `engine.measure()` counts them. Test your page's handling with `engine.simulateGpuLoss()` | `api/engine` |
| `engine.onFailure` reports E1302 and the canvas stops changing | The GPU did not come back, or it was lost more than twice within a minute | Destroy the engine, put a new canvas in place of the old one and start again; lower the preset; report reproducible cases | `errors/E1302` |
| Stutter every few seconds | Garbage collection | Remove per-frame allocations | `guides/performance` |
| Something appears late, or a hitch when it appears | Its pipeline was building | Create it hidden, `await scene.warmUp()`, then show it | `guides/loading-screens` |
| Tab reloads or crashes on a phone | Memory limit | Fewer and smaller assets, and textures destroyed when unused. The next start runs one preset lower (`engine.mode.crashedStarts`) | `guides/phones` |
| `document is not defined` or `window is not defined` | DOM code in `sketch.ts` | Move it to `page.ts`; send data with messages. A DOM-heavy app can run the sketch on the main thread with `sketchThread: 'main'` | `api/page`, `concepts/architecture` |
| `assets.loadGltf` rejects with E1416, or `loadTexture` with E1412, on a file that users upload | The file is broken, or passes a limit on what one file may decode to. Loaders check each file's limits before they allocate (0.2) | Catch the error and tell the user; check the file in the Khronos glTF Validator; split a model that is too large | `concepts/assets` |
| `createEngine` rejects with E1410 | The sketch module did not load: a wrong address, or an error that its top-level code threw | Pass `sketch: new URL('./sketch.ts', import.meta.url)`; fix the error that the message quotes | `errors/E1410` |
| Pointer position off by a factor | Mixing CSS pixels and render pixels | `input.pointer.x` and `y` are CSS pixels, as `ctx.engine.viewport` gives the canvas size | `api/input` |

## 9. Before you ship

Work through this list before a release, on the production build (`bunx vite build`, then `bunx vite preview`), not the dev server.

Rendering:

- The page renders with `?gpu=webgpu` and with `?gpu=webgl2`, and the console shows no errors and no warnings.
- The image stays right after a window resize, at phone width, and at a pixel ratio of 3.
- On a real phone, a ten-minute run holds its frame rate as the phone warms up (`guides/phones`).
- A scene with more than 1,048,576 objects and instance rows ran on the smallest devices your users have, on both GPU paths. On WebGPU every device draws 2,097,152. On WebGL2 a device whose textures reach only 2,048 pixels draws 1,048,576. The limit of each device is in `engine.capabilities.maxInstances`.

Startup:

- The host sends the isolation headers, and lets browsers keep the hashed files under `assets/` (`getting-started/hosting`).
- With the build's files on a CDN, the CDN sends `Access-Control-Allow-Origin` on every file, and the page's policy allows `blob:` workers and the CDN (`getting-started/hosting`). The engine needs no `'unsafe-eval'`.
- A cold load on Chrome's Slow 4G profile, with the cache off, reaches `engine.firstFrame` in a time you accept. The loading screen stays up until then.
- `engine.measure(5)` reports no long tasks on the page's thread (`mainThread`) while the engine starts.

Lifetime:

- In a single-page app, leaving the view and coming back uses `engine.detach()` and `engine.attach()`. After `attach`, `measure` reports `rebuilds` and `pipelines` at zero.
- Leaving the page during the start cancels it through the `signal` option, with no error in the console.
- After `destroy`, a new engine starts cleanly, and the page's memory falls back.

Failures:

- The page says something useful with JavaScript off, and when the start fails. Point `sketch` at a missing file to force a failure.
- The page handles `engine.onFailure`. Try it with `engine.simulateGpuLoss()`: the scene comes back on a new device.
- A batch too large for engine memory fails with E1109 in development, not on the user's phone. Size batches for the rows they use.

Accessibility:

- The canvas's markup matches its purpose, keyboard users can do what pointer users can, and decorative motion stops under reduced motion (`guides/accessibility`).
- A scene that moves on its own for longer than five seconds has a pause control.

For a product or marketing page, also work through the checks in `references/content-pages.md`.
