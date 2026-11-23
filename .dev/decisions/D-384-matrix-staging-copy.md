# D-384: a frame keeps its own copy of the matrix rows it changes

Status: decided. Task: the island showcase's engine work.

Summary: The cull fix stages every changed row's matrix in the frame's upload arena, so a frame
that changes every row holds one full copy of its matrix rows. Turning the sun's shadow off moves
that need by 64 KB, so a frame that a full load refuses cannot record again by that change: the
test that expected it is removed, and the shadow bound keeps its coverage at the large load.

## Question

Should a frame reference the live matrix rows to save a full copy of them, or hold a copy of every
row it changes?

## Rule

A frame draws only the matrices it copied: the live rows may change under a frame in flight, and a
frame that draws them can show a matrix from another frame. Saving memory may not change what a
frame draws.

## Data

| Measure | On this Mac, head `72c8b460f` |
| --- | --- |
| Full load, 2,095,104 rows, after frame 1 | 649,031,117 bytes held |
| Frame 1 with the sun's shadows on | 979,304,777 held; refused a padded 134,086,656 block, request 150,847,488 |
| Frame 2 after `set_sun_shadow(None)`, full load | 953,096,997 held; refused, reported `OutOfMemory { bytes: 134,150,720 }` |
| Frame 2 after `set_sun_shadow(None)`, large load, 1,300,000 rows | refused, reported `OutOfMemory { bytes: 83,264,064 }` = 1,300,000 × 64 plus the spare |
| What turning the shadow off gives back | 64 KB of the need |

How the data was produced: the lead's measurements at this head, reproduced here for the full
load (`OutOfMemory { bytes: 134,150,720 }`) and for the large load. An earlier run of the same
large-load test passed in a copy of `6318ce333`; the head's matrix staging changed
`crates/null3d-render/src/gpu_driven/layout.rs` by 74 added lines, and that is what moved the
need. A passing frame prints no held or request figures, so the earlier pass has none to quote.

## Look

No look changes: the same matrices draw the same frame.

## Decision

Keep the copy. The test `a_frame_records_again_when_a_shadow_the_bound_counted_turns_off` is
removed, because its scenario cannot happen: the frame stages a full copy of the rows it changes,
the shadow's bound is 64 KB of that need, and any frame that the memory maximum refuses misses it
by far more. The shadow bound stays proved by
`a_large_load_records_when_the_frame_counts_only_the_shadow_views_that_draw`, and a refused
frame's recovery by a smaller load by
`a_first_frame_that_cannot_fit_records_again_once_the_load_drops`.

## Consequences

A page that changes every row of a full load needs a smaller load or a higher memory maximum. The
renderer keeps its copy of each changed row; nothing draws a stale matrix.
