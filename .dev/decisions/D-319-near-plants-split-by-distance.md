# D-319: near plants draw real shoots inside one split per copy, by falling leaf tier, within a drawn-triangle budget

Status: decided. The near pool, its WebAssembly task, the placement of real kits, the wind records,
the level switches and the far bake are built. The per-frame budget holds the owner's near caps. The
four test devices' figures are measured: at the caps the near pool's own cost stays within D-241's
5 ms at Low and 12 ms at Medium on the Apple devices. Task: none.

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

The plant core's design ([D-323](D-323-plant-core-three-scales.md)) and the lead's ruling on near
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

### Each copy is measured by its crown

The engine measures a row's levels and draw ranges to the nearest point of the row's sphere, which
stays centred on the row. Rows at a copy's foot needed a sphere that held the whole crown from
there, so a broad crown read far nearer than it stood and kept its nearest wood well past the split.
A copy's rows now stand at its crown's centre. Their values carry that centre in the plant's own
meters, and the plant shader takes it back off every point, so the copy draws where it stood. The
sphere holds the farthest wood and the farthest shoot from the centre, so it matches the sphere by
which the near pool picks near copies. From an eye one split beyond the oak's crown, the copy
measures 0.8 to 1.1 splits away; the sphere round the foot read under three quarters of one. Each
of the centre's numbers is a half float, so a device that keeps row values at half precision reads
it exactly, and the near task writes only a card row's first value, its split.

### Near cards cast no shadow inside the split

A near copy's real shoots cast its shadow inside its split. Its cards' coverage in the shadow
caster gives way there as their pixels do, measured from the scene camera, whose inputs a caster
takes, so the leaves' shadow is cast once. The near band test's shadow view holds it: the ground
under one oak must take the shoots' shadow alone.

### Far cards keep their leaves

A card atlas's mip levels average the leaves' coverage with the gaps between them. Far away a
card's alpha falls under the cutoff, and its leaves vanish: the oak's first card level at 64 m
showed bare wood beside a far card of a whole crown. A card's alpha rises by a quarter for each mip
level that its sample reads, which keeps the share of the card that leaves cover near the full-size
texture's. The engine makes a texture's mip levels itself, so a coverage-keeping atlas of levels made
on the CPU was not open to the add-on.

### Fixed placements and the pool share each near table

A species' near table holds the places of the copies that draw real shoots. Fixed placements take
slots from its bottom with `reserveNearSlots`; the pool takes the slots above them and clears only
its own. Both write one CPU copy of the table and send it whole, so neither loses the other's slots.

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

Placement scales the asset's own switch distances, measured at the reference view, to the page's
view and bias, so an asset whose impostor starts at once, as a review forces it, draws its far card
alone. A far card row keeps the card's size times its copy's scale. The stand-ins' far cards take
the copy's scale alone and draw about a meter across; their pictures stay frozen until the demos
move to real species.

### The wood draws without the mask

The wood's alpha is always 1, yet it drew through the masked build, which discards after the
lighting and stays out of the depth prepass. It now draws in the opaque mode from the plant shader
without the casters' coverage function (`render/wood.wgsl`, written from `plant.wgsl` and held to it
by a test). On the near shoots page at Medium it took the frame from 132.1 to 108.4 ms of GPU time
on the iPhone 17's WebGPU, and from 16.8 to 13.5 ms on the Mac's WebGPU in Chrome.

## Device figures

The `near-shoots` plan (`tests/pages/near-shoots.html`) draws a stand of six oaks from under the
first crown at each preset, with no near shoots, at the preset's budget and at twice it. GPU time
per frame in ms, or the frame interval where the device has no GPU timer (WebGL2 in Safari, and
WebGL2 on the Galaxy S25), with the masked prepass and the wood's own draw path in place. The
iPhone 17's pages and the iPad's WebGPU Low and Medium pages ran on `834da3b90`; every other page
ran on `df024bf02`. The records sit in `.dev/tested-devices/`.

| Device, path, preset | No shoots | Budget | Twice the budget |
| --- | --- | --- | --- |
| iPhone 17, WebGPU, Low | 10.4 | 11.9 | 13.5 |
| iPhone 17, WebGPU, Medium | 41.6 | 47.4 | 57.0 |
| iPhone 17, WebGPU, High | 47.9 | 58.2 | 67.6 |
| iPhone 17, WebGPU, Ultra | 58.9 | 82.4 | 100.4 |
| iPhone 17, compatibility, Low | 10.4 | 11.8 | 13.3 |
| iPhone 17, compatibility, Medium | 46.6 | 52.0 | 61.4 |
| iPhone 17, WebGL2, Low (interval) | 16.1 | 16.3 | 20.0 |
| iPhone 17, WebGL2, Medium (interval) | 24.0 | 28.9 | 56.2 |
| iPad Pro 13, WebGPU, Low | 6.0 | 6.2 | 6.5 |
| iPad Pro 13, WebGPU, Medium | 20.6 | 23.5 | 27.7 |
| iPad Pro 13, WebGPU, High | 24.5 | 28.9 | 33.0 |
| iPad Pro 13, WebGPU, Ultra | 29.1 | 38.9 | 47.5 |
| iPad Pro 13, compatibility, Low | 6.1 | 6.4 | 7.0 |
| iPad Pro 13, compatibility, Medium | 22.6 | 25.6 | 29.7 |
| iPad Pro 13, WebGL2, Low (interval) | 14.7 | 16.3 | 16.3 |
| iPad Pro 13, WebGL2, Medium (interval) | 15.5 | 16.3 | 18.5 |
| Galaxy S25, WebGPU, Low | 26.6 | 25.7 | 26.6 |
| Galaxy S25, WebGPU, Medium | 27.4 | 27.7 | 32.4 |
| Galaxy S25, WebGPU, High | 26.8 | 34.3 | 44.0 |
| Galaxy S25, WebGPU, Ultra | 34.2 | 109.6 | 76.3 |
| Galaxy S25, compatibility, Low | 26.5 | 25.7 | 26.7 |
| Galaxy S25, compatibility, Medium | 27.9 | 27.9 | 53.6 |
| Galaxy S25, WebGL2, Low (interval) | 108.7 | 32.9 | 25.0 |
| Galaxy S25, WebGL2, Medium (interval) | 30.1 | 36.0 | 45.5 |
| Galaxy Tab A9 Plus, compatibility, Low | 533.1 | 543.8 | 597.6 |
| Galaxy Tab A9 Plus, WebGL2, Low (interval) | 500.0 | 555.6 | 555.6 |
| Galaxy Tab A9 Plus, WebGL2, Medium (interval) | 1000.0 | 1666.7 | no frame |

### The budgets

The near pool's own cost at the preset's budget, over the page with no near shoots, in ms:

| Device | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| iPhone 17, WebGPU | 1.4 | 5.9 | 10.3 | 23.5 |
| iPhone 17, compatibility | 1.3 | 5.4 | | |
| iPhone 17, WebGL2 (interval) | 0.2 | 4.9 | | |
| iPad Pro 13, WebGPU | 0.2 | 2.9 | 4.4 | 9.9 |
| iPad Pro 13, compatibility | 0.3 | 3.0 | | |
| iPad Pro 13, WebGL2 (interval) | 1.6 | 0.8 | | |

The capped rows cost 1.4 ms at Low and 5.9 ms at Medium on the iPhone, and 0.2 and 2.9 ms on the
iPad. Those figures sit inside D-241's 5 ms at Low and 12 ms at Medium for the add-on. Twice the
Medium budget draws the rows that the budget trims. It costs 15.4 ms on the iPhone and 14.8 in
compatibility mode, past the 12 ms allowance, so the cap must stop there. High and Ultra take the
caps themselves: 10.3 and 23.5 ms on the iPhone, and 4.4 and 9.9 on the iPad.

The Galaxy S25's figures are guides. Its GPU clock falls through a long run, and at Ultra the page
at the budget read 109.6 ms against the page at twice it. A later page can therefore read faster
than an earlier one. There the near pool adds nothing that the spread can see at Low or Medium, and
7.5 ms at High.

The Tab A9 Plus's capabilities page reports a WebGPU adapter, with core features and limits and a
working compatibility adapter. The plan ran compatibility mode at Low and WebGL2 at Low and Medium,
where the quality chooser gives it Low. In compatibility mode the near rows add about 11 ms to a
533 ms frame, so its cap needs no change. Its WebGL2 pages draw 9 to 10 frames in 5 seconds at Low,
and the page at twice Medium's budget drew none, so Medium is past what the device draws.

The caps stand as `NEAR_CAPS` sets them: one, three, six and ten copies with half a million, 1.5, 5
and 10 million triangles at Low, Medium, High and Ultra.

### Where a Medium frame goes

The `near-breakdown` plan takes the Medium frame apart, one change at a time. The frame draws 9.25
million triangles on both paths, 7.8 million of them in the three shadow cascades. WebGPU counts 192
draws to WebGL2's 97: its GPU-driven bundles record one indirect draw per bucket and part in every
view whether or not a row survives culling, and WebGL2 skips empty buckets. GPU time per frame in
ms, with the wood unmasked and before the masked prepass landed, which is why the unchanged frame
here reads above the device table's:

| Change | iPhone 17, WebGPU | Mac WebKit, WebGPU | Mac Chrome, WebGPU |
| --- | --- | --- | --- |
| None | 108.6 | 36.3 | 13.5 |
| No MSAA | 16.7 | 5.7 | 13.2 |
| Leaves alone | 109.0 | 33.0 | 8.4 |
| Leaves alone, drawn whole without the mask | | 8.5 | |
| Every leaf drawn whole without the mask | | 16.7 | |
| Wood alone | 25.7 | 8.7 | 4.6 |
| Far cards alone | 9.1 | | 3.5 |
| Leaves' masks without alpha to coverage | 106.9 | | 17.5 |
| 16-bit scene color | 108.3 | | |
| No HDR | 121.6 | | |
| Full-precision shading | 109.0 | | |
| No light through the leaves, no shine | 87.3 | | 16.6 |
| No sun shadow | 49.2 | | 6.0 |
| Depth prepass on | 110.4 | | 17.6 |

The Mac's WebKit and Chrome figures come from different hours of a loaded machine, so only each
column's ratios compare. The cost is the masked leaves under MSAA in WebKit's WebGPU, layer upon
layer: Chrome draws the same frame on the same GPU at a sixth of the time. The main pass is not the
cause: WebGPU's holds 8 bytes a sample (rg11b10ufloat color and depth32float, both resolved or
discarded in the pass), WebGL2's 12. No plant or engine shader of the frame shades per sample. The
`alpha-mask-cost` page with `?layers=8` shows it without plants: eight masked curtains under MSAA
take 6.48 ms against 1.37 ms opaque in WebKit, and 2.57 against 1.67 ms in Chrome; without MSAA
WebKit takes 1.48 against 0.53 ms.
