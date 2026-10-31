# D-282: A cache of still casters in a directional light's cascades

Status: decided for a build after 1.0, for the WebGPU path. Nothing is built yet. Task: M3-R11.

Summary: In Creek at Medium, the two cascade draws cost 0.76 to 0.84 ms a frame. Of that, 0.65 to
0.74 ms draws casters that stand still. A whole 2,048-texel layer copies in 0.0108 ms. With a
quarter-degree sun step, 6 frames in 7 keep. The cache then saves 0.576 ms, or 7.0% of an 8.19 ms
frame, against a 3% bar.

## Question

In a day-night scene whose sun turns in small steps, each cascade redraws the same standing casters
in many frames. Can a cache of those casters save enough GPU time to pay for a second shadow atlas?
Each kept frame would restore the cascade layer and draw the movers over it. The cache also costs
the bookkeeping that tells when its layer is stale.

## Rule

- Build the cache only when its measured saving is at least 3% of the frame's GPU time. The saving
  must hold in a scene that the engine ships, at the frame size the figures name. [Hard rule
  17](../../AGENTS.md#hard-rules) gives the engine that scale. A change that costs a benchmark 3% is
  refused. A feature must therefore save that much to earn its memory and its place in the frame.
- Both GPU paths carry the cache, or its fallback costs nothing.
- The added atlas stays under the preset's own shadow memory.
- The cache keeps at least half of the frames that a scene draws it in.

## What the engine draws today

- The nearest cascade draws in every frame. Each far cascade draws once every `farCascadeInterval`
  frames, and in every frame while a moving caster touches the box its layer holds.
- The moving list holds each dynamic object and each material that moves its vertices, unless the
  material holds its casters still. A plant whose sway fades out at a distance stands still beyond
  it, so a far cascade that only such plants touch keeps its layer.
- A cascade's culling is a pass of its own on WebGPU. The cache removes the depth draw of the still
  casters, not that culling, so the culling's cost stays in every frame.

## Vegetation

- A swaying plant's shadow redraws in every frame while the plant is in a cascade, because its
  material moves its vertices. The vegetation materials give a plant a sway distance of 8, 16, 24
  or 32 m by preset, and a plant beyond it stands still.
- Far tree cards are impostors that cast still by default, so a far cascade that holds only them
  keeps its layer.
- In Creek the only caster that moves in the sun's view is the grass at the water's edge. Its
  floating leaves are dynamic, but they lie on the unreflected layer, outside the sun's caster
  layers, so they cast no sun shadow. The trees, plants, stones, land and cave stand still.

## Data

### The measured cost

Creek's showcase at its opening pose, Medium, WebGPU, in Chrome 156. The machine is a MacBook Pro
with an Apple M3 Max, 36 GB of memory and macOS 26.2, as [the device
record](../tested-devices/macbook-pro-m3-max-chrome/README.md) gives it. The drawing buffer is 1920
by 1080. Every cascade draws in every frame on every side, so no pass rests and reads cheap.
The two sides are the scene as it draws, and the scene without the grass, whose shadow passes then
draw only casters that stand still. The run is
[the shadow-cache run](../tested-devices/macbook-pro-m3-max-chrome/20261031-1425-shadow-cache.md), which
gives the command, the loads and the per-pass figures. Every page there began and ended under a
1-minute load below 8.

The drawing buffer is pinned at the quality ratio of 1. A page whose emulated ratio is also 1 on a
2x display sizes its buffer from the physical pixels: 3840 by 2160. Every pass in it then reads
larger. The run file gives that detail.

| Hour | Side | Frame, ms | Cascade 0, ms | Cascade 1, ms |
| --- | --- | --- | --- | --- |
| Midday | all casters | 8.141 | 0.268 | 0.508 |
| Midday | all casters again | 8.187 | 0.260 | 0.483 |
| Midday | still casters | 7.003 | 0.201 | 0.448 |
| Midday | all casters again | 8.185 | 0.262 | 0.506 |
| Midday | still casters | 7.286 | 0.251 | 0.488 |
| Midday | all casters | 8.236 | 0.261 | 0.491 |
| Afternoon | all casters | 8.155 | 0.318 | 0.519 |
| Afternoon | all casters again | 8.254 | 0.311 | 0.527 |
| Afternoon | still casters | 7.004 | 0.253 | 0.485 |
| Afternoon | still casters | 7.100 | 0.246 | 0.481 |
| Afternoon | all casters again | 8.747 | 0.385 | 0.602 |
| Afternoon | all casters | 13.911 | 0.644 | 1.042 |

The two all-caster readings in a round differ by 1.5 to 5% of a cascade's time. The GPU kept one
state for them. The still side differs by up to 25% between rounds. The movers' share is all minus
still: 0.01 to 0.26 ms of the two cascades together at one state. That range reaches inside the
still side's spread, so this run does not resolve the movers' share. The static share is 0.65 to
0.74 ms of the two cascades. It is three to twelve times the cascade's own spread.

The still side's spread does not change the ruling. The saving rests on the static share and the
copy cost. It does not rest on separating the movers.

The last Afternoon page ran while the GPU drew a much slower frame: 13.911 ms against 8.747 ms, and
1.69 ms of cascades against 0.99. Its cascade share of the frame, 12.1%, matches the other pages'
10.3 to 12.2%, and the share is the figure to compare across GPU states.

### The keep rate

Creek's Auto day turns the sun 4.5 degrees a second. A cache goes stale when the sun turns by more
than the step it allows. This record takes a quarter degree as that step. At the 119.5 frames a
second that these pages presented, the sun turns 0.0377 degrees a frame. A step then falls every 7
frames, and 6 of them keep. The rate follows the frame rate:

| Frames a second | Frames between steps | Frames kept |
| --- | --- | --- |
| 30 | 2 | 1 of 2 |
| 60 | 4 | 3 of 4 |
| 94 | 6 | 5 of 6 |
| 120 | 7 | 6 of 7 |

The camera also makes a cache stale when its cascade's box no longer holds the fresh slice. This
run held the camera, so it does not measure that. A camera that moves can only lower the keep.

### The saving

The saving is the kept share of the static draw, less the restore that each kept frame pays for
each cached layer. At Midday's still share of 0.694 ms and a keep of 6 in 7:

| Restore, ms a layer | Saving, ms | Share of the 8.19 ms frame |
| --- | --- | --- |
| 0 | 0.595 | 7.3% |
| 0.01 | 0.578 | 7.1% |
| 0.02 | 0.561 | 6.8% |
| 0.05 | 0.509 | 6.2% |
| 0.10 | 0.423 | 5.2% |
| 0.20 | 0.252 | 3.1% |

The measured whole-layer copy, 0.0108 ms a layer, gives 0.576 ms, or 7.0%. The rule's bar is
0.246 ms at this frame. The cache fails it only when the restore costs more than 0.204 ms a layer.
Afternoon's static share, 0.73 ms, gives the same order.

The far cascade alone gives 0.39 ms, or 4.8%, so the bar clears even if the near cascade is left to
a rest rule. That form costs 8 MiB at Creek's Medium, against 16 MiB for both cascades.

### Memory

A cascade layer is 2 bytes a texel. A whole second atlas holds the same layers as the shadow map
and costs the same bytes. The far cascades alone take one layer fewer.

| Preset | Cascades | Layer, texels | Shadow map now | Second atlas | Far cascades only |
| --- | --- | --- | --- | --- | --- |
| Low | 2 | 1,024 | 4 MiB | 4 MiB | 2 MiB |
| Medium | 3 | 2,048 | 24 MiB | 24 MiB | 16 MiB |
| High | 3 | 2,048 | 24 MiB | 24 MiB | 16 MiB |
| Ultra | 4 | 4,096 | 128 MiB | 128 MiB | 96 MiB |

Creek's own light names 2 cascades of 2,048 texels. Its shadow map is therefore 16 MiB. A second
atlas is also 16 MiB, or 8 MiB for its far cascade alone. The presets' shadow memory is 9, 33, 92
and 228 MiB, so the second atlas stays under it at every preset.

### The restore

A kept frame must put the static depth back into the live layer. The probe times a copy of one
2,048-texel `depth16unorm` layer, whole and in rectangles, and the clear-and-store and load-and-store
passes that D-16 measured. It brackets each run with two one-invocation mark passes, whose cost the
figures include. It ran in a quiet window of its own, with a 1-minute load under 8.

| Restore form | Median, ms | Fifth to ninety-fifth, ms |
| --- | --- | --- |
| copy, whole layer | 0.0108 | -0.0023 to 0.0956 |
| copy, half across | 0 | 0 to 0 |
| copy, quarter across | 0 | 0 to 0 |
| copy, eighth across | 0 | 0 to 0 |
| clear and store | 0.0070 | -0.0114 to 0.0879 |
| load and store | 0.0072 | -0.0175 to 0.1080 |

The timer resolved only the whole-layer copy. A half, quarter or eighth of the layer read zero: its
copy is shorter than one step of the timer. A dirty-rectangle restore therefore costs at most the
whole-layer copy, and likely less. The negative fifth percentiles are marks whose timestamps came
back out of order.

The probe never drew casters into its source layer, so that layer may copy faster than a live
cascade layer whose depth varies. An uncompressed copy of the same 8 MiB at this machine's memory
bandwidth is about 0.04 ms. The cache fails only above 0.20 ms a layer, so no content can flip the
ruling.

## Look

The cache keeps the picture as it is: the same casters, the same moving grass shadows, and the same
sun direction. It requires the sun to step instead of turning smoothly. The step's look is not
measured here. A finer step lowers the keep rate. At an eighth of a degree, 120 frames a second
keep 3 frames in 4. At a sixteenth they keep 1 in 2. Each of those still clears the rule.

The cheaper alternative changes the picture. Giving the far grass a sway distance would let the far
cascade rest with no second atlas. The vegetation materials already work that way. The far grass's
shadow would then stop swinging. The cache keeps that movement, so it is the option to choose where
the look matters.

## Decision

- Build the cache for the WebGPU path, after 1.0. At the measured whole-layer copy of 0.0108 ms, the
  saving is 0.576 ms, or 7.0% of the 8.19 ms frame. That is 2.3 times the rule's bar. The cache
  fails only when the restore costs more than 0.204 ms a layer.
- The cache holds each cascade's still casters in a second depth atlas. A kept frame restores the
  layer, by a copy or by dirty rectangles around the movers, and draws the movers over it. A stale
  frame redraws every caster into the cache.
- Six things make a layer stale. The sun turns more than the step. The box no longer holds the fresh
  slice. A still caster moves, turns, scales, shows, hides, or changes its layers, material or mesh.
  A mover's old or new bounds need clearing. The cascade count, map size or depth format changes. A
  material starts or stops moving its vertices.
- The sun steps by at most a quarter degree. A scene that needs a finer step keeps fewer frames. The
  cache stays above the bar down to about a sixteenth of a degree at 120 frames a second.
- The cache applies to a cascade that a mover touches. Where no mover touches, the schedule already
  rests the far cascades. A rest rule could take those frames with no atlas, so the cache is not
  needed there.
- The WebGL2 path draws as today: its draw list cannot copy a depth texture, and a depth-writing
  pass would cost more than the cache saves. That fallback costs nothing.
- At 30 frames a second the keep is 1 in 2, and no phone figure exists. The build measures a phone
  first; a preset that fails leaves the cache off, which costs nothing.

### Options rejected

- **Do not build.** The measured saving clears the rule, and refusing it leaves the frames that a
  mover forces at the full cascade cost.
- **A rest rule alone.** It cannot draw a cascade that a mover touches, and those are the frames at
  stake.
- **A sway distance on the grass.** It would rest the far cascade for free, but the far grass's
  shadow would stop swinging. The cache keeps the picture. A scene that does not need the movement
  may take the fade instead.
- **A second map that each lookup reads twice.** D-16 rejected it for doubling the filter's reads.
- **A cache layer with fewer texels.** It would soften the static casters' shadows.

## Consequences

- The engine gains a second cascade atlas, a sun-step setting, the cache's staleness tests and the
  layer restores. The frame graph gains the copies, and the presets gain the memory.
- The shadows page describes the update under a stepped sun. D-16's still-caster cache is weighed
  again here, with a scene that the engine ships.
- The two probes stay in the repository: the cascade-share page and the depth-copy page, with the
  runner that drives them.
