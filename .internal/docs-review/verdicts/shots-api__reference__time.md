# Verdicts: api/reference/time (screenshots and demo links)

## Shots

None were proposed. None are needed: this page is a generated table of the sketch clock's fields.

## Demo links

### hold-mode/ for "hold mode and held time", under `SketchTime`: reject on this page

- The code exists. examples/demos.ts has an entry named `hold-mode` ("Repeatable frames"). The folder examples/hold-mode/ holds its sketch. It has reference images for webgpu, compat and webgl2.
- The demo shows hold mode. It runs with `?hold=3`, moves 400 balls in fixed steps, and the held frame is the same on every run.
- The demo never reads the clock object that this page lists. It uses no `time.now`, `time.held`, `time.drawn` or `time.frame`. It moves the balls with the step argument of `onFixedUpdate`, and that argument is not on this page. A reader who opens it from the `SketchTime` table finds none of the fields there.
- This page is generated from doc comments. No generated reference page has a demo link today. To add one, a writer must put it in the doc comment on the `SketchTime` interface in packages/engine/src. The proposal does not name that source.
- Better place: the hand-written concept page docs/api/time.md. It has no demo link yet. It covers hold mode near line 56 (the frame steps in hold mode) and line 111 (fixed steps in hold mode). guides/testing.md links this demo already.

## Concepts without a demo

None were listed. A search of the demos finds no sketch that reads `time.held` or `time.drawn`. Many demos read `time.now`, for example examples/security-camera/sketch.ts and examples/layers/sketch.ts, but the page does not need a link for that field.
