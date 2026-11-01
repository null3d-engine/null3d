# D-286: A WebGL2 pass beside a scene's second draw re-uploads its textures

Status: open, and not built. M3-V17 found the cost and worked around it in one demo. The fault is
the WebGL2 backend's, and no task owns it yet; this record holds it until one does.

Summary: On the WebGL2 path, a pass whose form there is a fragment pass costs the frame a set of the
scene's compressed textures when the scene also draws itself a second time. The upload is 2.1 MB a
frame at Creek's Low preset and 4.3 MB at Medium, and it reads 2.2 MB against a head's 128 KB. The
frame goes from 16.7 ms to 633 ms on the development machine, and from 31.06 to 287.1 ms on the iPad
Pro 13. The passes that met it are the floating leaves' state pass and the wind grid's. A scene that
draws once pays nothing for either.

## Question

Why does a fragment pass beside a second scene draw re-upload textures that the frame already holds
on the GPU, and what should the backend do instead?

## Rule

- A texture uploads when its texels change, never once a frame.
- A pass's fallback form costs the same as the pass it stands in for, beside any other draw of the
  scene.
- A fix must hold the frame within D-241's ceilings for Creek and the forest on the four cloud
  devices of M3-V1, at each preset and path.

## Data

The development machine, Chrome on an Apple GPU, Creek at Low and Medium on the WebGL2 path, three
seconds after a warm-up. Each row is one page.

| Scene | Frame interval | Frames in 3 s | Uploaded per frame |
| --- | --- | --- | --- |
| The milestone head `fcafb9cd7`, no wind | 16.7 ms | 176 | 128 KB |
| The branch, as built | 633 ms | 3 | 2.2 MB |
| The branch without the water, so no second draw | 16.7 ms | 178 | 87 KB |
| The branch with the leaves riding the offset form | 16.7 ms | 175 | 113 KB |
| The branch at Medium with the wind grid's pass | 683 ms | 3 | 4.3 MB |
| The branch at Medium with `grid: 0` | 33.3 ms | 105 | 96 KB |

The last column is the engine's `uploadBytes` counter, which adds buffer writes and texture uploads
together. A temporary instrumentation of the WebGL2 backend split it on the same pages: the buffer
writes were 87 to 150 KB a frame, and the rest were texture uploads of 2,048 by 2,048 texels, a BC7
model texture, in canvas-sized regions. The column names textures by inference; the counter alone
does not say what it moved.

The time sits on the render worker: its replay phase holds 667 ms of a 667 ms frame at Creek's Low
preset, on the pass that carries the fragment form. The sketch thread is idle beside it, and the GPU
timer reads 20 to 30 ms through the whole frame, so the drawing is not the cost.

The upload figure alone does not name the fault. The Galaxy Tab A9 Plus's head run builds no wind
field and still uploads 2.19 MB a frame at Creek's Low preset
([its record](../tested-devices/galaxy-tab-a9-plus-sm-x216b-chrome/20261101-091901-vegetation.md)),
and its frame is 1,487 ms, this scene's own miss on that device. What separates the two is the frame
beside the second draw: 633 ms here, where the same scene without the reflection reads 16.7 ms, and
the upload falls from 2.2 MB to 87 KB with it. The forest draws no reflection, and its Low rows hold
on every path.

The branch's own workaround is in `examples/showcase/creek/sketch.ts` and
`examples/showcase/creek/air.ts`: on the WebGL2 tier the leaves ride the offset form and the field
keeps no grid. Its rows then match the head on the iPad and the S25
([the iPad's](../tested-devices/ipad-pro-13-safari/20261101-091422-vegetation.md),
[the S25's](../tested-devices/galaxy-s25-sm-s931b-chrome/20261101-091422-vegetation.md),
[the head's](../tested-devices/ipad-pro-13-safari/20261101-091901-vegetation.md)). D-283 holds the
add-ons' side of the figures.

## What a fix must show

- A scene with a reflection and one fragment pass, at Creek's Medium preset, stays within its
  ceiling on the iPad and the S25.
- The upload figure per frame is the head's, 128 KB or less, for the same scene.
- The frame that a pass fallback shares with a second draw costs no more than twice the frame
  without it.
