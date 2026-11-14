# D-191: Shared shader text and combination loaders split by feature family

Status: decided and built. Task: M2-J4's size gate.

Summary: The shader build writes a table of shared paragraphs for each feature family of a device
kind, and each combination loader holds the keys of one family. Each file stays inside the shader
budget, a page downloads only the tables of the families that its build names, and the shader text
that reaches the GPU is unchanged. One table per kind and one loader for every feature set grew past
their limits with the relief materials.

## Question

The bump, displacement and parallax bits multiply the standard material's builds about three times,
and that growth pushed the shared tables and the combination loaders over their limits
([D-190](D-190-hold-relief-until-the-split.md)). The owner held the feature until the build splits
those files and no size limit is raised. How does the split choose the files, and how does a page
find the file that its build needs?

## Rule

- Every file stays inside the limits of a shader file of a feature that loads on first use: 49 KB
  after Brotli, 320 KB after gzip and 1,536 KB uncompressed. A combination loader keeps its own
  uncompressed limit of 96 KB, because its keys are addresses rather than shader text.
- Each file holds the text of the families that a page's build names, not the text of every
  combination the set can build.
- The shader text that reaches `createShaderModule` and `shaderSource` is byte-identical to the text
  that a build without the split writes.
- The build stays deterministic. The same inputs write the same bytes, the same families and the
  same file names.

## Data

The figures are from the merged tree of M2-J4 without the split, measured by the shader build's own
output with Brotli at quality 11 and gzip at level 9.

| File | Without the split | Limit |
| --- | --- | --- |
| `shader-paragraphs-glsl*.js`, the largest kinds | 3,384,247 B raw, 105,537 B after Brotli | 1,536 KB raw, 49 KB after Brotli |
| `shader-paragraphs-wgsl*.js`, the largest kinds | 507,972 B raw | 1,536 KB raw |
| `shaders-glsl-combos.ts` | 310,974 B raw | 96 KB raw |
| `shaders-wgsl-combos.ts` | 95,959 B raw | 96 KB raw |

With the split, from the same inputs:

| File | With the split | Limit |
| --- | --- | --- |
| the largest paragraph table, `shader-paragraphs-glsl-draw-index-tone-map-half-area-lights.js` | 1,245,059 B raw, 154,612 B after gzip, 44,364 B after Brotli | 1,536 KB, 320 KB, 49 KB |
| the largest combination loader, `shaders-glsl-combos-area-lights-and-bump-and-coat-sheen-half.ts` | 34,609 B raw, 1,288 B after Brotli | 96 KB raw, 16 KB after Brotli |
| the number of paragraph tables | 164, against 12 without the split | - |
| the number of combination loaders | 214, against 8 without the split | - |

The largest paragraph table is 11.6 per cent under its Brotli limit. The base table of a kind is
752 KB raw and about 36 KB after Brotli, close to the 30 KB of a kind's table without the relief
bits. The relief text sits in the family tables that only a page with that feature
downloads.

## Decision

**Paragraphs.** A paragraph joins the family of the one feature that every module naming it needs,
chosen as the first such name in sorted order. A paragraph that modules of several features share,
with no one feature covering them all, joins the unnamed base family. The build writes one table
for each family of each device kind. A device module imports each table whose paragraphs it names,
so a relief module downloads the base table and its relief family's table, and a module without
relief downloads only the base one. The table's file name is the kind's name, then the family, as
`shader-paragraphs-glsl-draw-index-bump.js`; the base table's name has no family, as
`shader-paragraphs-glsl-draw-index.js`.

**Combination loaders.** A key of several features joins a family named by the first features of
the key. The build starts from the first feature alone and splits a family by the next feature
while its rendered table would pass 64 KB, so each loader has room for later keys. The split depth
of each first feature is written into the main module as `WGSL_COMBINED_DEPTH` and
`GLSL_COMBINED_DEPTH`. The loader reads the depth, forms the family's key and imports that
family's table only. A preload loads the tables of the keys that it expects, not every table.

## Options rejected

- **Raising the limits.** D-190 refuses a limit raise for growth that every page downloads.
- **One table for the whole target.** It measures 8.9 MB uncompressed and 192 KB after Brotli for
  WebGL2, over all three limits ([D-181](D-181-shared-shader-paragraphs.md)).
- **Splitting the loader by a hash of its key.** It balances the files, but a page's download then
  depends on a hash of its feature names rather than on the features it uses, and the families
  would mean nothing to a reader. Splitting by the first features keeps each file's name and
  contents describing the builds it holds.
- **A table for each key.** It gives every key a file of its own, which is hundreds of small
  requests, and it gives up the sharing that the family keeps.

## Consequences

- `crates/null3d-shaders/src/typescript.rs` holds the family choice, the table list, the split depth
  and the runtime family function. `Writer::shared_sources` takes the kind's tables and writes one
  import for each table that a module names.
- `packages/vite-plugin/src/paragraphs.ts` emits every table that a copied device module names, and
  `offline.ts` gives a module each of its tables. The split names are inside the patterns that the
  size report and the shader module cache accept.
- `tools/lib/size-report.ts` reads the combination loaders from the build, not from a fixed list,
  because each name carries a family. It measures each one against the combination budget.
- The size check passes a new family table or combination loader without a `Size-Growth:` trailer.
  Such a file loads only on the first use of its feature, so it adds nothing to a page's start
  download, and its own budget caps it. The split writes thousands of them: the size check listed
  4,083 new files for the M2-J4 tree. Every file the split writes stays inside its budget, which is
  the rule that D-190 sets.
- A page with a feature of a kind downloads the base table and that feature's family table. The
  two files are usually smaller together than one table per kind, because the base table does not
  hold every other feature's text.
- The split does not change the manifest's build count: it decides where text is written, not which
  builds the engine makes. With M2-J4's three bits the manifest makes 19,175 WGSL builds and 53,622
  GLSL builds, against 8,671 and 21,910 without them. `BUILD_BUDGET` records the count, with the
  reason in the implementation notes.
