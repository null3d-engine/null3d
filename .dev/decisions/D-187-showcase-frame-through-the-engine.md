# D-187: The showcase test reads its frame through the engine

Status: decided and built. Task: the showcase controls test on a software GPU.

Summary: The showcase controls test reads its frame through the demo's engine, which publishes itself behind its own `?bench` switch. A browser screenshot waits on the browser's own frame work, which a software GPU busy with several demos starves. In CI that wait outlived the test's 180 second budget, for an element screenshot and for one clipped to the canvas.

## Question

Which way of reading the canvas's picture should the test use? It must not wait on anything a busy software GPU can starve. It must not change what the test checks.

## Rule

- The picture must be the canvas exactly, at its own size, with the page's overlay out of it.
- The read must wait on the engine alone, and not on the browser's frame work.
- The way of reading must not alter a check's tolerance or a test's budget.

## Data

| Attempt | What it did |
| --- | --- |
| An element screenshot of the canvas | CI: `locator.screenshot: Test timeout of 180000ms exceeded`, the call log ending at "waiting for element to be stable". An element's picture waits for its box to hold still across two of the page's animation frames. |
| A page screenshot clipped to the canvas's box | CI: `page.screenshot: Test timeout of 180000ms exceeded`. The browser's capture waits on a frame from the compositor. |
| The engine's own reader, `capture()` | On the Mac's real GPU: the canvas at 1040x720, its own size, and the same scene. Six reads in a row took 10 to 17 ms each. `capture()` encoded a 1,048,162 byte PNG in 38 ms. |

The clipped route's picture differs from the element route's by a mean of 0.29 of 255. Two pictures taken the same way differ by 0.39. So the picture is not the trouble. The wait is.

The page's animation frames, measured on a Mac's software renderer: 47 to 53 a second, then one frame in a second, then 11 to 14. The canvas's box never moved in 20 readings. So the box was still and the frames were not. The element's wait is a wait on frames, and the page-wide route waits the same way.

The frame comes through the engine because that is what the engine's reader is for. `captureFrame()`'s own note says its pixels are "for tests". Every other picture test in the tree reads a page's pixels this way. `captureFrame()` gives raw pixels and `capture()` a PNG. The test takes the PNG, which is a tenth of the size to carry and is what the sibling tests carry.

## Decision

Read the frame in the test with `page.evaluate` calling `engine.capture()` on the engine the page publishes. Decode the PNG in the test. Every check, tolerance and budget is the same as with a screenshot. The test's page URL carries `bench`, the engine's own switch for publishing itself on the page.

## Consequences

`tests/image/showcase-hud.spec.ts` carries `bench` in its URL, and its frame reader uses the engine. The page needs no code for it, because the engine publishes itself: `?bench` puts the whole engine on the page as `window.__null3dEngine` for a benchmark tool. This test reaches the same reader the benchmark tools use.

## Options rejected

One browser screenshot is as unsafe as another on a page whose frame work a slow machine starves.

- **An element screenshot of the canvas.** An element's picture waits for the element's box across two of the page's animation frames.
- **A page screenshot clipped to the canvas.** A page's picture waits for the compositor to produce a frame.

Neither wait has anything to do with the engine being ready to be read. So a test that needs a picture of a page that draws on the CPU reads it through that page's engine.
