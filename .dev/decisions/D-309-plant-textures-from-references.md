# D-309: the plant core's leaf and bark textures come from the reference set, as ETC1S KTX2 files

Status: decided. Built: the texture tool, `bun run plants:textures`, and its pin. Also built: the pedunculate oak's files of both sets in `@null3d/vegetation-textures`. Not built yet: the other species' textures, which each species package writes with the tool. Task: none.

Summary: a committed tool makes each species' leaf and bark textures from the private reference repository at a pinned commit. It writes ETC1S KTX2 files in a full set and a half set for the Low preset, and a page fetches only the species it places. The oak's full set measures 870 KB and its half set 252 KB, under the owner's caps of 1 MB and 0.35 MB.

## Question

The first generator painted every leaf and bark texture in the browser, and they looked painted. The owner ruled that the textures come from the reference pictures and ship as compressed files. How does the tool make them, in which format and at what size? A page must download only what it places, and each species must stay within its cap.

## Rule

- The textures come from the reference set's texture pictures: slot 24 (leaf upper face), 25 (lower face), 26 (trunk bark), 27 (a second bark zone) and 28 (young bark). The tool reads no other folder of the repository.
- The same sources give the same bytes on every machine, so a maintainer can rebuild and compare.
- With the full set, a species' download stays under 1 MB. With the half set, it stays under 0.35 MB.
- Silver birch, Scots pine and quaking aspen have a second bark zone. The owner allows them 1.3 MB and 0.4 MB. Only the owner raises a cap.
- A page loads a species' files the first time it prepares the species. It never loads them with the add-on's code, and never loads another species' files.

## Data

The oak's files at the encoder's default ETC1S quality of 128, against the design's estimates from the apple tree's pictures. Sizes are KB of KTX2 file, 1,000 bytes each:

| File | Full set | Half set | Estimate, full | Estimate, half |
| --- | --- | --- | --- | --- |
| Leaf color, upper and lower faces with coverage | 226.6 | 73.5 | 178.5 | 60 |
| Leaf relief, an array of one layer | 68.1 | 18.9 | 107.1 | 35 |
| Bark color | 196.2 | 54.7 | 207.7 | 65 |
| Bark relief | 256.9 | 73.6 | 236.6 | 70 |
| Young bark color and relief, at 512 and 256 | 122.5 | 30.9 | about 100 | about 30 |
| The set | 870.4 | 251.7 | 834 | 264 |

How the data was produced: `bun run plants:textures pedunculate-oak` on an Apple M-series Mac. It read the reference set's working state with `--from`. `--verify` in Bun and in Node gave the same bytes. The half-set estimates split the design's measured total by file.

The tool's own figures for the oak:

- The lower face fits the upper face's outline with an overlap of 0.97.
- The leaf's coverage at the alpha cutoff stays at 0.364 of the canvas from 1024 texels down to 16, within 0.0012.
- Across the bark tile's wrapping edge, the color step is 0.96 of the mean step between neighbors inside the tile. Down the tile, it is 0.90. No seam shows at 4 × 4 repeats.

## Look

The reference pictures look better than painted textures. They hold each species' real lobes, veins, plates and lenticels. The tool keeps that look and removes three faults:

- The cut-out's haze. Generated leaf pictures keep a faint halo round the leaf in their cleared background. The tool clears coverage below a floor. Each texel short of full coverage takes the color of the leaf's own texels nearby, and so does the outermost ring of full coverage. Mip levels then mix the edge with the leaf's color, never with a halo.
- Baked light. The tool divides out the picture's broad shading. On a leaf it divides out luminance. On bark it divides out each color channel, because a round stem's sheen and a band of moss would repeat as stripes along a branch.
- Seams. The tool cuts each bark edge where the two sides differ least, then blends across the cut over a few texels.

UASTC keeps more detail, but it is five to six times larger. The apple's bark relief at 1024 measured 1,337 KB in UASTC and 237 KB in ETC1S. UASTC would put every species over its cap, and ETC1S keeps the look within it.

## Decision

- **The tool** is `tools/plant-textures/`. It reads `generated/<species>/` of `null3d-engine/plant-references` at the commit in `tools/plant-textures/pin.json`. It fetches that commit once into the cache that every copy of the repository shares. Git fetches only the commit's tree, and each picture only when the tool reads it. Git checks every object by its hash.
- **Local sources.** `--from <dir>` reads a folder of the same layout instead, and the manifest records the commit as `local`. `--pin` changes the pin, which lives in one file.
- **The file of a slot** is the one `<slot>-*.png` that the species' INDEX.md does not mark "Superseded by". A published folder holds only the file in use for each slot, under its planned name. A folder that still holds replaced files marks them superseded, and their remakes carry a `-b` or `-c` suffix. Two files in use for one slot stop the tool.
- **Provenance.** The manifest records each source's name and SHA-256, and its generation job from the folder's `jobs.jsonl`. A line there names its file as it was made; a file renamed when the set was published carries its `final_name`, which the tool matches first. A line marked `"in_repository": false` made a file the folder does not hold, and the tool skips it.
- **Inputs a species tunes** live in `source.json` in its texture folder. They are its slots and the meters a bark tile covers. They include the furrows' depth and a blur that drops a picture's fine cracks before the height field. Crops, the ETC1S quality of a file that must shrink, and a bark layer's optional `tint` are there too.
- **A bark layer's tint** is three linear numbers, multiplied channel by channel into that layer's baked color. A bark's young color belongs to the species' wood. No single photograph carries all of it. The picture that feeds the young layer may hold older bark than the shoots the engine draws with it. The tint steers the layer toward the species' own tone. It leaves the relief and the height field alone, which read the picture before the tint. The manifest's mean records the tinted tile. A layer that gives no tint bakes byte for byte as it did before the field existed.
- **Leaves.** The tool cleans each face and frames it upright on a 1024 canvas. The midrib lies on the middle column, the stalk at the bottom, and the leaf's extent is centered.
- **The lower face** is fitted to the upper face's outline by small turns, scales and shifts. A photograph of a leaf turned over shows its outline mirrored. A generated underside may keep the upper's outline as drawn. So the tool takes whichever fits better. One set of texture coordinates serves both faces, and a back face samples the lower layer at the same coordinates.
- **Leaf relief** comes from the upper face's luminance: sunken veins and the puckering between them. It fades to flat at the leaf's edge.
- **Bark.** The tool takes a square of the picture, divides out its shading and makes it tile. A height field comes from its luminance at seven scales, blurred first by the layer's `smooth` texels so a photograph's fine cracks do not become ridges over its plates. Its 2nd to 98th percentile spans the species' furrow depth. The relief map comes from that height. The manifest keeps only the height's mapping from luminance, and the shader reads height from the color.
- **Files.** Every KTX2 file is ETC1S with every mip level. The relief maps use the encoder's normal preset. The engine reads a KTX2 file's first row at v = 0, so each file stores the picture's bottom row first.
- **Arrays.** The leaf color, the leaf relief and both bark maps are texture arrays. The encoder writes an array of one layer as a 2D texture, so the tool sets its layer count to 1. The engine loads it as a texture of one layer, which a `texture_2d_array` slot takes. `tests/image/plant-textures.spec.ts` draws every file of both sets on WebGPU, compatibility mode and WebGL2. Bark tiles filter their mip levels across their edges.
- **Coverage in mip levels.** The encoder makes every mip level from the top one and takes no levels of its own. ETC1S levels share one codebook, so levels encoded apart cannot join into one file. So the tool cannot rescale coverage per level. The oak's coverage holds within 0.0012 without it, because a cleaned leaf is solid inside with a one-texel edge. The tool prints the figure for every species, so a species whose coverage falls shows it.
- **The package.** The files live in `@null3d/vegetation-textures`, a package of data only, so code updates do not carry them. This is the owner's ruling. Each species folder holds the twelve files, the manifest and a module. The module's literal `new URL(..., import.meta.url)` expressions let every bundler emit the files apart.
- **Git keeps the files**, as [D-105](D-105-generated-files-out-of-git.md) records, because making them needs the private references.
- **No credit line.** The reference repository stays private, by the owner's ruling, so the shipped textures need no credit.

Rejected:

- UASTC, for its size (above).
- One texture array for leaves and bark. An array's layers share one size, and young bark needs none of the trunk's texels.
- Height in the bark color's alpha. The apple's bark measured 384 KB with it and 208 KB without it.
- Painting textures in the browser, which the owner ruled against.

## A lenticel's grain is stretched by the build

Measured on the common alder's young bark, slot 28 and the built tile. The photograph's lenticels run
14.7 pixels across the branch and 9.5 pixels down it, a ratio of 1.55. The built tile carries 13.3
across and 4.6 down, a ratio of 2.92. The build therefore nearly doubles the elongation of the grain
before any species' tiling touches it, and a bark whose lenticels are its figure, as an alder's and a
birch's are, reads as long diagonal streaks on a limb where the photograph shows short dashes.

The relief pass sharpens the picture's horizontal edges and its `smooth` blur drops the fine vertical
detail, which is the likeliest cause. Nothing here is fixed: the figure is recorded so that a species
with lenticels knows the build, and not its tiling alone, sets the grain. The alder's tiling halves
the span round the stem, which takes its edge-direction mix from 0.401 to 0.309 and costs 0.32 of a
colour step; that trade is the species' own and is recorded in
[D-335](D-335-common-alder-follows-its-whole-views.md).

## Consequences

- `bun run plants:textures` writes a species' folder, and `--verify` checks it. The textures package's test checks every committed file against its manifest, without the references.
- A species package writes its `source.json` and runs the tool. The per-species test checks its record's download budget against the manifest's outputs.
- The command-line tool decodes every PNG through `decodePngFile`. It works round a fault in fast-png's inflater that garbled large pictures ([Implementation notes](../implementation-notes.md#the-asset-tool)).
