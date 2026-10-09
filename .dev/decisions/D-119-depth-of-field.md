# D-119: Depth of field

Status: proposed, 2026-10-09. Date: 2026-10-09. Task: M2-EX17.

Summary: `post.set({ dof })` blurs by distance from the focus, as a camera lens does, with the near and far fields apart, so a sharp object never spreads a halo and a blurred one in front spreads over what lies behind it. It is the gather of KinoBokeh at half the render size: four steps after the custom effects and before bloom, whose code and shaders load on first use. The lens takes a focal length in millimetres on a full-frame sensor, an f-number and a focus distance, or a world point to focus on in each frame. The camera's `setFocalLength` sets the field of view of the same lens. The quality setting `dofSamples` gives the gather 22 taps on Medium, 43 on High and 71 on Ultra, and turns it off on Low until a phone measures it. At 1920 x 1080 on the Mac it costs about 0.6 ms of GPU time per frame at 22 taps with WebGL2 and 0.85 ms with WebGPU, about 0.9 and 1.3 ms at 43 taps, and nothing while it is off.

## Question

The showcase scenes need depth of field, with a "DSLR" switch that turns it on with a camera's lens ([D-117](D-117-showcase-features-before-1-0.md)). Which technique draws it on WebGPU, its compatibility mode and WebGL2, where does it run in the chain, what does its API look like, and what does each quality preset draw?

## Rule

- The intent of three.js's `BokehPass` ([D-52](D-52-intent-parity.md)): what lies near the focus stays sharp, and what lies in front or behind blurs more the farther it lies, with the engine's own best technique.
- No halo at depth edges: a sharp object's color never spreads into the blurred background, and a blurred object in front spreads over a sharp one behind it.
- One look on all three GPU paths, with image references for each.
- No allocation per frame while the focus moves ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- Nothing costs anything while depth of field is off, and its code and shaders load on first use. The code that a page downloads at its start barely grows: the pipelined start was at 137.8 KB of 140 KB after Brotli.
- Each quality preset draws it at a sensible cost, off on Low unless it is cheap.

## Options

### The technique

| Option | What it does | Verdict |
| --- | --- | --- |
| A: three.js's `BokehPass` | One full-size pass: each pixel reads about 40 taps of the color at a radius of its own depth's blur, `(focus - depth) × aperture`, capped by `maxblur` | Rejected. A sharp object in front of a blurred background spreads its color as a halo, a blurred object in front never spreads over a sharp one, and every tap reads the full-size image |
| B: a scatter of bokeh sprites | Each bright pixel draws a quad of its blur's size | Rejected. The cost follows the blur's area and the number of bright pixels, which a phone cannot bound, and it needs a pass that the render graph would have to count first |
| C: a separable hexagonal blur (Frostbite, 2011) | Three skewed line blurs make hexagons with no gaps | Rejected for now. Three passes for one shape, and the near and far fields need more passes on top |
| D: KinoBokeh's gather at half size, with near and far fields | Four steps (below); each tap counts for the far field only where both its own blur and the pixel's reach, and for the near field where its own blur reaches | Chosen |

Option D is the gather that Unity's post-processing stack ships. The steps are:

1. **Setup**, at half the render size: reads four pixels of the scene's color and depth for each texel, finds each pixel's circle of confusion, and writes the color with the smallest of their blurs. In-focus color counts less in the average and dims by how sharp the texel is.
2. **Gather**, at half size: a spiral of taps over a disk, or over a polygon with `blades`, around each texel. The far field takes a tap only where the texel's own blur reaches it too. The near field takes a tap wherever the tap's blur reaches the texel, and its share is how much of the texel it covers.
3. **Tent**, at half size: four filtered taps, as far apart as the gather's taps.
4. **Composite**, at the render size: mixes the blur into each pixel by the pixel's own blur, read from the full-size depth, and by the near field's share, into a target that bloom and the final pass read.

Three changes to KinoBokeh came from the image tests:

- **The smallest blur wins in the setup.** KinoBokeh keeps the largest. On a sharp object's edge, the half-size texel then took the background's blur with the object's color, and the gather spread an orange band about 10 pixels wide over the blurred wall above the test scene's box. With the smallest blur, the edge texel stays sharp. Measured in the test scene's column through the box's top edge, the rows above the edge then match the image without depth of field.
- **A sharp texel gathers the background around it.** Its own result shows only where the composite's filtered read reaches into a blurred pixel beside it. Gathering the background there, by each tap's own blur, removed a dark fringe two pixels wide along the same edge.
- **A spiral of taps, turned at each texel.** KinoBokeh's rings of 7, 14 and 21 taps left gaps that a small highlight cannot fill: at Medium's 22 taps the highlights drew seven-lobed blobs and rings. A spiral that turns each tap by the golden angle (Vogel's method) gives each tap an even share of the disk. A round aperture also turns it by a different angle at each texel, from Jimenez's interleaved gradient noise, and the tent reaches half the taps' spacing. The highlights then draw round disks with a fine grain at their edges.

With MSAA on WebGPU the composite reads each pixel's nearest depth sample. An edge pixel's color is mostly the object in front, so it keeps its own color where that object is sharp, and the edge keeps its smoothing. The setup reads the first sample only: the smallest-blur rule already keeps sharp edges from spreading, and every sample there cost about 0.5 ms more per frame at 1920 x 1080, as it reads the whole multisampled depth twice. WebGL2 reads the copy of one sample that its backend keeps.

### Where it runs

Custom effects, then depth of field, then bloom, then the final pass with the vignette, the tone mapping, FXAA, the outline and the color grading table. Bloom then glows from the blurred image, as a lens blurs a highlight before the sensor's glow spreads it, and as Unity's HDRP and Unreal order them. The custom effects come first because they are part of the scene's look, such as fog. Effects that would fold into the final pass draw in passes of their own while depth of field is on, as they do while bloom is on.

### The API

| Option | Verdict |
| --- | --- |
| A: all of the lens in `post.set({ dof })`, with `focalLength: 'camera'` by default, and `camera.setFocalLength` for the field of view | Chosen |
| B: a lens object on the camera, `camera.setLens({ focalLength, aperture, focus })`, which depth of field reads | Rejected. The aperture and the focus change only the blur, which `post.set` owns with every other effect. Two places would hold depth of field's settings, against design principle 10 |
| C: a preset helper that returns `{ fov, dof }` for a named lens | Rejected. A third way to say the same numbers, with names such as "portrait" that the docs would have to define |

The focal length frames the shot, so it belongs to the camera, as three.js's `PerspectiveCamera.setFocalLength` does. Depth of field reads the active camera's focal length unless its settings give one, so the blur always matches the framing. The aperture and the focus distance only change the blur, so they live in `dof`. A photographer's setup is two lines:

```ts
camera.setFocalLength(85);
post.set({ dof: { aperture: 1.8, focusPoint: subject } });
```

The showcase's "DSLR" switch sets those two lines and `post.set({ dof: false })` to turn it off.

`focusPoint` focuses on a world point: the engine core finds the point's distance along the camera's view in each frame, from the camera of that frame, so the focus follows the camera and the point with no lag. A sketch that follows a moving object passes its position again each frame, from an array that it changes in place.

The sensor is full frame, 36 x 24 mm, so the field of view is `2 atan(12 / focalLength)`. three.js's `setFocalLength` uses a film gauge of 35 mm on the canvas's longer side. The two agree on a square canvas with three.js's `filmGauge` set to 24, which the unit test checks.

### The lens

The blur of a point at distance `d` is the thin lens's circle of confusion, as a share of the sensor's height `h`: `f² / (N (s - f) h) × (1 - s / d)`, with focal length `f`, f-number `N` and focus distance `s`. World units count as metres, as in glTF. The blur is 0 at the focus, grows toward its far value behind it, and grows without bound in front of it, so `maxBlur`, 2% of the image's height by default, caps it. The gather reaches only as far as the frame's largest blur: the lens's blur at the camera's near and far planes, capped by `maxBlur`, so a lens closed down gathers a smaller disk.

## Data

### Cost

GPU time per frame that depth of field adds, from the effect cost page (`tests/pages/effect-cost.html?effect=dof&taps=<n>`) at 1920 x 1080 and a render scale of 1, in Chrome on the Mac (Apple M-series), WebGPU with MSAA and WebGL2. Each figure is the difference of the medians of three rounds of 2 seconds off and on. WebGPU's timer counts in steps of about 0.07 ms.

| Taps | WebGPU, median (lowest to highest) | WebGL2, median (lowest to highest) |
| --- | --- | --- |
| 16 | 0.72 ms (0.66 to 0.79) | 0.52 ms (below 0 to 1.32) |
| 22 (Medium) | 0.85 ms (0.26 to 1.18) | 0.64 ms (0.37 to 0.84) |
| 43 (High) | 1.31 ms (0.85 to 1.64) | 0.94 ms (0.68 to 1.12) |
| 71 (Ultra) | 1.84 ms (1.64 to 2.03) | 1.25 ms (0.76 to 1.37) |

How the data was produced: a local Playwright run of the cost page, one page at a time, through `heavy.sh`, on 9 October 2026. Each figure is the median of three such runs at loads of 3 to 6, two or three with the final shaders. The runs spread widely: the frames without depth of field alone moved between 0.33 and 1.6 ms from run to run, as the GPU's clock changes under a light load. The medians are the figures to use. Bloom costs 0.79 to 0.85 ms on the same Mac at the same size ([D-21](D-21-effect-chain.md)).

With MSAA, a setup that read every depth sample cost about 0.5 ms more per frame at 22 taps (1.25 to 1.31 ms against 0.72 ms). So the setup reads the first sample, and only the composite reads each pixel's nearest sample.

While depth of field is off it costs nothing: the frame graph declares none of its passes or targets, the frame asks for none of its pipelines, and the page loads none of its shaders. A unit test of the frame graph checks the passes, the targets, the pipelines and the upload room, and a unit test of `post.set` checks that `dof: false` loads no shader file.

The allocation check (`bun run bench:allocation --dof`) turns depth of field on in S1 with a focus point that moves every frame. It passed on WebGPU and on WebGL2. On WebGPU the replay allocated about 220 bytes more per frame than without depth of field: the browser's encoders of the four render passes, which the check budgets at bloom's 64 bytes per pass.

### Download size

| File | Before | After |
| --- | --- | --- |
| The pipelined start, after Brotli | 137.8 KB | 138.3 KB |
| Each WebAssembly file, after Brotli | 338.7 KB | 344.1 KB |
| `shaders-dof-wgsl.js`, first use | none | 2.3 KB |
| `shaders-dof-glsl.js`, first use | none | 2.4 KB |

The start grew by about 0.5 KB: the setter of `post.set`, the camera's focal length, the WebGPU layouts and the templates of both paths. One shared writer of the settings' numbers now serves bloom, ambient occlusion, the vignette and depth of field, which took back part of it. The shaders load with the first `post.set({ dof })` on a device that draws it.

### Image tests

`dof-off`, `dof-far-field` (focus on the post 2 m away), `dof-near-field` (focus on the lights 16 m away), `dof-both` (focus on the box 6 m away), `dof-hexagon`, `dof-point`, `dof-later`, `dof-scale-50` and `dof-8-bit`, on WebGPU, compatibility mode and WebGL2, with references for the Mac's GPU and for CI's software GPU. The point, the switch during play and the 8-bit path draw their twins' images. WebGL2 and compatibility mode run Medium at most, so their references draw 22 taps, and core WebGPU's draw High's 43.

## Decision

Option D, with the API of option A. The quality setting `dofSamples` takes 0, 16, 22, 43 or 71 taps:

| Preset | Taps | Why |
| --- | --- | --- |
| Low | 0 (off) | Phones run Low. No phone has measured depth of field yet; the cloud phone check (the `dof` plan of the device runner) decides whether Low draws 16 taps |
| Medium | 22 | The most that WebGL2 and compatibility mode run. Round disks with a fine grain at their edges |
| High | 43 | Desktops. Smooth disks, at about 1 ms at 1920 x 1080 |
| Ultra | 71 | Desktops with time to spare |

A change of the taps above 0 changes only the gather's block, so it makes no GPU object. A change to or from 0 adds or removes the passes. The frame-budget governor has no step for depth of field yet.

## Consequences

- **Code:** `crates/null3d-render/src/dof.rs` and `crates/null3d-shaders/wgsl/dof.wgsl`; the frame graph's four steps; bind layouts 27 and 28 and pipeline templates 41 to 46 in `null3d_gpu::drawlist`; the post values from 41 on; `setDof` and `setDofTaps` in the core's glue; `PerspectiveCamera.setFocalLength` and `focalLength`. Bloom's step blocks and depth of field's share one map of a target's corner onto its source's.
- **Docs and skills:** `api/post`, `concepts/post-processing`, `api/cameras`, the quality preset tables, the three.js mapping's `dof` entry, the porting skill's post-processing reference and the develop skill's quick reference.
- **Tests:** the image tests above, the frame graph's and the lens's unit tests, `post.set`'s unit tests, the camera's focal length against three.js, and the `--dof` switch of the allocation check.
- **Devices:** the device runner's `dof` plan times depth of field on each GPU path at render scales of 1 and 0.5, at 16 and 22 taps. The S24+ and the iPad run it before the owner rules on Low.
- **Later:** a step of the frame-budget governor for depth of field, and tile-based dilation of the near field's blur, which would let a near object's blur reach past the gather's radius.
