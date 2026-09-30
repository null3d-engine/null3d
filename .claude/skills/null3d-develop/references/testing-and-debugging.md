# Testing and debugging null3D projects

Engine docs: `guides/testing`, `guides/debugging`, `errors/index`, `cli/null3d`.

## Contents

1. Commands
2. Image tests in hold mode
3. Behavior tests
4. Testing on real devices
5. The MCP server for agents
6. Error codes
7. Troubleshooting table
8. Before you ship

## 1. Commands

| Command | What it does |
| --- | --- |
| `bunx vite` | Dev server; the null3D Vite plugin adds the cross-origin isolation headers and shader hot reload |
| `bunx @null3d/cli shot --out shot.png [--time 2.0] [--size 1280x720] [--gpu webgl2]` | Renders one frame headless and saves it, plus `shot.json` with frame stats and console errors |
| `bunx @null3d/cli test` | Type checks, lint, and all visual and behavior tests, headless |
| `bunx @null3d/cli test --gpu webgpu,webgl2,compat` | Runs visual tests on each GPU tier |
| `bunx @null3d/cli test --update-references` | Rewrites reference images; review the diff before committing |
| `bunx @null3d/cli bench --scene <name>` | Benchmark: 5 runs of 30 seconds after warm-up; median and spread per phase |
| `bunx @null3d/cli doctor` | Checks versions, headers, asset CORS, and the capabilities of the local browser |
| `bunx @null3d/cli docs show <id>` / `bunx @null3d/cli docs search "<words>"` | Prints docs for the installed engine version |

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
- The engine publishes the result as `window.__null3dHold`: `{ ok: true, time, frame, tier, width, height, pixels }`, or `{ ok: false, code, error }` at the first failure. A test runner waits for it, so a page that failed never costs a timeout.
- The first error stops the hold: E1407 for a bad time, and E1408 for an error in `onUpdate` or the core. E1408 gives the sketch time of the error. A live engine would log that error and carry on.
- Keep one reference image per GPU tier, and force the tier with `?gpu=`. Tiers, and software and real GPUs, can differ slightly at edges, so compare with a small tolerance, such as three.js's 0.1%.
- Pixels come back through the engine, never through a canvas screenshot, because some browsers alter canvas reads for privacy.
- When a comparison fails, open the actual image and the diff before deciding whether the code or the reference is wrong.

Keep held frames the same on every run:

- Move things with `time.now` and `dt`, never `Date.now()` or `performance.now()`.
- Draw random numbers from `math.random` or `Math.random`, which hold mode seeds; `crypto.getRandomValues` is not seeded.
- Await every asset in the setup, because the hold starts when the setup resolves.
- Pass test settings in the sketch module's address, such as `new URL('./sketch.ts?view=harbor', import.meta.url)`, and read them from `import.meta.url` in the sketch. Page messages reach the sketch only after the hold.

## 3. Behavior tests

```ts
// tests/pickup.test.ts
import { defineSketchTest } from '@null3d/engine/testing';

export default defineSketchTest({
  name: 'player picks up a coin',
  sketch: () => import('../src/sketch'),
  steps: 120,                                  // fixed steps at 60 Hz
  input: [{ at: 0, down: 'KeyW' }, { at: 60, up: 'KeyW' }],
  assert: ({ scene, messages }) => {
    if (!messages.some((m) => m.type === 'coin')) throw new Error('no coin message');
  },
});
```

Behavior tests run the sketch worker code with scripted input. They check sketch logic and messages to the page, not pixels.

## 4. Testing on real devices

URL switches for the dev server (engine docs `guides/testing`):

| Switch | Effect |
| --- | --- |
| `?gpu=webgpu`, `?gpu=compat`, `?gpu=webgl2` | Force a GPU tier, if the device supports it |
| `?threads=off` | Single-threaded build |
| `?render=main` | Render on the main thread |
| `?uploads=copy` | On WebGL2, copy each upload out of shared memory first, as browsers that refuse shared memory need |
| `?depth=reversed-gl` | On WebGL2, force a depth mode: `reversed`, `reversed-gl` (as in browsers without `EXT_clip_control`, such as Firefox) or `standard` (`concepts/backends`) |
| `?latency=pipelined`, `?latency=low` | Latency mode |
| `?jobs=4` | Start this many job workers, from 1 to 255, instead of the logical cores minus 2 |
| `?memory=2048` | Set the maximum of the memory that worker threads share, in MiB, up to 4096, over the `memory` option of `createEngine`; the default is 1024 |
| `?fps=30` | Hold drawing at this many frames per second, at most the display's rate, to compare runs on displays of different refresh rates |
| `?hold=1.5` | Hold mode: step the sketch to 1.5 seconds, draw that one frame and publish it as `window.__null3dHold`; a bare `?hold` holds at the `hold` option's time, or at 0 |

Reaching the dev server:

- Android phone: connect by USB and run `adb reverse tcp:5173 tcp:5173`; the phone opens `http://localhost:5173`, which counts as a secure context. Plain `http` on a network address does not, and Chrome 154 asks before loading it.
- iPhone or iPad: serve HTTPS with a local certificate through the Vite plugin's `https` option (`getting-started/hosting`). Install the root certificate on the device, and trust it in Settings > General > About > Certificate Trust Settings. Debug from Safari on a Mac through the Develop menu.
- Record the device, browser version, GPU tier and preset with every result; `bunx @null3d/cli doctor --device` prints them.

## 5. The MCP server for agents

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

## 6. Error codes

Every engine error is an `EngineError` with a code, the object's name, what failed, and the fix:

```
E1203: setPosition() got NaN for x on "Player" (slot 12). Check the value computed before this call.
```

Look up the full explanation with `bunx @null3d/cli docs show errors/E1203`. Release builds remove most checks, so reproduce problems in a development build.

## 7. Troubleshooting table

| Symptom | Likely cause | Fix | Docs |
| --- | --- | --- | --- |
| Blank canvas; console mentions `SharedArrayBuffer` or `crossOriginIsolated` | No isolation headers | The null3D Vite plugin, or set COOP `same-origin` and COEP `require-corp` on the host | `getting-started/hosting` |
| Blank canvas; console shows CORS errors for models or textures | Assets from another origin without CORS or CORP headers | Serve them with `Access-Control-Allow-Origin` or `Cross-Origin-Resource-Policy` | `getting-started/hosting` |
| Canvas works, nothing visible | No active camera, camera inside an object, or objects outside near and far | `scene.setActiveCamera`; check positions with `debug.axes`; widen near and far | `api/cameras` |
| An object does not move, or a development build logs E1110 | A static object's values changed without a setter | The setter, or `dynamic: true` | `concepts/static-dynamic` |
| A row of an instance batch does not move | A static batch's row written without `markDirty` | `markDirty(start, count)`, or `dynamic: true` on the batch | `concepts/static-dynamic` |
| Error: stale handle | The object was destroyed earlier | Drop your reference when you destroy; check the frame number in the message | `concepts/handles` |
| Colors too dark or washed out | Texture color space | `'srgb'` for color maps, `'linear'` for data maps | `concepts/color-management` |
| Lighting much brighter or darker than expected | Light units (physical, like three.js r155+) or exposure | Retune intensities; check `post.set({ exposure })` | `concepts/lighting` |
| Shadows missing | Light or object not casting, receiver not receiving, or out of range | `castShadows` on light and caster, `receiveShadows` on the receiver | `concepts/shadows` |
| Shadow acne or peter-panning | Bias | Adjust `shadow.bias` and `normalBias` in small steps | `concepts/shadows` |
| Flicker between overlapping surfaces | Z-fighting | Separate the surfaces; raise the near plane | `api/cameras` |
| Transparent objects in the wrong order | Sorting by object center | `setRenderOrder`; split large transparent meshes | `api/objects` |
| Works on WebGPU, broken on WebGL2 | A feature without a fallback | Check capabilities; test with `?gpu=webgl2` | `concepts/backends` |
| Shader works in Chrome, fails in Safari or Firefox | A WGSL feature or limit they lack | Follow the portable WGSL rules | `shaders/wgsl-rules` |
| A console warning that the browser took the GPU away, then the scene draws again | A driver reset or a GPU crash; the engine started a new device and drew the whole scene again | Nothing, unless it repeats. Test your page's handling with `engine.simulateGpuLoss()` | `api/engine` |
| `engine.onFailure` reports E1302 and the canvas stops changing | The GPU did not come back, or it was lost more than twice within a minute | Destroy the engine, put a new canvas in place of the old one and start again; lower the preset; report reproducible cases | `errors/E1302` |
| Stutter every few seconds | Garbage collection | Remove per-frame allocations | `guides/performance` |
| Hitch when something appears | Pipeline compile | Create earlier; `scene.warmUp()` | `guides/loading-screens` |
| Tab reloads or crashes on a phone | Memory limit | Compressed textures, fewer and smaller assets, destroy unused prefabs | `guides/phones` |
| `document is not defined` or `window is not defined` | DOM code in `sketch.ts` | Move it to `page.ts`; send data with messages | `api/page` |
| `createEngine` rejects with E1410 | The sketch module did not load: a wrong address, or an error that its top-level code threw | Pass `sketch: new URL('./sketch.ts', import.meta.url)`; fix the error that the message quotes | `errors/E1410` |
| Pointer position off by a factor | Mixing CSS pixels and render pixels | `input.pointer.x` and `y` are CSS pixels, like `screenToRay` expects | `api/input` |

## 8. Before you ship

Work through this list before a release, on the production build (`bunx vite build`, then `bunx vite preview`), not the dev server.

Rendering:

- The page renders with `?gpu=webgpu` and with `?gpu=webgl2`, and the console shows no errors and no warnings.
- The image stays right after a window resize, at phone width, and at a pixel ratio of 3.
- On a real phone, a ten-minute run holds its frame rate as the phone warms up (`guides/phones`).
- A scene with more than 2,097,152 objects and instance rows ran on a device with WebGPU's default limits, or stays below that number. The limit of each device is in `engine.capabilities.maxInstances`.

Startup:

- The host sends the isolation headers, and lets browsers keep the hashed files under `assets/` (`getting-started/hosting`).
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
