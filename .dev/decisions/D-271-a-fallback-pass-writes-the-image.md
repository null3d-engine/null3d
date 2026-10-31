# D-271: A compute pass's read counts the rows that its shader names

Status: decided by the measurements below. Built: the read's copy, which starts at the region's own
row on both GPU paths, and the decode, which takes the copy's order. Task: M3-V13.

Summary: On WebGL2 a read of a compute pass's region fetched rows from the other end of the target.
The decode then turned the region's rows. So `render.readPass` returned the mirror of the region
that the sketch asked for. The read now copies the region's own rows and takes their order. The
fragment form was not at fault: its texels match the compute form's.

## Question

`@null3d/water`'s ocean reads a compute pass's field back on three paths. On WebGL2 a read at the
image's row 6 returned the texels that the page's transform gives at its row 118. The fragment form
and the read each applied a row turn. A turn of the write and a turn of the read cancel. The field
alone therefore did not settle which of the two was wrong.

## Rule

- A compute pass and its fragment form give a page the same texels of the pass's texture.
- A read counts its rows as the pass's shader numbers them. The row that the compute form writes at
  index 0 is the region's row 0, on every path. A copy of a region starts at that row.
- A sketch's `textureLoad` of a pass's target keeps the row index that its shader names. A texture
  from a file or data keeps the row index its texels were given.
- A fragment form reads `input.uv` from the image's top left. The pass's texture holds its image's
  bottom row first. A form that names a compute row therefore turns the row that the docs give,
  `1 - uv.y`, as the ocean's and `compute-pass`'s forms do.

## Data

The fragment form was not at fault. `compute-pass` draws a material that samples a compute pass in
the same frame: four colored quadrants. Its WebGL2 picture matched its reference. With a turn added
to the form's row, 77.469% of the WebGL2 picture differed from its reference. The quadrants came out
in the mirror of the WebGPU path's picture. That turn also moved the `compute-vertex-offset` motion
test's plane by -2.07 px instead of 2 px, because it changes what `input.uv` means.

The read was at fault, in both of its places. `compute-state`'s `rows` case writes a 4 by 4 pass
whose red channel names its row, from 1 to 4. It reads the top two rows and then the bottom two.
With the copy's turn, and the decode taking the copy's order, WebGL2 returned rows 3 and 4 for the
top read and rows 1 and 2 for the bottom read. With the copy at each region's own row, all three
paths return rows 1, 2 and then 3, 4.

`compute-state`'s `steps` case reads a 2 by 2 region at row 1 of a 4-row pass. Its fallback named a
texel from `input.uv` without the turn that a compute row needs. The old read's two turns therefore
made the round trip agree for the wrong reason, and the case could not see the fault. Its fallback
now names the texels that the compute form names, so the case checks the read as well.

`compute-state`'s `rows-shown` case draws the image on a plane. It samples the plane at the place
that the docs give for a pass's texture. Its first row fills the frame's top on WebGPU, in
compatibility mode and on WebGL2. The case records that sampling convention, which the change leaves
as it was; `rows` is the case that fails on the old read.

## Decision

The read's copy starts at the region's own row. The decode takes the rows in the order that the copy
gives them. The target stores the texels in the order that the compute form writes them. A copy of
the region's rows therefore reads the values that the shader named.

Rejected: turning the fragment form's row. It flips the picture that a material samples (77.469% of
`compute-pass`'s WebGL2 pixels). It also moves the documented `input.uv` convention, so a sketch
that selects a row with `input.uv` must change with it.

Rejected: keeping the copy's turn and turning the decode. A read then returns the region bottom
first. The two turns still fetch the mirror of the region that the sketch asked for.

Rejected: turning every map's read, or data uploads to match. A texture from data, such as the
ocean's spectrum, keeps the row index that its texels were given.

## Consequences

- `render.readPass` and `textures.fromPass` keep their docs. A read returns the rows that the pass's
  shader wrote, in that order. A material shows a pass's image at the place that the docs give.
- `compute-state` gains two cases on all three paths. `rows` fails on the old read, so it guards the
  change. `rows-shown` records the convention that a material samples a pass's texture by, which the
  change leaves as it was. Its `steps` and `rows` fallbacks name their texels as the compute form
  does.
- `compute-state`'s two kept cases pass on all three paths in both sets. They are `a stopped pass
  keeps its image and its alpha` and `a stopped full-screen pass keeps its image and its alpha`. An
  earlier note in the review guide had them failing on WebGL2, and the runs show they do not.
