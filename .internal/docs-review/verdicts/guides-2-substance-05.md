# guides-2-substance-05

## The finding as given

- page: guides/screens
- anchor: ## Make a screen line 50; ## Limits line 119 'A held frame runs no update.'
- category: contradiction
- severity: medium
- claim: The page says a held frame runs no update. The testing page says hold mode runs onUpdate on every step from 0 to the held time (91 frames at 1.5 s). The reason given is wrong as stated, though the advice to paint the first picture in draw may still hold for another reason (a refresh rate holding an upload back, or a hold at 0). PLAUSIBLE: the real reason needs a check in the canvas texture path.
- evidence: docs/guides/testing.md:70,76; packages/engine/src/sketch/clock.ts:11 HOLD_STEPS_PER_SECOND = 60; the add-on repeats the claim at examples/addons/screens/index.ts:61-62,157.
- proposedEdit: Find the real reason, then fix the page and the add-on TSDoc. For example: 'Hold mode runs onUpdate on each step, but a change that the refresh rate holds back may not reach the held frame. Give draw the whole first picture, so every held frame shows it.'
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- The page says it twice: docs/guides/screens.md:50 ("so a held frame shows the picture") and :119 ("A held frame runs no update").
- The code runs the update on every hold step, the held one included. packages/engine/src/sketch/runner.ts:1812-1840 loops `step` from 0 to `steps` and calls `this.frame()` on each step. `frame(play = true)` calls `callbacks.onUpdate?.(dt)` at runner.ts:2299. Nothing gates it on `time.drawn`. The held frame is the last step of that loop, so its update runs.
- The only frame with no update is the settle frame after the held one: runner.ts:1863-1867 calls `this.frame(false)`. The runner test at runner.test.ts:1795 checks exactly that. That frame repeats the held time and runs no sketch code. So "a held frame runs no update" is false; "the settle frame after it runs no update" is true.
- docs/guides/testing.md step 3 and the 91-frame paragraph agree with the code.
- The hold at 0 case does not rescue the claim: `holdSteps(0)` is 0 (clock.ts:29-31), and the loop still runs step 0 once, with onUpdate and a step of 0.
- The refresh rate uses sketch time, not wall time: packages/engine/src/scene/textures.ts:762-763 compares `this.time.now` with `lastRefresh`. `lastRefresh` starts at negative infinity (textures.ts:614), so the first refresh at time 0 is never held back. A picture painted in the first update therefore does reach the texture.
- A real reason that does hold: a refresh within one refresh interval of the last read returns false (textures.ts:763). The settle frame runs no update, so no `flush` follows the held frame's update. So the held frame shows the canvas as of the last read, which can be up to one refresh interval (1/12 s at the default rate) before the held time. A change painted only in the last updates may not show. That is why the "Make a screen" advice to put the whole first picture in `draw` still makes sense, and why line 50's sentence also needs a new reason.
- The wrong reason is copied in more places than the finding lists: examples/addons/screens/README.md:96 ("never only in an update"), examples/addons/screens/index.ts:61-62 and :157, and code comments in examples/showcase/creek/sketch.ts:176,623 and examples/showcase/skyway/sketch.ts:287. The README's "never only in an update" is also wrong: a paint in the first update uploads.

## Corrected edit

docs/guides/screens.md line 50:
"`draw` runs in the setup, before the first upload, so every frame shows the picture, a held frame too."

docs/guides/screens.md line 119 (Limits):
"- In hold mode, the held frame shows the canvas as of its last read. A change that the refresh rate held back in the last updates does not show. Paint the picture that a test checks through `draw` or in the setup."

examples/addons/screens/index.ts:61-62 (the `draw` TSDoc): "Draws the first picture. It runs in the setup, before the first upload, so every frame shows it, a held frame too. Give it the whole picture, and leave the changes to `paint` or `mark`."

examples/addons/screens/index.ts:157: "Paint the canvas in the sketch's setup, so a held frame shows it whatever the refresh rate held back."

examples/addons/screens/README.md:96: use the same Limits line as the guide.

The showcase code comments (creek, skyway) state the same false rule. They are not docs pages, but they teach readers who copy the demos, so fix them in the same pass.
