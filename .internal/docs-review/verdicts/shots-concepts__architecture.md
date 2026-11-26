# Shot and demo-link verdicts: concepts/architecture

## Shots

### stats-overlay-threads (scripted, instances): keep, with corrected steps and alt text

- The picture helps. It shows the threads of the page's table as live numbers. It also shows the job worker count that the last sentence of "When the job workers start" names.
- The steps are wrong in one point. The demo runner starts the overlay collapsed to its frame rate (examples/lib/run.ts). A bare `?stats` maps to `true`, and `true` keeps the collapsed state. Use `?stats=open` instead, which opens the card.
- URL switches work only in a development build. Production builds turn them off. Capture on the examples dev server.
- The overlay does not give a line for each job worker. It shows one line, "job workers (N)  busiest X ms" (packages/engine/src/debug/stats-text.ts). It does give a line for each other thread, and a "main thread" line for long tasks and input delay. Fix the "shows" text and the alt text to match.
- The overlay must be live. A held frame never shows it, so do not add `?hold`.
- Corrected steps: on the examples dev server, open the instances demo with `?stats=open` in desktop Chrome on WebGPU. Wait about 5 seconds, so the job workers can ramp up and the figures can settle. Capture the canvas with the open overlay at its top-right corner.
- Corrected alt: "The open stats overlay over 100,000 columns: CPU time per frame of the sketch worker and the render worker, the main thread's long tasks, and one line with the number of job workers and the busiest one's time."

### devtools-threads (manual, instances): keep

- A manual shot is right here, because the Performance panel is the browser's own developer tool.
- The tracks carry clear names. The engine names its workers `null3d-sketch`, `null3d-render` and `null3d-job-<n>` (packages/engine/src/page/engine.ts). The helper workers also have names: `null3d-probe`, `null3d-gltf`, `null3d-panorama` and `null3d-tasks`. So the picture maps straight onto the table.
- Record after the job workers start, about 5 seconds after load, on a cross-origin isolated page. Otherwise the job worker tracks are missing, or the page runs the single-threaded build.
- The instances demo loads no model, so no glTF track shows. The probe worker shows only if the recording covers startup. Say so in the caption, or the reader may look for those tracks.
- Optional: put it in a collapsible "Technical details" block under "The kinds of thread", because it is for readers who profile.

## Demo links

### instances/ for "Job workers start as the parallel work grows": keep

- `instances/` is the demo's code value in examples/demos.ts.
- The sketch drives one dynamic batch of 100,000 rows and writes every row's height in each frame. The engine's instance-batch loops then run on the job workers, so this scene starts several of them. It is close to the 100,000-box scene that the page's figures come from.
- The code link alone does not show the workers start. Tell the reader to open the running demo with the stats overlay open to watch the count rise.

## Concepts said to have no demo

- Latency modes: confirmed. No demo asks for `latency: 'low'`. The `?render=main` and `?threads=off` switches change the mode of any demo, but they are test switches, not demos.
- `sketchThread: 'main'`: confirmed. No demo uses it. The `?sketch-thread=main` switch applies to any demo.
- The single-threaded build: confirmed. Any demo runs it with `?threads=off` or on a page without isolation. No demo exists for it.
- The passes of a frame: confirmed. `multiple-views/` (no code value, so the folder name) and `security-camera/` show extra views and scene passes, which are one step of the list. They do not show the order of the passes. The open stats overlay on WebGPU lists the GPU time of each step, which is the closest live view.
- The engine's lifetime (destroy, detach, attach): confirmed. No demo calls `detach` or `attach`. `destroy` and `destroy({ release: true })` appear only in the demo runner and the comparison page code (examples/lib/run.ts, examples/lib/compare.ts), not in a demo's sketch.
