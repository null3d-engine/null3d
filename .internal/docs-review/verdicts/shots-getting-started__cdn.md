# Shot and demo-link verdicts: getting-started/cdn

## Shots

### one-file-box: keep, with a corrected source
- The picture shows a newcomer what a working one-file page draws, so they can check their own result.
- The proposed steps are vague. A page and a server for this already exist:
  - Page: `tests/pages/cdn-try.html`, opened with `?cdn=<CDN origin>/`.
  - Server: the one in `tests/image/cdn-script-tag.spec.ts`. It builds the CDN folder with `buildCdn` in `tools/lib/cdn.ts`, serves the page from one origin and the build from another, and sends the policy and CORS headers.
  - Capture time: when the page sets its result. The sketch posts a message after 3 frames. Do not use `engine.firstFrame`.
- The test page's box is a little larger than the docs example's (1.4 per side, with a 45 degree view). The picture is still a fair match.
- Add `tests/pages/cdn-try.html` and `tests/image/cdn-script-tag.spec.ts` to the source files.

### cdn-network: reject
- It is under "Start the core early", but the proposed page has no early core script. No test page has one. So the picture cannot show the point of that section, which is the core download starting before the page's own scripts.
- The one-file example, served without isolation headers, runs on one thread. The panel would then show no worker scripts, which contradicts the caption.
- A full network panel is dense and hard to read at docs width. It also shows local host names, not a CDN.

### cdn-terrain: reject
- "Add-ons from the CDN" is about import addresses. A picture of ground does not explain them.
- With the docs example's numbers (a height of 6 m over 400 m, seen from about 250 m away), the ground is almost flat. The picture would be a plain green plane, so "rolling" in the alt text is wrong.
- The only runnable page, `tests/pages/cdn-addon.html`, is not the docs code. It sets a blue background, adds a soil layer, and sets the seed, resolution and detail level. So the picture would not match the code above it.
- If a picture is still wanted, take it from `tests/pages/cdn-addon.html` through the server in `tests/image/cdn-script-tag.spec.ts`, after the page sets its result. Then change the docs example to match that page.

## Demo links

### terrain/ for "Add-ons from the CDN": reject for this concept
- The code `terrain/` exists in `examples/demos.ts`.
- The demo's sketch imports `@null3d/terrain` through the Vite build. It does not load anything from a CDN. A link under this section suggests the demo is a CDN page, which misleads.
- A link that says it shows the terrain add-on in full (for example "the full terrain add-on: the Terrain demo") would be accurate.

## Concepts with no demo

All four are confirmed. No demo or comparison shows them. Every demo runs from the Vite-built demo app.
- Production and development entries: no demo. Only `tests/image/cdn-script-tag.spec.ts` covers them.
- Import maps: no demo. Only `tests/pages/cdn-try.html` (with `?map=1`) and `tests/pages/cdn-addon.html` use one.
- Both thread modes: no demo is about this. The CDN test runs both modes.
- The CDN Content-Security-Policy: no demo. It appears only in the CDN test server.
