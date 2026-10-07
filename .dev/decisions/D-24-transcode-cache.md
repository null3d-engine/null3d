# D-24: Cache of transcoded textures

Status: decided by its rule, 2026-10-07: keep the cache. Task: M2-A5 (T-31).

Summary: Keep each KTX2 texture's transcoded texels in Cache Storage, up to 256 MiB. The key is the SHA-256 of the file, with the format and mip levels. On the owner's iPad, with the job workers transcoding, a repeat visit that loads S6's 120 textures is ready 50% sooner, past the rule's 10%. A first visit is not later. Cloud phones gain only 6%, because other start work takes most of their time.

## Question

Should the engine keep each KTX2 texture's transcoded texels in browser storage, so a repeat visit skips the Basis transcoder? If so, where does it keep them, and what is each entry's key?

## Rule

Keep the cache if it makes a repeat visit that loads S6's textures ready at least 10% sooner on the S24+ or the iPad. It must never make one later on either. A first visit may cost a little more, because it writes the cache. The record states that cost.

## Design

The cache sits around the one step in `scene/ktx2.ts` that hands a file to the transcoder, on the sketch's thread (`scene/ktx2-cache.ts`). That step runs the transcoder as a task of the on-demand loader in the job workers (M2-R18). Before M2-R18 it posted the file to the transcoder's own worker. The cache needs no change for either. The task takes the file's bytes, so the lookup hashes them before the step. A hit skips the step, so a page whose files are all in the cache never downloads or compiles the transcoder.

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
| Repeat | 1,147 | 597 | 48% sooner | Mac, Chrome, WebGPU, before M2-R18 (7 to 8 loads each) |
| First | 2,052 | 2,099 | 2% later | Mac, Chrome, WebGPU, before M2-R18 (8 to 9 loads each) |
| Repeat | 636 | 511 | 20% sooner | Mac, Chrome, WebGPU, with M2-R18's job workers (9 loads each) |
| First | 1,436 | 1,581 | 10% later | Mac, Chrome, WebGPU, with M2-R18's job workers (9 loads each) |
| Repeat | 1,362 | 687 | 50% sooner | The owner's iPad Pro 11 (A12X), Safari 26.6.2, WebGPU, with M2-R18's job workers (medians of 5 loads): the deciding run |
| First | 3,138 | 2,986 | 5% sooner | The owner's iPad Pro 11 (A12X), Safari 26.6.2, WebGPU, with M2-R18's job workers (medians of 5 loads): the deciding run |
| Repeat | 1,335 | 729 | 45% sooner | The owner's iPad Pro 11 (A12X), Safari 26.6.2, WebGPU, before M2-R18 (medians of 5 loads) |
| First | 3,553 | 3,388 | 5% sooner | The owner's iPad Pro 11 (A12X), Safari 26.6.2, WebGPU, before M2-R18 (medians of 5 loads) |
| Repeat | 8,475 | 7,947 | 6% sooner | Galaxy S24 (BrowserStack), Chrome 149, WebGL2, before M2-R18 (medians of 5 loads) |
| First | 8,258 | 8,416 | 2% later | Galaxy S24 (BrowserStack), Chrome 149, WebGL2, before M2-R18 (medians of 5 loads) |
| Repeat | 7,775 | 7,311 | 6% sooner | Galaxy S25 (BrowserStack), Chrome 149, WebGPU, before M2-R18 (medians of 5 loads) |
| First | 7,604 | 7,842 | 3% later | Galaxy S25 (BrowserStack), Chrome 149, WebGPU, before M2-R18 (medians of 5 loads) |
| Repeat | 7,872 | 7,394 | 6% sooner | Pixel 9 (BrowserStack), Chrome 149, WebGPU, before M2-R18 (medians of 5 loads) |
| First | 7,811 | 8,029 | 3% later | Pixel 9 (BrowserStack), Chrome 149, WebGPU, before M2-R18 (medians of 5 loads) |

On the Mac, the device took ETC2 for the ETC1S maps and ASTC for the UASTC maps, as a phone does. On a repeat visit with the cache, the sketch's loads of all 120 files took a median of 232 ms, against 830 ms without it. The transcoder never downloaded. On a first visit, the loads took 945 ms with the cache against 821 ms: hashing and copying for the writes cost about 120 ms. The last write landed 2 to 87 ms after the textures were ready.

With M2-R18, the job workers transcode several files at once, so the transcoder's share of a load is smaller. Without the cache, a repeat visit's loads took 289 ms, and the cache brought them to 194 ms. A first visit pays more there: the loads took 443 ms with the cache against 330 ms, as hashing and copies compete with the transcodes. The first run on that branch also found a fault. Writes then held at most 64 MiB at once, and textures that finish together skipped 4 to 15 of the 116 writes. So a later visit still downloaded the transcoder for the few files it missed. Writes now hold up to 128 MiB, a whole S6's worth, and every later visit stored all 116 entries.

On the iPad with the job workers, the repeat visit's texture loads took 246 ms with the cache against 914 ms without it. With the cache, the transcoder never downloaded, and the cache held 116 to 118 entries after each visit. On a first visit the writes ended 128 ms after the textures were ready, off the load's path. The first visit came out 5% sooner with the cache. The cache cannot speed a first visit, so this is the spread between loads. The writes cost the first visit nothing that the iPad could measure.

The iPad's first run used the branch before M2-R18, with the transcoder in one worker of its own. It measured almost the same: a repeat visit 45% sooner (texture loads of 260 ms against 1,070 ms), and a first visit 5% sooner. The job workers took about 150 ms off the repeat visit's loads without the cache. The cache's own loads hardly changed, because they never run the transcoder. On the Mac, the job workers cut the cache's gain from 48% to 20%. The iPad runs 6 job workers against the Mac's 16, so the transcoder still takes most of a repeat visit's loads there.

On the cloud phones, the texture loads alone took 12% to 23% less time with the cache. But the phones spend 7 to 8 s before the textures are ready, mostly on other start work, so the whole page gained only 6%. The S24's and S25's screens ran at 24 Hz in these sessions, so the runner marks their timings as unreliable. The S24 stands in for the S24+ that the rule names; the owner's S24+ did not run the plan.

How the data was produced: `bun run build`, then `NULL3D_BUILD_PAGE=texture-cache bunx vite build`, served with `vite preview`. A local Playwright script loaded `tests/pages/texture-cache.html?files=city` in Chrome with the Mac's GPU, on 5 October 2026. Each first visit used a new browser profile, with `?clear&fresh`. Each repeat visit used one kept profile that an earlier visit filled. The runs took turns with the cache off and on. The M2-R18 rows used that branch at 273563784 with the same cache applied. The device rows come from the texture cache plan of the device runner ([Device sessions](../devices.md#the-texture-cache-plan)). One load fills the cache. Then each of 5 rounds makes a first and a repeat visit, each with the cache off and on. The iPad ran it over the local network on 7 October 2026, after a heat check, and passed 21 of 21 each time. The deciding run used fe945286c, with main's job workers (run 20261007-153354-texture-cache). The first used 1119360d5 (run 20261007-151135-texture-cache). The cloud phones ran it on BrowserStack Automate on 6 October 2026, at 8afe64d9f. Each passed 21 of 21 (runs 20261006-230938-texture-cache and 20261006-231919-texture-cache). The phones' commit and the iPad's first commit predate M2-R18, so their transcoder ran in one worker of its own. [Tested devices](../tested-devices.md) holds each run.

## Decision

Decided by its rule, 2026-10-07: keep the cache, on by default. The rule names the S24+ or the iPad, and the owner's iPad decides it. On main's code, where the job workers transcode, a repeat visit is ready 50% sooner, past the rule's 10%. A first visit is not later. No device made a repeat visit later.

Only the run on main's code decides, because the engine ships that code. The cache's gain depends on how long the transcoder takes without it, and M2-R18 changed that. The iPad's first run, on the code before M2-R18, gave 45%, so both runs pass. The cloud phones ran only the code before M2-R18. They gained 6%, under the rule's 10%, because other start work takes most of their time. The rule does not name them.

## Consequences

- The KTX2 loader's file grows by the cache's code, about 1 KB after Brotli. It loads with the first KTX2 file, so no page's start grows.
- Docs: `api/assets` (Caching), `concepts/assets`, `guides/testing` (the switch), and the three.js mapping entry of `KTX2Loader`. The develop skill's API quick reference and its testing switches.
- The device runner has a `texture-cache` plan, and the dev server serves the sample content's images as KTX2 files under `/sample-textures/`.
- `loadKtx2` runs the cache's lookup before the transcoder's task, which takes the file's bytes, and the store after the texture is made.
