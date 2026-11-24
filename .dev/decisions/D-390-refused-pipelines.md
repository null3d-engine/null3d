# D-390: A pipeline that the GPU's driver refuses builds once more alone, and a cached page gives its GPU back

Status: decided and built on both GPU paths, with unit tests and browser tests. The Galaxy Tab A9
Plus run with the change is below.

Summary: A pipeline of the scene's objects that the GPU's driver refuses builds once more, alone.
A second refusal leaves its draws out, reports E1307 once per device, and the frames go on. Where
the engine keeps texture copies, as phones and tablets do, a page in the browser's back/forward
cache gives its GPU back. It takes a new device when it shows again. On a Galaxy Tab A9 Plus, every
repeat visit of the island showcase ended at E1404 while the cached first visit held its GPU memory.

## Question

What should the engine do when the GPU's driver refuses to build a pipeline after the start? And
what should a page that the browser keeps in its back/forward cache hold?

## Rule

The engine stops only for a fault that it cannot draw past. Every error message says how to fix the
problem (principle 10). Both GPU paths behave the same (principle 9). The better look wins (hard
rule 40).

## Data

The island showcase on a Samsung Galaxy Tab A9 Plus (SM-X216B, Adreno 619, 4 GB, Android 14, Chrome
152) in BrowserStack Automate. The examples' production build is at `cbdd718e4`, served through this
Mac's BrowserStack Local tunnel. Each session is a fresh browser. It makes a first visit, then visits
the same address again after a wait on `about:blank`.

| Visit | Wait before it | Preset path | Result |
| --- | --- | --- | --- |
| First visit, 5 sessions | none | Medium, then the check's step to Low | draws |
| Repeat, 3 sessions | 3 s | Medium, then Low | E1404, custom material 135 |
| Repeat with `?check=fresh` | 3 s | Medium, then Low | E1404, custom material 135 |
| Repeat after that one | 3 s | Medium, then Low | E1404, custom material 135 |
| Repeat with `?preset=low` | 3 s | Low from the start | draws |
| Repeat with the stored check | 90 s | Low from the start | draws |
| Repeat with `?check=fresh` | 90 s | Medium, then Low | E1404, custom material 135 |
| Creek, first visit | none | its own start | E1404 before its first frame, custom material 133 |

The same tablet with this record's change and the frame graph's fix for E1502, built from this
worktree on `cbdd718e4`:

| Visit | Wait before it | Preset path | Result |
| --- | --- | --- | --- |
| Island, first visit | none | Medium, then Low | draws on; E1307 for custom material 135, refused twice |
| Island, repeat | 3 s | Low from the start (the stored check) | draws, nothing refused |
| Creek, first visit | none | its own start | E1307 for custom material 133 at 69 s, first frame at 71 s, then the GPU process went away at 75 s: E1302, no adapter |
| Island on WebGL2, first visit | none | Medium, then Low | draws, nothing refused; first frame at 177 s |
| Island on WebGL2, repeat | 3 s | Low from the start | draws, nothing refused; first frame at 120 s |

On `cbdd718e4` every frame after the step to Low failed with E1502. So a first visit never built
Low's pipelines, and its check timed frames that drew nothing: Low read 34 to 54 frames a second.
With the frames drawn, Low reads 1.1 frames a second, and the first visit meets the refusal too.

The driver's message is "CreateGraphicsPipelines failed with VK_ERROR_UNKNOWN", for the
render pipeline "custom material 135", from `CheckVkSuccessImpl`. It comes 1.5 to 14 s after the
first frame, after the quality update that steps the preset down. Custom material 135 is the
impostor add-on's card material. Creek's 133 is the water add-on's material. The numbers come from
the order in which the two scenes take their templates on this Mac.

During a repeat visit, Chrome keeps the first visit's page in its back/forward cache, with its engine
and its GPU device. That page's `pagehide` says `persisted: true`, and the page freezes. It does so
even with `Cache-Control: no-store`. A repeat's setup starts 14 to 24 s later than a first visit's.
So the driver refuses when two pages' GPU memory is held and the page builds two presets'
pipelines. It also refuses when one page holds as much as Creek does.

Dawn, as Chrome 152 ships it, turns every result of `vkCreateGraphicsPipelines` but device loss into
an internal error. `createRenderPipelineAsync` then rejects with a `GPUPipelineError` whose reason is
`internal`. The device stays alive: Dawn's `CreatePipelineAsyncEvent` reports the status and loses
nothing. Dawn's main branch now names `VK_ERROR_UNKNOWN` from pipeline creation a pipeline error of
its own (commit 70c5c0e, bug 538745944). Other projects meet `VK_ERROR_UNKNOWN` from Adreno 650 to
830 drivers as the shader compiler's refusal of one pipeline.

How the data was produced: `scratchpad/tab-crash/tab.ts`, a cut-down copy of the phones helper's
timing tool, ran one session at a time. It read the page's records and its localStorage after each
visit. The phones helper's run gave three of the repeat visits.

## Look

Building the pipeline again and then drawing on without it looks better. The scene keeps every
object but those of the refused pipeline. Stopping leaves the last frame on the canvas, or no scene
at all when the refusal comes before the first frame.

A cached page that gives its GPU back shows its scene again on its return after the pipelines build.
The next page draws its whole scene. A cached page that keeps its GPU shows at once on its return,
but the next page can lose objects or stop. Giving the GPU back looks better for the page that the
user is on.

## Decision

Build once more, alone, then draw on without the pipeline.

- A refusal with the reason `internal` waits in a queue when its template draws objects of the
  scene. Such a template is a mesh template, or a custom material, a draw shader among them. It still counts as
  building, so a capture and `pipelines_built` wait for it. Once no build runs, the backend builds
  it again with the same descriptor. A driver that ran short of memory among many compiles then has
  the most room that it can get.
- A second refusal leaves the pipeline's slot as one that builds. Its draws draw nothing, as they do
  while a pipeline builds, and the frames stop waiting for it. The renderer reports the first such
  pipeline of each device as E1307, with its name and the pass that its build draws in.
- WebGL2 does the same with a program of a mesh template whose link the driver refuses. It links new
  shaders once more, then skips the program's draws and reports E1307.
- A refusal with the reason `validation` is a descriptor that the engine got wrong. A refused
  full-screen pass, such as the final pass, would leave the frame without its output. Both still
  stop the replays as E1404.

Give the GPU back from the back/forward cache.

- Where the engine keeps texture copies, the page's `pagehide` with `persisted` asks the thread that
  draws to stop its loop and destroy its renderer. That covers its textures, its buffers and its device. The
  matching `pageshow` asks for a new device, as a recovery from a GPU loss does, and it counts no
  loss. The copies bring every map back.
- A desktop keeps no copies by default, so its maps would not come back. Its cached page keeps its
  GPU, and desktops have the memory for it.
- The browser can freeze the page's workers before the request reaches the thread that draws. A
  worker that it froze first gives its GPU back when the page shows again, and takes a new one at
  once. The Tab A9 Plus run cannot show which comes first: the cached page cannot be read.

Options rejected:

- Stop the engine at the first refusal. The scene then ends for one missing pipeline that the device
  could draw without.
- Step the preset down and rebuild. The island's refusal came at Low, the lowest preset. A step
  builds every pipeline of the frame again, which loads the driver most when it has least.
- Build again and again with a growing wait. A refusal by the compiler never builds. Each try costs a
  compile, about 190 ms a pipeline on the Tab A9 Plus, while the frames wait for it.
- Move to WebGL2. That needs a new engine. A page that hears E1307 can start one with `gpu: 'webgl2'`.
- End the workers on `pagehide`. A worker that ends gives everything back at once, but the canvas
  that it drew on cannot draw again. So a page that the cache shows again shows a dead canvas.
- Keep the page out of the back/forward cache. No standard call does that, and the docs ask pages to
  work with the cache.

## Consequences

`WebGPUBackend.refused` and `WebGL2Backend.refused` hear a refused pipeline. Both renderers send it
to the page as a GPU failure of the kind `pipeline`, which the page reports as E1307. The error's docs
say what to do. Lighten a custom material's WGSL, use less memory on a small device, update the
browser, and report an engine template. The methods `Drawing.enterPageCache` and `leavePageCache` give the GPU
back and take a new one, through the `page-cache` request. The driver fault is recorded in
[driver bug reports](../driver-bugs.md).
