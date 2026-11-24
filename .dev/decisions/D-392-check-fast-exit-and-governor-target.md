# D-392: The preset check's fast exit on very slow devices, and the governor's target under the engine's own load

Status: decided by the owner, and built. The preset check waits for the first frame's pipelines and its long finish before it measures. A preset far below its target goes straight to Low, and the check measures Low. The lowest quality tier stays the governor's step during play ([D-382](D-382-lowest-quality-tier.md)). A tier step at the check's end was built, and taken out (see The tier step). The frame-budget governor's target starts at the display's rate measured before the engine's load, and the engine's own load cannot lower it. Measured on the Galaxy Tab A9 Plus; see Data.

Summary: A tablet draws Skyway at one or two frames a second. There the check now measures Medium at its true rate, and steps to Low. The governor's target holds while the GPU's load slows the frame callbacks, and still follows a display that saves power.

## Question

The Galaxy Tab A9 Plus has an Adreno 619 and a 90 Hz display, and runs Chrome on WebGPU. There the examples page's Skyway starts at Medium, and draws at one to three frames a second, even at Low. Three faults showed ([D-17](D-17-stored-preset-check.md#the-target-under-the-checks-own-load)):

- The check's first round measured the first frame's own finish. The GPU took about 1.5 s over the first frame, after its pipelines were built. Medium read 0 to 1.8 frames a second inside that time.
- The check lowered one preset at a time, and stopped at Low. Low drew far below the target, and the governor reached the lowest tier only after its own windows. On a repeat visit there, its tier changes came 89 to 100 s after navigation.
- The governor's target followed the display's rate as the frame callbacks measure it. Under the GPU's load the callbacks slow down, and the rate read 30 to 45 on that 90 Hz display. A lower target makes slow frames pass as on target.

How should the check end sooner on such a device, and the governor keep its target, without a change for devices that never step down?

## Rule

The owner's ruling:

- A preset far below its target goes straight to Low. The owner first ruled that a Low that far below goes on into the lowest tier. The lead took that step out after CI's runs (see The tier step).
- D-17's rule holds: the engine runs only a preset that the check measured. A jump to Low is followed by a round at Low.
- The first round ignores the first frame's long finish and its pipeline builds.
- The governor's target starts at the refresh rate measured before the load, and never falls under the engine's own load. A display that saves power still lowers it.
- Nothing changes on a device that holds its preset: the Galaxy S25, which starts at Low and runs no check, and the MacBook Pro.

## Data

How the data was produced: the examples page's production build (`bun run examples:build`) of this change, and of the change before it. The change before it is the stored check of D-17, at cbdd718e4 with D-386. Vite's preview served each build over BrowserStack Local to BrowserStack Automate's real devices. Each session opened a fresh browser: a first visit of the demo, then a repeat visit of the same address after `about:blank` and 3 s. The page recorded each quality update that the engine sent, with its time from navigation. It also recorded when the GPU finished the first frame. The tunnel's speed varies from session to session, so the times count from the first frame on.

Galaxy Tab A9 Plus, Chrome, WebGPU, Skyway, first visits. The check starts at Medium.

| Build | Session | First frame done | Check ended | After the first frame | Rounds, lower of the two rates | Ended at |
| --- | --- | --- | --- | --- | --- | --- |
| Before | 1 | 22.6 s | 41.1 s | 18.4 s | Medium 0, Low 0.6 | Low |
| Before | 2 | 20.7 s | 35.4 s | 14.7 s | Medium 0, Low 1.2 | Low |
| This change, with the tier step | 1 | 24.2 s | 49.2 s | 25.0 s | Medium 0.8, Low 1.1 | Low, lowest tier |
| This change, with the tier step | 2 | 20.2 s | 42.5 s | 22.3 s | Medium 1.0, Low 1.1 | Low, lowest tier |

- Before, Medium's round read 0 frames finished: it fell inside the first frame's own finish, about 1.5 s. Now it reads 0.8 to 1.0, measured after the wait. Medium is far below the target either way, so the check still steps to Low.
- The check now ends 4 to 10 s later after the first frame. At about one frame a second, the wait before the first round runs to its cap of four seconds. The round then draws for about a second more. From Medium, Low is one lowering anyway, so the jump saves no round on this device. From High or Ultra, it saves a round for each preset between.
- These runs had the tier step, so the check ended in the lowest tier, 22 to 25 s after the first frame. Without it, the governor enters the tier on its own. On a repeat visit of the stored check's build, its tier steps came 89 to 100 s after navigation. That is about 70 to 80 s after the first frame.
- Both repeat visits of these runs took the stored result, started at Low, and ran no check.
- The refresh rate that the engine recorded read 90 during the setup, and 22 to 45 while Skyway drew. The check's target was 60 in all four first visits.

Galaxy S25, Chrome, WebGPU, this change, first visits of Skyway and instances: each started at Low and ran no check, as before. Neither sent a quality update in the 20 s of play that the tool watched. The recorded refresh rate read 30 from the setup on, as the device's display ran at 30 Hz. So the governor's target started there.

The sessions of this record took 8.0 device minutes: 6.0 on the Tab A9 Plus and 2.0 on the S25.

MacBook Pro, Chrome for Testing 156 headless, WebGPU, this change: the examples page's production build, one fresh profile for each demo. Instances and Skyway each checked one round at High, which held: 59.5 and 60.2 frames a second, with a target of 60. The check ended 0.79 s and 0.87 s after the GPU finished the first frame. Each repeat visit took the stored result. No run took the lowest tier.

The quality test page's heavy scene ran on the same Mac from the dev server. With its spheres' levels of detail, High drew 60 frames a second once the wait had passed, so the check kept High. The levels plan at the scene's first draw, and the old first round measured before them. Without levels, the check went from High at 5.9 frames a second to Low at 11.6. On WebGL2 it went from Medium at 5.8 to Low at 6.2.

The governor's walk test (`governor.spec.ts`) takes every live step down and back up. On this Mac it failed in every run but one: with this change, and at the base commit cbdd718e4 with and without the check (`?preset=high`). Each failed run took one extra step down and back at the start of the walk. The failure does not come from this change.

## Look

On a device that the check lowers, the look is the same until the check ends. A preset far below its target already plays at one to three frames a second. The step to Low comes in one change instead of one for each preset between. On a device that holds its preset, the look does not change.

## Decision

### The fast exit

- A round is far below its target when the lower of its two rates is under a quarter of the target (`CHECK_FAR_SHARE`). At a target of 60, that is under 15 frames a second. A preset that misses by less still steps down by one, so a device near the target keeps the preset between.
- After a round far below its target, the check lowers the preset straight to Low. It waits for Low's first frame and its settle, and measures Low. So the engine runs only a preset that the check measured.
- After a round at Low, the check ends, whatever its rate. The lowest tier stays the governor's step during play, as on main.
- The rounds of a check that never ended give the next preset by the same rule. That is Low after a round far below its target, or else the next lighter preset.
- Rejected: a jump without a round at the preset it jumps to. It breaks D-17's rule, and a jump to Low from High would leave Low unmeasured.
- Rejected: a rule from the count of frames that the window presented. At a quarter of the target, a 500 ms window holds about 7 frames. So the share of the target already covers a window with too few frames.

### The tier step

The first build of this record took the lowest tier at the check's end when Low too was far below its target, and stored it. CI's software GPU draws every page far below its target. So every page that left its preset to the engine started its play in the tier. The tier caps the render scale at a third. The frame-resolution test then read a render scale of 0.333 five times, where it steps the scale from 1 to 0.5. Thirteen benchmark pages failed with E1213: their sketches set a render-scale floor of 1 after the check, above the tier's cap of 0.3333. A slow phone could meet the same error in an app. The lead took the step out of the check. The check ends at Low, and the store keeps no tier. The governor alone enters the tier, during play.

### The first round

- Before the check draws, the runner waits until the thread that draws has built the pipelines that the scene needs, as a warm-up does.
- The first round then waits as a round after a lowering does ([D-17](D-17-stored-preset-check.md#the-wait-after-a-lowering)). It waits until the GPU has finished two frames at 100 ms or less, or for four seconds. The first frame's long finish passes there, outside the measured window.
- Rejected after a trial: ending the first round's wait after two frames in a row each slower than a quarter of the target. On the Tab A9 Plus, one Skyway session lowered to Low 6.4 s after the first frame, against 6.7 and 9.0 s with the cap. That is inside the spread between sessions. The rule would also let two slow one-time frames start the round early, so it was left out.
- A scene whose meshes plan levels of detail at their first draw is lighter by the first round than at the first frame. The quality test page's heavy scene therefore plans no levels, so it stays too heavy for the Mac's GPU.

### The governor's target

- The runner reads the display's rate when the sketch's setup returns, before the frames of play load the GPU. The preset check's target starts from it, and so does the governor's.
- The governor's target rises with any faster reading.
- It falls to a slower reading only in a window where the GPU finished each frame within the target's own period. Then the GPU had room for the target, so the display or the browser set the slower rate. A display that saves power does that. A GPU that the engine's load holds back takes longer than the target's period over each frame, so the target holds.
- Rejected: comparing the GPU's delay with the slower reading's period. A GPU that takes 20 ms over each frame on a 60 Hz display brings the callbacks to 30 Hz. 20 ms fits in 33 ms, so the target would fall under the engine's own load.
- Rejected: a meter that reads the shortest callback intervals. The page's shortest interval stayed at 11.1 ms on the tablet while its median read 30 to 45. But every reader of the meter would change with it: the overlay, the check and the governor.

## Consequences

- `quality/check.ts`: `CHECK_FAR_SHARE` and `farBelowTarget`. `quality/presets.ts`: `presetAfterMiss`.
- `sketch/preset-check.ts`: the first round's settle and the jump to Low. `checkPreset` takes no grace start.
- `sketch/runner.ts`: the setup's refresh rate for the check and the governor, and the warm-up before the check. `sketch/quality.ts`: `lower` takes the preset to lower to.
- `quality/governor.ts`: `GovernorLoop.startTarget` and the held target.
- `page/check-store.ts`: `checkedPreset` takes `presetAfterMiss`.
- Tests: unit tests of the check, the runner, the store and the governor. The quality test page's heavy scene plans no levels of detail (`?levels=off` of its sketch).
- The docs generator's table of the check's rules, the quality presets page and the develop skill's performance reference.
