# D-93: Skinned meshes in instance batches

Status: decided. Date: 7 October 2026.

Summary: `scene.createInstances(prefab)` draws a skinned mesh with one matrix, from the skinning matrix of the joint that carries most of its weight. That is exact when the rest pose is the bind pose. Otherwise the batch draws the bind pose, and development builds warn.

## Question

Instance batches do not skin. Where does a batch draw a mesh that a skin moves?

## Rule

The batch must draw the mesh where a copy from `scene.instantiate` draws it at rest, when one matrix can do so. That holds for files from the asset tool, whose integer positions keep their scale in the inverse bind matrices. A model that a page never draws with batches must cost nothing extra.

## Data

At rest, joint `j` moves a vertex by its world matrix times its inverse bind matrix. When the rest pose is the bind pose, every joint gives the same matrix. One matrix then places the whole mesh exactly. The asset tool's scale lives in that matrix, so the Knight draws in meters, raw or processed. Before this record, a batch drew a skinned mesh with no matrix. The tool's Knight then drew about 16,000 times too large.

When the rest pose differs, each joint gives its own matrix, and no one matrix places every vertex.

| Option | Exact at rest | Cost |
| --- | --- | --- |
| One matrix, the main joint's, and a warning when the joints disagree | When rest is bind | Nothing more |
| Skin the vertices at rest once on load, into a second mesh | Always | A second copy of each such mesh on the GPU, made for every model, used or not |

The parser compares each joint's matrix with the main joint's. They agree when no vertex moves more than a thousandth of the mesh's size between them.

## Decision

One matrix and a warning. A file that binds in its rest pose, as the Knight does, draws exactly, and the asset tool keeps that true. A model with a different rest pose still draws, in its bind pose placed by its main joint. The warning names `scene.instantiate` for a copy at rest. A second mesh would cost GPU memory for every such model, although few pages draw skinned models with batches. The owner confirmed this choice on 7 October 2026.

## Consequences

- `skinnedRest` in `gltf-animation.ts` gives each skinned copy its matrix, and whether it is exact. `createInstances` warns in development builds.
- [Animation](../../docs/api/animation.md) and the null3d-develop skill's API reference say that a batch draws such a mesh in its bind pose.
- The same pass boxes skinned meshes as the joints place them at rest, so `prefab.bounds` holds the model in meters, as the implementation notes say.
