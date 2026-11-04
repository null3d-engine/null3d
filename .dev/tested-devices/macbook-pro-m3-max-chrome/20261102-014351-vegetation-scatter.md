Plans: `vegetation-scatter` on this Mac's own Chrome, 156.0.8078.79 on macOS, on both GPU paths,
at the milestone head `a3606f16f`. The plan places Creek's
valley from one seed and reads back the checksum of the point list, so a difference of one bit in any
float fails it. The run is the same plan the cloud devices drew on 2 November, taken so that the one
row still on the older reference carries the current one.

Result: 2 passed, 0 skipped, 0 failed.

| Path | Placement | Worst frame of the placement | Ground maps | Plants | Checksum |
| --- | --- | --- | --- | --- | --- |
| WebGL2 | 5.77 ms | 6.35 ms | 27.98 ms | 956 | 3358570449 |
| WebGPU | 5.21 ms | 5.85 ms | 21.57 ms | 956 | 3358570449 |

## What the figures say

Both paths placed the same 956 plants at the same checksum as the iPad Pro 13 in Safari and the two
Android phones in Chrome, so one seed gives one placement across a second and a third JavaScript
engine and across both graphics paths.

The placement reads no GPU: it is the page's own CPU time, which is why the two paths differ by half a
millisecond on this machine rather than by the work the GPU does. The ground maps are the larger cost
of the two, and they too are CPU work over the height field.

## What this row replaces

The earlier Mac row used the reference before the species records changed the room each plant keeps:
955 plants at checksum `916344353`. It was the only row in the task's evidence still on the older
reference, and the plants' count and checksum here match the current one.
