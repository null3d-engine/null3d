# api-3-substance-29

## Finding as given

```json
{
 "page": "api/time,api/sketch",
 "anchor": "time line 65 `time.held`; sketch line 138 `engine.held`",
 "category": "duplication",
 "severity": "low",
 "claim": "Two flags with the same name and close meanings. `time.held` is true only while hold mode steps; `engine.held` is true for hold mode and replays. Neither page names the other.",
 "evidence": "packages/engine/src/sketch/define-sketch.ts:77-78 (time.held), 117-121 (engine.held).",
 "proposedEdit": "time row: \"... Unlike `engine.held`, it is false in a replay.\" sketch: \"Unlike `time.held`, it is also true in a replay.\"",
 "generatedSource": "",
 "id": "api-3-substance-29",
 "slice": "api-3",
 "role": "substance"
}
```

Verdict: survives

## Evidence

- docs/api/time.md:65 says `time.held` is "True while hold mode steps to its held frame, and false otherwise." It does not name `engine.held` or a replay.
- docs/api/sketch.md:138 says `engine.held` is true "as hold mode and a replay do". It does not name `time.held`.
- No other page links the two. A grep of docs/ finds `engine.held` in guides/testing.md:189 and guides/start-time.md:225,232, and `time.held` only in api/time.md:65.
- The code agrees with the claim. packages/engine/src/sketch/runner.ts:1004 sets `engine.held` to `holdsFrames`, and runner.ts:738 makes that true for hold mode or a replay. It is fixed for the whole session, setup included.
- `time.held` is set true only inside `hold()` (runner.ts:1804) and back to false at runner.ts:1881. `replay()` (runner.ts:1942-2000) sets `time.drawn` but never `time.held`, so `time.held` stays false in a replay.
- Both pages are hand-written. They are not under docs/api/reference/, so the empty generatedSource is correct. The TSDoc at define-sketch.ts:77-78 and 117-121 says the same thing and could get the same note.

I could not disprove the finding. The flags share a name, their meanings overlap, and they differ in a way a reader cannot work out from either page alone.

## Refinement (optional)

There is a second difference. `time.held` is also false during the setup function in hold mode, because the hold starts after setup (runner.ts:1118, 1804). `engine.held` is already true in setup, and setup is where the docs tell readers to check it. A fuller edit:

- time row: "... Unlike `engine.held`, it is false in the setup function and in a replay."
- sketch: "Unlike `time.held`, it is true for the whole session, the setup included, and in a replay too."
