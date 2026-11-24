# D-388: How the demo servers deliver files

Status: decided and built. The owner ruled the removal of the demos' offline cache, the content hash in the sample addresses, and HTTP/2 as an opt-in. The rest follows from the measurements below.

Summary: The examples page keeps no offline cache, and the dev server and the preview compress with Brotli. HTTP/2 is a switch, and each demo sample address carries its file's hash. On a phone-like link, Creek's production start falls from 26.1 s to 22.5 s and its reload from 3.0 s to 1.7 s. Its dev server start falls from 81.6 s to 40.9 s with compression, and to 34.1 s with HTTP/2 as well.

## Question

How should the examples page and the two servers deliver the demos' files to a phone over a slow link, without slowing any demo's start?

## Rule

- A change may not delay any demo's first frame on the phone profile below.
- A page downloads nothing before its first frame that it does not need ([D-14](D-14-js-budget.md)).
- Every default keeps Safari on an iPad working.
- A cache keeps a file under an address only while no other bytes can answer that address.

## Data

The phone profile: a TCP proxy makes one shared link of 150 ms round trip, 10 Mbit/s down and 5 Mbit/s up. Each new connection takes one more round trip. The page's CPU runs 4 times slower; the workers run at full speed. Chrome for Testing 156.0.8078.80, headless, on this Mac's GPU, a fresh profile per cold load. A reload is a new tab after one first visit. The "before" columns are the timing helper's runs of the same commit, script and profile.

Production build, `bun run examples:preview`:

| Measure | Before, with the offline cache | Before, cache blocked | After |
| --- | --- | --- | --- |
| Creek, first frame done, cold, median of 3 | 26,066 ms | 25,703 ms | 22,498 ms |
| Creek, requests and bytes before it | 138, 23.33 MB | 138, 23.34 MB | 132, 18.94 MB |
| Instances, first frame done, cold, median of 3 | 4,842 ms | 4,551 ms | 2,995 ms |
| Instances, requests and bytes before it | 54, 2.49 MB | 54, 2.49 MB | 48, 0.92 MB |
| Creek reload, first frame done, median of 3 | 5,626 ms | 3,037 ms | 1,685 ms |
| Requests that the offline cache starts before the first frame | 1,570 | none | none |

The offline cache's requests are the build's whole file list: 1,567 files and 820 MB uncompressed. Custom material builds take 472 of the files and 485 MB. Its downloads share the six HTTP/1.1 connections with the demo's own.

Dev server, `bun run dev` on this branch. A cell gives the median and the range when it has three loads, and each load when it has fewer:

| Measure | HTTP/1.1, no compression | HTTP/1.1, compressed | HTTP/2, compressed |
| --- | --- | --- | --- |
| Instances, first frame done, cold | 25,607 ms, 22.59 MB | 13,780 ms (13,772 to 15,924), 4.39 MB | 7,222 and 7,692 ms, 4.30 MB |
| Instances, reload | | 11,712 and 11,735 ms | 4,662 ms |
| Creek, first frame done, cold | 81,574 ms, 83.08 MB | 40,858 ms (40,593 to 47,139), 24.97 MB | 34,077 ms (33,615 to 34,373), 24.81 MB |
| Creek, reload | | 18,053 and 18,445 ms | 8,308 and 8,335 ms |

Both pages ask for about 400 and 700 files before their first frame. Over HTTP/1.1 they wait in the browser's queue for six connections.

Compression, on this Mac's CPU, one thread:

| File | Raw | Brotli 5 | Brotli 11 | gzip 6, Vite's preview default |
| --- | --- | --- | --- | --- |
| Engine core, `null3d_bg.wasm` | 2,000 KB | 717 KB in 32 ms | 613 KB in 3,231 ms | 810 KB, which the preview did not send compressed |
| Largest custom material build | 4,494 KB | 127 KB in 15 ms | 89 KB in 1,979 ms | 804 KB |
| GLSL start shader file | 1,252 KB | 73 KB in 6 ms | 57 KB in 779 ms | 229 KB |

Brotli 5 leaves 95 to 100% of the Creek garden's models, whose textures are compressed images. It leaves 75 to 79% of Creek's plant models, and 26% of the island's houses.

The comparison code: a demo's page started with 12 files, 391 KB raw and 125 KB after Brotli 11. With the comparisons loaded only on `?compare=`, it starts with 6 files, 220 KB and 68 KB.

The clean-up: a browser that had installed the old worker held a cache of 1,568 files. After one visit to the new build, 4.6 s later, it held no registration and no demo cache. On that visit the old worker started 1,575 requests before the browser replaced it, once.

How the data was produced: `bun run examples:build`, then `NULL3D_PORT=5401 bun run examples:preview --host 0.0.0.0`; the dev servers with `NULL3D_PORT=5405` and `NULL3D_PORT=5407 NULL3D_HTTP2=1`. The timing helper's `measure.ts` drove each load, with a host name that maps to the loopback for the compressed dev runs. Each timing run held the shared lock, with no build or test of another helper running. The preview's runs came after one load and 45 s of quiet, so they got the Brotli 11 copies.

## Look

The options look the same: they change how files arrive, not what a demo draws.

## Decision

1. The examples page registers no service worker. `examples/public/sw.js` stays at its address as a worker that deletes the caches named `null3d-demos-*` and unregisters itself. A browser fetches that script again when a visit starts, so this reaches every browser that installed the old one. The engine's file list, `null3d-files.json`, stays, because apps use it ([D-102](D-102-offline-play.md)).
2. The null3D Vite plugin compresses. The dev server compresses its answers at Brotli 5 and keeps each result. It does so for every request that is not from this computer's loopback by a loopback name. The preview compresses the build's text, WebAssembly and model files for every request. It answers at Brotli 5 first, then at Brotli 11 while no request is in flight. Bytes that save less than 5% go as they are.
3. HTTP/2 is the plugin's `http2` option, and `NULL3D_HTTP2=1` turns it on in this repository. HTTP/1.1 stays the default, because Safari on an iPad can stall on HTTP/2 while a worker loads its modules ([Device sessions](../devices.md)).
4. The demos' sample addresses carry `?h=` with the first 16 hex digits of the file's SHA-256. The sample plugin builds a table of them for the files that the demos name. The servers answer such an address with a year-long immutable cache. Any other address stays `no-cache`.
5. The examples page imports the comparisons' code only when its address names a comparison.

Rejected:

- Reworking the offline cache to start after the first frame and cache a bounded set: the owner ruled for removal. A demo page's visitor gains little from offline play, and its cost reaches every first visit.
- Compressed files written at build time. The examples build holds about 1,570 files and 820 MB, so Brotli 11 on each would add minutes to every build. The files would also land in every app's deploy folder, where most hosts ignore them.
- Brotli 11 while a request waits: 3.2 s for the core on the first visit.
- HTTP/2 by default: the iPad stall is recorded and not shown to be gone.
- A year-long cache for the whole samples folder. The island's card lists and a splat stream name files beside them by relative addresses, with no hash.
- Page code that unregisters the old worker. It runs only after the old worker has answered the page, and it would run on every visit of every visitor.

## Consequences

- Code: `packages/vite-plugin/src/compress.ts` and the plugin's `http2` option and `sameOriginMiddleware`; `tools/lib/samples.ts` (`sampleHashes`, the cache rule); `examples/lib/samples.ts`; `examples/compare/listing.ts`; `examples/public/sw.js`; `tools/lib/dev-https.ts`. `tests/lib/tunnel-server.ts` is gone, as the plugin's step covers the tunnel's host name.
- Docs: `getting-started/hosting` ("During development"), [Examples](../examples.md), [Device sessions](../devices.md), [Sample content](../sample-content.md) and the commands table in `AGENTS.md`. The develop skill's testing reference says what the compression, the certificate and the `http2` option mean on a phone.
