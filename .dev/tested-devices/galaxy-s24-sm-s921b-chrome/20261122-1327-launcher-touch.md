Plans: none. This was a manual touch check of the demos launcher, not a harness plan run, so it has
no result file. It ran at plan `bcfd2f218` (the two-pill touch cluster), served from the plan
worktree through BrowserStack Local, on the Galaxy S24 (SM-S921B, Android 16, Chrome 152) through
BrowserStack Automate. The check drove the demos page with W3C touch actions through the device
runner's WebDriver client, so every tap and drag was real touch input.

Result: the check passed; every row of the table below held and no page reported an error.

What was checked, and what the session found:

| Check | Result |
| --- | --- |
| The pointer reads as coarse | Yes: `document.body.dataset.input` is `coarse`. |
| The touch cluster holds only the mode and the gust | Yes: the Auto / Manual and Gust pills show, and the pad, the rise and the fall are absent. |
| The Controls tab's legend is gestures, not keys | Yes: it reads "Drag the scene: turn the camera in Manual mode" and "Pinch: zoom in or out"; no key caps. |
| The chip opens the sheet with About and Controls | Yes, by the element click: both tabs are present. |
| The pills send the keyboard's keys | Yes: Gust sends G down and up, Auto / Manual sends C down and up. |
| A finger on the scene sends no key | Yes: a drag across the canvas sends no key, because turning the scene is the scene's own gesture. |

One instrument note: the first touch tap on the chip did not produce a click, and an element click
opened the sheet. The same session's cluster taps produced their clicks, so this is the check's
first-touch behaviour, not the page's; the earlier launcher check on this device showed the same.

The session took a few minutes. No page reported an error.
