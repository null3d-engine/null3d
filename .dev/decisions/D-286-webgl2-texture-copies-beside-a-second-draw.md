# D-286: A WebGL2 view that rests between frames stalls every frame beside it

Status: fixed by M3-R41. A view that draws in one frame of several keeps its passes in the render
plan while it rests, so no frame beside it compiles a plan or makes a target. Creek keeps its wind
grid and its leaves' state form on the WebGL2 path.

Summary: A WebGL2 frame that changed its render plan compiled the plan, made its targets and its
framebuffers again, and bound everything again. A reflection at a cadence above one changed the plan
in each frame it rested and again in each frame it drew, and a new framebuffer's completeness check
waits for the GPU, so the frame took hundreds of milliseconds. The uploads that a measurement of
those seconds reads are the scene's first texture fill, at the preset's upload budget for each slow
frame. The backend uploads a texture once, when its texels arrive; it never uploads one that the GPU
already holds. With the passes kept in the plan, a resting view changes no plan: the same scene
reads the display's frame rate and makes no GPU object.

## Question

Why does a pass whose WebGL2 form is a fragment pass cost the frame hundreds of milliseconds beside
a scene that draws itself a second time, and what should the render graph do instead?

## Rule

- A texture uploads when its texels change, never once a frame. The store queues a texture's texels
  only when a setter gives them, and a texture whose texels are on the GPU keeps them.
- A view that rests changes no render plan and makes no target.
- A pass's fallback form costs the same as the pass it stands in for, beside any other draw of the
  scene. It holds the frame within D-241's ceilings for Creek and the forest.

## Data

The run that found the cost, on the development machine, Chrome on an Apple GPU, Creek at Low and
Medium on the WebGL2 path, three seconds after a warm-up. Each row is one page.

| Scene | Frame interval | Frames in 3 s | Uploaded per frame |
| --- | --- | --- | --- |
| The milestone head `fcafb9cd7`, no wind | 16.7 ms | 176 | 128 KB |
| The branch, as built | 633 ms | 3 | 2.2 MB |
| The branch without the water, so no second draw | 16.7 ms | 178 | 87 KB |
| The branch with the leaves riding the offset form | 16.7 ms | 175 | 113 KB |
| The branch at Medium with the wind grid's pass | 683 ms | 3 | 4.3 MB |
| The branch at Medium with `grid: 0` | 33.3 ms | 105 | 96 KB |

The frame interval is the fault. The upload column is the scene's first fill: 2.2 MB is the Low
preset's upload budget of 2 MiB, and 4.3 MB is the Medium preset's 4 MiB budget. A scene uploads
each texel once, a band of rows in a frame, so a start that takes hundreds of milliseconds a frame
spreads its first fill over the seconds that the measurement reads. The branch without the second
draw, and the branch with the leaves on the offset form, pay the same first fill; their frames are
fast, so the fill ends before the measurement starts. The backend re-uploads no texture that the
GPU holds.

### The cause

The reflection draws in one frame of two at these presets. Each frame it rested, its passes left the
render plan, and each frame it drew, they rejoined it. A plan that changed compiled again, made its
targets and framebuffers again and bound everything again, and a new framebuffer's completeness
check waits for the GPU. The leaves' state pass and the wind grid's hit it because each is a pass
whose WebGL2 form is a fragment pass: a full-screen draw that the graph places with the view, so the
view's rest wrote it out of the plan.

### The reproduction and the fix

A scene with all three parts shows the split: a model with compressed textures, a reflection at a
cadence of two, and a compute pass with a fragment form. It ran on the WebGL2 path at the Low
preset, on the commit before the fix, `7c2871530`, and on the milestone head. The machine carried
other sessions' builds, at a load average of about 40, so both sides meet the same conditions.

| Measurement | Before the fix | After the fix |
| --- | --- | --- |
| Frame interval, median | 200 to 258 ms | 16.665 ms |
| GPU objects the measure made | 360 to 879, near 23 a frame | 0 |
| Uploaded in the first frames | 4.3, 2.1, 2.1, 2.1 and 0.37 MB, then none | the same first fill, then none |
| Uploaded per frame, median | 6,144 B | 33,620 B |

The uploads are the same on both sides: the first fill in its first frames, and nothing after. The
cadence is the cause: the same scene before the fix, with the reflection drawn every frame, read
16.665 ms and did not stall. The pass is the other half: before the fix, the same cadence without
the pass made 5,234 GPU objects and kept 16.665 ms, so a plan that changes alone does not stall. The
stall is the pass's framebuffer made again in each frame that the plan changed, and its completeness
check waiting. Commit 6318df778 keeps each view's passes in the plan once the view has drawn, so a
frame that it rests skips only their recording. `tests/image/upload-repeat.spec.ts` holds it: it runs
the scene at a cadence of two, with the pass and without it, and fails when a frame makes a GPU
object. The scene makes 0 objects a frame after the fix, against 360 beside the pass before it and
5,234 without it over the longer measure.

### Creek after the fix

Creek keeps its wind grid and its leaves' state form on the WebGL2 path. On the Mac's GPU, three
seconds after a warm-up, with the reflection drawn every frame. The machine carried other sessions'
builds and browser runs through these figures, at a load average of about 40, so a single frame
stutters and the median is the figure:

| Scene | Frame interval | Uploaded per frame |
| --- | --- | --- |
| Creek Low | 16.7 ms | 519,700 B |
| Creek Medium | 33.3 ms | 631,426 B |
| Creek Medium, with the leaves on the offset form and no grid | 33.3 ms | 633,530 B |

The display ran at 60 Hz. Low holds it; Medium takes two display frames at both settings, so the
pass adds no measurable upload and no frame time.

The iPad Pro 13 in Safari 26.6.1 drew the same pair, each side twice, on that path: the two sides'
upload medians read 186.2 and 185.4 KB a frame at Low and 256.5 and 255.4 KB at Medium, 0.4 per
cent apart where two runs of one build move by 0 to 11 per cent, so the pass adds no upload there
either. Low read 15.54 and 15.56 ms against D-241's 30.8 ms ceiling and Medium 46.20 and 46.22 ms
against 90.8, with every page on WebGL2 at the preset asked for and a render scale of 1.00
([its record](../tested-devices/ipad-pro-13-safari/20261109-1908-creek-upload.md)). An earlier iPad
run read Creek Low at 15.94 ms with 445,988 bytes uploaded a frame at the median and 694,674 at the
99th percentile: the scene's own writes, far below the preset's 2 MiB budget. The three other cloud
devices hold their ceilings too, in their own records: the iPhone at 15 against 15.7 ms and 31
against 43.9, the S24 at 33 against 33.3 at both presets, and the Tab's Creek Low at 1059 against
1268.5. D-241 gives the Tab no Creek ceiling above Low, so no row is owed there.

## What the fix shows

- The upload figure per frame holds the scene's own, the same as the scene without the pass.
- The frame that a pass fallback shares with a second draw costs no more than the frame without it.
- The iPad Pro 13's pair and the other three cloud devices' rows are recorded beside the Mac's, above.
