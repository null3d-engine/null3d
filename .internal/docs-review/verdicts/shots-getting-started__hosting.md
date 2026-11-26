# Verdicts: screenshots and demo links for getting-started/hosting

All five shots are developer-tools views, so "manual" is the right source type. No demo shows a hosting topic, so the page correctly has no demo links.

## Shots

### console-isolated: drop
The text says it fully: open the console, read `crossOriginIsolated`, it is `true`. A picture of one console line adds nothing. The service-worker-offline shot already shows the same console reading, in the place where the check is harder.

### network-brotli: keep, with a concrete source
The picture helps. Many readers do not know where the network panel shows the transferred size beside the full size, and the page asks them to compare the two.
Corrected source: run `bun run build`, then `bun run examples:build`, then `bun run examples:preview`. The preview server compresses every answer with Brotli, as a host does. Open any demo (`?demo=<name>`) in Chrome. Reload once, because the preview compresses each file again at Brotli's best level after its first answers. In DevTools > Network, filter on `wasm` and turn on "Big request rows", so the Size column shows the transferred size above the full size. Capture the engine core's row (`null3d_bg-*.wasm`).
The alt text gives fixed sizes (0.6 MB and 2.0 MB). It must match the captured row, or say "a much smaller transferred size than its full size".

### response-headers: drop
The page tells the reader to check the header with `curl -I`. A DevTools picture shows a different way to do the same check. The two header lines that matter are text, and the page already shows the expected values as text. A code block of the `curl -I` answer would serve better than a picture.

### cache-storage: drop
The cache view lists hundreds of hashed file names. A reader cannot learn anything from them, and its file names will not match the page's sample service worker, which caches other features. The only useful fact ("a cache named game-<version> exists") is shown better by the offline shot. The listed source file (the plugin's offline list writer) is also not the service worker; the real one is the test project's worker.

### service-worker-offline: keep, with a concrete source
It shows the page's most subtle point: an offline page from the cache stays isolated. It also replaces console-isolated.
Corrected source: the fresh-project test fixture (`tests/fixtures/fresh-project/`, with its service worker in `public/sw.js`, written as the page's sample). Run `bun run test:packages --keep` to build the project and keep its folder, then run `vite preview` in that folder. Load the page once and wait for the first frame, so the worker caches the build. Dock DevTools to the side. In Application > Service Workers, tick Offline, reload, and open the console drawer (Esc). Evaluate `crossOriginIsolated`. One frame shows the running game, the ticked Offline box and `true`.

## Demo links

None proposed, and none fits.

## Concepts without a demo

I searched the demo list and the comparison list for caching, offline play, threads, isolation, Brotli, CDN, Electron and HTTPS. No demo or comparison shows any of them. The demos show rendering features, not hosting. All nine concepts are confirmed to have no demo.
