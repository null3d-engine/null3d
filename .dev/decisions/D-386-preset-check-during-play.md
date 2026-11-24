# D-386: The preset check during play

Status: decided by the owner, and built. The check measures the first frames of play by default. The `presetCheck` option's `before-play`, and the `?preset-check=before-play` switch, keep the check before play that [D-17](D-17-stored-preset-check.md) measured. This record replaces D-17's rejection of a check during play. D-17's stored result holds for both timings.

Summary: By the owner's ruling, a page shows its scene as soon as the first frame is drawn, and the preset check runs behind it. It is a setting, and its default is the check during play. On a first visit in the examples' production build, the instances demo's loading card left at 0.49 s, against 1.18 s. Skyway's left at 1.16 s, against 1.94 s. `presetCheck: 'before-play'` keeps the check behind the loading screen.

## Question

On a first visit, the engine checks the preset that it chose. The check holds back `createEngine`, the `sketch` and `first-frame` stages, `engine.firstFrame` and so the page's loading screen. Each preset that it measures costs at least 0.75 s, though the GPU finished the first frame long before. [D-11](D-11-frames-in-flight.md#the-preset-checks-thresholds-m1-g3) measured `createEngine` at 991 to 1,045 ms with the check, and 144 to 279 ms with a fixed preset. The first frame was done at 164 to 303 ms either way. Should the scene show at its first frame, with the check behind it?

## Rule

The owner's ruling: the scene shows as soon as it is drawn, with the quality check running behind it. This is a setting, not a fixed behavior. Its default is the check during play, and its other value keeps the check before play exactly as D-17 built it.

Within the ruling:

- The check keeps its thresholds and its rounds, so it lowers the preset where the GPU misses the target, as before.
- The governor does not move the render scale under the check's measurement.
- The scene runs normally during the check: the sketch's update, its input and its animations.
- What a page reads after `createEngine` resolves stays true while the check runs: the mode, the quality updates, the stored result and the stats overlay.

## Data

### Demo starts on the examples page

How the data was produced: the production build of the examples page (`bun run examples:build`), served over HTTPS by `bun run examples:preview`. The base commit, cbdd718e4, ran from an export of it on one port, and this change on another, timed in turns. Chrome for Testing 156, headless, drew on WebGPU on a MacBook Pro with an Apple M3 Max. Each load went through a local proxy with no limit on the link. The page's thread was not slowed, and no service worker ran. A first visit is a load in a fresh browser profile, so the engine checks the preset. A repeat visit is a new tab after one first visit, which takes the stored result. Each figure is the median of 3 loads, with the range, in ms from navigation start. The timing script reads when `createEngine` resolves, through the page's `?bench` switch, and when `engine.firstFrame` and `engine.presetChecked` resolve. It also reads when the loading card hides. No build or browser test ran during the runs, and the load average was 4.0 at the start and 5.8 at the end.

| Demo and visit | Measure | Check before play (base) | Check during play |
| --- | --- | --- | --- |
| instances, first visit | `createEngine` resolved | 1,177 (1,149 to 1,180) | 345 (337 to 389) |
| | `first-frame` stage | 1,179 (1,156 to 1,194) | 491 (477 to 539) |
| | Loading card hidden | 1,179 (1,156 to 1,194) | 491 (477 to 539) |
| | GPU finished the first frame | 453 (422 to 464) | 476 (457 to 528) |
| | Check ended | with `createEngine` | 1,193 (1,163 to 1,243) |
| instances, repeat visit | `createEngine` resolved | 250 (248 to 257) | 253 (247 to 257) |
| | `first-frame` stage | 357 (353 to 360) | 375 (353 to 383) |
| | Loading card hidden | 404 (402 to 405) | 403 (400 to 403) |
| Skyway, first visit | `createEngine` resolved | 1,407 (1,405 to 1,425) | 442 (436 to 453) |
| | `first-frame` stage | 1,536 (1,522 to 1,545) | 757 (733 to 768) |
| | Loading card hidden | 1,938 (1,925 to 1,952) | 1,160 (1,134 to 1,169) |
| | GPU finished the first frame | 697 (680 to 709) | 745 (731 to 749) |
| | Check ended | with `createEngine` | 1,469 (1,445 to 1,474) |
| Skyway, repeat visit | `createEngine` resolved | 309 (305 to 321) | 309 (308 to 326) |
| | `first-frame` stage | 425 (412 to 468) | 438 (413 to 441) |
| | Loading card hidden | 828 (814 to 870) | 840 (816 to 846) |

What the figures show:

- On a first visit, the loading card leaves 0.69 s sooner for instances and 0.78 s sooner for Skyway. `createEngine` resolves 0.83 to 0.97 s sooner. The card follows the `first-frame` stage, which now comes 15 ms after the GPU finished the first frame, against 0.7 to 0.8 s after it.
- The timing helper's runs of the same base build read the card hidden at 1.2 s for instances and 2.0 s for Skyway. They used the same full-speed link without a service worker.
- The check still ends about where `createEngine` resolved before: it measures as long as it did.
- A repeat visit runs no check, and its figures stay within the noise of 3 loads.
- The GPU finishes the first frame 23 ms later for instances and 48 ms later for Skyway, as medians. The promise of `createEngine` now resolves before that frame, so the page's own work after it runs beside the frame. The examples page then loads the stats overlay's code for instances. For Skyway it also loads the demo's sounds and the mixer, 1.1 MB from 0.58 s. Before play, both waited for the check.
- Skyway's card hides 0.4 s after its first frame on both: the examples page waits for a quiet gap after the scene's last loading message.

### The startup benchmark

`bun run bench:startup` ran with its defaults: 3 cold loads of the engine test page's production build, pipelined, on WebGPU, on Chrome's Slow 4G profile. Each load has a fresh profile, so the engine checks the preset. It ran from the base commit's export, then from this change, one after the other, on the same MacBook Pro. The load average was 8.5 at the start and 3.7 at the end. Medians in ms from navigation start:

| Build | Core | Ready | Frame | Frame done | Requests | KB |
| --- | --- | --- | --- | --- | --- | --- |
| Check before play (base) | 7,118 | 8,373 | 7,273 | 7,280 | 21 | 823.2 |
| Check during play | 7,145 | 7,266 | 7,292 | 7,298 | 22 | 824.0 |

"Ready" is when `createEngine` resolved. It comes 1.1 s sooner, now before the first frame. The first frame's end moves by 18 ms, within the noise of 3 loads. This change adds one request of about 1 KB to the load. The tool does not name its files, so the request is not identified here.

## Look

Both timings end on the same preset with the same settings, so play looks the same once the check has ended. During play, the viewer sees the scene at the preset that the engine chose for the check's time. A lowering then shows in front of the viewer: the pixel ratio, the shadows and the anti-aliasing change. The last frame stays on screen while the new preset's pipelines build, 21 to 412 ms on the iPad by [D-13](D-13-shader-variants.md)'s figures. Before play, the loading screen covers that time and the change. The owner chose to show the scene sooner. A page that would rather hide the change takes `before-play`.

### Repeat visits on a slow tablet

A repeat visit that takes the stored result shows no change of preset: its setup already runs the preset that the check chose. On a Galaxy Tab A9 Plus, Skyway's repeat visits did not take it. The GPU's load had lowered the check's target, and the page stores no result measured against a lower target ([D-17](D-17-stored-preset-check.md#the-target-under-the-checks-own-load)). During play, each repeat visit then showed Skyway at Medium and dropped to Low at the first frame. The pixel ratio, the shadows and the anti-aliasing changed, and the picture held at 1 to 2 frames a second while Low's pipelines built. A viewer who left before the check ended, about 18 s after the first frame, also left nothing stored. Both are fixed: a repeat visit there now runs Low from its setup and shows no change. A viewer may leave during the check. The next visit then runs the preset that the check had lowered to, and its check measures only what is left ([D-17](D-17-stored-preset-check.md#rounds-of-a-check-that-never-ended)).

## Decision

The check runs during play by default, as the owner ruled.

### The setting

`createEngine` takes `presetCheck: 'during-play' | 'before-play'`, with `during-play` as the default. Another value fails with E1213. The `?preset-check=` switch wins over the option, as `?target-fps=` and `?latency=` win over theirs. The type `PresetCheckTiming` names the two values.

The values name where the check sits against play, the frames that run the sketch's update. That is the one difference between the two. Before play, the check draws setup frames that run no sketch code, and the start waits for them. Options rejected:

- `behind` for the new value. The docs say "behind the loading screen" of the check before play, so `behind` reads both ways.
- A boolean such as `waitForPresetCheck`. It says what the start waits for, but not that the sketch plays during the check.

The option shares its name with `engine.mode.presetCheck`, as `preset` does: the option chooses how the check runs, and the mode reports what it measured.

### The start

- `createEngine` resolves once the setup has run, before the check, so a page can wire its controls at once.
- The `first-frame` stage and `engine.firstFrame` come once the GPU has finished a frame after the setup. The page keeps its poll for the first frame after the `sketch` stage. That stage now comes before the check, so the poll reports the first frame as soon as it is done. The stage order stays `core-download`, `core`, `sketch`, `first-frame`.
- Rejected: a poll from the `core` stage. A warm-up during the setup draws a frame of a half-built scene. The stage would then come in the middle of the setup, and a page would take its loading screen down over that scene.
- A failure of the thread that draws at the first frame now comes after `createEngine` has resolved, so it reaches the page through `engine.onFailure`. A page that waits only for `engine.firstFrame` would wait forever. So `engine.firstFrame` rejects when the engine stops drawing before the GPU finished the first frame. It rejects with the failure that ended the frames, or with E1420 for a destroy. The engine catches its own copy of the promise, so a page that never waits for it gets no unhandled rejection. The demos page shows the rejection on its loading card.
- `engine.presetChecked` resolves once the check has ended. Then `engine.mode.preset` holds the check's choice and `engine.mode.presetCheck` what it measured. It has resolved when `createEngine` resolves where no check runs, and with `before-play`. It also resolves when the engine stops drawing first. A page that shows the chosen preset, and a test or benchmark that measures steady play, waits for it.

### The check during play

- Before play, the check holds the sketch's frames. Its setup frames run none of the sketch's code ([D-11](D-11-frames-in-flight.md)). The update and the input do not run, and the clock and the animations do not step. During play, the check measures the frames that the frame loop draws, and publishes no frame of its own. The sketch's update, input, fixed steps and animations run in every frame that it measures.
- The governor waits until the check ends. D-17 gives the governor as a reason against a check during play. The governor would lower the render scale under the check, which would then keep a preset that misses the target. Held, the governor leaves each preset at the full render scale while the check measures. The check itself lowers the preset when frames miss, so play is guarded meanwhile. The governor then starts with its grace, as it starts at the first frame of play after a check before play.
- The check measures the load of play, with the sketch's own work in it. D-17 counts that as a fault, since the load differs from start to start. It is also the load that the preset must hold in play.
- A sketch that asks for a preset with `quality.setPreset` while the check runs ends the check with no result. The sketch chose its preset, and the engine stores no result. Rounds that the check stored at an earlier lowering stay, and the next visit goes on from them ([D-17](D-17-stored-preset-check.md#rounds-of-a-check-that-never-ended)). Without them, the next visit measures again.
- The sketch's `quality.onChange` handlers hear of each lowering in the next frame of play.
- A replay runs no check: it steps through its recording, which leaves no frames of play to measure.
- The page's crash note stays until 5 s after the later of the first frame and the check's end. So a start whose check ends in a crash counts as one, as with the check before play.

## Consequences

- `page/engine.ts`: the `presetCheck` option and its switch, `engine.presetChecked`, the quality update that ends the check, and the crash note's end. `page/switches.ts` reads `?preset-check=`. `quality/presets.ts` checks the option, and `quality/check.ts` holds `PresetCheckTiming`.
- `sketch/runner.ts`: the check during play. It waits for each frame that the thread that draws takes, and holds the governor's loop until it ends. In `sketch/quality.ts`, `QualityStart.check` carries the timing, and the update that ends the check carries `checked`.
- Unit tests of the runner's check during play: the sketch's update runs and the preset lowers in play. The governor waits, and a preset that the sketch asks for ends the check. The option and the switch have tests of their own.
- Browser tests: the quality page reports what the check had measured when `createEngine` resolved, and a test checks both timings. Every test page that measures or reads the scene after its first frame also waits for `engine.presetChecked`, so it reads steady play as before. The benchmark pages' warm-up starts once the check has ended.
- On a Galaxy Tab A9 Plus, Skyway draws 1 to 3 frames a second even at Low. The check's first round waits for the first frame's pipelines and its long finish, in both timings. A preset far below its target goes straight to Low, and a Low that far below takes the lowest quality tier. The governor's target no longer falls under the engine's own load ([D-392](D-392-check-fast-exit-and-governor-target.md)).
- Docs: the quality presets page, the loading screens guide, the engine and quality API pages, and the testing guide's switches. Skills: the API quick reference, the performance reference and the testing reference.
