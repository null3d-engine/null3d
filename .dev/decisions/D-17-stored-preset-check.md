# D-17: The preset check on repeat visits

Status: decided and built. Task: M1-K5, for T-28. The stored result holds for both timings of the check. The check's target starts at the display's rate measured before the check ([The target under the check's own load](#the-target-under-the-checks-own-load)). The store also keeps the rounds of a check that never ended ([Rounds of a check that never ended](#rounds-of-a-check-that-never-ended)). [D-386](D-386-preset-check-during-play.md) settles when a first visit's check runs: by the owner's ruling, during play by default, which replaces this record's rejection of design (a). The check before play, which this record measured, stays as the `presetCheck` option's `before-play`.

Summary: Store each sketch's preset check result in `localStorage` for a week, and skip the check on a matching repeat visit. With the check before play, that saves about 1 s per preset measured on the iPad. A shorter check for known GPUs needs GPU names. By the owner's ruling in D-386, a first visit's check runs during play by default.

## Question

When the page leaves the quality preset to the engine, the preset check measures the scene after the setup. Before play, `createEngine` waits for it. On the 11-inch iPad Pro it takes about 1 s for each preset that it measures. How can the first frame of play come sooner without losing what the check decides?

## Rule

The engine must run the preset that the check would choose, with the same settings. The change must not show a switch of preset to the player. Hard rule 14 holds: no decision from GPU names. Among the designs that pass, take the one that saves the most time on the iPad.

## Data

### What the check costs

Before play, the check draws the first frames behind the loading screen, and every figure in this record measures that timing. For each preset it measures, it draws for 250 ms, then measures for 500 ms, so each preset costs at least 0.75 s. It draws up to 2 s more while textures upload. A lower preset adds the wait for its pipelines. In practice one preset took about 0.8 s on the MacBook Pro, in [D-11](D-11-frames-in-flight.md#the-preset-checks-thresholds-m1-g3) and in the table below. On the iPad it took about 1 s.

From [D-13](D-13-shader-variants.md)'s warm-up time runs, the time from `createEngine` until the first frame was on screen:

| Device and path | Shown | The check's part |
| --- | --- | --- |
| iPad, Safari 26.6, WebGPU | 1.0 to 1.9 s | about 1 s for each preset measured; most scenes start at Medium |
| iPad, Safari 26.6, WebGL2 | 1.0 to 2.2 s | the same; loads that lowered the preset once took 1.9 to 2.2 s |
| S24+, Chrome 154, WebGL2 | 0.23 to 0.43 s | none: a phone starts at Low, which has no lighter preset |

The startup benchmark ran on the MacBook Pro M5 Max, WebGPU. Chrome ran `bun run bench:startup --loads warm`. Safari ran the device runner's `startup` plan. "Ready" is when `createEngine` resolved, and "Frame done" when the GPU finished the first frame. Both measure from navigation start. The page's loading screen waits for the later of the two. Each figure is the median of 5 loads. A warm load repeats the address and the storage of an earlier load, as a repeat visit does. With `?check=fresh`, the engine measures again, as on a first visit.

| Browser and thread mode | Ready, stored result | Ready, `?check=fresh` | Frame done, both |
| --- | --- | --- | --- |
| Chrome 154, pipelined | 52 ms | 866 ms | 85 to 86 ms |
| Safari 26.6.2, pipelined | 28 ms | 831 ms | 63 to 64 ms |
| Safari 26.6.2, the other four thread modes | 28 to 30 ms | 826 to 837 ms | 48 to 65 ms |

So a repeat visit on the Mac shows its first view about 0.8 s sooner, in both browsers. The first frame itself does not move: the check runs after it. Safari's cold loads, which start with empty storage, still checked: Ready at 827 to 850 ms.

The same `startup` plan on the 11-inch iPad Pro, Safari 26.6.2, WebGPU. The iPad was warm from 25 minutes of timing runs.

| Thread mode | Ready, stored result | Ready, `?check=fresh` | Frame done, both |
| --- | --- | --- | --- |
| Pipelined | 87 ms | 900 ms | 119 ms |
| Single-threaded | 63 ms | 845 ms | 83 to 87 ms |
| The other three thread modes | 85 to 90 ms | 875 to 877 ms | 110 to 124 ms |

The cold loads checked in both runs: Ready at 876 to 902 ms.

The warm-up time plan on the iPad starts each benchmark scene and demo at the preset that the engine chooses. Its first two loads take `?shaders=fresh` and `?check=fresh`, as a first visit. Its last two take the stored result, as a repeat visit. The time from `createEngine` until the first frame was on screen, as medians of two loads:

| Path | First visit | Repeat visit |
| --- | --- | --- |
| WebGPU | 1.00 to 1.19 s; 1.82 to 2.36 s where the check lowered Medium to Low | 0.25 to 0.32 s |
| WebGL2 | 1.00 to 1.26 s; 1.91 to 2.21 s where the check lowered Medium to Low | 0.27 to 0.36 s; the math demo 0.52 s |

On a repeat visit the first view comes 0.7 to 2.1 s sooner. What remains is the start itself: the core, the setup, the pipelines and the uploads. The math demo's WebGL2 pipeline wait stayed at 275 to 288 ms on both visits.

### The designs

(a) Draw at once and check during play. `createEngine` resolves after the setup, and the check runs while the sketch plays. This record's rule, which keeps the switch out of the player's view, rejects it for the reasons below. The owner's ruling in [D-386](D-386-preset-check-during-play.md) makes it the default, and keeps the check before play as the `presetCheck` option's `before-play`. D-386 answers each reason. The player sees the switch by the owner's choice, and the governor waits until the check ends. The check measures the load of play, which is the load that the preset must hold. The reasons:

- The player sees the switch. A lower preset changes the pixel ratio and the shadows. Its first frame waits for its pipelines, and the last frame stays on screen meanwhile: 21 to 412 ms on the iPad, by D-13's figures.
- The frame-budget governor runs during play. It lowers the render scale when frames are slow. A check during play would then measure the lowered scale, and keep a preset that misses the target. Turning the governor off during the check leaves the first second of play unguarded.
- The frames of play hold the sketch's own work and the player's input, so the check would measure a different load on each start.
- Starting at a safe preset, Low, does not help. Its rate says nothing about whether Medium holds. Raising the preset needs a measurement at Medium in front of the player, and a drop back when it misses.

(b) A shorter check on GPUs that the engine knows. Rejected: knowing a GPU means a list of GPU names, which hard rule 14 forbids. Firefox and Brave can hide the names, and such a list goes out of date with each new device. A shorter window for every device saves at most a quarter to half a second for each preset. At 60 Hz, 500 ms is 30 frames. With fewer frames, one slow frame moves the rate more, so the check would decide less reliably.

(c) Store the check's result, chosen. The page keeps each sketch's last result in `localStorage`. A later start that matches it takes the stored preset and skips the check. The first visit still waits for the check, and every later visit within a week does not.

### When a stored result applies

A stored result applies only when the start matches the one that the check measured:

- The same sketch module, whose URL is the key, as for the crash note. The same preset to check from, the same GPU path and the same `?fps=` switch.
- The same facts from the browser: the device hints, the screen's pixel ratio, the logical cores, and what the GPU path reports of the GPU. On WebGPU that is the adapter info, the features and the limits. On WebGL2 it is the renderer string, the extensions and the render target limits. The engine only compares these with the stored ones. It reads no meaning from the names, so hard rule 14 holds. Where a browser hides or varies the names, the check runs again and only costs its time.
- The same rules of the check: its target, share and times are part of the stored facts, so a change to them measures again.
- A canvas whose area is within 25% of the measured one, either way. A larger canvas has more pixels to fill, and a smaller one may hold a heavier preset.
- A check from the last 7 days. Browsers and drivers update every few weeks, and Safari clears a site's script storage after 7 days of use without a visit to it anyway.
- No crash: a start after a crashed start measures again, and does not store.

The engine stores a result only when it measured against the highest target, 60 frames per second, or the `?fps=` cap. A display that saves power with a lower refresh rate gives an easier target. Its result could keep a preset too heavy for a normal day. A result measured against the highest target is safe to take at any lower target. The page's `targetFps` setting ([D-124](D-124-target-frame-rate.md)) is one of the conditions. The engine stores a result whose target reaches 60, or the setting's rate when that is lower.

A start that takes a stored result runs the stored preset from its setup on. Its settings fixed at the start keep the values of the preset that the check started from, as they do after the check's own steps. These are the shadow tiles, point light shadows and the prepass. A unit test checks that both paths give the same settings. `engine.mode.presetCheck` reports the stored result with `reused: true`. The `?check=fresh` switch measures again.

### The target under the check's own load

The examples page's production build ran on a Galaxy Tab A9 Plus: Adreno 619, a 90 Hz display, Chrome on WebGPU, through BrowserStack. It ran the check on every visit of Skyway, and stored the result of instances. The check lowered Skyway from Medium to Low, which takes about 16 s on that tablet. So each repeat visit spent those seconds again. A first visit and a repeat visit of the base commit cbdd718e4 both reported a target of 45 frames per second. Medium read 1.2 frames per second presented and 0 completed, and Low read 1.7 and 1.7. The page then stored nothing, as the rule above says for a target below 60.

The display runs at 90 Hz. The engine takes the display's rate from the intervals of the frame callbacks of the thread that draws. While Skyway loaded the GPU, the callbacks came every second or third refresh, and the rate read 30 to 45. During the setup it read 90. The page's own frame callbacks slowed too, but their shortest interval stayed at 11.1 ms in every half second. The check raised its target from that reading at the end of each round, and both readings were 45. Instances loads the GPU less, its reading stayed at 90, and its target was 60.

The check now starts its target at the rate that the engine read before the check's first frame. It raises the target from each round's reading as before. A display that saves power reads its slower rate before the check too. So the rule above still keeps its result out of the store. A unit test of the runner reads 90 before the check and 45 during it, and expects a target of 60. Without the change it gets 45. On the Tab A9 Plus with the change, Skyway's first visit reported a target of 60 and stored its result. The repeat visit took it: no check ran, and the setup ran at Low. Instances did the same.

### Rounds of a check that never ended

The page stored the check's result only when the check ended. With the check during play ([D-386](D-386-preset-check-during-play.md)), a viewer can leave before then. On the Tab A9 Plus, Skyway's check ended about 18 s after its first frame. So can a test tool that closes the page once the loading card has gone. The next start then measured every preset again.

Each lowering by the check now hands the page the check's rounds so far. The page stores them under the same conditions and the same target rule as a result. A start that finds them begins at the preset that they lowered to, with `checkedSettings`, as a start that takes a result does. Its own check goes on from there, from the earlier start's first preset, target and rounds. It reports the earlier rounds first, with `reused: false`, and stores the result when it ends. This keeps the rule of this record: the engine still runs the preset that the check would choose. Each round that the earlier start measured missed its target, and the check goes on below them.

The Tab A9 Plus ran Skyway with a tool that leaves each page once the loading card has gone, as the phones helper's tool does. Without the change, each of three visits started at Medium and lowered to Low at its first frame, and no visit stored anything. With it, the first visit stored the Medium round at its lowering. The second visit ran at Low from its setup, and its check measured Low alone. That check ended 2.7 s after the first frame, against about 18 s for the whole check. The third visit took the stored result and ran no check.

### The anti-aliasing mode of a lowered preset

The anti-aliasing mode does not stay with the start preset. A device fixes its mode when it starts, and the scene's targets and pipelines depend on it. A device can still move to a lighter mode while it runs. The engine does so when the check lowers the preset: `SketchQuality.lower()` gives the lower preset's mode when it is lighter. The runner then moves the canvas to that mode, on the scene color that the device started with. A start that takes a stored result computes the same setting in `checkedSettings`, so both paths draw alike.

The check lowers a tablet from Medium to Low, and Low's FXAA costs about half the GPU time of Medium's MSAA on the same scene and device. A tablet that kept the start's MSAA drew Skyway's Low preset at 47.4 frames a second with 14.36 ms of GPU, at a render scale of 0.85. With the lower preset's mode the same page draws Low with FXAA at the scale of 1: 56.9 frames a second and 6.72 ms of GPU, against 6.41 for the same preset with the governor off. So the settings that the start fixes are inherited to keep a session from changing shape under the viewer. A lowering by the check is not that case: it happens after the frames that the check measured, and before the session plays.

A sketch's own `quality.setPreset()` keeps the mode that the device started with, so a session never changes its edges while the viewer plays. Only the check's lowering takes a lighter mode, because only the check decides the preset that the session runs. A later preset keeps it too: the lowering writes the mode into the settings that every preset keeps, so `quality.settings` never names a mode that the canvas is not drawing.

The move is paid inside the check, not by the viewer. The lowering applies, the runner moves the canvas on the next frame, and the check waits for the new preset's first frame before it measures again.

### The wait after a lowering

A lowering changes the shadow map, the tile atlas and the pipelines, so the first frames after it carry that rebuild. The check draws past them before it measures again: it waits until the GPU has finished two frames at 100 ms or less, or four seconds have passed. The frames it skips are a one-time cost of the check's own lowering, not a cost that play pays: the rebuild happens once, inside the check, before the session starts. On the iPad its longest frame took about half a second, where the window read 2.1 frames a second against 59.2 for an unlowered page.

The first round waits the same way, after the first frame's pipelines are built. So the first frame's own long finish stays out of its window too ([D-392](D-392-check-fast-exit-and-governor-target.md)). A preset far below its target goes straight to Low there. A Low that far below takes the lowest quality tier, which the stored result keeps.

The wait cannot hide a cost that persists in play. A preset that runs slower than ten frames a second never meets the two-frame mark, so the four-second cap ends the wait and the next window measures the preset at its true rate.

### three.js

three.js has no preset check. Apps choose a quality level themselves, or adapt during play. React Three Fiber's drei has `PerformanceMonitor` and `AdaptiveDpr`. They lower the pixel ratio after slow frames in front of the player, as design (a) would.

## Decision

(c): store the check's result per sketch, browser and device, for a week. It keeps the check's decision exactly, shows no switch, and needs no GPU names. With the check before play, a repeat visit on the iPad showed its first view after 0.25 to 0.52 s. A first visit took 1.0 to 2.4 s. A first visit still runs the check: during play by default ([D-386](D-386-preset-check-during-play.md)), or before play, where the first view waits for it.

## Consequences

- The module `page/check-store.ts` reads and writes the stored result. The page's `createEngine` reads it after the GPU probe, and starts at its preset with `checkedSettings`. It saves each result that a check measured, and the rounds so far at each lowering. The functions `checkEnded` and `checkedPreset` tell a result from the rounds of a check that never ended, and give the preset to start at.
- In `sketch/preset-check.ts`, `checkStart` gives the check's first preset, target and rounds. It takes them from the rate that the runner read before the check's first frame, and from the rounds that `QualityStart.resume` carries. The method `CheckHost.lower` takes the rounds so far, which `SketchQuality.lower` sends to the page with the lower preset.
- `SketchQuality.lower()` gives the lower preset's anti-aliasing mode when it is lighter than the one that runs, and `SketchRunner` moves the canvas to it with `setCanvasOutput`. `checkedSettings` gives the same setting for a start that takes a stored result, so both paths draw alike. `SketchQuality.setPreset()` keeps the mode that the device started with, and a lowering writes the lighter mode into the settings that every later preset keeps.
- `PresetCheck` has `reused`. The `?check=fresh` switch measures again.
- The device runner's quality and preset check pages take `?check=fresh`, so each run measures. So do the first two loads of each scene in the warm-up time plan. Its later loads take the stored result, as a repeat visit does.
- The quality presets page and the loading screens guide describe repeat visits.
- The `startup` plan measures repeat visits, with and without `?check=fresh`. So does the warm-up time plan, whose last two loads of each scene take the stored result. The iPad's runs are 20261003-062311-startup, 20261003-062605-startup with `?check=fresh`, and 20261003-062907-warm-up-time.
