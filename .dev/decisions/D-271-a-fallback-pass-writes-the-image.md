# D-271: A compute pass's fragment form writes the image, not the row index

Status: decided by the measurement below. Built: the fragment form's row turn, the turn of a pass
map's read in the shader build, and the value that the store writes for a turned map. Owed: the run
that proves it on all three paths, and the two `kept` pictures' WebGL2 failure, which is a separate
fault. Task: M3-V13.

Summary: A compute pass's fragment form wrote each texel at the row index that the compute form uses.
WebGL2 counts a texture's rows from the bottom and WebGPU from the top, so the form's image came out
upside down against the compute form's. A page that reads the pass, or samples it with `v`, saw the
mirror. The fragment form now writes the image's rows, and the shader build turns a pass map's read so
every sketch's `textureLoad` arithmetic keeps the index it names.

## Question

The ocean's transform keeps its field in a compute pass of several layers, and reads it back on three
paths (`tests/image/ocean-waves.spec.ts`). On WebGPU and in compatibility mode the field matches the
same transform on the page's thread within 0.004 m of a field of 0.73 m. On WebGL2 the field is the
thread's own field, but a read of the pass finds it mirrored top to bottom. Which form is wrong, and
where?

## Rule

- A compute pass and its fragment form give a page the same image of the pass's texture, as the docs
  promise: a texture that a material samples with `v`, and a region that `render.readPass` returns.
- A sketch's `textureLoad` of a pass's texture keeps the row index that its shader names, so a chain
  of passes, as the ocean's transform, the wind add-on's field and `crowded-read` use, works without
  knowing the path.
- A texture from a file or data keeps the row index its texels were given.

## Data

The fragment form writes row `id.y` of the target through `gl_FragCoord`, and the compute form writes
the same index through `textureStore`. The two agree on the index. They put that index at opposite
ends of the image, because WebGL2 counts a texture's rows from the bottom and WebGPU from the top.

The field is not wrong. On WebGL2, reading the pass at the image's row 6 returns the texels that the
page's transform gives at its row 118, and a read there matches that transform within 0.004 m on both
bands (0.0039 m of a field of 0.733 m, and 0.0010 m of 0.413 m). Reading the image's row 118 gives the
same field as reading row 6 on WebGPU.

The map is not wrong. `compute-state`'s `map` case binds a known two-layer texture as a fragment
form's map, copies it per layer and reads a texel of each layer back. The value, the column and the
layer the map gives arrive right on WebGPU, in compatibility mode and on WebGL2.

The block, the pass's size in texels, the layer of each draw and the sketch time are right too: the
stage, the texels written and the alpha that carries the time were each probed and read back
unchanged on both paths.

Two `compute-state` cases fail on WebGL2 and not on the other paths: `a stopped pass keeps its image
and its alpha` and `a cadence's skipped frame keeps the image a material samples`. The pass's texture
reads black through a standard map and white through a custom shader's missing-map guard, so the
texture reads as not ready. The same two fail with this branch's format change reverted, so they are
not that change's. The mirror does not explain them: a uniform image stays uniform under a mirror, and
the pass writes one white texel everywhere. They are a second fault of the same path, and the record
below keeps them apart from this fix.

## Decision

The fragment form writes the **image's** rows. When it draws on WebGL2, the wrapper turns the row it
computes from `gl_FragCoord` so that the row index becomes the image's row, as on WebGPU. The compute
form needs no change: its target's row order is already the image's.

A pass's map is then read at the image's rows, and a sketch's `textureLoad` names the index that the
texel was written with. To keep a chain's arithmetic, the shader build turns a read of a **pass's**
texture on WebGL2: the row it names becomes the image's row of that index. A texture from a file or
data is read unturned, because its texels keep the rows they were given. The engine knows which maps a
pass gives, as it knows their layers, so the turn travels with the layer that the store writes for each
map slot.

Rejected: turning only `render.readPass`. That fixes the read and leaves a material that samples the
pass with `v` drawing the mirror, as the ocean's surface would.
Rejected: turning every map's read. A texture from data, such as the ocean's spectrum, would then be
read mirrored against the CPU's own transform.
Rejected: turning data uploads to match. It changes every data texture's picture and the wind add-on's
field, for a fault that belongs to the pass's target.

## Consequences

- `render.readPass` and `textures.fromPass` keep their docs: a read returns the image's rows, top
  first, and a sampled pass stands upright with `v = 0` at its bottom row. The fragment form is what
  changes.
- A sketch that reads a pass's texture through `textureLoad`, as the ocean, the wind add-on and
  `crowded-read` do, keeps its arithmetic on both paths. The turn is a runtime value of its map slot,
  so one compiled shader serves a map that a pass gives and one from data.
- The ocean's WebGL2 test drops its expected failure, and the demo's WebGL2 tier and its picture
  follow, when this fix lands.
- The `kept` cases' not-ready texture on WebGL2 is a separate fault of the same path. The branch that
  fixes the mirror records it and does not claim it.
