---
id: cli/null3d
title: "The `null3d` command"
status: experimental
since: "0.1"
summary: "create, test, bench, shot, assets, docs, port, skills, mcp, doctor."
---

# The `null3d` command

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. The commands `create`, `test`, `assets`, `docs`, `port`, `skills`, `mcp` and `doctor` are not built yet, so coding agents must not use them.

The `@null3d/cli` package holds the `null3d` command. You need no command to build or run a sketch: Vite and the null3D Vite plugin do that. The command does jobs that a bundler does not do, such as drawing a frame of your scene with no person watching.

Run it with `bunx` in your project's folder:

```sh
bunx @null3d/cli --help            # the commands
bunx @null3d/cli shot --help       # the options of one command
bunx @null3d/cli --version
```

The command needs Node 20.19 or later, or Node 22.12 or later, as Vite 8 does.

## shot

```mermaid
flowchart LR
    shot["bunx @null3d/cli shot"] --> vite["Your project's own<br/>Vite dev server"]
    vite --> page["A headless browser opens<br/>your page with ?hold"]
    page --> hold["The engine holds the sketch<br/>and reads the frame back"]
    hold --> png["shot.png"]
    hold --> json["shot.json"]
```

`shot` draws one frame of your page and saves it as a PNG file. It starts your project's own Vite dev server in the current folder, with your Vite config, on a free port. Then it opens your page in a headless browser with the `?hold` switch. The engine steps the sketch to the time you give, draws that frame and reads it back ([Testing your sketch](../guides/testing.md)). Your page needs no test code.

```sh
bunx @null3d/cli shot --out shot.png --time 1.5 --size 1280x720 --gpu webgl2
```

| Option | Effect | Without it |
| --- | --- | --- |
| `--out <file.png>` | The image to write. The JSON file beside it takes its name, such as `shot.json` | `shot.png` |
| `--time <seconds>` | The sketch time of the frame, from 0 to 600 | The `hold` option of `createEngine`, or 0 |
| `--size <width>x<height>` | The browser window's size in CSS pixels. Each CSS pixel is one pixel of the image | `1280x720` |
| `--gpu <tier>` | Forces a GPU tier: `webgpu`, `compat` or `webgl2` | The engine picks the tier |
| `--page <path>` | The page to open, from the dev server's root, with any query of its own | `/` |
| `--timeout <seconds>` | How long the page may take to draw the frame | 60 |

The image has the size of your page's canvas. A canvas that fills the window gives an image of the window's size. When your page's CSS gives the canvas another size, the summary says so.

### What it prints

When the engine draws the frame, `shot` prints a short summary and exits with 0:

```text
Drew / at 1.5 s, frame 91, on webgl2: 1280 x 720 pixels.
It made 3 draw calls, uploaded 30.3 KB and built 2 pipelines.
Saved shot.png, and the frame's facts and what the page logged in shot.json.
The page logged no errors or warnings.
```

The summary lists what the page logged, with the first lines of each entry. The JSON file holds every line.

### The JSON file

| Field | What it holds |
| --- | --- |
| `ok` | `true` when the engine drew the frame and `shot` saved the image |
| `page` | The page's address, with hold mode's switches |
| `environment` | Where the frame was drawn: `chrome-real-gpu` or `chromium-swiftshader` |
| `browser` | The browser's name and version |
| `time`, `frame` | The sketch time and the frame's number: the steps to the time, plus one |
| `tier` | The GPU path that drew the frame: `webgpu`, `webgpu-compat` or `webgl2` |
| `width`, `height` | The image's size in pixels |
| `image` | The image's file name, in the JSON file's folder |
| `stats` | The frame's figures in the form that `engine.measure()` returns: CPU time by thread and phase, draw calls, uploads and pipelines. The held frame is the first frame that the engine draws, so it builds every pipeline and uploads the whole scene |
| `code`, `error` | When no frame was drawn: the error's code, or `null`, and what went wrong |
| `ms` | Time from opening the page to the engine's result, in milliseconds |
| `errors` | The page's uncaught errors and console errors, then the dev server's errors |
| `warnings` | The page's console warnings |

### When it draws no frame

When no frame is drawn, `shot` says why, saves the JSON file and exits with 1. It deletes the image of an earlier run, so an old image never passes for a new one. It stops at once in these cases:

- The engine stops the hold at the sketch's first error, such as [E1408](../errors/E1408.md), and publishes the error.
- The page logs an error and has not started the engine by the time it loads, for example because a page script threw.
- The project has no HTML file at the `--page` path. Vite would answer that address with your main page.

A page must start the engine as it loads. A page that waits for a click never starts the hold, so `shot` gives up after `--timeout` seconds.

### Where it draws

`shot` draws with Google Chrome on your computer's GPU. When the `CI` variable is set, it draws with Playwright's Chromium on SwiftShader, a GPU in software. Most CI machines have no GPU. Set `CI=1` to draw the software GPU's image on your own computer:

```sh
CI=1 bunx @null3d/cli shot --out ci-shot.png
```

The two draw the edges of objects a little differently, so keep reference images for each. When a browser is missing, `shot` prints the command that installs it.

## bench

```mermaid
flowchart LR
    bench["bunx @null3d/cli bench"] --> build["A production build<br/>with your Vite config"]
    build --> page["A headless browser opens<br/>your page with ?bench"]
    page --> warm["Warm-up,<br/>not measured"]
    warm --> measure["engine.measure"]
    measure -->|"next run"| page
    measure --> json["bench.json"]
```

`bench` measures the engine on your page. It builds your project for production with your Vite config, into a temporary folder, and serves the build. A production build has none of the engine's development checks, so the engine runs as your users get it. Then `bench` opens your page in a headless browser with the `?bench` switch, once for each run. Each run lets the page run for the warm-up, and then measures it with `engine.measure` ([Performance guide](../guides/performance.md#measure)). Your page needs no benchmark code.

```sh
bunx @null3d/cli bench --gpu webgpu,webgl2
```

| Option | Effect | Without it |
| --- | --- | --- |
| `--page <path>` | The page to open, from the server's root, with any query of its own | `/` |
| `--gpu <tiers>` | The GPU paths to measure, joined by commas: `webgpu`, `compat` and `webgl2` | The engine picks the path |
| `--runs <count>` | Fresh runs on each GPU path | 5 |
| `--seconds <seconds>` | How long each run measures | 30 |
| `--warmup <seconds>` | How long each run lets the page run before it measures | 5 |
| `--size <width>x<height>` | The browser window's size in CSS pixels | `1280x720` |
| `--out <file.json>` | The JSON file to write | `bench.json` |
| `--timeout <seconds>` | How long the page may take to start the engine | 60 |

With more than one GPU path, `bench` takes one run on each path in turn. A computer that slows down during the command then slows every path alike. The runs take several minutes, so `bench` prints a line after each run.

### What it prints

For each GPU path, `bench` prints the median of the runs:

```text
/ on webgpu: 5 runs of 30 s, each after 5 s of warm-up.
CPU time per frame, the median of the runs:
  the busiest thread in each frame: 0.10 ms (runs from 0.10 to 0.11 ms)
  sketch-worker: 0.05 ms, of which the sketch's update 0.02 ms
  render-worker: 0.10 ms
  16 job workers: 0.00 ms together, at most 0.00 ms on one
  all threads: 0.15 ms
GPU time per frame: 0.46 ms.
Frames per second: 60.0 presented, 60.0 finished by the GPU, on a display of 60.0 Hz.
```

- The busiest thread in each frame limits the frame rate. The runs' lowest and highest values show how much the figure varies.
- Each thread's line gives its own CPU time per frame. The sketch's update is your `onUpdate`, and the rest of that thread's time is the engine's own work.
- GPU time needs the browser to time the GPU. `bench` starts Chrome with WebGPU's developer features on, so the times are not rounded. Where the browser does not time the GPU, such as Chrome on WebGL2 on a Mac, the line says n/a.
- A headless browser draws 60 frames per second on every computer. Compare CPU time and GPU time between computers.

When a run fails, `bench` says why after the figures of its path, and exits with 1.

### The JSON file

| Field | What it holds |
| --- | --- |
| `ok` | `true` when every run measured the engine |
| `page` | The page as you gave it |
| `environment`, `browser` | Where the runs drew, as for `shot`, and the browser's version |
| `warmupSeconds`, `measureSeconds` | The warm-up and the measured time of each run |
| `paths` | One entry for each GPU path: `gpu`, the tier that `--gpu` forced or `null`; `tier`, the path that the engine drew with; `summary`, the medians and the spread of the runs; and `runs` |
| `runs` | Each run's figures from `engine.measure` in `stats`, with its GPU path and the engine's mode, or `ok: false` and the `error` that stopped it |
| `error` | What stopped `bench` before its runs, such as a production build that failed |
| `errors`, `warnings` | What the pages and the server logged, each entry once |

### Measure fairly

- Close other busy programs. Programs that use the CPU change the figures from run to run.
- Compare runs on one computer, one after another.
- Vite builds `index.html` alone, unless `build.rolldownOptions.input` in your Vite config lists more pages. For a page outside the build, `bench` says so.
- The page must start the engine as it loads. A page that waits for a click never starts the engine, so `bench` gives up after `--timeout` seconds.
