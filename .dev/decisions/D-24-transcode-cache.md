# D-24: Cache of transcoded textures

Status: proposed, 2026-10-05; the S24+ and iPad timings pending. Task: M2-A5 (T-31).

## Question

Should the engine keep each KTX2 texture's transcoded texels in browser storage, so a repeat visit skips the Basis transcoder? If so, where does it keep them, and what is each entry's key?

## Rule

Keep the cache if it makes a repeat visit that loads S6's textures ready at least 10% sooner on the S24+ or the iPad. It must never make one later on either. A first visit may cost a little more, because it writes the cache. The record states that cost.

## Design

The cache sits around the one step in `scene/ktx2.ts` that hands a file to the transcoder, on the sketch's thread (`scene/ktx2-cache.ts`). On main that step posts the file to the transcoder's own worker. On the branch of the on-demand loader (M2-R18), the same step runs a task in the job workers. The cache needs no change for either. A hit skips the step, so a page whose files are all in the cache never downloads or compiles the transcoder.

- Storage: Cache Storage, one cache named `null3d-ktx2-basis-2.50-1`. Each entry is a `Response` of the texels, in the layout that the transcoder writes: every mip level in turn, each level's layers in turn. IndexedDB would also serve. Cache Storage was chosen for its smaller code, and because it stores bodies as files that the browser reads back as one `ArrayBuffer`. Both need a secure context in practice: the engine's threads need cross-origin isolation, which needs one.
- Key: the SHA-256 of the file's bytes, the transcoder's target format and the number of mip levels written. They form the path of an address under the reserved name `ktx2.null3d.invalid`. The task first named the file's address and its response's validator. That key fails in two cases. The KTX2 textures inside one glTF file share the file's address and validator. A server that sends no `ETag` or `Last-Modified` would leave its files out. The hash costs one pass over the file, which the browser's `crypto.subtle` runs off the thread. Files with the same bytes at two addresses share one entry. In S6's 120 maps, 4 have the same bytes as another, so the cache holds 116 entries.
- Versions: the cache's name holds the transcoder's version and the layout's. An engine whose transcoder writes other bytes opens a new cache and deletes every other cache whose name starts with `null3d-ktx2-`.
- Size: at most 256 MiB of texels. When the writes under way end, the cache deletes its oldest entries until the rest fit. S6's textures take about 105 MiB as ETC2 and ASTC, the formats a phone takes. Writes hold at most 128 MiB at once, and a texture past that skips its write. So a page that loads many textures at once never holds a second copy of all of them.
- Checks: an entry whose size is not what the header and format give is deleted, and the file transcodes again. When a step fails, the file goes to the transcoder. Examples are a browser without Cache Storage, a private window that refuses it, and a full disk.
- Writes run after the texture is made, so they never delay a load. A page that closes before they end keeps only the entries written so far.
- `?texture-cache=off` turns the cache off for timing and tests.

## Data

S6's textures are the color, normal and roughness maps of its 40 ambientCG texture sets. They are 120 KTX2 files of 1024 x 1024 with mip levels, 34 MB in all. The asset tool encoded them as it encodes a model's textures: color and roughness in ETC1S, normal maps in UASTC. The texture cache page loads all 120 at once from the production build. It reports the time from navigation until every texture is on the GPU.

| Visit | Cache off: ready, ms | Cache on: ready, ms | With the cache | Device and browser |
| --- | --- | --- | --- | --- |
| Repeat | 1,147 | 597 | 48% sooner | Mac, Chrome, WebGPU, main (7 to 8 loads each) |
| First | 2,052 | 2,099 | 2% later | Mac, Chrome, WebGPU, main (8 to 9 loads each) |
| Repeat | 636 | 511 | 20% sooner | Mac, Chrome, WebGPU, with M2-R18's job workers (9 loads each) |
| First | 1,436 | 1,581 | 10% later | Mac, Chrome, WebGPU, with M2-R18's job workers (9 loads each) |
| Repeat | pending | pending | pending | S24+, Chrome |
| Repeat | pending | pending | pending | iPad, Safari |

On the Mac, the device took ETC2 for the ETC1S maps and ASTC for the UASTC maps, as a phone does. On a repeat visit with the cache, the sketch's loads of all 120 files took a median of 232 ms, against 830 ms without it. The transcoder never downloaded. On a first visit, the loads took 945 ms with the cache against 821 ms: hashing and copying for the writes cost about 120 ms. The last write landed 2 to 87 ms after the textures were ready.

With M2-R18, the job workers transcode several files at once, so the transcoder's share of a load is smaller. Without the cache, a repeat visit's loads took 289 ms, and the cache brought them to 194 ms. A first visit pays more there: the loads took 443 ms with the cache against 330 ms, as hashing and copies compete with the transcodes. The first run on that branch also found a fault. Writes then held at most 64 MiB at once, and textures that finish together skipped 4 to 15 of the 116 writes. So a later visit still downloaded the transcoder for the few files it missed. Writes now hold up to 128 MiB, a whole S6's worth, and every later visit stored all 116 entries.

How the data was produced: `bun run build`, then `NULL3D_BUILD_PAGE=texture-cache bunx vite build`, served with `vite preview`. A local Playwright script loaded `tests/pages/texture-cache.html?files=city` in Chrome with the Mac's GPU, on 5 October 2026. Each first visit used a new browser profile, with `?clear&fresh`. Each repeat visit used one kept profile that an earlier visit filled. The runs took turns with the cache off and on. The M2-R18 rows used that branch at 273563784 with the same cache applied. The device rows come from the texture cache plan of the device runner ([Device sessions](../devices.md#the-texture-cache-plan)).

## Decision

Proposed: keep the cache, on by default. On the Mac it makes a repeat visit 48% sooner on main, and 20% sooner with M2-R18's job workers. Both pass the rule's 10%. A first visit costs 2% on main and 10% with M2-R18. The rule asks for the S24+ or the iPad, so the decision waits for their runs. If neither gains 10%, or either is later, the cache comes out of the engine.

The phone runs should also time M2-R18 with the cache, because the engine will transcode that way. A phone has fewer cores for job workers than the Mac, and slower storage. So the gain on main may overstate what a phone keeps once M2-R18 lands.

## Consequences

- The KTX2 loader's file grows by the cache's code, about 1 KB after Brotli. It loads with the first KTX2 file, so no page's start grows.
- Docs: `api/assets` (Caching), `concepts/assets`, `guides/testing` (the switch), and the three.js mapping entry of `KTX2Loader`. The develop skill's API quick reference and its testing switches.
- The device runner has a `texture-cache` plan, and the dev server serves the sample content's images as KTX2 files under `/sample-textures/`.
- When M2-R18 lands, its `loadKtx2` keeps the cache's lookup before its task and the store after the texture is made.
