# D-276: A production build compiles only the permutation words its pages record

Status: decided and built. The shader build takes a list of whole permutation words, the recorder writes the list, and the showcases' production build reads it. Task: M3-R12.

Summary: A production build of a known set of pages compiles only the permutation words that those pages draw with. The list is recorded from a run of the pages, so it covers what the models list and what the page turns on at run time. The engine's release set still serves every project, so it compiles every word.

## Question

The shader build compiles every combination of every permutation bit that each template lists, which is the build count that `BUILD_BUDGET` records. A production build of the showcases draws a small part of them. How can that build compile less, without a device or a page state failing at run time?

## Rule

- The narrowed set must draw every state that the project's pages offer, on every GPU path and every quality preset.
- A page pays nothing for a feature it does not use (hard rule 8). The narrowing changes what the build compiles, not the modules that the loader tables name.
- A word that the set lacks fails loudly and names the list to record again. It never draws nothing in silence.
- The engine's release set serves every project, so it stays full.
- The build's cache never reuses an entry of another list.

## Data

| Measure | Every word | Listed words |
| --- | --- | --- |
| Shader builds compiled | 78,491 | 4,189 |
| Shader build time, compile and wall | 420 s and 446 s | 21 s and 22.6 s |
| Generated modules | 3,481,695,437 bytes in 6,851 files | 181,075,966 bytes in 478 files |
| Showcases' production build | 3,718,479,059 bytes in 7,965 files | 415,239,143 bytes in 1,174 files |
| Recorded words | | 172 |

How the data was produced: on one Mac with 14 cores, in held quiet windows, with the entry cache off (`NULL3D_NO_SHADER_CACHE=1`) and an empty module cache, so each run compiled every build it made:

```sh
NULL3D_NO_SHADER_CACHE=1 NULL3D_SHADER_CACHE=/tmp/r12-modcache-full \
  NULL3D_QUIET_PASSED=1 /usr/bin/time -p bun tools/shaders.ts
NULL3D_SHADER_PERMUTATIONS=examples/shader-permutations.txt \
  NULL3D_NO_SHADER_CACHE=1 NULL3D_SHADER_CACHE=/tmp/r12-modcache-listed \
  NULL3D_QUIET_PASSED=1 /usr/bin/time -p bun tools/shaders.ts
```

The sizes are the apparent bytes of every file in `packages/engine/src/generated`, and of `target/examples` after `bun run examples:build` with `NULL3D_SHADER_PERMUTATIONS=` for the full set. The examples builds ran while other jobs used the machine, so their sizes are the figures and their times are not.

## Look

The two sets draw the same pixels, because a word's shader text does not change: the narrowing removes words that no page asks for, and a missing word fails its pipeline instead of drawing another. Every demo's picture passes on the listed set, 183 of 183 on the Mac's real GPU, and the three showcase scenes pass 9 of 9 on WebGPU, in compatibility mode and on WebGL2. The four controls-HUD tests pass too, and they turn the shadows, bloom, quality, sky, fog and environment light on at run time. The recording that wrote the list pressed the same buttons, so those words are in it.

## Decision

The shader build takes `--permutations <file>`, one hexadecimal word on each line. `NULL3D_SHADER_PERMUTATIONS` names the same file to the build wrapper, the build's input hash and each cache key. A build without the variable compiles every word.

A word leaves out the bits that a device fixes: the draw index, tone mapping in the shader and half precision. One list then serves every device module, and the build makes each listed word's builds for every value of those bits. A build matches a listed word with those bits cleared, so one list serves every template.

The list comes from a recording run of the pages. `?permutations=record` makes the drawing thread record the word of every variant that a pipeline asks for. The recorder loads each page in hold mode at the low and high presets on both GPU paths, because a preset sets a few of the bits and a path lists bits that the other does not. It also loads every page live, and presses every button of a showcase's controls HUD, because a held frame never turns those on. It writes the union to `examples/shader-permutations.txt`.

The examples' production build reads that file. The engine's release asset is built without a list, because it serves every project rather than one project's pages.

The variants that load on a feature's first use stay in modules of their own. The narrowing removes a build from its module; it never moves a build into the start's modules, so a page downloads the same files for the same features.

## Consequences

- `crates/null3d-shaders` filters each variant's builds to the list, and the list joins the cache key.
- `tools/shader-modules.ts` reads `NULL3D_SHADER_PERMUTATIONS`, and `tools/shader-permutations.ts` records the list.
- `packages/engine` records the words and names a missing word at the pipeline that needs it.
- `examples/vite.build.config.ts` reads `examples/shader-permutations.txt`; a full build sets the variable empty.
- `guides/assets-pipeline` describes the recording and the build. D-162 describes the model's own list, which is a different list.
