# Shot and demo-link verdicts: api/reference/sound

## Shots

None proposed. None needed: this is a generated reference page of signatures. A still picture cannot show sound.

## Demo links

### createSound, connectSound, groups, shots and loops -> `sound/` (under `## createSound`)

Verdict: keep, with one fix to the concept text.

- The code `sound/` exists in examples/demos.ts (demo "sound", "Positional sound").
- Its sketch (examples/sound/sketch.ts) calls `createSound(ctx, { listener: camera })`, then `sound.loop` (rain), `sound.group` (the brook, with positions and levels), two `sound.shot` calls (near and far thunder), `shot.play(...)` on each strike, and `sound.update()` in `onLateUpdate`. So it shows createSound, loops, groups and shots well.
- It does NOT show `connectSound`. The page half lives in the shared helper examples/lib/sound-button.ts, outside the linked folder. A reader who follows the link for connectSound will not find it.
- Fix: drop "connectSound" from the concept, or name the shared speaker-button helper as the place that calls it.
- Source to edit: this page is generated. The link goes into the TSDoc comment on `createSound` in packages/sound/src (tag @category api/sound), not into the .md file.

## Concepts without a demo

None proposed. Nothing to add.
