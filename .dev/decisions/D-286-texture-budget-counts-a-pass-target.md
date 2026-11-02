# D-286: The texture budget counted a pass's target, so a second draw dropped levels

Status: built, and owned by M3-R41. The fix is a filter in the budget's projection and a unit test.
The frame and device figures that the task's done line asks for are owed a run of the browser and
the cloud devices.

Summary: The texture memory budget measured two different things. The figure that a page reads,
`quality.textureMemory.bytes`, holds the texture arrays alone. A pass's target belongs to the render
graph, so it takes none of the textures' room. The projection that decides whether to drop mip
levels counted every array, the targets among them. So a scene whose textures sit near its budget
reads as over it. A pass that draws a target the size of the canvas can then tip it over, as the
water's reflection does.
The store then drops the largest mip levels of the compressed textures that a page can load again.
The page loads their files again, and the frame uploads megabytes for the frames that takes. Creek's
frames lasted hundreds of milliseconds meanwhile. The projection now measures the arrays that the
budget measures, so a pass's target drops no level.

## Question

Why did a fragment pass beside a second scene draw re-upload textures that the frame already held?
What should the engine do instead?

The upload was not a copy of unchanged texels. The store asked for the levels that its own
projection had dropped. The page fetched and decoded the files again, as it does for any level that
comes back. The budget counted every pass target as texture room, so it believed the textures took
more GPU memory than they took.

## Rule

- A texture uploads when its texels change, never once a frame.
- A pass's fallback form costs the same as the pass it stands in for, beside any other draw of the
  scene.
- The texture budget measures the textures' own arrays on every path of its decision. A pass's
  target is the render graph's, and the render scale governs it.
- A fix must hold the frame within D-241's ceilings on the four cloud devices of M3-V1, at each
  preset and path.

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
together. A temporary instrumentation of the WebGL2 backend split that figure on the same pages. It
read 87 to 150 KB a frame of buffer writes. The rest were texture uploads of a compressed model
texture.

The same scene read 287.1 ms on the iPad Pro 13, against the head's 31.06 ms on the same device and
path. Both rows were measured before the fix ([the branch's
run](../tested-devices/ipad-pro-13-safari/20261101-080738-vegetation.md), [the
head's](../tested-devices/ipad-pro-13-safari/20261101-091901-vegetation.md)).

The figures name a burst rather than a cost of every frame. The upload budget is 2 MiB a frame at
Low and 4 MiB at Medium. The two figures are those allowances spent whole. Three frames could not
show whether the burst ended. The unit test below shows the decision that started it. A run of the
same pages owes the figures that show it ended.

The time sat on the render worker, whose replay phase held most of each frame. The GPU timer read 20
to 30 ms through it, so the drawing was not the cost.

The branch worked around the cost in `examples/showcase/creek/sketch.ts` and
`examples/showcase/creek/air.ts`: on the WebGL2 tier the leaves ride the offset form and the field
keeps no grid. The workaround stands until a run shows the pass affordable again. D-283 holds the
add-ons' side of the figures.

## The cause

`crates/null3d-render/src/textures/budget.rs` decides what to drop from `projected_bytes`. That
figure is the GPU memory that the arrays take once the next frame has sized them. It summed every
array. `TextureStore::memory_bytes` is the budget's own figure, and a page reads it as
`quality.textureMemory.bytes`. It leaves out the arrays of a pass's texture, because the render
graph makes and owns their GPU texture.

So a pass target a canvas across, such as the water's reflection, counted in the projection and not
in the budget's own figure. With the scene's textures near the budget, the projection passed the
band's top, and `fit_memory` dropped levels. A compressed texture of a file drops by asking the page
to load its texels again. Each drop therefore fetched and decoded a file, and uploaded megabytes. A
scene with no second draw has no target that large, and a scene with no pass has none at all.

## The fix

`projected_bytes` now measures the arrays that `memory_bytes` measures. The two figures agree, and a
pass target takes no room of the textures. The unit test
`a_pass_target_takes_no_room_of_the_textures_and_drops_no_level` holds a compressed texture that
loads again. The texture takes half a megabyte of an 8 MiB budget, and the test adds a pass target of
1600 by 900. It drops no level, asks for no load again and uploads nothing after its first frame.
With the filter removed, the same test drops two levels.

## The pictures

The fix moves no picture. The terrain, water and creek tests were drawn on WebGPU, compatibility
mode and WebGL2. `terrain`, `demo-terrain`, `water-shores`, `transmission-water` and `demo-water` on
WebGPU matched their references, which predate the fix. The fix moved no pixel there.

The other fourteen differ from their references, and those were drawn again at the commit before
the fix. Each pair of drawings matches to 0.000 per cent. Two compatibility-mode pictures read 0.051 and
0.001 per cent, which is the noise of two separate runs. So those references were owed a redraw
before this fix.

Three `water-bounds` pages timed out under the load of four parallel tests and drew no frame, so
they are no evidence either way.

On WebGL2 the Creek water-close picture draws its trees near black, where its WebGPU and
compatibility drawings shade the same trees. That darkness predates the fix, and it owes a look of
its own before a reference is drawn over it.

## What a fix must show

- A scene with a reflection and one fragment pass, at Creek's Medium preset, stays within its
  ceiling on the iPad and the S25. Owed a run.
- The upload figure per frame is the head's, 128 KB or less, for the same scene. Owed a run.
- The frame that a pass fallback shares with a second draw costs no more than twice the frame
  without it. Owed a run.

An earlier reading of these figures called the cost a re-upload of textures that the frame already
held, once a frame. That was wrong, and it sent the work after the backend's upload path, which
never re-uploads a texture on its own. The store's own budget dropped the levels, and the page
loaded them again.
