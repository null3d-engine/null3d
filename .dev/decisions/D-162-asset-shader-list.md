# D-162: The asset tool records a model's shader list with the file

Status: decided. Built: the asset tool writes the list, and the glTF loader reads it. Task: M2-B5.

Summary: The asset tool writes the permutation bits and first-use shader files that a model's draws need into `asset.extras.NULL3D_shaders`. The engine asks its preloads for those files as it loads the model. The list is plain data, so it needs no glTF extension, and a file from another tool has none.

## Question

A feature that changes what a shader costs is a permutation bit, and the files of some features load on first use ([D-56](D-56-first-use-shader-files.md)). So a game that must fetch nothing during play needs its model's shader files before the loading screen goes. Which part of a model carries the list, and how does the engine read it?

## Rule

- One source per fact: the list is data that the tool writes and the engine reads, so it has one shape and one meaning.
- A file from another tool must keep working, and the list must never change how a file draws.
- A name that either side does not know must not break a load.

## Data

| Measure | Options |
| --- | --- |
| Where it can sit | A glTF extension of the engine's own, as `NULL3D_occluder` and `NULL3D_mesh_bvh` do ([D-27](D-27-bvh.md), [D-50](D-50-blockers-and-stored-trees.md)); or `asset.extras.NULL3D_shaders`, as `NULL3D_lod_error` sits in a node's extras ([D-91](D-91-level-planning.md)) |
| Written by | The tool, from the document it has just optimized, so the list matches the output's materials and meshes |
| Read by | The glTF loader, which already asks for `skinning` and `morph` from the parsed data |

How the data was produced: the tool's own document is the source, so no measurement is needed. The shapes were read from `packages/cli/src/assets/spatial-extensions.js`, `packages/cli/src/assets/report.js` and `packages/engine/src/scene/gltf.ts`.

## Decision

The list goes in `asset.extras.NULL3D_shaders` as `{ "permutations": [...], "features": [...] }`:

- An extension would need a glTF-Transform extension class and a name in the file's extension lists. The data is a small list of names, not bytes that another reader must skip. The tool's other engine fields use extras for the same reason.
- The engine's loader reads the list with the parsed file and calls `ShaderPreloads.needListed`, which leaves out a name that this engine does not know. So a file from a newer tool loads and draws.
- The list names what the model may draw with, and the page's settings decide what it does draw with. The tool names `lod_fade` only for levels that fade: a level with a measured error, which the tool writes with its screen coverage, switches at once, so the files it cuts with `--lod` and `--clusters` name no fade file. A hand-set error comes alone and keeps the fade. A node that gives its levels no measure at all draws its base mesh alone. It names neither the bit nor the file, since the loader gives such a node no levels. The tool reads a node's measures as the loader does. It counts the level nodes up to the first one without a mesh. It takes a list only where it reaches that count and holds numbers throughout. A list that falls short is no measure, so the other list stands alone and its band keeps. `needListed` holds back a feature that the settings cannot use now and asks for it once they can. Alpha to coverage (`coverage`) needs MSAA, which the page picks at start and loses when effects move it to HDR with FXAA. A distance band's fading edges (`lod_fade`) need the `lodFade` setting, which Low turns off and `quality.set` can turn on during play; a hand-set level's own fade needs no setting (D-211). The runner tells `ShaderPreloads.setUsable` about both. A pipeline that needs a held feature still loads its file on first use.
- The permutation names are a record of what the model turns on. Warm-up already builds exactly the pipelines that the scene's objects need, so the loader reads the names but acts on none of them yet. They are there for a loading screen and for the report.
- The report compares the textures' memory with each quality preset's budget. That budget is the only one a preset gives. The four figures live in the engine's preset table; the tool keeps its own copy, and a unit test fails when the two part.

## Consequences

- The tool writes the list in `packages/cli/src/assets/shaders.js`, and the report gives the list, the pipeline keys and the preset warnings.
- The loader asks for the recorded features in `packages/engine/src/scene/gltf.ts`; `parseGltf` reads the field.
- A unit test checks that every name the tool writes exists in `crates/null3d-gpu/src/drawlist.rs` and `crates/null3d-shaders/shaders.toml`, and that the tool's preset budgets equal the engine's.
- `guides/assets-pipeline`, `guides/loading-screens` and the develop skill describe the list.

## Addendum, 25 October 2026: the list that a production build compiles

Status: decided. Task: M3-R12.

The model's list above records what a model may draw with, and its permutation names are a record.
A production build reads a second list, of whole permutation words, which a run of a project's
pages records. `bun tools/shader-permutations.ts --pages demos` drives each page in hold mode with
`?permutations=record` on both GPU paths. The engine collects the word of every variant that a
pipeline asked for while the held frame drew, and the tool writes one hexadecimal word on each line
of the file that `NULL3D_SHADER_PERMUTATIONS` names.

What the build's list covers:

- One word for each set of bits that a template's builds vary in. The bits that a device fixes are
  left out, which are the draw index, tone mapping in the shader and half precision. One word then
  serves every device module, and the build makes that word's builds for each value of those bits.
- The word without any bit, which the compute passes, the pre-passes and the full-screen passes ask
  for. A list without it would leave those passes without a shader.
- Both GPU paths' words, because each path's variants list a few bits that the other's do not:
  WebGL2 has the morph targets, and WebGPU has the instance index and the sample mask.
- Nothing for a bit that no recorded scene draws with.

A build without the variable compiles every word, as before. The engine's release set, which serves
every project rather than one project's pages, is built without a list and stays full.

A permutation word that nothing lists is not built. A build that a template cannot make builds
nothing for that template, so one list serves every template. At run time the variant lookup of a
narrowed set names the missing word and the file to record again, instead of drawing nothing.
