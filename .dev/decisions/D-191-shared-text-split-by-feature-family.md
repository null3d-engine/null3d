# D-191: Shared shader text and combination loaders split by feature family

Status: decided by the tooling change of 18 October 2026. Task: M2-J4's size gate.

Summary: One table of shared paragraphs served a whole device kind, and one combination loader
listed every set of features that a build needs, so the relief materials' builds grew both past
their limits. The shader build now writes a table for each feature family of a kind, and each
combination loader holds the keys of one family. Each file stays inside the shader budget, a page
downloads the table of the family of the build it asks for alone, and the shader text that reaches
the GPU is unchanged.

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
  the build wrote before this change.
- The build stays deterministic. The same inputs write the same bytes, the same families and the
  same file names.

## Data

The figures are from the merged tree of M2-J4 on 18 October 2026, before the split, measured by the
shader build's own output with Brotli at quality 11 and gzip at level 9.

| File | Before | Limit |
| --- | --- | --- |
| `shader-paragraphs-glsl*.js`, the largest kinds | 3,384,247 B raw, 105,537 B after Brotli | 1,536 KB raw, 49 KB after Brotli |
| `shader-paragraphs-wgsl*.js`, the largest kinds | 507,972 B raw | 1,536 KB raw |
| `shaders-glsl-combos.ts` | 310,974 B raw | 96 KB raw |
| `shaders-wgsl-combos.ts` | 95,959 B raw | 96 KB raw |

After the split, with the same inputs:

| File | After | Limit |
| --- | --- | --- |
| the largest paragraph table, `shader-paragraphs-glsl-draw-index-tone-map-half-area-lights.js` | 1,245,059 B raw, 154,612 B after gzip, 44,364 B after Brotli | 1,536 KB, 320 KB, 49 KB |
| the largest combination loader, `shaders-glsl-combos-area-lights-and-bump-and-coat-sheen-half.ts` | 34,609 B raw, 1,288 B after Brotli | 96 KB raw, 16 KB after Brotli |
| the number of paragraph tables | 164, where the set held 12 | - |
| the number of combination loaders | 214, where the set held 8 | - |

The largest paragraph table is 11.6 per cent under its Brotli limit. The base table of a kind is
752 KB raw and about 36 KB after Brotli, close to the 30 KB that a kind's table took on main before
the relief bits. The relief text sits in the family tables that only a page with that feature
downloads.

## Decision

**Paragraphs.** A paragraph joins the family of the one feature that every module naming it needs,
chosen as the first such name in sorted order. A paragraph that modules of several features share,
with no one feature covering them all, joins the unnamed base family. The build writes one table
for each family of each device kind. A device module imports each table whose paragraphs it names,
so a relief module downloads the base table and its relief family's table, and a module without
relief downloads only the base one. The table's file name is the kind's name, then the family, as
`shader-paragraphs-glsl-draw-index-bump.js`; the base table keeps the old name.

**Combination loaders.** A key of several features joins a family named by the first features of
the key. The build starts from the first feature alone and splits a family by the next feature
while its rendered table would pass 64 KB, so each loader has room for later keys. The split depth
of each first feature is written into the main module as `WGSL_COMBINED_DEPTH` and
`GLSL_COMBINED_DEPTH`. The loader reads the depth, forms the family's key and imports that
family's table only. A preload loads the tables of the keys that it expects, not every table.

## Options rejected

- **Raising the limits.** D-190 refuses a limit raise for growth that every page downloads.
- **One table for the whole target.** Measured before the split: 8.9 MB uncompressed and 192 KB
  after Brotli for WebGL2, over all three limits ([D-181](D-181-shared-shader-paragraphs.md)).
- **Splitting the loader by a hash of its key.** It balances the files, but a page's download then
  depends on a hash of its feature names rather than on the features it uses, and the families
  would mean nothing to a reader. Splitting by the first features keeps each file's name and
  contents describing the builds it holds.
- **A table for each key.** It gives every key a file of its own, which is hundreds of small
  requests, and it gives up the sharing that the family keeps.

## Consequences

- `crates/null3d-shaders/src/typescript.rs` gains the family choice, the table list, the split depth
  and the runtime family function. `Writer::shared_sources` takes the kind's tables and writes one
  import for each table that a module names.
- `packages/vite-plugin/src/paragraphs.ts` emits every table that a copied device module names, and
  `offline.ts` gives a module each of its tables. The split names are still inside the patterns that
  the size report and the shader module cache already accept.
- `tools/lib/size-report.ts` learns the combination loaders from the build instead of a fixed list,
  because their names now carry a family. It measures each one against the combination budget.
- A page with a feature of a kind downloads the base table and that feature's family table. The
  two files are usually smaller together than the one table was, because the base table no longer
  holds every other feature's text.
- The manifest's build count does not change: the split decides where text is written, not which
  builds the engine makes. M2-J4's three bits raise it from 8,671 to 19,175 WGSL builds and from
  21,910 to 53,622 GLSL builds, which `BUILD_BUDGET` records with the reason in the implementation
  notes.

### Addendum, 19 October 2026: the size check and the new family files

The split writes 164 family tables and 214 combination loaders where the set
held 12 and 8. The size check treated each new file as unexplained growth and
asked for a `Size-Growth:` trailer that named it; the first run to reach the
check listed 4,083 new files. A family table or a combination loader loads only
on the first use of its feature, so it adds nothing to a page's start download,
and its own budget caps it. The check now passes a new file of those kinds
without a trailer. Every file the split writes stays inside its budget, which is
the rule that D-190 set.
