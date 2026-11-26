# Verdicts: api/sketch shots and demo links

## Shots

### download-list-network: reject
- Source is "manual" (browser Network panel), which is the right kind of source. But no demo or test page uses the `downloads` option. A search of examples/ and tests/ finds no `downloads: [...]` in any sketch. No page names which run to open, so the picture cannot be taken as given.
- A waterfall would also not show the points the section makes: two at a time, a load moving a file to the front, up to four while loads wait. A short timeline in a collapsible "Technical details" block would explain more than a screenshot.

### serial-load-warning: reject
- No demo or test page sets off the warning. The warning is one long line of console text (serial-loads.ts, `serialLoadWarning`). A picture of text adds nothing that quoting it would not give.
- Better: quote the warning text in a collapsible "Technical details" block under "Loads one after another".

## Demo links

### input/ (camera that follows a moving object in onLateUpdate): keep
- `input` exists in examples/demos.ts with no code field, so `input/` is right. Its sketch moves the robot in onUpdate, then places the camera and looks at the robot in onLateUpdate (examples/input/sketch.ts, the onLateUpdate block). This is the same pattern as the page's example.

### hold-mode/ (Hold mode, under "Where the sketch runs"): keep
- `hold-mode` exists with no code field, so `hold-mode/` is right. The sketch uses Math.random for the balls, and the engine seeds it in hold mode, so the held frame repeats.
- Caveat: the demo calls Math.random inside setup, not at the top of the module. Word the link as "a sketch whose random numbers repeat in hold mode", not as an example of code at the top of the module.

## Concepts said to have no demo

- downloads (the download list): confirmed. No demo or test page passes `downloads` or `serialLoadWarning`.
- engine.firstFrame: wrong. showcase/creek/ waits for `engine.firstFrame` before it loads its models on a live page, and loads them in the setup when `engine.held` is true (examples/showcase/creek/sketch.ts, the lines that set grownFirst and garden). This is the page's "far scenery" example. showcase/island/ does the same (`ctx.engine.firstFrame.then(loadLater)`). Link https://github.com/null3d-engine/null3d/tree/main/examples/showcase/creek/ under "The engine field".
- errors in callbacks: confirmed. No demo throws from a callback on purpose.
