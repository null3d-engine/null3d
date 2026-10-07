# D-102: Offline play: the build's file list and the game's own service worker

Status: decided, 2026-10-08. Date: 2026-10-08. Task: M2-R20.

Summary: Each production build with the Vite plugin writes `null3d-files.json` beside the page. It holds a `start` group, a group per feature that loads on first use, and a version. A game's own service worker caches the start and the features that it uses. On the engine test page's build, the start is 6.7 MB, skinning 5.2 MB and the whole build 17.8 MB, uncompressed. The hosting guide shows a 25-line worker, and the fresh-project test proves that it starts the threaded engine with the server stopped.

## Question

Games must play with no network after their first visit (owner, 4 October 2026). The owner ruled that the game's own service worker does the caching and that null3D ships none. What must the engine and the Vite plugin give such a worker, so that it caches what the game needs and no more? And how does the page stay cross-origin isolated when the worker answers it?

## Rule

- A game caches exactly the features that it uses, with the same names as `createEngine`'s `preload`.
- An offline start must not fall back to the single-threaded build without a sign.
- A list that the plugin makes must never leave out a file that a page may need. A file that the plugin cannot place goes to the start.
- The guide shows the setup in one short example, and a test runs that example.

## Data

The engine test page's production build (`bunx vite build`, Vite 8.3.1, main at efead8b5d), sizes of the files as they are and after gzip at level 9. Cache Storage keeps the bodies as they arrive, without the transfer's compression.

| Group | Files | Uncompressed | gzip |
| --- | --- | --- | --- |
| `start` | 37 | 6,681 KB | 1,569 KB |
| `skinning` | 12 | 5,152 KB | 511 KB |
| `morph` | 8 | 2,947 KB | 338 KB |
| `ktx2` | 8 | 1,102 KB | 467 KB |
| `instance_index` (engine tests only) | 4 | 890 KB | 141 KB |
| `lines` | 8 | 231 KB | 52 KB |
| `sprites` | 7 | 160 KB | 32 KB |
| `environment` | 13 | 147 KB | 38 KB |
| `bloom` | 4 | 121 KB | 27 KB |
| `gltf` | 8 | 102 KB | 38 KB |
| `texcoords` (engine tests only) | 6 | 94 KB | 20 KB |
| `sky`, `background`, `ao`, `occlusion`, `lut` | 4, 4, 2, 1, 2 | 62, 51, 28, 16, 9 KB | 18, 13, 7, 4, 3 KB |
| Every file of the build | | 17,790 KB | 3,281 KB |

A game that caches every file stores 17.8 MB. One that uses no skinning, morph targets or KTX2 files stores 6.7 MB plus its small features.

How the data was produced: `bunx vite build --outDir <folder>` in the repository, then the sizes of each group's files in the written `null3d-files.json`.

The offline reload in each browser. The fresh project's production build has the guide's worker, which caches the start and the sprite feature. A first visit fills the cache. Then the server stops, and the page reloads from the cache alone.

| Browser | First visit | Offline reload | Run |
| --- | --- | --- | --- |
| Chrome 155 (Playwright, the Mac's GPU) | Threaded, isolated; the cache holds exactly the page, the start and the sprites | Threaded, isolated; no failed request but the worker's own check of the list | `bun run test:packages` |
| Safari 26.6.2, the owner's Mac | Threaded, isolated; 59 files cached | Threaded, isolated, under the worker's control | offline-check-1791390521124 |
| Firefox 157, the owner's Mac | Threaded, isolated; 59 files cached | Threaded, isolated, under the worker's control; only the browser's own `favicon.ico` request failed | offline-check-1791390669975 |

How the browser runs were made: a script served the build with the isolation headers. It added a reporting script to the page, which posted to a second port. The page reported its first start once the cache held the page. The script then stopped the server, and the page reloaded itself and reported again. Last, the page removed its worker and caches and closed its window. Safari and Firefox ran on 2026-10-08 from the branch at 95aa3f907.

## Decision

1. The list. Each production build of pages writes `null3d-files.json` beside the page: `version`, `start`, and `features` by name. The shader features take the names of `preload` (`skinning`, `bloom`, and so on). The loaders form four more: `gltf`, `ktx2`, `environment` and `lut`. The `gltf` group holds the meshopt decoder, which only glTF files use, and `ktx2` holds the transcoder. The stats overlay, the label loop, the preset check and the WebGL call timing are small, so they stay in the start. Each feature's list holds the shaders of every GPU path and device setting. A device can switch to another variant during play. For example, bloom on the 8-bit path moves to HDR color, which loads the start's builds without the tone mapping bit.
2. How the plugin groups files. The plugin reads the bundler's facts, not file names, so a project's own naming of files cannot move a file. Vite builds each worker in a bundle of its own, and copies its files into the main bundle without their modules. So the plugin adds a small plugin to each worker build that records them. A file's group then follows from the files that name it, starting at the pages and the entry scripts. The walk does not enter a feature's files from the start. It always follows a static import, which loads with its importer. In a script, Vite writes the list of files to fetch beside each import on demand (`__vite__mapDeps`). Those files load only with the import, which the walk follows itself, so the walk skips that list. A file that no walk reaches goes to the start, so a list errs toward caching more.
3. The service worker is the game's. The guide gives a worker of about 25 lines, not a tool. Its call to `cache.addAll` caches the page by its own address. That call keeps each response's headers, so the cached page stays isolated. The cache's name holds the list's `version`. On each visit with a network, the worker checks the list and caches a new build in one step. When one download fails, `cache.addAll` stores nothing, so a half-cached build never runs. Tools that write workers, such as vite-plugin-pwa, need more settings for the engine: its `.wasm` files, and files over their size limits. Their versions also move on their own, so the guide does not depend on one.
4. Lost isolation. A development build of the engine warns once when a service worker controls the page and the page is not isolated. That is the one sign of a worker that dropped the headers. Production builds drop the check with the other development checks. The guide says to check `crossOriginIsolated` after an offline reload.
5. Stable addresses. Vite already names every engine file with a content hash, on the page's origin. The engine starts its workers from `blob:` scripts that it makes in the page. The offline test checks that no request fails with the server stopped.
6. The engine's own cache. The KTX2 loader keeps transcoded textures in Cache Storage, in caches whose names start with `null3d-` ([D-24](D-24-transcode-cache.md)). The guide's worker deletes only its own caches. The transcoder stays in the `ktx2` group, because a texture that the engine's cache does not hold still needs it.

Rejected:

- Caching every file of the build: 17.8 MB on every visitor's device, 2.7 times the start.
- Caching what the first visit downloaded: a feature used later then fails offline, and so does a device that switches variants.
- Grouping by file names: a project could change Vite's file names, or name a module of its own like an engine module. Either would move files between groups.
- Shipping a service worker in the engine: the owner's ruling, and a game's worker also caches its own files and decides its own updates.

## Consequences

- `@null3d/vite-plugin` exports `FILES_LIST` and the `OfflineFiles` type. `packages/vite-plugin/src/offline.ts` holds the table of the loaders' modules. A new module that loads on first use joins the start until the table names it. A unit test checks that every module in the table exists.
- `packages/engine/src/page/isolation-check.ts` gives the development warning.
- `bun run test:packages` builds the fresh project with the guide's worker. The worker caches the sprite feature, which the page preloads. It stops the server, reloads, and checks a threaded, isolated start with no failed request. It also checks that the cache holds the page, the start's files and the sprites' files, and nothing else.
- Docs: `getting-started/hosting` ("Offline play"), `getting-started/install`, and the develop skill's release checks and troubleshooting table.
