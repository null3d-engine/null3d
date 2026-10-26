# D-264: Light clusters: depth-fitted slices and occupancy words

Status: measured for M3-R9 on 26 October 2026, for the owner's review. Not built yet. Date: 2026-10-26. Task: M3-R9.

Summary: null3D lists each cluster's lights in a packed index list, so the shading loop walks exactly
the lights that reach the cluster and never meets an empty group of 32 lights. Occupancy words
therefore add nothing to this design. A census of S3, the many-lights benchmark, shows that
depth-fitted slices would halve the average number of listed lights per shaded fragment, from 14.6
to 7.5, and raise the index list from 2,470 to 5,458 entries, or 8 percent of its cap. The measured
ceiling on the Mac is 2.25 ms of S3's 4.24 ms GPU frame, or 53 percent, so the fit is to be built.
Its before-and-after figures on the Mac, the iPad and an S24-class phone are still owed by the task.

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
- The fit ships only when the measured saving is at least 0.3 ms on the Mac and at least 0.3 ms on
  a phone, the picture is unchanged, and the new pass costs less than half the saving.

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

The loop costs 2.25 ms of S3's 4.24 ms frame. The census says the fit removes about half the listed
lights, so the predicted saving is about 1.1 ms, less the extra clustering work that the longer list
adds. That is more than three times the Mac's floor of 0.3 ms.

## Decision

- Occupancy words: not built. Reopen only when a list stops being packed, or when a light table
  sorted by position is shown to leave the picture unchanged.
- Depth-fitted slices: build it. The ceiling clears the floor on the Mac by more than three times,
  and the census says the fit recovers about half of it.
- Before the task closes, the before-and-after figures are owed on the Mac, the iPad and an
  S24-class phone, with the pictures unchanged and the new pass costing less than half the saving.
- Built: the light grid's words begin with an eight-word header that holds the slicing. A
  one-thread dispatch at the start of the light-clustering pass fits the slices to the depth that
  the last frame measured and writes the header. A reduction pass after the camera view's opaque
  pass samples one texel of each block of 16 and writes the nearest and farthest reversed depth
  into one buffer that the fit reads; a multisampled depth is read at its first sample. WebGL2
  keeps the CPU's slicing in the frame uniform and its old slice lookup, so that path reads no
  header and pays nothing new.
- Costs: the reduction reads the scene depth, so a frame with a local light cannot keep its depth
  in transient memory. The graph declares the pass only when the camera sees a local light, so a
  scene without one pays nothing. A lit fragment reads the header's eight words once.
- WebGL2 keeps today's slicing as its documented fallback. The pictures stay identical, because a
  light out of range multiplies to exactly zero.

## Consequences

- The header read is paid on every lit fragment in every scene, including scenes with few lights.
  That is why the new pass must cost less than half the saving.
- The fit can lag the depth range and can be approximate. Correctness never depends on it, because
  the end slices stay open. Only the size of the win depends on it.
- The task's finish line needs the before-and-after figures on the three devices. The ceiling only
  sets the bound that those figures must fall inside.
