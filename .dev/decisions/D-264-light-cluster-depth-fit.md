# D-264: Light clusters: depth-fitted slices and occupancy words

Status: built for M3-R9. On WebGPU at Medium and above, the light clustering fits each camera
view's slices to the depth range that the frame before measured, and lists fewer lights per
cluster. Low and WebGL2 keep the CPU's slicing, because the header read that a fitted fragment
makes costs more on a weak phone than the shorter light loop saves. Occupancy words are not built,
because a packed index list leaves no empty group of 32 lights to skip. The before-and-after GPU
times on the Mac, the iPad and an S24-class phone are recorded below.

Summary: A census of S3, the many-lights benchmark, shows that depth-fitted slices halve the
average number of listed lights per shaded fragment, from 14.6 to 7.5, and raise the index list
from 2,470 to 5,458 entries, or 8 percent of its cap. The light loop costs 2.25 ms of S3's 4.24 ms
GPU frame on the M5 Max, or 53 percent. The fit takes S3 on the iPad from 8.41 to 6.23 ms of GPU
time per frame at Medium, with the new pass at 0.16 ms, and on the M3 Max Mac from 4.46 to 4.20 ms
at High. At Low it cost the Galaxy S25 2.29 ms, so Low keeps the CPU's slicing and the phone's
frame stays at 19.1 ms. On S6, the city, the fit adds 0.52 ms to the High frame on the Mac, so the
header read it pays on every lit fragment and its reduction pass can outweigh the lists it
shortens.

## Question

The engine study names two techniques for clustered lights: fit the depth slices to the last
frame's measured depth range from a small reduction, and add per-cluster occupancy words so the
shading loop skips empty groups of 32 lights. Do they pay in null3D's light grid, and on which
numbers?

## Rule

- The picture must not change. The first and last slices stay open, so a fragment outside the
  fitted range still gets every light that reaches it. A light that a cluster lists but a fragment
  does not reach contributes exactly zero.
- A change to which lights a cluster lists can recover at most the light loop's own GPU cost. That
  is the ceiling, and it is measured on an empty machine. A figure from a loaded machine is not a
  ceiling and is not recorded.
- The fit runs where it pays. A preset fits the slices only when its devices gain, the picture is
  unchanged, and the new pass costs less than half the saving. A preset that loses keeps the CPU's
  slicing. The gain is measured over a preset's scenes, because a scene whose lists the fit shortens
  little can pay more for the header read than the fit saves.

## Look

The two options look the same. A fitted slicing lists a subset of the lights that the CPU's slicing
lists for each fragment. Every light that a listed cluster adds beyond the fragment's reach
multiplies to exactly zero, and each light keeps its place in the frame's light list. The sum of
the shaded lights is therefore unchanged. A cap on a cluster's list keeps the first lights of the
frame's list, so it can change a picture only where a cluster reaches more lights than the cap. The
fitted slices are shallower, so a cluster reaches fewer lights, and a cap cuts no more than before.
In the GPU test's S3-like case, no cluster reaches the cap of 128 with the CPU's slicing.

The device runs confirm it. The device runner drew S3's visual page before the fit and again
with it, on the same page, scene, 640 by 360 size and 2.05 s hold, and kept eight frames of each
device: four in motion, the normals, and three of the shadows. Every frame is byte-identical. The
iPad's `moving-1.png` carries the sha256
`55a68bca15a09ee8267705cd4e44eca127f05d5a4e4d084054884b9993b9be0b` on both sides, and its
`shadows.png` `a9c2784ae4b264b7744f6c141c138d01d71c11d2b1ad6b8ab4906b6f51e72cfe`. The Galaxy
S25's `moving-1.png` carries
`496d4ba43d23bf4ef523de7975d47a9932bbf0ec79de67401717dac603220553` and its `shadows.png`
`a75b54ef56ac4feedc62fbf92713a37dc4df991141d89a84c125ecc26ab13159`. All eight match on the
iPad at Medium, where the fit runs, and on the S25 at Low. The S25's frames also match the run that
fitted the slices at Low, so the picture is the same with the header read on and off.

## Data

### The list is packed

The grid is 16 by 9 tiles and 24 slices, or 3,456 clusters. Each cluster's word holds a 23-bit start
into a shared index list and a 9-bit count, capped at 128. The two assignment passes write only the
lights that reach the cluster, so every entry that the loop walks is a light to shade. No group of
32 entries is empty.

For each listed light the loop reads one 32-bit index and one 80-byte light record, then shades the
surface. A mask can remove only the index read, and none of the record read or the shading.

### Census of S3

The numbers come from a no-machine replication of the engine's slicing and tile tests. The
replication was checked against the engine's own unit test for where slices end. The frame is S3's
hold frame at 2 s: a camera at radius 120 and height 50, and 256 moving point lights of 12 m range.

| Measure | Current slicing | Near end fitted |
| --- | --- | --- |
| Mean lights per shaded fragment | 14.6 | 7.5 |
| 99th percentile lights per fragment | 30 | 16 |
| Index list entries | 2,470 | 5,458 |
| Share of the 65,536-entry cap | 3.8% | 8.3% |

The slices run from the 0.1 m near plane to the end of the farthest visible light, 251 m. The
visible surfaces lie between 51 m and 261 m from the camera, so fragments use only the last 5 of
the 24 slices, each about 55 m deep at 200 m. Fitting the near end to the measured 51 m spreads all
24 slices over 51 m to 251 m, about 11 m each. Fitting the far end as well changes nothing here,
because the measured far depth lies past the end of the farthest light.

A light truly reaches the average fragment with 2.4 lights. After the fit the list is still about
three times the true set. The rest is tile size, 80 pixels on each side, and not depth.

### Occupancy words

A packed list has no empty group to skip. The only cost that a mask could remove is the index read
beside the 80-byte record. The study's scheme also needs the light table sorted by position, so
that a cluster's mask covers a short range. null3D lists lights in creation order, and sorting them
changes the order of the floating-point sum, so it changes the picture.

### The ceiling

The ceiling is the loop's own GPU cost in S3. The baseline side is commit 668b7a4. The new side is
commit 5db15f0, which changes this record alone, plus one uncommitted change: the light-clustering
compute shader writes empty light lists. Every fragment shader is byte-identical on the two sides,
so the difference is the per-light work of the loop and the index writes. The cluster lookup runs on
both sides.

The measurement ran in Chrome 155.0.8059.85 on macOS, on the 18 cores of an Apple M5 Max, on the
protocol canvas at the High preset with the governor off. Each side ran three rounds in turn, with
10 s of warm-up and 10 s measured. No run was dropped, every run held 120 Hz, and the comparison
reported no change of measurement.

| Measure | Baseline | Loop skipped | Change |
| --- | --- | --- | --- |
| GPU time per frame, median | 4.240 ms (4.223 to 4.267) | 1.993 ms (1.988 to 1.999) | -53.0%, noise 0.4% |
| Busiest thread | 0.070 ms | 0.065 ms | -13.3%, noise 16.3%, same |
| Own work | 0.060 ms | 0.050 ms | -16.7%, noise 11.4%, same |

The one-minute load was 2.99 at the start and 2.88 at the end. In run order, baseline round 1 ran
from 2.99 to 3.18, new round 1 from 3.18 to 3.29, new round 2 from 3.29 to 3.50, baseline round 2
from 3.50 to 3.56, baseline round 3 from 3.56 to 3.24, and new round 3 from 3.24 to 2.96. The
highest sample inside any round was 3.74, well under the bar of 8.

The loop costs 2.25 ms of S3's 4.24 ms frame on the M5 Max. The census says the fit removes about
half the listed lights, so the predicted saving is about 1.1 ms, less the extra clustering work that
the longer list adds. On the M3 Max the net saving is 0.27 ms. The header read that every fitted
fragment makes, and the reduction pass, are the costs that the census leaves out, and S6 shows that
they can exceed the saving.

### Before and after the fit

The Mac ran S3 on null3D's WebGPU page, on the protocol canvas at High, three rounds a side in
turns, with 10 s of warm-up and 10 s measured (`bun run bench:run --compare <baseline>,. --scenes
s3 --pages null3d-webgpu --runs 3 --seconds 10`). The baseline side is commit 2196803c5, and the
new side is the same commit with this change uncommitted, so the report names both sides alike. The
comparison ran on the 14 cores of an Apple M3 Max in Chrome 156.0.8078.79. The figures come from
this session's Mac, a MacBook Pro with an M3 Max, not the MacBook Pro with an M5 Max whose loop
cost the ceiling above measured. The GPU time per frame
fell from 4.462 ms (4.309 to 4.498) to 4.197 ms (4.021 to 4.207), 6.5 percent at a noise of
0.2 percent. The busiest thread and the engine's own work did not move. No run was dropped, and
every run held 120 Hz.

The iPad Pro 13 in Safari 26.6.1 and the Galaxy S25 in Chrome 152 ran the device runner's bench
plan: S3 on null3D's WebGPU page, three runs of 10 s warm-up and 10 s measured. The iPad chose
Medium, and the S25 chose Low. The S25 stands in for the S24 class by the owner's ruling. Its
display runs at 30 Hz, so the runner marks its timing figures unreliable; its GPU times still
compare between its sessions, where two runs of the before build gave 19.01 and 19.07 ms.

| Device | Preset | Before, GPU ms | After, GPU ms | After, light depth pass |
| --- | --- | --- | --- | --- |
| iPad Pro 13 | Medium | 8.41 | 6.23 | 0.162 |
| Galaxy S25 | Low | 19.01 | 19.14 | none: the fit is off |

The iPad's fitted frame saves 2.18 ms, thirteen times the new pass's 0.162 ms. The S25 kept the
fit on once and its frame took 21.30 ms, 2.29 ms more than the 19.01 ms before. The reduction pass
cost only 0.066 ms there, so the per-fragment header read costs the rest. Low therefore turns the
fit off, and the phone draws the frame it drew before: 19.14 ms, within the 0.1 ms that two runs of
the before build differ.

## Decision

- Occupancy words: not built. Reopen only when a list stops being packed, or when a light table
  sorted by position is shown to leave the picture unchanged.
- Depth-fitted slices: built at Medium and above. The light grid's words begin with an eight-word
  header that holds the slicing. A one-thread dispatch at the start of the light-clustering pass
  fits the slices to the depth that the last frame measured and writes the header. A reduction pass
  after the camera view's opaque pass samples one texel of each block of 16 and writes the nearest
  and farthest reversed depth into one small buffer that the fit reads; a multisampled depth is read
  at its first sample.
- The fitted lookup is a preset setting. At Medium and above a fragment finds its slice in the
  grid's header. At Low, and on WebGL2 at every preset, it finds it in the frame uniform, as before,
  and the graph declares no reduction pass. The setting is live, so a preset the governor drops to
  turns the fit off.
- Costs: the reduction reads the scene depth, so a frame with a local light cannot keep its depth
  in transient memory. The graph declares the pass only at Medium and above, and only when the
  camera sees a local light. A fitted fragment reads the header's eight words once.
- The two paths may list different lights in a cluster at Medium and above. The picture is the
  same, because a light out of range multiplies to exactly zero.

## Consequences

- At Medium and above the header read is paid on every lit fragment, including scenes with few
  lights. That is why a preset fits only while its devices gain.
- The fit can cost a scene whose lists it shortens little. On S6, the city, it adds 0.52 ms to the
  High frame on the M3 Max, 8.9 percent, while the same change's S3 frame falls. The size of the
  win depends on the scene as well as on the device.
- Low pays no header read and no reduction, so a phone there draws the frame it drew before. The
  Galaxy S25's S3 frame stays at 19.1 ms of GPU time at Low, against 21.3 ms when the fit was on.
- The fit can lag the depth range and can be approximate. Correctness never depends on it, because
  the end slices stay open. Only the size of the win depends on it.
- The fit runs only on WebGPU. WebGL2 keeps the CPU's slicing and its cost at every preset, so a
  scene with many lights gains on WebGPU alone.
