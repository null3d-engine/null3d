# D-264: Light clusters: depth-fitted slices and occupancy words

Status: open. The ceiling measurement is owed, and no figure is recorded for it. Date: 2026-10-26. Task: M3-R9.

Summary: null3D lists each cluster's lights in a packed index list, so the shading loop walks exactly
the lights that reach the cluster and never meets an empty group of 32 lights. Occupancy words
therefore add nothing to this design. A census of S3, the many-lights benchmark, shows that
depth-fitted slices would halve the average number of listed lights per shaded fragment, from 14.6
to 7.5, and raise the index list from 2,470 to 5,458 entries, or 8 percent of its cap. The ceiling
measurement that decides whether to build the fit is owed. The window closed because sessions kept
starting work in their own checkouts, so the machine could not be kept empty.

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

### The ceiling protocol

The ceiling is not measured. The plan, when a machine can be kept empty: S3, WebGPU, the High
preset, 1280 by 720 pixels, the governor off. The two sides are two builds of one commit that
differ by one compute shader, which writes empty light lists, so every fragment shader is identical.
Each side runs three rounds in turn, with 5 s of warm-up and 10 s measured, and the one-minute load
is recorded before and after every run. A ceiling below 0.3 ms ends the task as this record. A
ceiling of 0.3 ms or more buys the fit, and the rule above decides whether it ships.

## Decision

- Occupancy words: not built. Reopen only when a list stops being packed, or when a light table
  sorted by position is shown to leave the picture unchanged.
- Depth-fitted slices: not built yet. The ceiling is owed. The window closed because sessions kept
  starting work in their own checkouts.
- The implementation shape is a depth reduction pass, header words in the light grid, and the slice
  arithmetic moved into the clustering shaders. It is 12 files and about 540 lines, or one and a
  half to two days with the runs.
- WebGL2 keeps today's slicing as its documented fallback. The pictures stay identical, because a
  light out of range multiplies to exactly zero.

## Consequences

- The header read is paid on every lit fragment in every scene, including scenes with few lights.
  That is why the new pass must cost less than half the saving.
- The fit can lag the depth range and can be approximate. Correctness never depends on it, because
  the end slices stay open. Only the size of the win depends on it.
- If the ceiling comes back below 0.3 ms, this record is the task's answer, with the census and the
  ceiling as its numbers.
