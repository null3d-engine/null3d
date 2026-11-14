# D-181: One shared table of shader paragraphs for each kind of device module

Status: decided and built. [D-191](D-191-shared-text-split-by-feature-family.md) splits each kind's table by feature family, and the rest of this design holds. Task: the generated shader set's weight.

Summary: The build writes each shader paragraph that twenty or more device modules of one kind name once, in a shared table that they import. The set is 24 per cent smaller after Brotli than with one copy in each module. The shader text that reaches the GPU, the start's modules and the image tests are the same in both builds.

## Question

The generated shader set repeats a paragraph once for each feature set that holds it. May the build write such a paragraph once for a whole kind of device module? It must not change what a page downloads at its start, and it must not change the shader text that reaches the GPU.

## Rule

- A page that uses no feature that loads on first use downloads nothing new at its start. The start's shader files keep their bytes.
- The shader text that reaches `createShaderModule` and `shaderSource` is byte-identical to the text that a build without the tables writes.
- Every file stays inside the limits of one shader file of a feature that loads on first use: 49 KB after Brotli, 320 KB after gzip and 1,536 KB uncompressed ([D-56](D-56-first-use-shader-files.md), [D-14](D-14-js-budget.md)).
- The shader build stays deterministic. The same inputs write the same bytes.

## Data

Sizes are after Brotli at quality 11 and after gzip at level 9, the levels `bun run build:check-size` uses.

| | one copy per module | shared tables | change |
| --- | --- | --- | --- |
| Uncompressed | 846.1 MB | 681.9 MB | 164.2 MB less, 19.4 per cent |
| After gzip | 152.3 MB | 111.1 MB | 41.2 MB less, 27.0 per cent |
| After Brotli | 41.9 MB | 31.7 MB | 10.2 MB less, 24.3 per cent |

Both columns count the 1,331 device modules, and the second one the twelve tables too. The tables are 5.0 MB uncompressed and 294 KB after Brotli together. The largest is `shader-paragraphs-glsl-tone-map-half.js`. It is 593.0 KB uncompressed, 83.5 KB after gzip and 31.4 KB after Brotli, against 1,536 KB, 320 KB and 49 KB. All twelve start modules are byte-identical in both builds.

No device module breaks a limit of a first-use shader file in either build. The largest is `shaders-area-lights-and-coat-sheen-and-morph-and-skinning-and-transmission-glsl-draw-index-tone-map-half.js`. With one copy per module it is 47.4 KB after Brotli against the 49 KB limit, and with the tables 41.4 KB. Its gzip size is 197.1 KB against 177.2 KB, and its uncompressed size 1,023.9 KB against 941.8 KB.

After Brotli, one device module of a WebGL2 kind is 9.6 KB smaller at the median. That is 24 per cent of it. One of a WebGPU kind is 7.1 KB smaller, which is 36 per cent. So a module that breaks a limit comes under it when its excess is smaller than that fall. Nine of the 1,319 feature-set modules grow instead, by 10 to 30 bytes each. In a small module, the import line costs about what the shared text saves. A change to the first-use shader budget should read these figures. It should also measure the set as it stands.

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

How the data was produced: the shader build wrote the modules with the tables, and a script measured each module and each table for its three sizes. The ladder is a parse of the modules that a build without the tables writes, over one WebGL2 kind. For the shader text, the test project was built for production with two features turned on. Every device module of that build was then imported and compared with the module that a build without the tables writes. That is all 1,331 of them, on both targets. Each one builds the shader text it did.

**GPU check.** No `bun run bench:gpu-check` measurement was made. The gate in `tools/hooks/check-gpu-ack.ts` reads a change under `crates/null3d-shaders/src/` as one that can change how the GPU draws. It reads the path and not the content. The comparison above is the cover the measurement exists for, and it is complete on both targets. Every device module builds byte-identical shader text, so no page draws with other text. The commit carries a `GPU-Checked:` trailer that states this in place of the measured line. That is the form [Branches and parallel work](../pull-requests.md#the-gpu-check) allows for a change that cannot change the GPU's work.

## Decision

Write one table for each kind of device module. A kind is a GPU target and one value of the permutation bits that a device fixes. A table holds the paragraphs that at least twenty feature-set device modules of that kind name. Its file name is the start's module of that kind under the table's prefix, such as `shader-paragraphs-glsl-draw-index` beside `shaders-glsl-draw-index`. There are twelve kinds, four for WebGPU and eight for WebGL2. [D-191](D-191-shared-text-split-by-feature-family.md) writes a base table and one table per feature family for each kind, under the same rule.

A table belongs to one kind and not to a whole target, because devices differ in their bits. One table for the whole WebGL2 target measures 8.9 MB uncompressed and 192 KB after Brotli. That is over all three limits of a shader file. Per kind it is 0.6 MB and about 33 KB.

The count is the named constant `SHARED_PARAGRAPH_MIN_USES`. Changing that one number tightens or loosens every table.

Only modules of features that load on first use take part, and only they name a table. A module of the start keeps its own paragraphs. So a page that uses no feature downloads none of the table. That gives up about one per cent of the text the sharing could save, and keeps the start's bytes free of the tables.

The plugin emits each table. A bundler copies a device module as an asset and does not read it, so the relative import the shader build writes survives as written. The file it names is then never emitted, and the build reports no warning. The load fails only in a browser. `emitParagraphTables` reads the head of each copied engine shader module for that import. It emits the table in the folder the bundler put the module in, at the name the import uses. The table therefore sits beside every module that names it, whatever a project's assets folder and asset naming pattern are. Worker builds emit their own copy through the same function.

A copied shader module carries no text that the list of a build's files for offline play reads. So the plugin also gives such a module the table it names in its `loads`. Without that, nothing names the table, and `offlineFiles` then puts it in the start's files. A table's name carries no `shaders-` prefix, so `featuresOf` reads it as no feature of its own.

## Consequences

- `crates/null3d-shaders/src/typescript.rs` holds `SharedParagraphs`, `shared_paragraphs`, `paragraphs_module` and the table's constant. `Writer::shared_sources` names a table entry in place of a shared paragraph. `lib.rs` deletes a stale table that the build does not write.
- `packages/vite-plugin/src/paragraphs.ts` holds `emitParagraphTables` and the plugin that each worker build runs. `packages/vite-plugin/src/index.ts` runs the same function in the client build. `listedFiles` in `offline.ts` takes the file of each module's table.
- `tools/lib/size-report.ts` measures a table as one more file that a feature's first use loads, so the three limits of a first-use shader file hold it. `tools/build-wasm.ts` reads a table out of the built page by its name, because the plugin emits it at a name of its own and so it carries no source map. `tools/hooks/check-size-growth.ts` accepts a `Size-Growth:` trailer that names one.
- `tools/lib/shader-modules.ts` counts the tables among the files the shader build writes, so the shared cache copies them with the rest. `.gitignore` names them.
- A device module imports its kind's tables. A table that fails to arrive fails every device module that names it. That shows as pipelines waiting, rather than one feature's pipelines waiting.
- A device module downloads its kind's table before it can build a shader, so the first feature of a kind costs one more request. The table is 12 to 14 KB after Brotli for a WebGPU kind and 29 to 31 KB for a WebGL2 kind. A feature-set module is about 6 to 9 KB smaller after Brotli. So a page that uses one or two features of a kind downloads a little more than with one copy per module, and one that uses more downloads less. The start's download does not change. This is the one cost of the tables on a page's own loading.
- `.dev/implementation-notes.md`, "The generated shader set's weight", records the measured result.
