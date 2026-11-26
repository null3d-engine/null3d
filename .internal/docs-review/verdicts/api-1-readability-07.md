# Verdict on api-1-readability-07

## The finding as given

```json
{
 "page": "api/engine",
 "anchor": "## The start (line 36); ## Memory (line 149)",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Line 36 (158 words, 10 sentences) describes a sequence in prose, with two promises (firstFrame and presetChecked) and two presetCheck modes buried in it. Line 149 (93 words) mixes advice with per-row byte figures.",
 "evidence": "stats.json lines 29 (158 words, 10 sentences) and 142 (93 words, 6 sentences).",
 "proposedEdit": "Rewrite line 36 as an ordered list: 1. createEngine tests the browser and picks the build and GPU path. 2. It starts the threads and loads the sketch module. 3. It runs the setup, then resolves. 4. engine.firstFrame resolves once the GPU finishes the first frame, or rejects (E1404; E1420 after a destroy). 5. With an engine-chosen preset, the preset check measures the first frames, and engine.presetChecked resolves when it ends. Then add two sentences on 'before-play' and the stored result on a repeat visit. Line 149: keep the advice and the E1109 and E1409 sentences. Put the byte figures in <details><summary>Technical details: how much memory a scene takes</summary>.",
 "generatedSource": "",
 "id": "api-1-readability-07",
 "slice": "api-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The page is hand-written (docs/api/engine.md), so no generated source applies. The stats lines 29 and 142 are body lines; with the 7 front-matter lines they are file lines 36 and 149, as the finding says.
- Line 36 does hold three topics in one paragraph: what `createEngine` does and when it resolves, how `engine.firstFrame` resolves or rejects, and the preset check with `engine.presetChecked`, `before-play` and the stored result. The claims in it match the code: packages/engine/src/page/engine.ts:185-195 (the `presetCheck` option), page/engine.ts:705 and page/first-frame.ts:32-38 (E1420 for a stop before the first frame), sketch/runner.ts:1104-1116 (`before-play` checks after setup and before play; `during-play` starts the check after setup). The problem is real.
- The proposed ordered list is the wrong fix:
  - The list right below it (the `onProgress` stages, lines 38-44) already gives the start in order. A second numbered list of the same start, a few lines above, repeats it.
  - Steps 4 and 5 are not a strict sequence. The E1404 and E1420 rejections are failure branches, not steps. With `during-play` the check runs during play, beside the first frames. With `before-play`, step 3 ("runs the setup, then resolves") is false, because `createEngine` waits for the check (runner.ts:1105). A reader takes a numbered list as the real order, and two later sentences that undo step 3 would mislead.
- Line 149: moving the per-row byte figures (210 bytes per instance row, 267 bytes per object place, the short double use while the tables grow) into a collapsible block is right. But "1024 MiB holds about 5 million rows with the rest of the scene" must stay in the main text. Without it, "Ask for more only when a scene needs it" gives no way to judge need, so the main text would not make sense with the block closed.

## Corrected claim

Line 36 joins three topics in one paragraph and should be split. Line 149 mixes advice with byte figures that suit a collapsible block. The fix for line 36 is three short paragraphs, not a numbered list, because the start's order is already listed under `onProgress` and the steps are not strictly in sequence. The headline figure on line 149 (about 5 million instance rows in 1024 MiB) stays in the main text.

## Corrected edit

Line 36, as three paragraphs:

`createEngine` tests what the browser offers, and picks the build and the GPU path from those tests, never from browser or GPU names. It starts the engine's threads, loads the sketch module and runs the sketch's setup. It resolves once the setup has run.

`engine.firstFrame` resolves once the GPU has finished the first frame. If the engine stops drawing before that frame, `engine.firstFrame` rejects with the failure that ended its frames, such as [E1404](../errors/E1404.md) when the thread that draws fails. A destroy before the first frame rejects it with [E1420](../errors/E1420.md).

When the engine chose the preset itself, its [preset check](../concepts/quality-presets.md#the-preset-check) measures the first frames of play, and `engine.presetChecked` resolves once the check has ended. With the `presetCheck` option's `before-play`, the check runs before play, and `createEngine` waits for it. The first frame is then on the screen before `createEngine` resolves. On a repeat visit, the engine takes the check's stored result instead, and runs no check.

Line 149:

Ask for more only when a scene needs it: 1024 MiB holds about 5 million instance rows with the rest of the scene. A scene that needs more memory than the maximum fails with [E1109](../errors/E1109.md). A maximum that is not a whole number of MiB from 256 to 4096 fails the start with [E1409](../errors/E1409.md).

<details>
<summary>Technical details: how much memory a scene takes</summary>

Each instance row takes about 210 bytes of engine memory. Each place for an object takes about 267 bytes in the scene's tables. While the tables grow, the old and the new ones both take memory for a moment.

</details>
