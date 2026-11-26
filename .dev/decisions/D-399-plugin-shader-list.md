# D-399: A project's build copies only the shader builds of its listed words

Status: decided and built. The Vite plugin's `shaders.list` option narrows the copies of a production build, and `bunx @null3d/cli shaders record` writes the list. Task: none.

Summary: A production build that names a list of permutation words copies only the builds of those words from the engine's shader set. It compiles nothing. The whole set is 7,597 files and 4,115 MB. The examples' 270 words copy 795 files and 257 MB, and a small scene's 6 words copy 218 files and 17 MB.

## Question

The plugin takes the engine's shader set from the release asset, from the folder that `NULL3D_ENGINE_SHADERS` names, or from a local build. A production build copies every file that the set's modules name. A page downloads the few files that its device needs, yet the host stores the whole set. How does a project outside the engine's repository ship only what its pages draw with? It has no checkout of the engine, and it compiles no shader.

## Rule

- A narrowed build draws every state that the project's pages offer, on every GPU path and every quality preset, as D-276's compiled list does.
- It needs no checkout of the engine and compiles no shader. It reads the set that it already has.
- A listed word that no shader build of the project holds fails the build, and the message names the word. The engine's set holds most builds. The project's custom materials and add-ons hold the rest.
- A page that asks for a word outside the list fails that pipeline with a message that names the word as the list writes it. It never draws nothing in silence, and it never fails as a lost download.
- A build without a list copies the whole set, and it warns with the size that it copied.
- The build never holds the whole set in memory (the reason for the hash pool of the streamed copies).

## Data

| Shader files that a production build copies | Files | Bytes |
| --- | --- | --- |
| No list: the whole set | 7,597 | 4,114,971,399 |
| The 270 words of `examples/shader-permutations.txt`, narrowed builds | 795 | 257,337,846 |
| The same words, whole device files that hold one of them | 794 | 363,991,448 |
| The fresh project's 6 recorded words, narrowed builds | 218 | 16,655,749 |
| The same words, whole device files that hold one of them | 237 | 82,502,342 |
| The fresh project's word `0x00000000` alone, narrowed builds | 176 | 11,986,701 |

How the data was produced: on one Mac with 18 cores, at commit a4fcf784d with this branch's changes, against the shader set that `bun run build` wrote. The set's shader sources are those of the 0.1.0 release, and it holds 8,148 files and 4,118,429,045 bytes. Other checkouts' shader builds ran beside the runs, at load averages from 15 to 100, so no time is given. A count takes the files of the build's `assets` folder that hold builds in the shader build's own form. It adds the paragraph tables and the module without builds, and the bytes are their sizes:

- The whole set and the fresh project's rows: `bun run test:packages --keep`. It builds the fresh project with the packed packages, and `NULL3D_ENGINE_SHADERS` names the checkout's set. Its `shaders record` wrote 6 words: `0x00000000`, `0x00000010`, `0x00000100`, `0x00001000`, `0x00004000` and `0x00040000`.
- The examples' row: `vite build` of `examples/vite.build.config.ts`, with `NULL3D_SHADER_PERMUTATIONS=` and the plugin's `shaders: { list: 'examples/shader-permutations.txt' }`. None of its 7,459 copied builds has a word outside the list. The same build without the list copied the whole set's 7,597 files and 4,114,971,399 bytes. Eleven demos of the build with the list drew in hold mode on WebGPU and on WebGL2, on the Mac's GPU. They are instances, security-camera, coat-and-sheen, translucency, weighted-transparency, sprites-lines, particles, morph-flowers, post-effects, decals and area-lights. The server of that check served no sample files, so the character demo stopped at its model's download (E1411) and drew nothing.
- The whole-file rows: a script over the set. It keeps each device file that holds a build of a listed word whole, and each table that those files import.

## Look

The options draw the same pixels. A build keeps a listed word's builds byte for byte, and a word outside the list fails its pipeline instead of drawing another build.

## Decision

The plugin takes `shaders: { list }`, a file of hexadecimal words, one on each line, in D-276's form. The path is relative to Vite's root. The streamed copies of a production build read each device file of the set on the hash pool's workers. A worker hashes the file and gives the permutation word of each build that it holds, from the same read. Then:

- A file whose builds the list all holds is copied whole.
- A file of which the list holds some builds is copied with those builds alone. The plugin parses it with Vite's parser and removes the other builds. It also removes the shared paragraphs and the imported names that no kept build reads. The parse refuses a file in another form, so a build never ships a file that it misread.
- A file of which the list holds no build gives way to one module with no builds. Its loader in the set's tables then names that module. A page that asks for one of its words loads it and finds no build, and the engine's message names the word.
- A table of shared paragraphs keeps the paragraphs that the copies import.

A build matches a listed word as the shader build does: a build's word, or that word with the bits that a device fixes cleared. The set's module of listed words, which the engine reads for its message, names the project's list. The build fails when a listed word is in no build: none of the copies, and none of the builds that the bundle holds. Those are the set's main module and the project's custom materials and add-on shaders. The plugin reads their words from the bundle's files. The examples' list holds 13 words that only such builds hold. The dev server ignores the list, so a recording sees every word.

The recorder lives in the command-line tool, `packages/cli/src/shader-record.js`, which `bunx @null3d/cli shaders record` runs for a project. The repository's script runs the same code over the demos. The command starts the project's own dev server unless `--base` names one, and draws with the tool's browser launcher. Its `--scroll` scrolls each live page to its end, a window's height at a time. After each step it waits until the page has asked for nothing for 500 ms, at least 1 s and at most 15 s. A scene stage that a scroll reveals downloads its models and shader files, and its pipelines then ask for their words. The engine publishes its words only when the recording stops, so the page's requests are the signal that the recorder can read. A run adds its words to the list that it names, so each level or mode can be recorded in a run of its own; `--replace` writes the run's words alone. The repository's script writes the demos' list afresh, so a word that no demo draws leaves it.

The list names words alone. So a listed word keeps its builds in every shader that has one, those of features that the pages never use too. The word without any bit set keeps the most: the engine's own passes and many features' passes draw with it. With the fresh project's list cut to that word alone, a build copied 176 files and 11,986,701 bytes. A list of shaders as well as words would keep less. The engine records words, though, and a list of words also serves the repository's compiled build (D-276). Every page's start draws its culling with that word. So the plugin refuses a list without it, and no build ships that cannot start.

The engine's message for a missing word gives the word without the device bits, padded as the list writes it. It names the command that records the list. It names the word of the build that the pipeline looked for, which a prepass pipeline takes without its prepass bit. A WebGPU pass that the start builds, such as culling or skinning, names its shader and the word in the same form.

Options rejected:

- Copy whole device files only, those that hold a listed build. It needs no parse, but a file holds every word of its features. It copied 1.4 times the bytes of the narrowed copies with the examples' list, and 5.0 times with the fresh project's words.
- Compile the listed words in a checkout of the engine, and name the result with `NULL3D_ENGINE_SHADERS`. It needs the engine's checkout, its Rust toolchain and a compile of every listed build. A project outside the repository has neither.
- Ship a narrowed release asset. A release serves every project, so no one list fits it (D-276).
- Leave the dropped files' loaders as they are. A page that asks for such a word then fails as a download that the server lacks. That message names neither the word nor the list.
- Pick the files to keep from their names. The feature that a file's name gives belongs to its shaders, not to the word, so every listed word would keep each feature's own files.

## Consequences

- `packages/vite-plugin/src/shader-list.ts` reads the list and narrows a device file and a table. The hash worker, `hash-worker.js`, scans a file's words in the same read as its hash. The plugin's `index.ts` takes the option and replaces the module of listed words. It fails on a missing word, and it reports what it copied.
- `packages/engine/src/gpu/variants.ts` names the missing word as the list writes it. The two GPU paths pass the word of the build they looked for. The WebGPU passes that the start builds, such as culling, name it through `missingShader`.
- `packages/cli/src/shader-record.js` holds the recorder, `shaders.js` the command, and `tools/shader-permutations.ts` keeps the demos' pages.
- `bun run test:packages` records the fresh project's words, builds with them, checks the copies and starts the page on both GPU paths. It also builds with a list that holds only the word without any bit, and checks that the page names a word of the recording.
- The guides `guides/assets-pipeline`, `guides/deterministic-simulation`, `getting-started/network-use`, `getting-started/install` and `cli/null3d`, both READMEs and the develop skill describe the option and the command.
