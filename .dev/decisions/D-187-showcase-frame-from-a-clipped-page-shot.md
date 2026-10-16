# D-187: The showcase test reads its frame from a clipped page screenshot

Status: decided. Date: 2026-10-16. Task: the showcase controls test on a software GPU.

Summary: The showcase controls test read its picture of the scene with an element screenshot of the canvas. That screenshot waits for the element's box to hold still across two of the page's animation frames, and it re-arms the wait on each frame. So the wait follows the page's frame rate. A software GPU busy with several demos stops producing frames, and in CI the wait never ended. The test failed at its 180 second limit with the call log "waiting for element to be stable". The test now takes the same picture with a page screenshot clipped to the canvas's box, which runs no per-element wait. The two pictures differ by less than two pictures taken the same way do.

## Question

Which way of reading the canvas's picture should the test use? It must not let a busy software GPU stop the test, and it must not change what the test checks.

## Rule

- The picture must cover the canvas exactly, with the controls panel, the toast, the tips, the caption and the stats overlay out of it. The test's checks are written against the canvas alone.
- The picture must not wait on anything that the page's own drawing can starve.
- The change must not alter a check's tolerance or a test's budget.

## Data

From the installed Playwright's injected code: the element's "stable" state reads the element's box. It then re-arms `requestAnimationFrame` until the box holds still on two frames at least 15 ms apart. So the wait follows the page's frame rate.

| Measure | Value |
| --- | --- |
| The page's animation frames on a Mac's software GPU, one page alone | 47 to 53 a second, then 1 frame in a second, then 11 to 14 |
| The canvas's box over 20 readings, the toast shown and hidden | identical (`240,0,1040,720`), with the toast's own state the only change |
| An element screenshot against a clipped page screenshot, on the real GPU | mean difference 0.2889 of 255, worst channel 155, 29,332 pixels of 748,800 |
| Two clipped page screenshots against each other, the same sitting | mean difference 0.3908 of 255, worst channel 234, 46,805 pixels of 748,800 |

Two pictures taken the same way differ more than the two ways differ from each other. So the difference is the scene's own motion between captures, which the sky's clouds and the falling snow cause. None of it comes from the way the picture is taken. The test allows 1.5 before it calls a picture changed, and 0.5 for a still one.

How the data was produced: on 16 October 2026, probes read the page's frames and the canvas's box on a Mac with Chromium on SwiftShader. The two ways of taking the picture were compared in one sitting on the same Mac's real GPU. The figures are in the green-main landing task's run logs.

## Decision

Take the frame with `page.screenshot({ clip, omitBackground: true, style })`. The clip is the canvas's box, and the style is the one the test already passed. Nothing else in the test changes.

## Consequences

`tests/image/showcase-hud.spec.ts` is the only file that changes. No other test reads a canvas by element screenshot, and the other picture tests read their frames from the page itself. The test's tolerances, budgets and checks stay as they are.

A test that needs a picture of an element on a page that draws on the CPU should use the same route. The element's stability check is a wait on the page's frames.
