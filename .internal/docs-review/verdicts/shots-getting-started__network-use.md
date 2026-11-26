# Shot and demo-link verdicts: getting-started/network-use

## Shots

### network-own-origin: keep, with a corrected source
- Manual is right: the picture is the browser's own network panel.
- As proposed, the picture is an empty table. An empty table proves little, and "any production build" names no page.
- Corrected source: open the splats demo (examples/splats) in a production preview build of the demos, wait for the scan to stream in, open the network panel and tick the third-party requests filter. Crop so the status bar shows "0 / N requests". The large N (one request per chunk file) shows that the page made many requests and none went to another origin. The demos load their sample files from the page's own origin (examples/lib/samples.ts serves them under /samples/ by default), so the claim holds for this demo.

### csp-block: drop
- No page exists that sends the strict policy and requests another origin. The policy test (tests/image/content-security-policy.spec.ts) adds the header through Playwright routes, on engine.html, and checks that no violation occurs. The demo servers send no policy, so a manual capture needs a server that nobody has built.
- The picture would show only one line of console text. A quoted text block under "## Check the claim" (the shape of the Chrome message, with the blocked address and the connect-src directive) is searchable and copyable, and serves the reader better than a picture.
- The hosting page already owns the full policy and its errors (hosting.md, "## Content-Security-Policy"). Any error picture belongs there, not here.

## Demo links

### sound/ (concept: @null3d/sound downloads): keep
- The code exists: demos.ts gives the sound demo code 'sound/'.
- The demo shows the concept. Its assets line says the rain and brook loops and the two thunder one-shots load once the sound starts. The sketch calls createSound, then loop, group and shot with the recordings in examples/sound/files.ts.

### splats/ (concept: @null3d/splats downloads): keep
- The splats demo has no code value, so the contract gives "splats/". The folder examples/splats/ exists.
- The demo shows the streamed case that the page describes. It passes a streamed index (bolton-priory-stream/index.json) to createSplats, fetches the 84 chunk files nearest first, and its loading overlay counts the chunks that have loaded.

## Concepts said to have no demo
- The build's shader download: confirmed. It happens on the build machine, and no demo shows it.
- NULL3D_ENGINE_SHADERS: confirmed. No file under examples/ names it.
- The command-line tool's network use: confirmed. No demo or comparison covers the CLI.
