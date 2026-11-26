# porting-shaders-substance-01

## Finding as given

- page: shaders/library, porting/threejs-shaders, shaders/builtins
- anchor: ## Modules table (library); threejs-shaders line 89; builtins lines 13 and 98
- category: missing-content
- severity: high
- claim: The library page lists nine modules and leaves out null3d::mesh and null3d::builtins. Full shaders need them (InstanceIn, find_instance, clip_position, relative_position, world_normal, finish, fill_builtins). The generator's comment even says shaders other than the engine's cannot rely on unlisted modules, which contradicts the full-shader docs.
- evidence: tools/lib/shader-library.ts:16-31; crates/null3d-shaders/wgsl/lib/mesh.wgsl:248; docs/porting/threejs-shaders.md:89; docs/shaders/builtins.md:13,98; docs/guides/custom-shaders.md:53-92; docs/errors/E1215.md:13
- proposedEdit: Add 'mesh' and 'builtins' (or a curated public subset of their items) to PUBLIC_MODULES, with doc comments on InstanceIn, find_instance, clip_position, relative_position, world_normal, finish, finish_exposed, fill_builtins, frame, camera, object. Fix the PUBLIC_MODULES comment. Put the per-GPU-path layout of InstanceIn in a details block.
- generatedSource: tools/lib/shader-library.ts; mesh.wgsl; builtins.wgsl

Verdict: partly

## Evidence

Holds:
- tools/lib/shader-library.ts:16-31: the list of shown modules has nine entries, with no mesh and no builtins. Its comment says shaders other than the engine's "cannot rely on" the other modules. That contradicts docs/guides/custom-shaders.md:53-92, which tells full shaders to import null3d::mesh and null3d::builtins.
- docs/shaders/library.md:13 says "A custom material's surface function, vertex offset or full shader can call these modules". The table (lines 46-56) has no row for mesh or builtins, and the page has no link to the full-shader section or to builtins.md. A reader who looks up `find_instance` or `fill_builtins` on the library page finds nothing.

Does not hold:
- Severity. The content is not missing from the docs. docs/guides/custom-shaders.md:47-92 gives a full working example and one rule for each item: InstanceIn, find_instance, clip_position(found, position), relative_position, world_normal, finish, finish_exposed and fill_builtins(origin). docs/shaders/builtins.md documents every field of frame, camera and object. The gap is a missing cross-reference on one reference page. It does not block a newcomer, so medium fits, not high.
- The edit "add 'mesh' to PUBLIC_MODULES" is wrong as written. The generator prints every `fn`, `struct` and `const` that has a doc comment. mesh.wgsl has 87 top-level declarations, most of them engine internals such as DrawTable, CellOffsets, CELL_SHIFT, MAX_CELLS, InstanceBucket and view_depth (mesh.wgsl:95-184). The generator has no per-item filter, so a "curated subset" needs new generator code.
- The details block on how InstanceIn differs on each GPU path works against the docs. custom-shaders.md:85 says find_instance and InstanceIn "hide the difference". The layout depends on build flags (WEBGL2, DRAW_INDEX, INSTANCE_INDEX at mesh.wgsl:244-256) that a user cannot choose. Publishing it invites code that reads the fields directly and breaks between GPU paths.
- Adding builtins whole would print FrameValues, CameraValues and ObjectValues field by field, which repeats docs/shaders/builtins.md.

## Corrected claim

The library page claims full shaders can call its modules, but its table leaves out null3d::mesh and null3d::builtins, and it does not link to where they are documented (custom-shaders.md#full-shaders and builtins.md). The generator's comment on the list of shown modules wrongly says only the engine's shaders can rely on the other modules. Severity: medium.

## Corrected edit

In tools/lib/shader-library.ts:
1. Add two rows to the Modules table, outside the generated item sections: `null3d::mesh` ("What a full shader needs from the engine: InstanceIn, find_instance, clip_position, relative_position, world_normal, finish and finish_exposed. [Full shaders](../guides/custom-shaders.md#full-shaders) lists them.") and `null3d::builtins` ("frame, camera, object and fill_builtins for a full shader. [Built-in shader inputs](builtins.md) lists their fields."). Alternatively, add a per-module list of the items to show and print only those items for mesh and builtins.
2. Change the comment on the list of shown modules: the other modules hold what the engine's own shaders share; mesh and builtins are for full shaders, and the full-shader guide and built-in inputs page document them.
Do not publish the per-GPU-path layout of InstanceIn.
