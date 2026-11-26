# Shot and demo-link verdicts: guides/video-textures

## Shots

### video-on-plane: reject

- The proposal says the test page "does not exist yet". That is wrong. A test page that registers a video and shows it with textures.fromVideo exists: tests/pages/video-texture.html, with tests/pages/video-texture.ts and tests/pages/sketches/video-texture-sketch.ts. The image test tests/image/video-texture.spec.ts opens it as `video-texture.html?gpu=webgpu&preset=low` (and `gpu=webgl2`).
- That page does not show "a video frame on a flat screen in a dark scene". Its video is a canvas stream of two flat colour bands (blue on top, orange below) with a small white bar that moves along the middle. The video quad covers the left half of the view. The right half shows two data textures of the same colours, for a pixel comparison. To a reader, that picture is a test pattern beside a second test pattern. It does not show what the page explains.
- The page keeps no view on screen to hold. It measures while the video plays, pauses it, captures a frame and then destroys the engine. A capture is only possible inside the two-second playing window, between the progress steps "video playing at ..." and "measured while playing" in window.__null3dProgress.
- No reference image exists. The image manifest has no video entry, and no file under tests/image/references/chrome-real-gpu/ holds a video view.
- A still picture adds little to this page. A still frame on a quad is what any reader already imagines from the code, and the page's points (frames follow playback, frame sizes, the upload budget, browser limits) are about time and cost, which a still cannot show. The diagram and the code examples already carry the page.
- If a picture is still wanted, it needs a new page that plays a real clip on a plane in a dark scene. The existing test page is not a fit source.

## Demo links

None proposed. None needed: no demo uses a video.

## Concepts said to have no demo

Searched examples/ (all demos and sketches) and examples/compare/comparisons.ts for registerVideo, fromVideo, video elements, frameRate and crossOrigin. No match.

- engine.registerVideo and textures.fromVideo: confirmed, no demo. Only the test page above uses them. The canvas-screen demo shows screens painted on OffscreenCanvas, not a video, so it does not show this API.
- maxSize and the upload budget: confirmed, no demo. The test page uses maxSize 512 and checks the budget, but it is a test, not a demo.
- The frameRate option: confirmed, no demo or test uses it.
- Cross-origin video: confirmed, no demo. The test page plays a same-page canvas stream.
