# D-187: The showcase test reads its frame through the engine

Status: decided. Date: 2026-10-16. Task: the showcase controls test on a software GPU.

Summary: The showcase controls test reads the canvas's picture with a browser screenshot. Both ways of taking one wait on the browser's own frame work. A software GPU busy with several demos starves that work. In CI the wait then outlived the test's 180 second budget twice. It outlived it at an element screenshot, and again at a page screenshot clipped to the canvas. The test now reads the frame through the demo's engine, as every other picture test in the tree does. The engine publishes itself behind its own `?bench` switch, so no page code was added.

## Question

Which way of reading the canvas's picture should the test use? It must not wait on anything a busy software GPU can starve. It must not change what the test checks.

## Rule

- The picture must be the canvas exactly, at its own size, with the page's overlay out of it.
- The read must wait on the engine alone, and not on the browser's frame work.
- The change must not alter a check's tolerance or a test's budget.

## Data

| Attempt | What it did |
| --- | --- |
| An element screenshot of the canvas | CI: `locator.screenshot: Test timeout of 180000ms exceeded`, the call log ending at "waiting for element to be stable". An element's picture waits for its box to hold still across two of the page's animation frames. |
| A page screenshot clipped to the canvas's box | CI: `page.screenshot: Test timeout of 180000ms exceeded`. The browser's capture waits on a frame from the compositor. |
| The engine's own reader, `capture()` | On the Mac's real GPU: the canvas at 1040x720, its own size, and the same scene. Six reads in a row took 10 to 17 ms each. `capture()` encoded a 1,048,162 byte PNG in 38 ms. |

The clipped route's picture was measured against the element route's before that change landed. They differed by a mean of 0.29 of 255, while two pictures taken the same way differed by 0.39. So the picture was never the trouble. The wait was.

The page's animation frames, measured on a Mac's software renderer: 47 to 53 a second, then one frame in a second, then 11 to 14. The canvas's box never moved in 20 readings. So the box was still and the frames were not. The element's wait was a wait on frames. The page-wide route then proved to wait the same way.

The frame comes through the engine because that is what the engine's reader is for. `captureFrame()`'s own note says its pixels are "for tests". Every other picture test in the tree reads a page's pixels this way. `captureFrame()` gives raw pixels and `capture()` a PNG. The test takes the PNG, which is a tenth of the size to carry and is what the sibling tests carry.

## Decision

Read the frame in the test with `page.evaluate` calling `engine.capture()` on the engine the page publishes. Decode the PNG in the test. Every check, tolerance and budget stays as it was. The test's page URL gains `bench`, the engine's own switch for publishing itself on the page.

## Consequences

`tests/image/showcase-hud.spec.ts` is the only file that changes. Its URL gains `bench`, and its frame reader uses the engine. No page code was added, because the engine already publishes itself. `?bench` puts the whole engine on the page as `window.__null3dEngine` for a benchmark tool. This test reaches the same reader the benchmark tools use.

**What the two earlier attempts got wrong**, for whoever meets this next. One browser screenshot is as unsafe as another on a page whose frame work a slow machine starves. An element's picture waits for the element's box across two of the page's animation frames. A page's picture waits for the compositor to produce a frame. Neither wait has anything to do with the engine being ready to be read. So a test that needs a picture of a page that draws on the CPU should read it through that page's engine from the start.
