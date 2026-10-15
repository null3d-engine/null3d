# D-181: One shared table of shader paragraphs for each kind of device module

Status: decided. Date: 2026-10-15. Task: the generated shader set's weight, 15 October 2026.

Summary: A shader paragraph that many device modules of one kind held was written into each of them. So the build stored the same text once for every feature set. The build now writes the paragraphs that at least twenty feature-set modules of a kind name once, in a table of their own. Each module imports the ones it uses and names them in its sources. The set is 24 per cent smaller after Brotli. The shader text that reaches the GPU is unchanged, the start's modules are unchanged, and no image test changes.

## Question

The generated shader set repeats a paragraph once for each feature set that holds it. May the build write such a paragraph once for a whole kind of device module? It must not change what a page downloads at its start, and it must not change the shader text that reaches the GPU.

## Rule

- A page that uses no feature that loads on first use downloads nothing new at its start. The start's shader files keep their bytes.
- The shader text that reaches `createShaderModule` and `shaderSource` is byte-identical to the text the build wrote before.
- Every file stays inside the limits of one shader file of a feature that loads on first use: 49 KB after Brotli, 320 KB after gzip and 1,536 KB uncompressed ([D-56](D-56-first-use-shader-files.md), [D-14](D-14-js-budget.md)).
- The shader build stays deterministic. The same inputs write the same bytes.

## Data

Sizes are after Brotli at quality 11 and after gzip at level 9, the levels `bun run build:check-size` uses.

| | before | after | change |
| --- | --- | --- | --- |
| Uncompressed | 846.1 MB | 681.9 MB | 164.2 MB less, 19.4 per cent |
| After gzip | 152.3 MB | 111.1 MB | 41.2 MB less, 27.0 per cent |
| After Brotli | 41.9 MB | 31.7 MB | 10.2 MB less, 24.3 per cent |

Both columns count the 1,331 device modules, and the later one the twelve tables too. The tables are 5.0 MB uncompressed and 294 KB after Brotli together. The largest is `shader-paragraphs-glsl-tone-map-half.js`. It is 593.0 KB uncompressed, 83.5 KB after gzip and 31.4 KB after Brotli, against 1,536 KB, 320 KB and 49 KB. All twelve start modules are byte-identical before and after.

The count of modules is the dial. This ladder was measured on one WebGL2 kind. Its 140 feature-set device modules hold 100.0 MB.

| modules that name a paragraph | paragraphs | table uncompressed | table after Brotli | saved in that kind |
| --- | --- | --- | --- | --- |
| 2 | 6,707 | 11.01 MB | 254 KB | 85.4 MB (93 per cent) |
| 3 | 6,336 | 10.37 MB | 239 KB | 84.2 MB (92 per cent) |
| 5 | 4,283 | 5.52 MB | 150 KB | 65.2 MB (71 per cent) |
| 10 | 2,634 | 2.14 MB | 88 KB | 42.2 MB (46 per cent) |
| 20 | 1,479 | 0.59 MB | 33 KB | 20.2 MB (22 per cent) |
| 50 | 509 | 0.10 MB | 10 KB | 6.9 MB (8 per cent) |

Twenty is the highest count whose table still meets every limit with room to spare. It keeps about a fifth of the text. A lower count saves more and grows the tables towards the limits. At twenty the whole set saves 24 per cent.

How the data was produced: on 15 October 2026, the shader build wrote the modules of this change. A script then measured each module and each table for its three sizes. The ladder is a parse of the modules the build wrote before the change, over one WebGL2 kind. For the shader text, the test project was built for production with two features turned on. Every WebGPU device module of that build was imported, and a tenth of the WebGL2 ones. Each was compared with the module the build wrote before the change.

## Decision

Write one table for each kind of device module. A kind is a GPU target and one value of the permutation bits that a device fixes. A table holds the paragraphs that at least twenty feature-set device modules of that kind name. Its file name is the start's module of that kind under the table's prefix, such as `shader-paragraphs-glsl-draw-index` beside `shaders-glsl-draw-index`. There are twelve tables, four for WebGPU and eight for WebGL2.

A table belongs to one kind and not to a whole target, because devices differ in their bits. Measured first as one table for the whole WebGL2 target, it was 8.9 MB uncompressed and 192 KB after Brotli. That is over all three limits of a shader file. Per kind it is 0.6 MB and about 33 KB.

The count is the named constant `SHARED_PARAGRAPH_MIN_USES`. A later change tightens or loosens every table with that one number.

Only modules of features that load on first use take part, and only they name a table. A module of the start keeps its own paragraphs. So a page that uses no feature downloads none of the table. That gives up about one per cent of the text the sharing could save, and keeps the start's bytes as they were.

The plugin emits each table. A bundler copies a device module as an asset and does not read it, so the relative import the shader build writes survives as written. The file it names is then never emitted, and the build reports no warning. The load fails only in a browser. `emitParagraphTables` reads the head of each copied engine shader module for that import. It emits the table in the folder the bundler put the module in, at the name the import uses. The table therefore sits beside every module that names it, whatever a project's assets folder and asset naming pattern are. Worker builds emit their own copy through the same function.

A copied shader module carries no text that the list of a build's files for offline play reads. So the plugin also gives such a module the table it names in its `loads`. Without that, nothing names the table, and `offlineFiles` then puts it in the start's files. A table's name carries no `shaders-` prefix, so `featuresOf` reads it as no feature of its own.

## Consequences

- `crates/null3d-shaders/src/typescript.rs` gains `SharedParagraphs`, `shared_paragraphs`, `paragraphs_module` and the table's constant. `Writer::shared_sources` names a table entry in place of a paragraph it would have written. `lib.rs` deletes a table that the build no longer writes.
- `packages/vite-plugin/src/paragraphs.ts` is new: `emitParagraphTables` and the plugin that each worker build runs. `packages/vite-plugin/src/index.ts` runs the same function in the client build. `listedFiles` in `offline.ts` takes the file of each module's table.
- `tools/lib/size-report.ts` measures a table as one more file that a feature's first use loads, so the three limits of a first-use shader file hold it. `tools/build-wasm.ts` reads a table out of the built page by its name, because the plugin emits it at a name of its own and so it carries no source map. `tools/hooks/check-size-growth.ts` accepts a `Size-Growth:` trailer that names one.
- `tools/lib/shader-modules.ts` counts the tables among the files the shader build writes, so the shared cache copies them with the rest. `.gitignore` names them.
- A device module is no longer plain JavaScript that imports nothing. A table that fails to arrive fails every device module that names it. That shows as pipelines waiting, rather than one feature's pipelines waiting.
- The change moves the compiler stamp that the per-entry shader cache is keyed by. Every checkout and CI build the shaders once more.
- `.dev/implementation-notes.md`, "The generated shader set's weight", records the measured result in place of the estimate it held.
