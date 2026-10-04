# Sample content

Tests, benchmarks and demos load large models, characters, textures, environments and colour grading tables. These files live in a separate repository, [null3d-engine/sample-assets](https://github.com/null3d-engine/sample-assets), and not in this one. This guide says where the files are, how code uses them, how to add an asset, and why the files live apart.

## Where the files live

| Place | Contents |
| --- | --- |
| The sample-assets repository | `sources/` holds each asset as its authors publish it. `manifest.json` gives each asset's title, authors, source link, licence, fetch date and changes, and each file's path, size and SHA-256. The README prints the same attribution as tables, and `LICENSES/` holds the licence texts |
| `tools/samples/lock.json` | The pinned commit of the sample-assets repository, and a place for the processed release archive (`processed`, null until the asset tool publishes one) |
| `tools/samples/manifest.json` | A byte-exact copy of the pinned commit's `manifest.json`. Biome skips it, so formatting never changes its bytes |
| The cache, `~/.cache/null3d/samples/<commit>/` | The pinned commit's files. `XDG_CACHE_HOME` moves the cache folder, and `NULL3D_SAMPLES_DIR` replaces the whole path. Every copy of the repository on the machine shares it |

`bun run samples:fetch` downloads the pinned commit's archive into a staging folder in the cache. It checks that the archive's manifest is the pinned copy, and checks each file's size and SHA-256 against it. Then it moves the folder into place and writes a marker with the manifest's hash. A later run sees the marker and returns at once. `--verify` hashes the cached files again and downloads a copy that fails. A fetch that fails never leaves a partial copy, and two fetches at once end with one good copy.

On the owner's Mac, the first fetch of 540 files (183 MB) took 8.7 seconds. A fetch with the cache in place took 0.02 seconds.

## What the content covers

| Content | For |
| --- | --- |
| 28 Khronos glTF sample models (`sources/khronos/`): skins, clips, morph targets, materials, and a model for each glTF extension that the loader reads | The loader's image tests and parity (M2-A2, M2-L4), skinning and clips from files (M2-C7), morph targets (M2-C5), quantized vertices (M2-A1), meshopt (M2-A3) and Draco (M2-A6) |
| The KayKit Knight (`sources/characters/kaykit-knight/`): 7,024 vertices, 41 joints, 76 clips | The crowd scene, S5 (M2-L2). The asset tool's simplifier can bring it near S5's 2,500 vertices |
| Four Kenney city kits (`sources/city/kenney-*/`), with one building in FBX and OBJ form | The city scene, S6 (M2-L3), and the convert command (M2-B3) |
| 40 ambientCG texture sets at 1024 x 1024 (`sources/materials/ambientcg/`) | S6's materials and a real KTX2 load (M2-B1) |
| The city layout (`sources/city/layout/layout.json`), from the repository's seeded generator | S6: 19,173 objects in 1,296 buildings, 200 materials (each texture set in five tints), 32 point lights, a camera path through the streets and 8 labels |
| Four Poly Haven environments at 2048 x 1024, with one OpenEXR copy | Environment light and backgrounds (M2-B2, M2-E2, M2-E3) and the HDR readers (M2-E4) |
| Colour grading tables in `.cube` and `.3dl` form | Colour grading (M2-F3) |

No Khronos model under an accepted licence uses `EXT_meshopt_compression`. So `tests/lib/meshopt-fixtures.ts` compresses SimpleInstancing (CC0) with gltfpack 1.3, `-cc -ce ext`, into `tests/pages/assets/models/simple-instancing-meshopt.glb`. `bun tests/lib/meshopt-fixtures.ts` writes it again. A unit test checks that the committed file matches what gltfpack builds. [D-34](decisions/D-34-meshopt-decoding.md) records why. Small fixtures, such as one glTF file per extension and malformed files, stay in this repository beside their tests. So do the image test references.

## Use a sample file

- In code that runs in Bun or Node, `samplePath('sources/khronos/Fox/glTF-Binary/Fox.glb')` from `tools/lib/samples.ts` returns the file's full path in the cache. It throws, with the command to run, when the file is missing.
- In a page, `sampleUrl(...)` returns `/samples/<path>`. The dev server and `vite preview` serve each pinned file there from the cache, so phones and tablets on the runner reach the files too. They answer 404 for a file that the manifest does not list. They also answer 404, with the command to run, for a pinned file that the cache lacks. The file's SHA-256 is its entity tag, so a browser never keeps a file from an earlier pin.
- A page module can also import a pinned model optimized: `import url from '/samples/<path>?optimized'`. The import resolves to the cached file. The null3D Vite plugin then runs the asset tool on it, as on a model of the project, and keeps the result in its cache. A build writes the optimized file with the pages. S5 loads its Knight this way (`bench/pages/lib/s5-model.ts`), so both engines load the file that a developer would ship.
- Name each file with a string literal. The sample check reads the names from the code, the `?optimized` imports included.
- A CI job that loads sample files runs `bun run samples:fetch` first. Cache `~/.cache/null3d/samples` with `actions/cache`, keyed on the hash of `tools/samples/lock.json`. The `.github/actions/samples` action does both. The browser, bench and real-browsers jobs use it, because the glTF image tests and their parity scenes load Khronos models. The job of the unit tests uses it too, because the meshopt unit tests read sample files.

## The sample check

`bun run test` runs `tools/lib/samples.test.ts`. It finds every `samplePath` and `sampleUrl` call in `tests/`, `bench/`, `examples/`, `tools/` and `packages/`. For each named file, it checks that the pinned manifest lists the file with a SHA-256. It also checks that the file's asset is under CC0 or CC BY, with its authors, title, source link, fetch date and changes. The sample-assets repository's own check makes its README tables match its manifest, so each pinned asset also has its row in that README.

## Add or change an asset

1. In the sample-assets repository, follow its README: add the asset's entry to `manifest.json`, run `bun scripts/import.ts <asset id>`, then `bun scripts/manifest.ts --write`, then `bun scripts/manifest.ts`.
2. Accept CC0 and CC BY only. Leave out an asset whose licence is non-commercial, no-derivatives or unclear, and add it to the list of assets left out below, with the reason. The sample-assets README lists only the assets it holds.
3. Keep each file under 40 MB and each image within 2048 x 2048, which the asset tool's encoder takes. Keep the sources near 300 MB in all. They are 183 MB now.
4. Commit and push in the sample-assets repository, and wait for its check to pass.
5. Here, run `bun run samples:fetch --pin main`, or give a commit. It copies that commit's manifest, records the commit in the lock, and fetches it. Commit `tools/samples/lock.json` and `tools/samples/manifest.json` together.

## Assets left out

Well-known sample models that may not go into the sample-assets repository, and why. Nothing in the engine repository uses them.

| Asset | Reason |
| --- | --- |
| BrainStem, Sponza, VirtualCity, DamagedHelmet, Duck (Khronos) | Their licences do not allow redistribution and commercial use, or they have a non-commercial part |
| Mixamo characters | Adobe's terms do not allow redistribution of the files |
| CesiumMan, CompareBaseColor (Khronos) | They carry logos under trademark terms beyond CC BY. RiggedFigure and Fox cover the same skinning cases |
| DragonAttenuation (Khronos) | The dragon is under the Stanford Graphics licence, which is not CC0 or CC BY |
| Larger Khronos showcase models | No test needs them, and they would add size |

## Why a separate repository and a download script

- Size. The sources are 183 MB, and the processed files will add 110 to 170 MB for each version of the encoders. In this repository, they would slow every clone for people, CI and agents.
- Not Git LFS. GitHub's free plan gives 10 GiB of LFS downloads a month, and CI's downloads count. One CI fetch of about 150 MB uses 1.5% of that, so about 65 fetches would use it all. No file is near GitHub's block at 100 MiB, so plain git holds the files well.
- Not a submodule. Each worktree would need its own checkout of the sources, and this team runs many worktrees at once. CI would need its own submodule step and cache. The download script keeps one checked copy per machine, keyed by commit, and works the same way in CI.
- Not an npm package. Every version would stay in the registry for good, and the files would land in each worktree's `node_modules`.
- Checks per file. GitHub does not promise that a commit's archive keeps the same bytes. The script therefore checks each file against the manifest, and never the archive itself.

## Processed files

The asset tool, `bunx @null3d/cli assets optimize`, builds the files that pages load from the pinned sources. It writes quantized meshes, with meshopt once the engine reads it, and textures in KTX2. On the Mac it encodes the 40 texture sets in about 20 seconds, and the four city kits in under 3 ([D-18](decisions/D-18-asset-tool.md)). Each new encoder version would add the whole set to git's history again, so they stay out of git. A workflow in the sample-assets repository will publish them as a release archive, tagged `processed-v<n>`, with its own manifest of SHA-256 hashes. GitHub sets no size or bandwidth limit on release archives. The lock's `processed` field will then record the tag, the URL and the archive's SHA-256. `bun run samples:fetch` will unpack the archive into the commit's folder in the cache.
