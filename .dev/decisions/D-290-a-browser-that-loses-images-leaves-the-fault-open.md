# D-290: A browser that loses a moved image leaves the fault open, and a probe watches it

Status: decided by the measurement below. The engine still draws a model without a map whose image a browser lost; the image test's row for the interpolation model posts its maps' upload facts from a probe. Task: none (no plan task names the glTF loader's image handoff; the fault is the CI Safari row's).

Summary: Safari 27.2 sometimes hands a transferred `ImageBitmap` over empty, and a model then draws without that map. A loader that failed such a load and loaded the file again with the images copied was measured on CI: the one page that took the copy failed 24 ms later, and thirty model rows that had loaded before failed under it. So the engine keeps the old behavior, the fault stays open, and a probe records what a lost image looks like on the devices that lose it.

## Question

What the engine does about a browser that loses an image between the thread that decodes it and the thread that draws, and how the fault is watched until it is fixed.

## Rule

- A change must not cost pages that work today to repair one that does not.
- A wrong picture that a browser causes must be visible in the run's record, so a reader does not take it for the model's own look.
- The engine's memory and time stay as they are on the browsers that hand images over correctly.

## Data

CI run 41436706177 ran a branch whose loader refused a parse answer without its decoded image, and loaded the file once more with the images copied instead of moved. Every Safari shard's log is in the measurement.

| Measure, Safari 27.2 | Count |
| --- | --- |
| `E1412`, the guard's own failure | 0 |
| The copy-and-reload warning | 1 (`Fox.glb`) |
| That page's result 24 ms later | `E1416`, the reload failed |
| `E1416: assets.loadGltf() could not read ...: Type error` | 30 rows |
| WebGL2 model rows failed, of 35 | 28 |
| `E1404: ... image is not an Object`, the older handoff loss | 18 |

The run before the change loaded and drew the same models on the same browser: `gltf-dispersion` differed from its reference in 4.781 per cent of pixels, which needs the model drawn, and `gltf-texture-linear-interpolation` in 8.199 per cent. In the same run, Firefox loaded and passed `gltf-clearcoat-car-paint`, `gltf-sheen-cloth`, `gltf-sheen-grid-env`, `gltf-texture-coordinates` and `gltf-morph-colors`.

A probe that posts the upload queue, the GPU bytes and the textures' layers in every frame read the same on this Mac's Safari 26.2 and on Chrome: both images arrive at 2 by 1 and 512 by 256 pixels, the first frame that uploads them uploads 524,300 bytes with the GPU memory at 2,796,256, and no warning names the browser. So the loss is that WebKit version's, not a late upload.

## Look

The withdrawn attempt looked worse: pages that drew a model before failed to load it at all. The engine's present behavior draws the model with the map missing, which is a wrong picture, but the model still draws and its other maps and its shape are right.

## Decision

Leave the fault open. The engine neither fails such a load nor reloads it: it draws the model without the map, as it did before, and the probe records the upload facts beside the picture so a later attempt starts from evidence. The attempt to guard and recopy is rejected on what the run shows: the one page that took the copy path failed 24 ms later with `E1416`, and the thirty rows that regressed under it. That a copy of an `ImageBitmap` is what that browser refused is an inference from the failure, not an observation: the read error does not separate a browser refusal from a fault in the attempt's own change, and a later attempt should measure which before it copies again.

## Consequences

The image test's row for `gltf-texture-linear-interpolation` runs `tests/pages/sketches/probe-gltf-maps-sketch.ts`, which frames the same scene and posts its upload facts; the image page keeps those messages in the run's result. A reader of the Safari row sees the picture, and the facts that say whether the maps were late. The fault is unchanged in the engine and waits for a fix that a Safari 27.2 machine can measure.
