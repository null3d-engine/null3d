# D-311: Cache of derived data across visits

Status: decided and built. The engine keeps derived data in the origin private file system, and the KTX2 loader's cache of transcoded textures ([D-24](D-24-transcode-cache.md)) is its first namespace. Add-ons register their own through `assets.cache`, and the vegetation add-on's `cache` option takes one. Task: none.

Summary: One cache keeps the derived data of every producer, by name, version and content key, as files of the origin private file system. A worker reads them through sync handles. On the Apple devices it reads 120 MiB in 17 to 36 ms, against 59 to 98 ms for Cache Storage. One budget, a tenth of the browser's allowance, replaces D-24's 256 MiB, and repeat visits keep D-24's gains.

## Question

The engine and its add-ons make data from their inputs at load: transcoded textures today, and grown plants, impostors, terrain bakes and processed models next. Where should the engine keep such data across visits, how much may it keep, and how does it stay correct and never slow a load?

## Rule

- Measure first, because no capacity research existed. Use the Mac's Chrome, Safari and Firefox, and the four test devices. Record the storage allowance, and whether persistent storage is granted. Record write and read times at 1, 10 and 100 MiB for each store, from a worker.
- The store that reads fastest on most of those browsers wins, as a repeat visit waits for reads. Writes must not block the thread that runs the sketch.
- The budget is a share of the browser's own estimate, not a fixed number.
- The cache of transcoded textures moves onto it with no loss of D-24's figures. On the texture cache page, a repeat visit with the cache is ready no later than with D-24's cache.
- Every failure of the storage is a miss, never an error.

## Data

### What the browsers allow

`navigator.storage.estimate()` from the storage speed page, in a profile that held no data, with `navigator.storage.persist()` asked once:

| Device and browser | Allowance | Persistent storage asked | Granted |
| --- | --- | --- | --- |
| Mac, Chrome 156 | 10.0 GiB | refused | no |
| Mac, Safari 26.6.2 | 76.8 GiB | refused | no |
| Mac, Firefox 155 | 10.0 GiB | no answer: a prompt | no |
| iPhone 17, Safari 26.6 | 38.4 GiB | refused | no |
| iPad Pro 13, Safari 26.6.1 | 38.4 GiB | refused | no |
| Galaxy S25, Chrome 152 | 10.0 GiB | refused | no |
| Galaxy Tab A9 Plus, Chrome 152 | 10.0 GiB | refused | no |

The published limits give the context (MDN, "Storage quotas and eviction criteria"). Chromium and Safari allow an origin about 60% of the disk. Firefox allows 10% of the disk or 10 GiB while storage is best-effort. Chrome reports 10 GiB on the Mac, whose disk has about 2 TB free, and on both Android devices. No browser granted persistent storage to a page without a bookmark or an install, and Firefox answers the request with a prompt. Safari deletes the storage that a site's scripts wrote after seven days of browser use without a visit. A Home Screen web app keeps it. Under storage pressure, every browser deletes whole origins, the least recently used first, unless they are persistent.

### How fast each store is

Medians of three tries at each size, in milliseconds, from a dedicated worker, as the sketch runs. The last column writes 120 blocks of 1 MiB at once, then reads them at once, as a scene's textures load together. Every read matched the bytes written.

| Device and browser | Store | 1 MiB write, read | 10 MiB write, read | 100 MiB write, read | 120 x 1 MiB at once, write, read |
| --- | --- | --- | --- | --- | --- |
| Mac, Chrome 156 | Cache Storage | 3, 1 | 13, 6 | 125, 52 | 140, 60 |
| Mac, Chrome 156 | IndexedDB, ArrayBuffer | 3, 1 | 20, 5 | 177, 50 | 356, 73 |
| Mac, Chrome 156 | IndexedDB, Blob | 3, 1 | 18, 2 | 148, 16 | 345, 44 |
| Mac, Chrome 156 | OPFS, sync handle | 3, 1 | 3, 2 | 14, 16 | 182, 54 |
| Mac, Chrome 156 | OPFS, async calls | 3, 1 | 18, 6 | 166, 55 | 230, 55 |
| Mac, Safari 26.6.2 | Cache Storage | 3, 1 | 16, 10 | 148, 91 | 190, 98 |
| Mac, Safari 26.6.2 | IndexedDB, ArrayBuffer | 3, 1 | 41, 7 | 359, 85 | 586, 86 |
| Mac, Safari 26.6.2 | IndexedDB, Blob | 3, 1 | 8, 4 | 68, 42 | 952, 69 |
| Mac, Safari 26.6.2 | OPFS, sync handle | 1, 1 | 2, 2 | 13, 18 | 96, 36 |
| Mac, Safari 26.6.2 | OPFS, async calls | 2, 3 | 7, 8 | 47, 66 | 80, 164 |
| Mac, Firefox 155 | Cache Storage | 6, 5 | 46, 44 | 451, 380 | 167, 44 |
| Mac, Firefox 155 | IndexedDB, ArrayBuffer | 6, 5 | 46, 42 | 463, 455 | 642, 478 |
| Mac, Firefox 155 | IndexedDB, Blob | 2, 1 | 14, 10 | 145, 111 | 190, 113 |
| Mac, Firefox 155 | OPFS, sync handle | 5, 2 | 7, 6 | 28, 18 | 449, 208 |
| Mac, Firefox 155 | OPFS, async calls | 4, 2 | 8, 13 | 44, 104 | 410, 119 |
| iPhone 17, Safari 26.6 | Cache Storage | 2, 1 | 9, 5 | 124, 53 | 97, 67 |
| iPhone 17, Safari 26.6 | IndexedDB, ArrayBuffer | 2, 0 | 25, 5 | 280, 55 | 329, 44 |
| iPhone 17, Safari 26.6 | IndexedDB, Blob | 1, 1 | 4, 3 | 127, 38 | 130, 99 |
| iPhone 17, Safari 26.6 | OPFS, sync handle | 1, 0 | 2, 1 | 44, 13 | 71, 19 |
| iPhone 17, Safari 26.6 | OPFS, async calls | 1, 2 | 3, 6 | 62, 89 | 78, 204 |
| iPad Pro 13, Safari 26.6.1 | Cache Storage | 2, 1 | 8, 5 | 84, 47 | 153, 59 |
| iPad Pro 13, Safari 26.6.1 | IndexedDB, ArrayBuffer | 1, 0 | 18, 4 | 202, 46 | 280, 38 |
| iPad Pro 13, Safari 26.6.1 | IndexedDB, Blob | 1, 1 | 3, 3 | 30, 19 | 113, 82 |
| iPad Pro 13, Safari 26.6.1 | OPFS, sync handle | 1, 0 | 2, 1 | 14, 8 | 59, 17 |
| iPad Pro 13, Safari 26.6.1 | OPFS, async calls | 1, 2 | 3, 4 | 25, 33 | 59, 140 |
| Galaxy S25, Chrome 152 | Cache Storage | 4, 3 | 22, 12 | 119, 96 | 183, 118 |
| Galaxy S25, Chrome 152 | IndexedDB, ArrayBuffer | 4, 2 | 27, 9 | 189, 64 | 310, 156 |
| Galaxy S25, Chrome 152 | IndexedDB, Blob | 3, 2 | 22, 5 | 167, 34 | 283, 91 |
| Galaxy S25, Chrome 152 | OPFS, sync handle | 4, 2 | 8, 5 | 44, 20 | 182, 134 |
| Galaxy S25, Chrome 152 | OPFS, async calls | 4, 2 | 20, 9 | 174, 68 | 138, 95 |
| Galaxy Tab A9 Plus, Chrome 152 | Cache Storage | 9, 6 | 50, 37 | 938, 328 | 1,275, 391 |
| Galaxy Tab A9 Plus, Chrome 152 | IndexedDB, ArrayBuffer | 11, 6 | 84, 28 | 1,496, 327 | 1,624, 486 |
| Galaxy Tab A9 Plus, Chrome 152 | IndexedDB, Blob | 11, 9 | 90, 17 | 491, 149 | 1,751, 340 |
| Galaxy Tab A9 Plus, Chrome 152 | OPFS, sync handle | 33, 8 | 109, 15 | 327, 69 | 1,594, 308 |
| Galaxy Tab A9 Plus, Chrome 152 | OPFS, async calls | 23, 6 | 124, 38 | 1,416, 436 | 871, 340 |

The cost of a check on read, in milliseconds, for the same blocks. SHA-256 runs through `crypto.subtle`, and the word hash is a JavaScript loop over 32-bit words.

| Device and browser | SHA-256, 10 MiB | SHA-256, 100 MiB | Word hash, 10 MiB | Word hash, 100 MiB |
| --- | --- | --- | --- | --- |
| Mac, Chrome 156 | 7 | 72 | 5 | 46 |
| Mac, Safari 26.6.2 | 6 | 65 | 12 | 64 |
| Mac, Firefox 155 | 8 | 78 | 19 | 189 |
| iPhone 17, Safari 26.6 | 3 | 39 | 5 | 133 |
| iPad Pro 13, Safari 26.6.1 | 3 | 33 | 5 | 117 |
| Galaxy S25, Chrome 152 | 6 | 42 | 3 | 24 |
| Galaxy Tab A9 Plus, Chrome 152 | 14 | 139 | 4 | 43 |

Two facts about the file system came from a probe page in Chrome 156 and Firefox 155. A write through a sync handle leaves the file's `lastModified` as it was in Chrome, so the cache cannot age entries by file times. Chrome lets two `read-only` sync handles share a file, and Firefox lets one handle at a time hold it.

### The cache of transcoded textures

D-24's texture cache page loads the city scene's 120 KTX2 textures at once. It reports three times. Ready runs from navigation until every texture is on the GPU. Textures runs from the engine's start to then, and loads covers the sketch's loads. The old cache is D-24's Cache Storage at `f088a473`, and the new one is this record's.

Chrome 156 on the Mac's GPU, headless, from the production build that `vite preview` served. Each first visit used a new profile with `?clear&fresh`, and each repeat visit one kept profile per build. The builds and the switch took turns in each of 5 rounds. Medians, in milliseconds:

| Visit | Cache | Ready, old | Ready, new | Textures, old | Textures, new | Loads, old | Loads, new |
| --- | --- | --- | --- | --- | --- | --- | --- |
| First | off | 4,736 | 4,473 | 1,883 | 1,666 | 1,706 | 1,468 |
| First | on | 4,729 | 4,419 | 1,849 | 1,748 | 1,655 | 1,549 |
| Repeat | off | 3,212 | 2,989 | 1,511 | 1,504 | 1,317 | 1,326 |
| Repeat | on | 2,218 | 1,934 | 543 | 534 | 360 | 361 |

Safari 26.6.2 on the Mac, through the device runner's `texture-cache` plan with 3 runs, once for each build. Medians, in milliseconds:

| Visit | Cache | Ready, old | Ready, new | Textures, old | Textures, new | Loads, old | Loads, new |
| --- | --- | --- | --- | --- | --- | --- | --- |
| First | off | 3,120 | 2,334 | 1,949 | 1,258 | 1,732 | 1,061 |
| First | on | 9,986 | 2,267 | 1,809 | 1,181 | 1,582 | 1,019 |
| Repeat | off | 1,690 | 1,403 | 1,238 | 1,150 | 1,037 | 945 |
| Repeat | on | 746 | 634 | 294 | 360 | 187 | 181 |

With the new cache, a repeat visit was ready 35% sooner than with the cache off in Chrome, against 31% with the old one. In Safari it was 55% sooner, against 56%. A first visit was no later with the cache on, with either cache. In every repeat visit with the cache on, no file reached the transcoder, and the cache held all 116 entries. The old build's first visit with the cache on was ready after 9,986 ms in Safari. Its start waited before the engine ran, and its textures took 1,809 ms. The two Safari runs ran at different times on a Mac at a load average near 60, so their figures differ by that machine's spread. The sketch's loads agree within 6 ms.

The new cache also passed both visits of the KTX2 test files in Playwright's Firefox 155 and WebKit. It passed in the single-threaded build and with the sketch on the page's thread too, where it reads without sync handles.

How the data was produced: the storage speed page, `tests/pages/storage-speed.html`, runs its stores from a worker in a profile that holds no data. The page ran on `f088a473`. The four devices ran the device runner's `storage-speed` plan on BrowserStack Automate, with the dev server on the Mac behind the tunnel. The command was `NULL3D_PORT=6351 bun run devices:cloud --only bsiphone17-safari,bsipadpro13-safari,bsgalaxys25-chrome,bsgalaxytaba9plus-chrome --plan storage-speed` (runs 20261103-112517-storage-speed and 20261103-112809-storage-speed). The Mac's Safari ran `bun tests/real-browsers.ts --plan storage-speed Safari` (run 20261103-112151-storage-speed). Firefox did not open the runner page there. So Playwright's own Firefox 155 loaded the page, headless, with a profile of its own, and so did the Mac's installed Chrome. The texture cache page's Safari runs were 20261103-120146-texture-cache with the new cache and a copy of the checkout at `f088a473` with the old one. The Mac ran other work beside every run, at a load average of 40 to 61.

## Look

The options look the same: the cache keeps bytes, and every draw stays as it was.

## Decision

The origin private file system, one file per entry, wins.

- Reads go through a sync access handle in the sketch worker. They read 100 MiB fastest, or as fast as the fastest, in every browser. They read the batch fastest on the Apple devices and the Tab A9 Plus. The Apple devices take 17 to 36 ms, against 59 to 98 ms for Cache Storage. The Galaxy S25 takes 134 ms, against 91 ms for IndexedDB's Blobs and 118 ms for Cache Storage. Firefox takes 208 ms, against 44 ms for Cache Storage. Both still read large entries fastest this way. Each read asks for a `read-only` handle, so Chrome lets two tabs read one entry at once. Safari and Firefox let one handle at a time hold a file. So two reads of one entry at once on one thread share one read.
- Writes go through the file's writable stream. Its writes run off the thread, while a sync handle's write blocks it: 1,594 ms for the batch on the Tab A9 Plus. The stream replaces the file only when it closes, so a reader never sees half an entry. A browser without the writable stream writes through a sync handle in a worker. Writes start after the call that asks for them, four at a time, and at most 128 MiB wait in memory, as in D-24.
- On the main thread, as in the single-threaded build or with `sketchThread: 'main'`, no sync handle exists. There the cache reads each file whole through `getFile()`, the "async calls" rows. It reads the batch more slowly than Cache Storage on the Apple devices, which is the cost of one store for every thread.
- Each entry's file starts with a header: a mark, the hour of its last use, its length, a check and its key. A read misses when the key, the length or the check differs. The check hashes the length and 1,024 bytes at even places. A hash of every byte would cost more than the read. On the iPad Pro 13 it takes 117 ms for 100 MiB, which the cache reads in 8 ms.
- The budget is a tenth of the allowance that `navigator.storage.estimate()` reports. All namespaces share it. That is 1 GiB in Chrome and Firefox, 3.8 GiB on the iPhone and the iPad, and 7.7 GiB in Safari on the Mac. When the writes end, the cache compares what the origin uses with the budget. Past it, the cache deletes the entries used longest ago until the rest fit. The origin's figure holds the cache, so a figure under the budget needs no list of the entries. A hit writes the entry's hour again once it is a day old, so an entry in use stays.
- Opening the storage has a time limit of 2 s. The slowest open measured took 85 ms, on the Tab A9 Plus. Past the limit, the thread works without the cache for the visit.
- The engine never asks for persistent storage. No browser granted it, and Firefox asks the person with a prompt, which a page should decide to show.
- A namespace is a producer's name and the version of what it makes. Registering a version deletes the entries of the name's other versions. A new layout of the entries deletes the folder of the old one. The first open deletes D-24's caches in Cache Storage, whose names start with `null3d-ktx2-`.
- `?derived-cache=off` turns the whole cache off, for timing and tests. It replaces `?texture-cache=off`.

Options rejected:

- Cache Storage, D-24's store. It reads the batch 2.7 to 3.5 times slower on the Apple devices, and 100 MiB up to 21 times slower in Firefox. Its only index is the order of its writes, so a trim must read every entry's headers.
- IndexedDB with Blobs. Its transactions and indexes would make the budget simple. But it reads the batch 1.9 to 5.2 times slower than the sync handle on the Apple devices. Safari wrote the batch in 952 ms.
- IndexedDB with ArrayBuffers. It is the slowest writer for large entries everywhere.
- A sync handle for writes. It blocks the sketch worker for the whole write.
- The file's `lastModified` as the time of last use: Chrome does not change it on a sync handle's write.
- A hash of every byte on read: it costs more than the read on the Apple devices.
- A fixed budget, such as D-24's 256 MiB: the owner's rule asks for a share of the browser's estimate.

## Consequences

- `packages/engine/src/scene/derived-cache.ts` holds the cache, and `scene/ktx2-cache.ts` is its namespace of transcoded textures, `null3d-ktx2` at `basis-2.50-1`. The module loads in the assets loader's file with the first call that reads a file, so no page's start grows.
- `assets.cache(name, version)` gives a namespace to a sketch or an add-on, with `get(key)` and `put(key, bytes)`. Its type, `DerivedCache`, fits the vegetation add-on's `PlantByteCache`.
- The storage speed page and the device runner's `storage-speed` plan repeat the measurement.
- Docs: `api/assets` ("Caching"), `concepts/assets`, `guides/performance`, `guides/content-pages` and `guides/testing` (the switch). `getting-started/hosting` holds the overview of the caches between visits, which the other pages link to. The develop skill's testing, performance, content pages and API references.
