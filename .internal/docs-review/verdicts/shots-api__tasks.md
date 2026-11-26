# Shot and demo-link verdicts: api/tasks

## Shots

### task-on-job-worker (manual) - keep, with corrected steps
A manual source is allowed: the Performance panel is part of the browser's own developer tools.
The picture helps under "What the engine guarantees". It shows the first two guarantees (off the
sketch thread, frames first) better than words do. The splats demo is a good choice: the splats
add-on runs its selection task on a job worker each time `splats.update` runs, once per frame.

The proposal gives no steps, so a capture could show a busy trace with nothing to point at.
Corrected steps:
1. Open the splats demo (examples/splats/) on a cross-origin isolated page, so the job workers start.
2. Wait until all parts of the scan load, then move the camera so the selection runs each frame.
3. Record about two seconds in the Performance panel.
4. Expand the worker tracks. The engine names them "null3d-job-<n>", "null3d-sketch" and
   "null3d-render". Show one job worker track with the selection task's `run` call, beside the
   sketch worker's and the render worker's frames.
5. Crop to two or three frames. Save as docs/images/api/tasks/task-on-job-worker.webp.

Note for the alt text: the sketch runs in its own worker here, not on the page's main thread.
Say "the sketch worker", not "the main thread".

## Demo links

### A task that chooses what to draw -> splats/ - keep, move it
The demo has no `code` field, so `splats/` (its name plus a slash) is right. Its add-on runs
SELECT_TASK through runTask, with a shared buffer, to choose each chunk's splats nearest first.
The demo's own sketch does not call runTask: it calls createSplats and splats.update. The link
shows the task at work, not the task's code. Put it in the opening section, next to the sentence
that names the Gaussian splats add-on, not under "What the engine guarantees".

### Work on the job workers -> terrain/ - keep
The demo's `code` is `terrain/`. Its add-on runs the quadtree selection and the block build as a
task (BUILD_TASK) on the job workers, with one shared buffer for the terrain's life. The sketch
itself calls only createTerrain and terrain.update, so the link shows the effect, not runTask code.
"What the engine guarantees" is a fair place for it.

## Concepts said to have no demo

### shared-memory tasks - confirmed
No demo sketch makes a SharedArrayBuffer or passes one to runTask. The splats and terrain add-ons
do this inside their own code, so the two demos above run shared-memory tasks, but a reader of the
examples folder does not see it.

### TaskFailure - confirmed
No demo catches or names a TaskFailure or a TaskLoadError.
