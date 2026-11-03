# D-319: near plants draw real shoots inside one split per copy, by falling leaf tier, within a drawn-triangle budget

Status: decided. The near pool, its WebAssembly task, the placement of real kits, the wind records,
the level switches and the far bake are built. The per-frame budget holds the owner's near caps;
its figures on the four test devices are not measured yet. Task: none.

Summary: a tree never draws whole with real leaves. Each copy in the near pool draws its real shoot
rows nearer than one split distance and its own cards beyond it, with a thin overlap that the
engine's dither crosses, so no pixel pops or opens. Inside the split the leaf mesh tier falls with
distance in up to three bands. A per-frame budget of drawn triangles holds every near shoot of the
scene; past it, the near task cuts every chosen copy at one nearer distance, nearest rows first, and
gives the copy that distance as its split. The frame-budget governor halves the budget under load.
One copy of the grower's oak with the leaf package's test shoots draws 26.7 million triangles at
High with every row whole, and 7.8 to 9.4 million inside its near band with the falling tiers,
before the budget cuts it to the preset's figure.

## Question

How does a scene draw real leaves near the camera without paying for whole trees of them, keep the
hand-over to cards invisible, and stay within a frame's budget on every preset and GPU path?

## Rule

The plant core's design ([D-305](D-305-plant-core-three-scales.md)) and the lead's ruling on near
foliage: one split per copy, real shoot rows nearer than it and the tree's own cards beyond, a thin
overlap, no pop and no hole; the leaf mesh tier falls with distance inside the near band; a
per-frame drawn-triangle budget for all near foliage per preset, which the governor halves under
load; the caps of `NEAR_CAPS` per preset (copies 1, 3, 6, 10; triangles 0.5, 1.5, 5 and 10
million); no loop over rows or copies in TypeScript in a frame (hard rule 42); no allocation in the
pool's per-frame call (hard rule 1); 16-bit wind ids on WebGL2 (hard rule 23).

## Data

Measured on the self-organizing grower's oak with the leaf package's oak shoots and leaves (seed
11, 12 prototypes with their winter twins, about 160 triangles a leaf at High), on a Mac in Bun:

| Figure | Variant 0 | Variant 1 | Variant 2 |
| --- | --- | --- | --- |
| Shoot rows | 11,485 | 11,283 | 16,599 |
| Axes, each with its own wind record | 2,805 | | |
| Split distance at 1080 pixels and 60 degrees | 16.2 m | 16.2 m | 16.2 m |
| Every row whole, High tier | 26.7 M | 24.8 M | 35.8 M |
| Inside the band from the trunk, Low tiers | 6.46 M | 6.02 M | 8.00 M |
| Inside the band from the trunk, High's three tiers | 8.29 M | 7.78 M | 9.36 M |
| Inside the band from the crown's middle, High | 10.82 M | 9.80 M | 13.70 M |
| Inside the band from the crown's edge, High | 3.56 M | 2.93 M | 3.16 M |

The level switches at the reference view: first card level at 16.2 m, second at 85 m, impostor at
110 m. The far bake of the first card level takes about 2 s on the CPU.

The near task's module is 19 KB. One call walks at most 16 copies' rows; the TypeScript count of
one copy's drawn triangles and the module's agree exactly.

The near band test (`tests/image/plant-near-band.spec.ts`) walks a stand of six oaks from three
spots, drawn black on white: the split, the shoots alone and the cards alone. No pixel that both the
shoots and the cards cover is open in the split, on WebGPU, compatibility mode and WebGL2, on a Mac's
GPU. The pool's figures:

| Spot | High (WebGPU): copies, triangles of 5 M | Medium (compatibility, WebGL2): copies, triangles of 1.5 M |
| --- | --- | --- |
| Under the first crown | 4, 4.999 M | 3, 1.497 M |
| Between two crowns | 3, 4.986 M | 3, 1.500 M |
| Where the band crosses several crowns | 2, 0.810 M | 2, 0.810 M |

The pool's per-frame call allocates nothing on WebGPU or WebGL2 under Chrome's heap profiler
(`tests/image/near-pool-allocation.spec.ts`).

## Choices

### One split per copy, carried by the copy's card rows

The design gave each card row a flag beside one split distance in a uniform. A budget cut must move
the split of the copies it cuts, so each card row's value now carries its copy's own split in
meters, 0 for a copy that draws no shoots. The cards discard their pixels nearer than 96 per cent of
it. The shoot rows' last band ends at 104 per cent of the page's split, where the engine thins them
over its last eighth, so they are gone only where the cards draw. A copy that the caps leave out
stays all cards, so a cap never opens a hole.

Rejected: changing the shoot batches' draw ranges for each cut. A range change rebuilds the
engine's draw tables, and it would move every copy's band, not the cut copies'.

### Leaf tiers in bands of distance

Each prototype has one shoot batch per tier band, each with a fixed draw range: the pool's tier to a
quarter of the split, the tier below to half, the tier below that to 104 per cent. A band starts at
the previous band's end over 1.08 squared, so the next band is whole before the previous one thins
and a row in the overlap goes into both batches. Most of the band's ground draws the coarsest tier:
the nearest quarter of the split holds a sixteenth of the area round the eye. A kit holds its own
tier and those below it, so the nearest band never asks for a tier the kit lacks.

### A budget of drawn triangles, cut nearest first

The near task bins the triangles that the chosen copies' rows would draw by distance, in 512 bins,
and keeps the bins from the eye out while their sum stays within the budget. Every chosen copy is
cut at the same distance, so the nearest leaves of every tree draw first. The card rows of a cut
copy take the cut, less the meters the camera may move before the next answer, over 0.96. The
budget counts every band a row stands in, and rows behind the camera too, since the shadow maps
draw them.

The budget is a quality setting of the add-on's feature, with the governor's `scale` steps and a
budget floor of one half: under load the governor lowers the triangle budget to half of the preset's
figure, and the stats overlay shows the governed figure.

### The per-species check counts what a copy draws inside its band

The check that every species takes no longer counts one copy with every shoot row whole. It counts
what one copy draws inside its near band at High, with the falling tiers, from the worse of two eyes
where a person stands: under the crown at eye height, and at the crown's edge. That figure stays
within the species' own `lod0Triangles` and within High's per-frame budget. An eye inside the crown
is left to the pool: its budget then draws that copy's shoots out to a nearer split, which thins no
leaf below the references. The pedunculate oak's own record, with its fitted shoots, draws 1.98
million triangles from the trunk and 0.50 million from the edge, and 5.03 million from the crown's
middle, where the pool's budget cuts its split by about one per cent.

### The near task in WebAssembly

Placing up to 16 copies' rows in the world, finding each row's tier bands and writing the batch rows
is a loop over thousands of rows, so it runs in `crates/null3d-vegetation-wasm` on a job worker
(hard rule 42). The page reads the camera once a frame and starts the task when the camera has moved
half a meter, at most ten times a second. The answer goes into the batches with `TypedArray.set`
over views that are made once per count of 256 rows and kept, `markDirty` and `setActiveCount`.
The camera's turn starts no task: the task culls nothing by view, since the shadows draw what the
camera does not see.

### Wind ids

A variant takes up to 8,000 records, so eight variants fit 65,000. Past its share, the finest axes
share one record per parent branch, so each branch keeps its own motion and only twigs of one
branch swing together; the shoot rows take the shared ids. A child turns about the junction on its
parent's internode.

### The far bake

The far bake draws the first card level four times finer than the far atlas and keeps each texel's
share of leaf hits, raised so that three tenths meet the cards' cutoff. A ray that misses a card's
leaves goes on to the cards behind it, as on the GPU. Drawn at the far atlas's own size, a far
texel sampled one point of each card and the crown drew as a scatter of dots; filtering each card
before its cutoff thinned it further, since a filtered card never lets the cards behind it through.

## Not measured yet

The budget's figures on the iPhone 17, the iPad Pro 13, the Galaxy S25 and the Tab A9 Plus. The
owner's near caps stand until those runs.
