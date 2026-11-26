# Shot and demo-link verdicts: guides/loading-screens

## Shots

### loading-card: keep, with a new source

- The picture helps. Under "Show progress on the page", it shows the reader what the page code makes: a label, a percentage and a bar over the canvas.
- The source is wrong. "Manual" is only for the browser's own developer tools. The loading card is part of the demo page, so a script can take this shot.
- The demo is wrong. The island sketch posts only "Raising the island" and "Growing the trees". It never reports file bytes, so its card never shows "Downloading the scene files" with a bar. The island scene is also very heavy for a short loading shot.
- The alt text does not match any demo. The shared progress helper (examples/lib/progress.ts, reportLoading) posts "Downloading scene files" with a detail such as "3.1 MB of 10.6 MB".
- Better demo: gltf-model/. Its sketch calls reportLoading first, then loads the BoomBox glTF file. The demo page's runner (examples/lib/run.ts) passes onProgress and onSketchMessage to createEngine, as the page's code sample does.
- Scripted steps: in Playwright Chromium, open a CDP session and send Network.emulateNetworkConditions with a slow mobile link (about 150 ms latency and 200 KB/s download). Open the demos page at `?demo=gltf-model` as a live page, without `?hold`. Wait until a `.loader__task-text` element reads "Downloading scene files" and the `.loader__fill` width is between 20% and 80%. Take a screenshot of the canvas's parent element.
- New alt text: "A loading card over the canvas, with the row 'Downloading scene files', its byte count and a bar partway across."

### network-waterfall: drop

- The demo cannot show it. The island sketch has no download list (no `downloads` option). It calls assets.preload only for a held frame or `?grown`, inside its setup. So its waterfall shows no listed files that download while the engine core downloads.
- No demo uses the `downloads` option. The only page that does is the test page tests/pages/download-list.html. Its files exist only through the test's network routing, so a browser by itself cannot load them.
- A developer-tools waterfall is also dense and hard to read at docs width. The text and the code sample already make the point.

## Demo links

### showcase/island/ for "Repeat visits": keep

- The code exists in examples/demos.ts.
- Every live demo stores the pipeline list without any code. The island is the scene whose repeat-visit figures the section quotes, and it builds the most pipelines. So a reader who opens it twice on a phone sees the gain.
- Do not tell the reader to try `?builds=fresh` on the published demos. A production build reads no address switches.

### instances/ for "The preset check": drop as a demo of the check before play

- The code exists in examples/demos.ts, but the instances sketch and the demo runner never pass `presetCheck: 'before-play'`. The demo shows only the default check during play, as every demo does.
- `?preset-check=before-play` works only in a development build, so the published demo cannot show the other timing.
- A plain link on the words "the instances demo", where the paragraph names it as the measured scene, is acceptable. It must not claim to show the option.

## Concepts said to have no demo

- Page code for progress with onProgress and onSketchMessage: a demo shows it. gltf-model/ (and character/, showcase/creek/) posts file progress with assets.onProgress through reportLoading, and the shared demo runner passes onProgress and onSketchMessage to createEngine.
- `presetCheck: 'before-play'`: confirmed. No demo or demo runner uses it.
- quality.setPreset behind a loading cover: partly shown. The showcase demos (showcase/island/, showcase/creek/, showcase/skyway/) call quality.setPreset from the Quality menu of their controls, and the engine keeps the last frame while the new pipelines build. No demo covers the canvas during the change.
- preload of features in createEngine: confirmed. Only the test page tests/pages/preload.ts uses it.
- A later loading stage with scene.warmUp(): confirmed. No example calls scene.warmUp.
