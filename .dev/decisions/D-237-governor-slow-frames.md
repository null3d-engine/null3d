# D-237: The governor judges slow frames, and undoes a step down that slowed them

Status: proposed, for agreement before any code. Not built yet. Date: 24 October 2026. Task: M3-R2.

Summary: The governor takes a gap of half a second between frames for a pause, and starts its windows again. So it never judges a page that draws fewer than about two frames a second. On CI's software GPU the resize page drew 2.2 frames a second at the whole render scale, and the governor stepped it to 0.95. The two-step upscale then drew as well, and the page fell to 0.3 frames a second. That is below the line where the governor judges, so the page stayed there for the rest of every test. The proposal has two parts. A gap counts as a pause only while no frame was drawing. A step down whose frames are not faster than before is undone, and becomes a floor for a while.

## Question

After D-236, the pixel ratio test of `tests/image/resize.spec.ts` failed on CI's software GPU. A resize back at the screen's ratio of 2 waited past its 30 s. One runner timed browser shard 30 at the commit before D-236 and at the commit after, in turn. It logged the page's render scale and frame rate once a second. Why did the new commit make this test slower, when its shard ran faster as a whole?

## Data

Diagnostic run 40032826932 ran on one runner, on branch `diag/resize-ab`, which never lands. It ran the pixel ratio test's five WebGPU thread modes, twice for each commit. The page used the `high` preset, whose lowest render scale is 0.75.

| Commit | Render scale | Seconds logged | Frames a second, median | Longest frame in a second, median and most |
| --- | --- | --- | --- | --- |
| b9fc91903, before D-236 | 1.00 in every test | 319 | 0.5 | 2.1 s, 9.5 s |
| 16628a5dd, after D-236 | 1.00, until the governor's step | 35 | 2.2 | 0.6 s, 1.2 s |
| 16628a5dd, after D-236 | 0.95, from the step to the test's end | 210 | 0.3 | 3.3 s, 10.2 s |

| Commit | Resizes at ratio 2 | Mean | Longest | Tests failed |
| --- | --- | --- | --- | --- |
| b9fc91903 | 30 | 13.3 s | 20.1 s | 0 of 10 |
| 16628a5dd | 28 | 21.4 s | 30.0 s, the test's limit | 2 of 10 |

Each of the ten tests at 16628a5dd stepped to 0.95 once and never stepped again. None of the ten at b9fc91903 stepped at all. The first run of the same kind, 40028158368, ran on another runner and showed the same split. There, resizes at ratio 2 took 13 to 17 s on average at 16628a5dd, and 8 to 9 s at b9fc91903.

How the data was produced: a patch to the resize page made the quality sketch post `quality.renderScale`, its frame rate and its longest frame once a second. The test wrote them beside the time of each resize. The page used the build files of each commit's own CI run, 40019735250 and 40022423739.

## Findings

- `GovernorLoop.frame` starts the windows again when a frame comes `GAP_MS` or more after the one before (`packages/engine/src/quality/governor.ts`). That is half a second, and the rule is right after a pause in play. But the rule cannot tell a pause from a frame that took that long. So a page below about two frames a second is never judged. It never steps down, and once it is there, it never steps up.
- Before D-236, every final pass build held the upscale's loops. The page drew below that line from its first frame, and the governor never acted. D-236 made the frames at the whole scale about four times faster. That put the page above the line, so the governor judged it and stepped down.
- The step to 0.95 turned on the two-step pass. On the software GPU, its upscale costs several times what a twentieth of the canvas's width and height saves. The governor assumes that each step down makes the frames cheaper, and it never checks that a step helped. Its steps up are on trial (`FAILED_RAISE_MS`), but its steps down are not.
- The same trap waits for a page that a browser draws on its software renderer, as Chrome does where it blocks a GPU. It also waits on any device where one step costs more than it saves.
- The resize test checks buffer sizes, which no render scale changes. So it now keeps the whole scale and turns the governor off (branch `fix/resize-whole-scale`). That fix leaves this fault as it is.

## Proposal

1. A gap counts as a pause only when no frame was drawing during it. A frame that the GPU or the thread that draws held for half a second or more counts as a frame of that length. It fills the windows it spans, so one 3 s frame makes a whole second of windows that missed. The completed frames' busy time, which the metrics rings hold already, should tell the two cases apart. After a pause, the frame that ends the gap was quick; after a slow frame, it was not. The code must show that this holds in every thread mode, since the wait can fall before the submit as well as after it.
2. A step down is on trial, as a step up is. When the governor judges again after the settle time, it compares the mean frame time of the new setting's first second with that of the second that caused the step. If the new frames are not faster by a clear margin, it takes the step back at once. The level below then becomes a floor: no step down into it until a wait has passed. The wait doubles with each failed step into it, up to the longest wait of a step up. A step that helped is kept, and its floor is forgotten.
3. An alternative bounds the step in time alone. A scale below the whole that lasts longer than the window that justified it, with no gain in frame time, steps back, and the scene never steps down again. But the comparison needs the frame times that rule 1 makes visible, so a time bound alone cannot see the gain. A scene can also grow heavier later, when a step down would help. So a floor whose wait grows fits better than a ban for the scene's life, and it reuses the trial rules of the steps up.

## Tests

- Unit tests in `packages/engine/src/quality/governor.test.ts`:
  - Frames 2 s apart with a busy GPU are judged, and step down.
  - A gap of 2 s with an idle GPU still starts the windows again.
  - A step down whose next second is no faster is undone, and becomes a floor. Its wait doubles on a second failure.
  - A step down that helps is kept.
- The governor's page test (`tests/pages/governor.ts`), with a scene whose step below the whole scale costs more than it saves. The scene must end at the whole scale.
- M3-R2's own check: no flapping between two levels in the governor's stress test, on the Mac, the iPad and an S24-class phone.

## Consequences

- None until the proposal is agreed.
- The code then changes `GovernorLoop.frame`, `Governor.lower` and `Governor.judge`.
- `.dev/implementation-notes.md` describes the gap rule in its governor paragraph, so that paragraph changes too.
