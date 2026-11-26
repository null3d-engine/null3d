# concepts-1-readability-30

## Finding as given

```json
{
 "page": "concepts/backends",
 "anchor": "## Color and anti-aliasing on each tier, line 60",
 "category": "unclear",
 "severity": "medium",
 "claim": "'when the start-up preset check lowers the preset, the demo draws with the lower preset's mode. The engine moves the canvas to a lighter mode for that, and never under the viewer's own preset change.' On an engine page, 'the demo' reads as an error, and the last clause is hard to parse.",
 "evidence": "backends.md:60",
 "proposedEdit": "Replace with: 'One exception: when the start-up check lowers the preset, the engine starts with the lower preset's mode. A preset change during play never changes the mode.'",
 "generatedSource": "",
 "id": "concepts-1-readability-30",
 "slice": "concepts-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/concepts/backends.md:60 says what the finding quotes. "The demo" and "the viewer's own preset change" are wrong words for an engine page. The sister text in docs/concepts/quality-presets.md:204 says it correctly: "A sketch's own `quality.setPreset` keeps the mode that the engine started with." So the problem is real.
- packages/engine/src/sketch/preset-check.ts:1-12: the check runs after the first frame, while the scene draws. packages/engine/src/sketch/quality.ts:559-575 (`lower`) gives the lower preset's mode only when it is lighter than the current mode, and only when the page did not set `antialias`. packages/engine/src/sketch/runner.ts:1535-1547 (`followAntialias`) then moves the canvas, and never to MSAA (never heavier).
- packages/engine/src/sketch/quality.ts:445-449 and 522-528: `setPreset` builds on options that hold the start's fixed values, `antialias` among them, so a sketch's preset change keeps the start mode. The page's claim about that is right.
- packages/engine/src/quality/presets.ts:1017-1039 (`checkedSettings`): only a repeat start that reuses an earlier check result starts with the lower mode from its first frame.

## What is wrong with the proposed edit

1. "the engine starts with the lower preset's mode" is wrong for a first visit. The engine starts with the start preset's mode (MSAA on Medium) and moves the canvas to the lighter mode when the check lowers the preset.
2. "A preset change during play never changes the mode" is ambiguous. The check's own step is a preset change after the first frame, and it does change the mode. The rule is about the sketch's `quality.setPreset`.
3. It drops the "lighter only" rule: the canvas never moves to a heavier mode.

## Corrected edit

Replace the last two sentences of backends.md:60 with:

"One exception: when the start-up preset check lowers the preset, the engine moves the canvas to the lower preset's mode, if that mode is lighter. A sketch's own `quality.setPreset` keeps the mode that the engine started with."
