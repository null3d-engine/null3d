# concepts-2-substance-22

## Finding as given

- page: concepts/quality-presets
- anchor: ### The lowest quality tier, lines 321-327
- category: unclear; severity: low
- claim: "the sustained window" and "the window that raises a step" are never defined, and "a third-size render scale floor" is unclear. The page does not say that a start in the tier also fixes maxRenderScale at the floor.
- evidence: docs/concepts/quality-presets.md:321, 325; packages/engine/src/quality/presets.ts:938-959 (lowestTierSettings adds maxRenderScale).
- proposedEdit: "The governor enters the tier when the render scale has stayed at its floor for a second over budget and frames still miss. Its cuts: a render scale floor of one third, ... A start in the tier also caps the render scale at one third." Replace "the window that raises a step" with "5 seconds with time to spare".

Verdict: partly

## Evidence

- The page uses both phrases without defining them (docs/concepts/quality-presets.md:321 "held at its floor through the sustained window"; :325 "keep room through the window that raises a step"). The earlier governor text (line 313) names only "a second" over budget and "5 seconds" of spare time, never "sustained window". So the clarity complaint holds.
- The proposed entry wording is wrong. The tier's entry check is `floorWindows * WINDOW_MS >= RAISE_AFTER_MS` (packages/engine/src/quality/governor.ts:750-759), with WINDOW_MS = 250 and RAISE_AFTER_MS = 5000 (governor.ts:146, 152). So the render scale must hold at its floor for 5 seconds of judged frames, and then a judged window must still miss (governor.ts:705-708). "A second over budget" is the normal step-down rule (DROP_AFTER_MS, governor.ts:148), not the tier's entry rule. The edit would mislead readers.
- The exit uses the step-up wait for the current level, `raiseAfter[level - 1]` (governor.ts:721), which starts at 5 s (governor.ts:994) but doubles after failed step ups, up to 80 s (governor.ts:154, 903-907). "5 seconds with time to spare" is right as a first value only. After an exit, the re-entry wait is fixed at 5 s (`lowestWait = now + RAISE_AFTER_MS`, governor.ts:803).
- "a third-size render scale floor" is terse but correct: LOWEST_TIER_SCALE = 1/3 of width and height (presets.ts:920-925). Rewording to "one third" is polish.
- The start-in-tier cap is true: lowestTierSettings adds maxRenderScale = 1/3 (presets.ts:955-957), and engine.ts:2671-2678 applies it for `?tier=lowest` and for a start after two crashed starts. The page hints at it only through "the tier's floor and cap" (line 323), never saying what the cap is. So this part holds.

## Corrected claim

"the sustained window" and "the window that raises a step" are undefined on the page. The first is 5 seconds at the render scale floor, not one second over budget. The second is the step-up wait, 5 seconds at first and longer after failed step ups. The page does not say that a start in the tier also caps the render scale at one third.

## Corrected edit

Line 321: "The governor enters it when the render scale has held at its floor for 5 seconds and frames still miss the target. Its cuts are a render scale floor of one third of the canvas's width and height, no sun shadows, no bloom, and reflection passes at a quarter of the render size."

Line 323, after "...wins over the tier's floor and cap.": make the cap concrete, for example add "A page that starts in the tier also caps the render scale at one third, so it draws at that scale from the first frame." (best placed beside the `?tier=lowest` sentence at line 327).

Line 325: "The governor leaves the tier when the frames keep time to spare for as long as a step up waits: 5 seconds at first, longer after failed step ups. It then waits 5 seconds before the tier can enter again, so a device cannot flap."
