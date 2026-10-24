# D-237: The governor judges slow frames, and undoes a step down that slowed them

Status: rule 2 agreed, rule 1 waits for its test in every thread mode. Built: rule 2 and its bound for a trial with no judged second, in `packages/engine/src/quality/governor.ts`. Rule 1 is not built yet. Date: 24 October 2026. Task: M3-R2.

Summary: The governor takes a gap of half a second between frames for a pause, and starts its windows again. So it never judges a page that draws fewer than about two frames a second. On CI's software GPU the resize page drew 2.2 frames a second at the whole render scale, and the governor stepped it to 0.95. The two-step upscale then drew as well, and the page fell to 0.3 frames a second. That is below the line where the governor judges, so the page stayed there for the rest of every test. The proposal has two parts. A gap counts as a pause only while no frame was drawing. A step down whose frames come clearly slower than before is undone, and its level closes for a while.

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
- CI's software GPU found the fault, and it stands for the case that matters to users: a browser that draws on its software renderer, as Chrome does where it blocks a GPU. The same trap also waits on any device where one step costs more than it saves.
- The resize test checks buffer sizes, which no render scale changes. So it now keeps the whole scale and turns the governor off (branch `fix/resize-whole-scale`). That fix leaves this fault as it is.

## Proposal

1. A gap counts as a pause only when no frame was drawing during it. A frame that the GPU or the thread that draws held for half a second or more counts as a frame of that length. It fills the windows it spans, so one 3 s frame makes a whole second of windows that missed. The completed frames' busy time, which the metrics rings hold already, should tell the two cases apart. After a pause, the frame that ends the gap was quick; after a slow frame, it was not. The code must show that this holds in every thread mode, since the wait can fall before the submit as well as after it.
2. A step down is on trial, as a step up is. When the governor judges again after the settle time, it compares the mean frame time of the new setting's first second with that of the second that caused the step. If the new frames came a tenth slower or more (`LOWER_LOSS_PERCENT`), it takes the step back at once. A step that changes nothing stays: a step that saves little shows no gain within one second's noise, and the walk down passes through such steps. The level below then closes: no step down into it until a wait has passed. The wait starts at 10 s (`FLOOR_AFTER_MS`) and doubles with each failed step into it, up to the longest wait of a step up. A step that held is kept, and its level's wait starts again from the shortest.

   During a trial the page draws at the new setting for the settle time and one second of frames, about two seconds at the target rate, before the governor judges it. On a page whose frames take seconds, the trial lasts as long as those first frames. If the step made the frames slower, the user sees that slower setting for the trial's length, and the governor then takes the step back.

   A trial in which no second of frames is judged within 4 s (`LOWER_TRIAL_MS`: the settle time and three seconds) also fails: the frames before the step were judged, so they came faster than the frames after it. The frame loop checks the bound at each gap, through `Governor.gap`. A pause in play during a trial fails it too, and the short first wait lets the governor try the step again soon. This needs no change to the gap rule, and it frees the page in the data above.
3. An alternative bounds the step in time alone. A scale below the whole that lasts longer than the window that justified it, with no gain in frame time, steps back, and the scene never steps down again. But the comparison needs the frame times that rule 1 makes visible, so a time bound alone cannot see the gain. A scene can also grow heavier later, when a step down would help. So a floor whose wait grows fits better than a ban for the scene's life, and it reuses the trial rules of the steps up.

## Condition

Rule 1 lands only if the completed frames' busy time tells a slow frame from a pause in every thread mode: pipelined, low latency, single-threaded, drawing on the main thread, and the sketch on the main thread. A worker that draws into the canvas reports its time differently from one that hands the frame back. If the test fails in one mode, rule 2 lands alone, with its rule for a trial in which no second is judged, and the gap rule stays as it is.

## Tests

- Unit tests in `packages/engine/src/quality/governor.test.ts`:
  - Frames 2 s apart with a busy GPU are judged, and step down.
  - A gap of 2 s with an idle GPU still starts the windows again.
  - A step down whose next second is slower is undone, and its level closes. The wait doubles on a second failure.
  - A step down whose next second is no slower is kept.
  - A step into a level that held sets its wait to the shortest again.
  - A step down after which no second of frames is judged before the trial ends is undone.
- The governor's page test (`tests/pages/governor.ts`), with a scene whose step below the whole scale costs more than it saves. The scene must end at the whole scale.
- For rule 1, a page test in each thread mode with frames held for a known time and with a pause of the same length, which the governor must tell apart.
- M3-R2's own check: no flapping between two levels in the governor's stress test, on the Mac, the iPad and an S24-class phone.

## Consequences

- Rule 2 changes `GovernorLoop.frame`, which calls `Governor.gap` at a gap, and `Governor.judge` and `Governor.lower`, with the trial in `lowerFailed` and `undoLower`. Six unit tests in `governor.test.ts` check it, one of them a replay of the resize page's frame times. All 57 of the file's tests pass.
- Rule 1 would change `GovernorLoop.frame` again, after its test in every thread mode.
- `.dev/implementation-notes.md` describes the gap rule in its governor paragraph, so that paragraph changes too.
