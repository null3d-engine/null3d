# D-232: What WebGL2 draws for a tree of cluster patches

Status: decided by the work of M3-L3 on 23 October 2026, for the owner's review. Built: the WebGPU
path, its pictures and its figures ([D-231](D-231-cluster-levels-cost.md)). Not built: the
multi-draw route and the fallback below, which this record states so that the plan's two missing
halves are decided rather than forgotten. Date: 2026-10-23. Task: M3-L3.

Summary: A WebGL2 page draws a mesh that has a tree of cluster patches as its whole triangle list.
The plan's two routes are not built: the multi-draw walk in the job workers, and the whole levels
cut from the tree for a browser without multi-draw. The picture is right either way, because the
whole mesh is what the tree divides; what a WebGL2 page does not get is the saving.

## Question

The plan for M3-L3 gives a WebGL2 device two routes. With `WEBGL_multi_draw` (Chrome and Safari),
the job workers walk the tree for each view and each chosen patch is one range of a multi-draw
call, up to 256 ranges a call, so a frame uploads ranges and no triangles. Without it (Firefox),
the mesh draws whole levels cut from its tree, through the levels of [D-137](D-137-lod-groups.md).

What does a WebGL2 page draw today, and what does each route still need?

## Rule

A WebGL2 page may draw the whole mesh, but then the tree buys it nothing and a large static mesh
pays the full triangle list on that path. Neither route may wait on a browser feature that
[D-179](D-179-technique-rulings-2026-10-15.md) ruling 27 keeps gated: multi-draw *indirect* and
64-bit atomics. Plain `WEBGL_multi_draw` is not gated, and the backend already uses it.

## Data

What the engine does today:

- The patch tree belongs to the mesh ([D-213](D-213-cluster-levels.md)), and the GPU-driven path
  draws it ([D-213](D-213-cluster-levels.md)'s addendum). The path that draws objects directly, as
  WebGL2 always does, has no cluster pass: a bucket's patches are picked only where the layout holds
  a tree for a GPU-culled view.
- The picture tests prove the WebGL2 result. `cluster` and `cluster-coarse` draw pictures that differ
  in 0 of 129,600 pixels on WebGL2, because the threshold changes nothing when the whole list draws;
  the same pair differs in 17 percent of pixels on the two WebGPU paths. Both WebGL2 pictures are
  committed as their own references.
- The frame's figures do not suffer at this size: on the Galaxy S25 the WebGL2 page keeps the same
  33.3 ms frame as the WebGPU page, and on the iPad Pro 13 the same 15.5 ms, with no GPU timer on
  either device for that path.
- `WEBGL_multi_draw` is used by the backend already (`packages/engine/src/gpu/webgl2/backend.ts`),
  and a call carries at most 256 ranges (`sizes::MULTI_DRAW_RECORDS` in
  `crates/null3d-gpu/src/drawlist.rs`).

What the multi-draw route still needs, in the order the work falls:

1. The job workers walk the tree per view with the same rule as the compute pass: the patch's own
   error under the threshold and the parent's over it, against the view's factor and the copy's
   matrix. The walk is the part that [D-137](D-137-lod-groups.md) says needs no state between
   frames, so the workers can run it beside the culling they already do.
2. The chosen patches' ranges go into the view's command list, sorted in space so neighbours merge
   into longer runs. The plan's figures put 3,000 chosen patches at about 12 calls a view.
3. The command list's fixed size must hold the bound ([the code review](../code-review-2026-10.md)'s
   finding R5-01, which fills at 1,500 meshes on WebGL2 without multi-draw), and the draw records a
   call reads must carry the ranges: 256 records a call today.

The fallback for a browser without multi-draw still needs the tree cut into whole levels at a few
fixed errors. The asset tool does not cut it: `--lod` makes a mesh's levels by simplifying the mesh,
which is a separate pass, not a cut of the tree. So the fallback is the whole mesh too, and the tree
is stored for a viewer that can use it.

## Decision

Both routes stay open, and neither is built in M3-L3. A WebGL2 page draws the whole triangle list,
and the concept page says so. The reasons are that the WebGPU path landed first, that the
multi-draw route needs the worker walk and a per-view range list that no code has yet, and that the
fallback needs the asset tool to cut the tree, which is its own task.

No path is dropped: the tree, the file format and the pictures serve all three, and the WebGL2
pictures are committed so that either route can be judged against them when it lands.

## Consequences

- A large static mesh on WebGL2 or Firefox pays its whole triangle list, which is the case the
  routes exist for. At the test model's 32,768 triangles the frame is unchanged.
- The job workers' walk reuses the level rule that the compute pass runs, so the two must be kept
  in step: the threshold, the copy's matrix and the parent test. A change to one without the other
  makes a device draw a different set of patches from another's.
- The fallback waits on the tool's cut, and [D-213](D-213-cluster-levels.md)'s Consequences already
  promise that cut with this path.
