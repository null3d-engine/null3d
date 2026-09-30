# Verifying a port: parity and performance

A port is done when each chosen camera view looks the same within an agreed tolerance on both GPU paths. It must also run at least as fast as the original on the same device. Engine docs: `porting/verification`, `guides/testing`, `cli/null3d`.

## Contents

1. Choose the views
2. Capture the three.js baseline
3. Compare the null3D port
4. Tolerances
5. Compare performance
6. The porting report

## 1. Choose the views

Pick 3 to 8 camera views that together show every material, light, effect and object type in the app. Write them to `views.json`:

```json
{
  "size": [800, 450],
  "pixelRatio": 1,
  "views": [
    { "name": "overview", "position": [8, 6, 10], "target": [0, 1, 0], "fov": 50, "time": 0 },
    { "name": "hero-closeup", "position": [1.2, 1.6, 2], "target": [0, 1.4, 0], "fov": 35, "time": 1.5 }
  ]
}
```

`time` is the animation time in seconds at which to capture. A fixed size and a pixel ratio of 1 make the two images comparable.

## 2. Capture the three.js baseline

Make the original deterministic first:

- Stop damping and auto-rotation in controls.
- Set animation mixers to the view's time with `mixer.setTime(view.time)`, and set any time uniforms to the same value.
- Replace `Math.random` with a seeded generator during capture, if the scene uses randomness.
- Keep anti-aliasing on (`antialias: true`), and start null3D with `createEngine({ antialias: 'msaa' })`. Both then draw 4 samples per pixel (MSAA) on every GPU tier.
- Keep tone mapping off (`NoToneMapping`). null3D has none until `post.set({ toneMapping })` comes later in 0.1.

Then add this temporary helper to the original app:

```js
// capture-baseline.js: temporary, remove after capturing
export function captureBaseline(renderer, scene, camera, config, renderFn = () => renderer.render(scene, camera)) {
  renderer.setPixelRatio(config.pixelRatio);
  renderer.setSize(config.size[0], config.size[1], false);
  const shots = {};
  for (const v of config.views) {
    camera.position.fromArray(v.position);
    camera.lookAt(v.target[0], v.target[1], v.target[2]);
    if (camera.isPerspectiveCamera && v.fov) camera.fov = v.fov;
    camera.aspect = config.size[0] / config.size[1];
    camera.updateProjectionMatrix();
    renderFn();                                                  // use composer.render() if the app has one
    shots[v.name] = renderer.domElement.toDataURL('image/png');  // same task as the render, so the buffer is still valid
  }
  return shots;   // save each data URL as baseline/<name>.png
}
```

With `WebGLRenderer`, reading the canvas in the same task as the render works without `preserveDrawingBuffer`. With `WebGPURenderer`, call `await renderer.renderAsync(scene, camera)` first; if the canvas reads back empty in that browser, render into a render target and read it with `readRenderTargetPixelsAsync` instead. Record the three.js version, browser and GPU next to the images.

## 3. Compare the null3D port

```sh
bunx @null3d/cli port compare --baseline baseline/ --views views.json --gpu webgpu,webgl2   # (0.3)
```

The command runs the sketch in hold mode and poses the active camera at each view. It captures each image through the engine's readback, and compares it with the baseline using three.js's own image comparison script. It writes `compare/<view>.<tier>.actual.png`, `.diff.png` and a summary in the terminal.

Before 0.3, `bunx @null3d/cli test` compares the port with the baseline (engine docs `cli/null3d`). Make each view an image test, with the three.js image as its reference:

1. Let the sketch pose its camera from a view name in its module's address. In the setup, read `new URL(import.meta.url).searchParams.get('view')`, and set the camera from that view's `position`, `target` and `fov` (`guides/testing`).
2. List one test per view in `null3d.json`, with the view's time and the baseline's size:

   ```json
   {
     "tests": [
       { "name": "overview", "sketch": "sketch.ts?view=overview", "hold": 0, "size": "800x450" },
       { "name": "hero-closeup", "sketch": "sketch.ts?view=hero-closeup", "hold": 1.5, "size": "800x450" }
     ]
   }
   ```

3. Copy each baseline image to `tests/references/<environment>/<tier>/<name>.png`, once for each tier: `webgpu`, `compat` and `webgl2`. The environment is `chrome-real-gpu` on your computer's GPU, and `chromium-swiftshader` with `CI=1`.
4. Run `bunx @null3d/cli test`. A view passes when at most 0.1% of its pixels differ by more than 10% of the color range, as in three.js's own image tests. Edge pixels of anti-aliased shapes do not count. For a view that fails, open its image and its `-diff.png` in `test-results/null3d/<environment>/<tier>/`.

Never run `--update-references` in this setup: it replaces the three.js baselines with the port's own images.

A sketch test draws with the engine's default options. When the page passes options to `createEngine` that change the image, give the test a `page` in place of `sketch`, such as `"page": "/?view=hero-closeup"`. Then make the page pass the view into the sketch module's address. To look at one view, `bunx @null3d/cli shot` draws it:

```sh
bunx @null3d/cli shot --page '/?view=hero-closeup' --time 1.5 --size 800x450 --gpu webgl2 --out compare/hero-closeup.webgl2.png
```

For the comparison, match the original's settings: no tone mapping and a pixel ratio of 1. Later in 0.1, `post.set({ toneMapping: 'none' })` matches an original that differs in tone mapping. `createEngine({ antialias: 'none' })` matches an original without anti-aliasing.

## 4. Tolerances

| Scene content | Suggested tolerance | Why |
| --- | --- | --- |
| Geometry, unlit and standard materials, no post effects | At most 0.5% of pixels differ by more than the 0.1 threshold | Rasterization and shadow filtering differ slightly between engines |
| Lambert, Phong or Toon materials ported by approximation | Review the diff image with the user | Differences are expected by design |
| Bloom, ambient occlusion, other effects | Review with the user | Effects are implemented differently |
| Text, HTML labels | Compare in the browser, not in images | Labels are HTML on the page |

three.js's own screenshot tests allow 0.1% of pixels over the threshold, which is a good target for simple views. Record every accepted difference in the report.

## 5. Compare performance

Measure both apps on the same device, browser, window size and pixel ratio, with the refresh rate fixed at 60 Hz:

1. Warm up for at least 5 seconds; this excludes shader compilation. `bunx @null3d/cli bench` warms up for 5 seconds by default.
2. Run 5 times for 30 seconds each. Report the median and the spread.
3. On phones, add one 10-minute run, because phones slow down as they heat up.

| Measure | three.js | null3D |
| --- | --- | --- |
| Frame time at the 50th, 95th and 99th percentile | Intervals between `requestAnimationFrame` timestamps | `intervalMs` from `engine.measure(seconds)` on the page, or `bunx @null3d/cli bench` |
| CPU time per frame on the busiest thread | `performance.now()` around update and render in the loop | `cpuMs`, and each thread's phases in `threads` |
| Main-thread time per frame | Same as above: everything runs there | Close to zero; this is why pages stay responsive |
| Memory | Browser task manager or memory panel | `memory` from `engine.measure()`: WebAssembly memory and the JavaScript heap |
| Load time to the first frame | From navigation to the first rendered frame | `load` from `engine.measure()` |
| Download size | Network panel, compressed | Same |

If the original was not optimized, part of the gain comes from idiomatic rewrites rather than from the engine. Say so in the report. Also check the WebGL2 path with `?gpu=webgl2`: phones without WebGPU use it.

## 6. The porting report

Write `PORTING-REPORT.md` in the project root:

```markdown
# Porting report: <project name>

Date: <date>. three.js <version> to null3d <version>.
Tested on: <device, OS, browser and version, GPU tier> for each device.

## Summary
- Ported: <scenes and features>
- Parity: <n> of <m> views pass on WebGPU, <n> of <m> on WebGL2
- Performance on <device>: frame time p50 <a> ms to <b> ms, p99 <c> ms to <d> ms; main-thread time <e> ms to <f> ms
- Lowest engine version needed: <version>

## Parity per view
| View | WebGPU | WebGL2 | Differing pixels | Notes |
| --- | --- | --- | --- | --- |

## Performance
| Measure | three.js | null3d | Device and browser |
| --- | --- | --- | --- |

## Visual differences accepted
| Where | Difference | Reason | Accepted by |
| --- | --- | --- | --- |

## Features not ported
| Feature | Status (post-1.0 or unsupported) | Workaround used | Follow-up |
| --- | --- | --- | --- |

## Behavior changes
<anything users will notice, such as input handling, loading or quality presets>

## How to rerun the checks
<the exact commands>
```
