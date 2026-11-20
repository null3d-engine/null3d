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
| 36 Khronos glTF sample models (`sources/khronos/`): skins, clips, morph targets, materials, and a model for each glTF extension that the loader reads | The loader's image tests and parity (M2-A2, M2-L4), skinning and clips from files (M2-C7), morph targets (M2-C5), quantized vertices (M2-A1), meshopt (M2-A3), Draco (M2-A6), clear coats and sheens (M2-EX30: ClearCoatTest, ClearCoatCarPaint, ClearcoatWicker, SheenChair, SheenCloth, SheenTestGrid and ToyCar), and the animation-pointer samples' property tracks (M3-G1: AnimationPointerUVs) |
| The KayKit Knight (`sources/characters/kaykit-knight/`): 7,024 vertices, 41 joints, 76 clips | The crowd scene, S5 (M2-L2). The asset tool's simplifier can bring it near S5's 2,500 vertices |
| Four Kenney city kits (`sources/city/kenney-*/`), with one building in FBX and OBJ form | The city scene, S6 (M2-L3), and the convert command (M2-B3) |
| 40 ambientCG texture sets at 1024 x 1024 (`sources/materials/ambientcg/`) | S6's materials and a real KTX2 load (M2-B1) |
| The city layout (`sources/city/layout/layout.json`), from the repository's seeded generator | S6: 19,173 objects in 1,296 buildings, 200 materials (each texture set in five tints), 32 point lights, a camera path through the streets and 8 labels |
| Four Poly Haven environments at 2048 x 1024, with one OpenEXR copy | Environment light and backgrounds (M2-B2, M2-E2, M2-E3) and the HDR readers (M2-E4) |
| Colour grading tables in `.cube` and `.3dl` form | Colour grading (M2-F3) |
| The Creek's trees, plants and cave mouth (`sources/showcase/creek/`), built by script in Blender | The Creek showcase scene (M2-EX8) |
| The island's stone pines, olives, holm oaks and oleanders (`sources/showcase/island/`), built by script in Blender | The island showcase scene |
| Dok11's drone scan of Bolton Priory (`sources/splats/bolton-priory/`): 1,710,551 Gaussian splats, as the SOG file that SuperSplat publishes | The source of the splat stream below |
| The same scan as a splat stream (`sources/splats/bolton-priory-stream/`): an index and 84 SPZ chunk files, 27.6 MB, made by script | The Gaussian splats demo, and a real scan for the splats add-on's devices |

No Khronos model under an accepted licence uses `EXT_meshopt_compression`. So `tests/lib/meshopt-fixtures.ts` compresses SimpleInstancing (CC0) with gltfpack 1.3, `-cc -ce ext`, into `tests/pages/assets/models/simple-instancing-meshopt.glb`. `bun tests/lib/meshopt-fixtures.ts` writes it again. A unit test checks that the committed file matches what gltfpack builds. [D-34](decisions/D-34-meshopt-decoding.md) records why. The sample content's one Draco model, RiggedSimple, has no texture coordinates. So `tests/lib/draco-fixtures.ts` compresses TextureCoordinateTest (CC0) with Draco's own encoder through glTF-Transform, into `tests/pages/assets/models/texture-coordinates-draco.glb`. A unit test checks that file the same way ([D-112](decisions/D-112-draco-decoding.md)). Small fixtures, such as one glTF file per extension and malformed files, stay in this repository beside their tests. So do the image test references. Khronos's AnisotropyStrengthTest is one: its `glTF-Binary` file is 94,444 bytes and under CC0 by Ed Mackey, so the image tests keep it at `tests/pages/assets/models/sources/khronos/AnisotropyStrengthTest/`, beside the two animation-pointer samples that are kept the same way.  The same holds for Khronos's TextureLinearInterpolationTest: 13,468 bytes under CC0, at `tests/pages/assets/models/sources/khronos/TextureLinearInterpolationTest/`. Its scene checks that a texture samples linearly after its texels decode, a fault that no synthetic scene caught. Khronos's DispersionTest is another: its `glTF-Binary` file is 2,310,944 bytes, SHA-256 `bbac38386632b5a7a27289737963314c2f92095074dfdf0e8c0c1c25270b3e37`, and under CC BY 4.0 by AGI, so the image tests keep it at `tests/pages/assets/models/sources/khronos/DispersionTest/`. Each is the Khronos original, byte for byte.

## Use a sample file

- In code that runs in Bun or Node, `samplePath('sources/khronos/Fox/glTF-Binary/Fox.glb')` from `tools/lib/samples.ts` returns the file's full path in the cache. It throws, with the command to run, when the file is missing.
- In a page, `sampleUrl(...)` returns `/samples/<path>`. The dev server and `vite preview` serve each pinned file there from the cache, so phones and tablets on the runner reach the files too. They answer 404 for a file that the manifest does not list. They also answer 404, with the command to run, for a pinned file that the cache lacks. The file's SHA-256 is its entity tag, so a browser never keeps a file from an earlier pin.
- A page module can also import a pinned model optimized: `import url from '/samples/<path>?optimized'`. The import resolves to the cached file. The null3D Vite plugin then runs the asset tool on it, as on a model of the project, and keeps the result in its cache. A build writes the optimized file with the pages. S5 loads its Knight this way (`bench/pages/lib/s5-model.ts`), so both engines load the file that a developer would ship.
- Name each file with a string literal. The sample check reads the names from the code, the `?optimized` imports included.
- A CI job that loads sample files runs `bun run samples:fetch` first. Cache `~/.cache/null3d/samples` with `actions/cache`, keyed on the hash of `tools/samples/lock.json`. The `.github/actions/samples` action does both. The browser, bench and real-browsers jobs use it, because the glTF image tests and their parity scenes load Khronos models. The job of the unit tests uses it too, because the meshopt unit tests read sample files. The action fetches only the checked-out commit's pin. Each copy of the repository reads its own pin. So a job that builds other commits in copies of their own runs the fetch in each copy, as the benchmark job does ([Benchmarks](benchmarks.md#the-benchmark-job-in-ci)).

## The city of S6

The city layout holds rows of objects, not models. S6 needs model files, so `bench/lib/city-files.ts` builds two from the layout. The kit file holds each part of the Kenney models that the layout uses. The tower file holds one mesh per material with every box in that material, and the layout's 200 materials. The files go into the shared cache, in `city/<key>` beside the commits' folders. The key is the layout's SHA-256, the pinned commit and the module's own source, so a change to any of them builds them again. Their images stay in the commit's folder, and the files name them by relative paths. Only the packed images of occlusion, roughness and metalness are new files.

The key must hold the pinned commit, because the files name images in that commit's folder. Take a change that moves the pin and keeps the layout. Without the pin in the key, the benchmark job builds its baseline's city files under the old pin, and its new build takes the same folder. The Actions cache then keeps those files for the new pin, without the old pin's folder. The next benchmark run that restores them fails before its first page, because the files name images that the machine does not have. A computer that keeps every pin's folder, as a developer's does, never shows the fault. A unit test in `bench/lib/city-files.test.ts` checks that two pins with one layout get two folders.

A page imports them as `/s6-city/kit.gltf?optimized` and `/s6-city/towers.gltf?optimized`. The `cityServer` plugin of the module resolves each import to the built file, and the null3D plugin optimizes it as any model. The benchmark pages' build and the dev server both use it. The first build takes about 27 seconds, and the optimization about 100 more on the owner's Mac. `bun bench/lib/city-files.ts` does both ahead of time. In CI, the `city` job runs it once per run through `.github/actions/city`, after the samples action, and keeps both results in the Actions cache. Its key covers the pinned sample content, the module and the asset tool. The job hands both results to the jobs that load S6 as artifacts. A build without the cache took 6.2 minutes on GitHub's Linux machines ([D-106](decisions/D-106-s6-city.md#ci)). [Benchmarks](benchmarks.md#the-city) describes S6.

## Splat scans converted by script

The splats add-on reads SPZ files and splat streams, and the scans that sites publish come in other forms. A script in this repository converts a published scan into a stream, and the sample-assets repository keeps both the published file and the stream. The published file keeps the author's own bytes, and the manifest records the stream with the origin kind `converted`, which names the script and the asset it reads.

| Script | Builds |
| --- | --- |
| `tools/samples/splats/bolton-priory.ts` | The Bolton Priory stream from the SOG file that SuperSplat publishes |

Build the stream with `bun tools/samples/splats/bolton-priory.ts <folder>`. It needs libwebp's `dwebp` (`brew install webp`), or the executable that `DWEBP` names, and takes about a second. A SOG file is a zip of lossless WebP images, and `dwebp` gives every byte exactly. A browser's decoder may multiply a pixel's color by its alpha, and every splat's color pixel in a SOG file is partly transparent, so a browser would change the colors. The script turns the cloud upright, since the training wrote it with its vertical axis pointing down, moves the ground to height 0 and the site over the origin, keeps the first spherical-harmonic band, and cuts and writes the chunks with the add-on's own `chunkSplats` and `encodeSpz`. To publish it:

1. Copy the folder into `sources/splats/bolton-priory-stream/` of the sample-assets repository, and run `bun scripts/manifest.ts --write` there.
2. Commit, push, and pin the commit here, as "Add or change an asset" says.

SuperSplat lets only a signed-in account download a scan, so the published file's origin kind is `manual`, which names the page to download it from. A page names only the stream's index, and the add-on reads the chunks from it. So `copyNamedSamples` copies the chunk files that a named stream index lists beside it.

## Models built in Blender

The showcase scenes' trees and plants, and Creek's cave, are organic shapes that code in a sketch would make poorly. A Python script builds them in Blender, with no hand work and no downloads, and the sample-assets repository keeps its output. Creek's two sculpted pines start from trunks that Tripo3D generated. The sample-assets repository keeps each raw download with its task record and command, and `creek.py` finishes it. The scripts live in this repository, in `tools/samples/blender/`, so a change to a model is a reviewed change to code.

| Script | Builds |
| --- | --- |
| `common.py` | The parts that the scripts share: textures painted with numpy, the materials that the glTF exporter reads, the mesh builder, the crown of leaf cards on pads at the branches' ends, the export with levels of detail, and the Cycles preview |
| `creek.py` | The Creek's models: oak, beech and birch trees, a fern, a hosta, a shrub, a clump of wildflowers, a cave mouth with boulders, and a tall and a low cloud-pruned pine. numpy paints every texture but the pines' bark: leaf clusters, needles, fern fronds, a hosta leaf, flowers, three barks and a rock. The vertex colors hold ambient occlusion and moss. Each pine's trunk is a raw Tripo3D model: the script sizes it, drops its loose pieces, keeps its own bark maps, finds its limbs and lays a layer of needle pads on each tier of them. Each pad is a body of dense needles with needle cards on it, and the bare twig ends outside the layers are cut away |
| `island.py` | The island's models: a stone pine, an olive, a holm oak and an oleander, each with a card of the whole plant for the far copies. numpy paints every leaf, needle, flower and bark texture, and Blender bakes the cards from the plants themselves |
| `creek_tripo.py` | The Creek garden's models that start as Tripo3D meshes: the bronze statue, a stone lantern, a timber gate and three boulders. It reads each raw download, turns, scales and stands it, and decimates it. The statue loses its base, its head grows and its body widens, and it gets a stone slab that the script builds. The gate loses the rear frame that Tripo3D added. Cycles bakes the raw surface onto each decimated mesh, and numpy repaints the bronze's weathering, the stone and the moss. Each part gets two lower levels with their measured errors, and the build stops if one strays too far |
| `build.ts` | Runs a script in Blender, optimizes each model with the asset tool, packs each model's KTX2 textures into its own file, and checks that every part that sways kept its sway. Blender runs with four threads in every build, since some meshes come out in an order that depends on the thread count. The options after the output folder go to the script, and `--models` picks the models to build |
| `creek.ts`, `island.ts`, `creek_tripo.ts` | Each scene's models for `build.ts` |

Build a scene's models with `bun tools/samples/blender/creek.ts <folder>` or `bun tools/samples/blender/island.ts <folder>`. `--models <a,b>` builds only those models. The Creek's pines read their raw trunks from the pinned sample content, and `creek.py` checks each file's hash. `--raw <folder>` names another copy of the same files, such as the `sources/showcase/creek-raw` folder of a sample-assets checkout whose commit is not pinned yet. They need Blender 5.3, on the path or where `BLENDER` names it, and the engine's build for the asset tool. Each takes under a minute, and prints each part's triangles and each file's size. `--preview <folder>` also renders each model with Cycles there. To publish them:

1. Copy the files into `sources/showcase/<scene>/` of the sample-assets repository, and run `bun scripts/manifest.ts --write` there.
2. Commit, push, and pin the commit here, as "Add or change an asset" says.

The sample-assets repository records these models with the origin kind `blender`, which links to the script. Its import script has nothing to download for them, and its check does not build them again, because the check would need Blender.

The Creek garden's statue, lantern, gate and boulders start as Tripo3D meshes instead. Tripo3D cannot repeat a request exactly, and its download links expire within minutes. So each raw download goes into the sample-assets repository unchanged, in `sources/showcase/creek-raw/<model>/`. The run's record (`task.json`), its preview and the exact `tripo make` command go beside it. `bun tools/samples/blender/creek_tripo.ts <folder>` finishes the models from the pinned copies, or from the folder that `--raw <folder>` names, and never calls the service. The finished models go into `sources/showcase/creek-garden/<model>/`, one entry each. The raw downloads, and every model finished from them, are under CC BY-NC 4.0.

The models are optimized before they go into the sample-assets repository, unlike the other sources there. A sketch loads them with `sampleUrl`, so a website's build copies one file for each model. The asset tool writes its KTX2 textures as separate files, and the build would not copy those. So `build.ts` moves each texture into the model's binary chunk, as an image with a buffer view.

Every vertex of a tree or a plant carries its sway in the second texture coordinates (`TEXCOORD_1`). The first value is the bend weight, from 0 at the root to 1 at the freest tips. The second is a phase from 0 to 1, which sets each branch apart, so the plant flutters part by part. Both stay between 0 and 1, since the asset tool's quantizer keeps no negative texture coordinate. The scenes' wind material (`examples/lib/sway.ts`) reads them. Vertex color alpha cannot carry the weight. glTF multiplies it into the base color's alpha, so a masked card would lose its leaves near the root.

A scene reads each part's textures from its node's `maps`, which `prefab.find` gives, and the wind material draws them in the file's material's place.

Each model draws with few triangles, so a scene can place many copies. The trees' leaves are cards. Each card holds a cluster of small leaves from an atlas, and its alpha cuts their outline. The alpha fades over two texels at each leaf's edge, which softens the outline where alpha to coverage runs. The cards' normals bend away from the crown's middle, so the crown shades as one soft mass. The materials of the cards are masked and double sided. Each tree part also has two lower levels of detail, in the MSFT_lod extension, with each level's error in `NULL3D_lod_error`. The asset tool keeps each level in its base mesh's frame.

| Part | Triangles at each level |
| --- | --- |
| Creek oak: wood, leaves | 5,072, 1,704, 568; 31,036, 10,348, 3,880 |
| Creek beech: wood, leaves | 5,284, 1,762, 588; 34,340, 11,448, 4,296 |
| Creek birch: wood, leaves | 3,872, 1,374, 504; 13,968, 4,656, 1,748 |
| Creek fern, hosta, shrub, wildflowers | 416, 560, 504, 564 |
| Creek cave mouth | 9,863 |
| Island stone pine: wood, leaves | 766, 150, 84; 2,804, 936, 284 |
| Island olive: wood, leaves | 960, 228, 126; 2,080, 696, 208 |
| Island holm oak: wood, leaves | 612, 148, 72; 5,272, 1,320, 332 |
| Island oleander: stems, leaves and flowers | 192, 96, 96; 1,280, 768, 288 |
| Each island plant's far card | 20 |
| Creek tall pine: wood, needles | 14,000, 4,999, 1,599; 20,694, 10,908, 5,136 |
| Creek low pine: wood, needles | 7,999, 2,999, 999; 22,336, 11,800, 5,572 |
| Creek garden statue: figure, slab | 29,999, 10,199, 2,999; 1,456, 728, 312 |
| Creek garden lantern | 1,500, 900, 450 |
| Creek garden gate | 5,967, 2,369, 869 |
| Creek garden boulders 1 and 2, each | 1,500, 900, 450 |
| Creek garden boulder 3 | 1,499, 899, 599 |

The Creek's trees file takes 4,198 KB, its plants file 470 KB, its cave file 784 KB and its pines file 3,348 KB. The island's trees file takes 1,237 KB and its shrubs file 256 KB. The Creek garden's statue file takes 3,079 KB, its lantern 571 KB, its gate 2,184 KB, and its boulders 2,029 KB, 2,075 KB and 514 KB. A Creek tree's lower levels keep one leaf spray in three and one in eight, each a little larger, so the leaves keep near their size. They switch about 50 m and 100 m away on a screen 1,080 pixels high. The island's tree levels switch about 40 m and 90 m away, and the oleander's about 15 m and 35 m away. The tall pine's levels switch about 40 m and 90 m away, and the low pine's about 25 m and 60 m away. A pine's lower levels keep one needle card in two and one in five, each a little larger, and coarser pad bodies. They cut the wood to about a third and an eighth of its triangles.

An island plant's card is two upright quads crossed through its trunk and a level quad at two thirds of its crown's height. Cycles renders the plant from the side and from above onto a transparent film, with each surface's own color and no light, so the engine lights the card once. The views fill the card's atlas, the side on the left and the top on the right. Each quad carries its own back face, so the card's material draws one side. A two-sided material would turn the back's normals inward, and half of every card would light dark. The scene hands each plant over from its meshes to its card past a distance that its preset sets.

## The sample check

`bun run test` runs `tools/lib/samples.test.ts`. It finds every `samplePath` and `sampleUrl` call in `tests/`, `bench/`, `examples/`, `tools/` and `packages/`. For each named file, it checks that the pinned manifest lists the file with a SHA-256. It also checks that the file's asset is under CC0 or CC BY, with its authors, title, source link, fetch date and changes. The one exception is CC BY-NC, which the check accepts only on an asset that names its `generator`. The sample-assets repository's own check makes its README tables match its manifest, so each pinned asset also has its row in that README.

## Add or change an asset

1. In the sample-assets repository, follow its README: add the asset's entry to `manifest.json`, run `bun scripts/import.ts <asset id>`, then `bun scripts/manifest.ts --write`, then `bun scripts/manifest.ts`.
2. Accept CC0 and CC BY. Leave out an asset whose licence is non-commercial, no-derivatives or unclear, and add it to the list of assets left out below, with the reason. The sample-assets README lists only the assets it holds.
   The one exception is a model that a generative service made, such as Tripo3D, or a model finished from one. The service's terms bar some commercial uses of its outputs, so the model is under CC BY-NC 4.0. Its manifest entry names the service in `generator`. The check refuses CC BY-NC on an entry without one, here and in the sample-assets repository. So the licence never spreads to an asset that it was not meant for.
3. Keep each file under 40 MB and each image within 2048 x 2048, which the asset tool's encoder takes. Keep the sources near 400 MB in all. They are 272 MB at the pinned commit, and the Creek garden's models add about 100 MB.
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

- Size. The sources are 272 MB, and the processed files will add 110 to 170 MB for each version of the encoders. In this repository, they would slow every clone for people, CI and agents.
- Not Git LFS. GitHub's free plan gives 10 GiB of LFS downloads a month, and CI's downloads count. One CI fetch of about 150 MB uses 1.5% of that, so about 65 fetches would use it all. No file is near GitHub's block at 100 MiB, so plain git holds the files well.
- Not a submodule. Each worktree would need its own checkout of the sources, and this team runs many worktrees at once. CI would need its own submodule step and cache. The download script keeps one checked copy per machine, keyed by commit, and works the same way in CI.
- Not an npm package. Every version would stay in the registry for good, and the files would land in each worktree's `node_modules`.
- Checks per file. GitHub does not promise that a commit's archive keeps the same bytes. The script therefore checks each file against the manifest, and never the archive itself.

## Processed files

The asset tool, `bunx @null3d/cli assets optimize`, builds the files that pages load from the pinned sources. It writes quantized meshes, with meshopt once the engine reads it, and textures in KTX2. On the Mac it encodes the 40 texture sets in about 20 seconds, and the four city kits in under 3 ([D-18](decisions/D-18-asset-tool.md)). Each new encoder version would add the whole set to git's history again, so they stay out of git. A workflow in the sample-assets repository will publish them as a release archive, tagged `processed-v<n>`, with its own manifest of SHA-256 hashes. GitHub sets no size or bandwidth limit on release archives. The lock's `processed` field will then record the tag, the URL and the archive's SHA-256. `bun run samples:fetch` will unpack the archive into the commit's folder in the cache.
