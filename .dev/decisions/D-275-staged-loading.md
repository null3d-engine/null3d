# D-275: Staged loading for whole levels and cluster bands

Status: proposed, for the owner's ruling. Built: the whole-level stages that D-228 decides, their
reader and writer, `maxLevels`, and the pick-driven holdback. Built: the cluster band stage, its
writer, and the call that appends a band to a tree. Task: M3-L4.

Summary: D-228's layout stands. A model holds its full vertex stream and its coarsest level. Each
finer level is a stage file of indices, and it refines copies in place. This record adds a second kind
to the same header: a band of a cluster tree's patches. The loader appends each band as it arrives.
`maxLevels` and the pick-driven holdback serve both, with no device check.

## Question

How do a file's levels load, so a scene draws at once and refines while it draws? What does the
loader draw while a level is missing? How does a phone skip a level that it never shows? How does one
layout serve whole levels and the cluster patch groups without a second format?

## Rule

- The page draws its first picture sooner, and a stage that never draws costs no download.
- One file layout serves whole levels and cluster bands.
- The file stays a valid glTF model that other readers draw, at the detail it holds.
- A stage costs indices alone where the levels share the mesh's vertices.
- A copy refines in place, with no new object and no flicker.
- No new allocation in a frame. A stage arrives at load time.

## Data

| Measure | Value | Source |
| --- | --- | --- |
| The staged test model's file | 69,880 bytes | D-228 |
| The same model with every level in the file | 559,672 bytes | D-228 |
| The stage files | 6 files, 6,168 to 196,632 bytes, 387,216 bytes in all | D-228 |
| The bytes that arrive after the first picture | 85% of the staged model's bytes | D-228 |
| The finest stage | 196,632 bytes, of which 98,304 indices at 2 bytes | D-228 |
| The first picture against the level limit of 1 | equal within 0.1% of its pixels | the `staged-levels` browser test |
| The first picture against the last | more than 1% of the pixels differ, and the ground covers more than 40% | the same test |
| The time from navigation to the first draw | 12,390 ms with every stage and 12,388 ms with the level limit of 1, cold on Slow 4G; the stages add 18.0 KB before the first picture and 29.3% of the download after it | `bun run bench:staged-load --runs 3` |
| A cluster band's bytes | the file 805,500 bytes, five bands of 12,900 to 204,828 bytes, 397,012 in all, 33.0% of the download | `bun packages/cli/src/assets/cluster-fixture.ts` |
| The staged cluster test, first band against the last | more than 1% of the pixels differ, and the file's first band covers more than 40% | the `staged-levels` browser test, `?clusters` |
| A real model's split into stages | Creek's cave, 195,376 bytes in the file and 88,816 in two stages, 31.3% of the 284,192 bytes downloaded; Kenney's building-i, 38,788 bytes in the file and 23,136 in two stages, 37.4% of 61,924 | `bunx @null3d/cli assets optimize <model> <folder> --lod --stages` |

How the data was produced: `bun packages/cli/src/assets/staged-fixture.ts` and
`bun packages/cli/src/assets/cluster-fixture.ts` print each file's size. The browser test
`staged-levels` runs on WebGPU, compatibility mode and WebGL2. D-228 holds the staged levels' shares
and the model; the cluster case holds the tree's.

## Look

The test holds two pictures of one camera: the file's own coarse level, and the same copies after
every stage arrived. The coarse picture is the file's coarsest level. The page with `maxLevels` 1,
which downloads no stage, draws the same picture within 0.1% of its pixels. The fine picture changes
more than 1% of the pixels, and the ground covers more than 40% of both. The coarse picture is a
complete model. A still cannot show the time between the pictures, and no picture shows the
refinement while a page draws.

## Decision

1. D-228's whole-level layout stands. The model file holds the full vertex stream and the coarsest
   level. Each finer level is a file of indices, named in the node's `NULL3D_stages` extras. The last
   stage holds the mesh itself, exact. The loader downloads from the coarsest down and refines every
   copy in place.
2. The header's `kind` word gains kind 1 for a cluster band. The header stays four words: the magic
   `N3DS`, the layout's version, the kind, and a count. A kind 1 stage holds one band, so its count is
   1. After the header comes the patch count. Then each patch's sphere, run, parent plus one and error
   follow. The band's indices come last. The widths follow kind 0. Parents come before children across
   the file and its bands.
3. The model file holds the tree's root patches, which draw the first picture. Each band appends its
   patches and indices to the same tree through an internal call, as `replace_indices` gives a mesh a
   level. The draw pass then draws the larger tree, with no new object. A mesh that cannot take a band
   keeps the tree it has and warns in a development build, as a level does.
4. A missing band draws nothing new. The loaded patches form an ancestor-closed tree from the root,
   and the ordinary rule draws it. A loaded patch whose children have not arrived draws where the
   camera is close. So the first picture is coarse and still covers the whole surface.
5. `maxLevels` counts bands as it counts levels. The pick-driven holdback counts the patch picks. The
   band that a cluster mesh draws now is the deepest loaded band with a patch that a view picked. A
   band that never draws is held, then looked at again. A camera that comes close brings it back. The
   warm-up and retry windows stay as D-228 sets them.
6. The skip follows the camera and the level rule, not the device. A phone at Low picks coarser levels,
   so the loader holds the bands that the camera never shows. No user agent or GPU name is read (hard
   rule 14).
7. The tool writes kind 1 for a mesh with a tree, with `--clusters --stages`. The whole-level cut stays
   in the file as `MSFT_lod`, for other readers and for the paths that draw a mesh whole. The first
   band after the file's own always arrives, because it is what refines the first picture. The rest
   wait.

## Ruled out

- A second format for a patch tree. One header and one list frame serve both kinds, and a reader
  leaves a kind it does not know.
- Holding the first picture until a coarse band downloads. The model file already holds the root
  patches, and one download is fewer round trips than two.
- Waiting for every band before the first draw. That is D-228's option C.
- One file for each level or band, loaded as a model. That is D-228's option B, and each file would
  build its own meshes and materials.
- An external buffer for each level in the model file. That is D-228's option D, and the loader
  downloads every external buffer before it parses.
- A device class chosen from a user agent or a GPU name. The camera and the level rule decide.
- A complete tree in the model file. The page would wait for all of the tree's bytes.

## What a machine run settles

- `bun run bench:staged-load` times the navigation to the first draw on the staged page, cold on
  Slow 4G in Chrome, on the page's load route. It loads once with `maxLevels` 1 and once with every
  stage. Over three loads of each, the page with every stage drew its first picture at 12,390 ms.
  The page with the limit of 1 drew it at 12,388 ms. The staged page downloaded 869.9 KB before its
  first picture, against 851.9 KB. So 18.0 KB of the stages arrived before it, and 29.3% of its 1,230.0 KB
  download arrived after it. A stage costs no delay to the first picture, and a page whose camera
  never shows the finest level saves its 378.1 KB.
- The tool's report lists each stage file's bytes and the share after the first picture. The Data
  table holds the cave's and a Kenney kit's split, and the cluster fixture's five bands.
- The `staged-levels` browser test holds the staged cluster model on WebGPU, compatibility mode and
  WebGL2. The file's first band covers the surface. Each band appends, and the picture refines over
  more than 1% of the pixels. A far camera asks for one band file, and a band limit of 1 asks for
  none.
- A phone's automatic skip stays open. The far test passes on SwiftShader and the Mac, with one
  stage asked for. A run on a phone's own network has not reported its stage requests.

## Consequences

- Code: `packages/cli/src/assets/levels.js` gains the kind 1 writer beside `stageFile`, and the
  report lists the stage files' bytes. `packages/engine/src/scene/gltf.ts` gains the kind 1 reader and
  the append call. The core gains the call that appends patches to a mesh's tree, beside the level
  call. `crates/null3d-render/src/levels.rs` counts picks per band.
- The version word guards the writer and the reader together. A change to either changes both.
- Docs: `docs/guides/assets-pipeline.md#levels-as-separate-downloads` and `#cluster-levels` state the
  second kind. `docs/concepts/lod.md` states that a tree refines as its bands arrive.
- Tests: the `staged-levels` spec gains a cluster case on each GPU path, and the tool's levels test
  holds the band bytes. A far test proves a band that never draws is not asked for.
- The whole-level path does not change, so its pictures hold.
