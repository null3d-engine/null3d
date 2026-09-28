# Testing and debugging sokko3d projects

Engine docs: `guides/testing`, `guides/debugging`, `errors/index`, `cli/sokko3d`.

## Contents

1. Commands
2. Image tests in hold mode
3. Behavior tests
4. Testing on real devices
5. The MCP server for agents
6. Error codes
7. Troubleshooting table

## 1. Commands

| Command | What it does |
| --- | --- |
| `npx sokko3d dev` | Dev server with cross-origin isolation headers and shader hot reload |
| `npx sokko3d shot --out shot.png [--time 2.0] [--size 1280x720] [--gpu webgl2]` | Renders one frame headless and saves it, plus `shot.json` with frame stats and console errors |
| `npx sokko3d test` | Type checks, lint, and all visual and behavior tests, headless |
| `npx sokko3d test --gpu webgpu,webgl2,compat` | Runs visual tests on each GPU tier |
| `npx sokko3d test --update-references` | Rewrites reference images; review the diff before committing |
| `npx sokko3d bench --scene <name>` | Benchmark: 5 runs of 30 seconds after warm-up; median and spread per phase |
| `npx sokko3d doctor` | Checks versions, headers, asset CORS, and the capabilities of the local browser |
| `npx sokko3d docs show <id>` / `npx sokko3d docs search "<words>"` | Prints docs for the installed engine version |

Every command prints short text results (pass or fail, reasons, file paths), so you can read them directly. Open the image files it names when a visual check fails.

## 2. Image tests in hold mode

Hold mode renders with a fixed time step and a fixed random seed, and without the frame loop, so the same code always gives the same image.

```ts
// tests/boat.visual.ts
import { defineVisualTest } from '@sokko3d/engine/testing';

export default defineVisualTest({
  name: 'boat at sunset',
  game: () => import('../src/game'),       // the real game module
  setup: (ctx) => ctx.page.post('test-view', 'harbor'),  // optional: pick a camera or state
  time: 2.0,                                // seconds of simulated time before capture
  size: [640, 360],
  tolerance: { threshold: 0.1, maxDiffRatio: 0.001 },   // three.js's comparison uses 0.1%
});
```

- References are stored per GPU tier: `tests/__references__/<name>.<tier>.png`. Tiers can differ slightly, so compare like with like.
- Pixels are read back through the engine, never through a canvas screenshot, because some browsers alter canvas reads for privacy.
- A failure writes `<name>.actual.png` and `<name>.diff.png` next to the reference. Open both before deciding whether the code or the reference is wrong.
- Randomness must come from `ctx.random` (seeded) in code that tests cover.

## 3. Behavior tests

```ts
// tests/pickup.test.ts
import { defineGameTest } from '@sokko3d/engine/testing';

export default defineGameTest({
  name: 'player picks up a coin',
  game: () => import('../src/game'),
  steps: 120,                                  // fixed steps at 60 Hz
  input: [{ at: 0, down: 'KeyW' }, { at: 60, up: 'KeyW' }],
  assert: ({ scene, messages }) => {
    if (!messages.some((m) => m.type === 'coin')) throw new Error('no coin message');
  },
});
```

Behavior tests run the game worker code with scripted input. They check game logic and messages to the page, not pixels.

## 4. Testing on real devices

URL switches for the dev server (engine docs `guides/testing`):

| Switch | Effect |
| --- | --- |
| `?gpu=webgpu`, `?gpu=compat`, `?gpu=webgl2` | Force a GPU tier, if the device supports it |
| `?threads=off` | Single-threaded build |
| `?render=main` | Render on the main thread |
| `?latency=pipelined`, `?latency=low` | Latency mode |
| `?preset=low` (to `ultra`), `?fps=60` | Fix preset and frame rate |
| `?hold` | Render one frame in hold mode |

Reaching the dev server:

- Android phone: connect by USB and run `adb reverse tcp:5173 tcp:5173`; the phone opens `http://localhost:5173`, which counts as a secure context. Plain `http` on a network address does not, and Chrome 154 asks before loading it.
- iPhone or iPad: serve HTTPS with a local certificate (`npx sokko3d dev --https`), install the root certificate on the device, and trust it in Settings > General > About > Certificate Trust Settings. Debug from Safari on a Mac through the Develop menu.
- Record the device, browser version, GPU tier and preset with every result; `npx sokko3d doctor --device` prints them.

## 5. The MCP server for agents

`npx sokko3d mcp` starts a Model Context Protocol server connected to the running dev session. Its tool names can change until `guides/agents` is stable:

| Tool | Use |
| --- | --- |
| `sokko3d_list_objects` | Names, handles, types, static or dynamic, layers |
| `sokko3d_get_object` / `sokko3d_set_transform` / `sokko3d_set_material` | Inspect and adjust objects live |
| `sokko3d_capture` | A PNG of the current frame |
| `sokko3d_stats` | Frame phases, buckets, uploads, memory, tier, preset |
| `sokko3d_errors` | Recent engine errors and console output |
| `sokko3d_render_graph` | The compiled render graph as DOT text |
| `sokko3d_set_quality` / `sokko3d_set_gpu` | Switch preset or GPU tier (tier changes reload the page) |

Live changes through the MCP server are for exploring; put the final values into code and tests.

## 6. Error codes

Every engine error is an `EngineError` with a code, the object's name, what failed, and the fix:

```
E1203: setPosition() got NaN for x on "Player" (slot 12). Check the value computed before this call.
```

Look up the full explanation with `npx sokko3d docs show errors/E1203`. Release builds remove most checks, so reproduce problems in a development build.

## 7. Troubleshooting table

| Symptom | Likely cause | Fix | Docs |
| --- | --- | --- | --- |
| Blank canvas; console mentions `SharedArrayBuffer` or `crossOriginIsolated` | No isolation headers | `sokko3d dev`, or set COOP `same-origin` and COEP `require-corp` on the host | `getting-started/hosting` |
| Blank canvas; console shows CORS errors for models or textures | Assets from another origin without CORS or CORP headers | Serve them with `Access-Control-Allow-Origin` or `Cross-Origin-Resource-Policy` | `getting-started/hosting` |
| Canvas works, nothing visible | No active camera, camera inside an object, or objects outside near and far | `scene.setActiveCamera`; check positions with `debug.axes`; widen near and far | `api/cameras` |
| An object does not move | Static object written through an array | Setter, or `dynamic: true` | `concepts/static-dynamic` |
| Error: stale handle | The object was destroyed earlier | Drop your reference when you destroy; check the frame number in the message | `concepts/handles` |
| Colors too dark or washed out | Texture color space | `'srgb'` for color maps, `'linear'` for data maps | `concepts/color-management` |
| Lighting much brighter or darker than expected | Light units (physical, like three.js r155+) or exposure | Retune intensities; check `post.set({ exposure })` | `concepts/lighting` |
| Shadows missing | Light or object not casting, receiver not receiving, or out of range | `castShadows` on light and caster, `receiveShadows` on the receiver | `concepts/shadows` |
| Shadow acne or peter-panning | Bias | Adjust `shadow.bias` and `normalBias` in small steps | `concepts/shadows` |
| Flicker between overlapping surfaces | Z-fighting | Separate the surfaces; raise the near plane | `api/cameras` |
| Transparent objects in the wrong order | Sorting by object center | `setRenderOrder`; split large transparent meshes | `api/objects` |
| Works on WebGPU, broken on WebGL2 | A feature without a fallback | Check capabilities; test with `?gpu=webgl2` | `concepts/backends` |
| Shader works in Chrome, fails in Safari or Firefox | A WGSL feature or limit they lack | Follow the portable WGSL rules | `shaders/wgsl-rules` |
| "Device lost" message, then recovery or a switch to WebGL2 | GPU driver reset or memory pressure | Reduce memory; report reproducible cases | `concepts/backends` |
| Stutter every few seconds | Garbage collection | Remove per-frame allocations | `guides/performance` |
| Hitch when something appears | Pipeline compile | Create earlier; `scene.warmUp()` | `guides/loading-screens` |
| Tab reloads or crashes on a phone | Memory limit | Compressed textures, fewer and smaller assets, destroy unused prefabs | `guides/phones` |
| `document is not defined` or `window is not defined` | DOM code in `game.ts` | Move it to `page.ts`; send data with messages | `api/page` |
| Pointer position off by a factor | Mixing CSS pixels and render pixels | `input.pointer.x` and `y` are CSS pixels, like `screenToRay` expects | `api/input` |
