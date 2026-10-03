# D-17: The preset check on repeat visits

Status: decided. Date: 2026-10-03. Task: M1-K5, for T-28.

## Question

When the page leaves the quality preset to the engine, the preset check measures the scene after the setup, and `createEngine` waits for it. On the 11-inch iPad Pro it takes about 1 s for each preset that it measures. How can the first frame of play come sooner without losing what the check decides?

## Rule

The engine must run the preset that the check would choose, with the same settings. The change must not show a switch of preset to the player. Hard rule 14 holds: no decision from GPU names. Among the designs that pass, take the one that saves the most time on the iPad.

## Data

### What the check costs

The check draws the first frames behind the loading screen. For each preset it measures, it draws for 250 ms, then measures for 500 ms, so each preset costs at least 0.75 s. It draws up to 2 s more while textures upload. A lower preset adds the wait for its pipelines. In practice one preset took about 0.8 s on the MacBook Pro, in [D-11](D-11-frames-in-flight.md#the-preset-checks-thresholds-m1-g3) and in the table below. On the iPad it took about 1 s.

From [D-13](D-13-shader-variants.md)'s warm-up time runs of 2 October 2026, the time from `createEngine` until the first frame was on screen:

| Device and path | Shown | The check's part |
| --- | --- | --- |
| iPad, Safari 26.6, WebGPU | 1.0 to 1.9 s | about 1 s for each preset measured; most scenes start at Medium |
| iPad, Safari 26.6, WebGL2 | 1.0 to 2.2 s | the same; loads that lowered the preset once took 1.9 to 2.2 s |
| S24+, Chrome 154, WebGL2 | 0.23 to 0.43 s | none: a phone starts at Low, which has no lighter preset |

The startup benchmark ran on the MacBook Pro M5 Max, WebGPU, on 3 October 2026. Chrome ran `bun run bench:startup --loads warm`. Safari ran the device runner's `startup` plan. "Ready" is when `createEngine` resolved, and "Frame done" when the GPU finished the first frame. Both measure from navigation start. The page's loading screen waits for the later of the two. Each figure is the median of 5 loads. A warm load repeats the address and the storage of an earlier load, as a repeat visit does. With `?check=fresh`, the engine measures again, as on a first visit.

| Browser and thread mode | Ready, stored result | Ready, `?check=fresh` | Frame done, both |
| --- | --- | --- | --- |
| Chrome 154, pipelined | 52 ms | 866 ms | 85 to 86 ms |
| Safari 26.6.2, pipelined | 28 ms | 831 ms | 63 to 64 ms |
| Safari 26.6.2, the other four thread modes | 28 to 30 ms | 826 to 837 ms | 48 to 65 ms |

So a repeat visit on the Mac shows its first view about 0.8 s sooner, in both browsers. The first frame itself does not move: the check runs after it. Safari's cold loads, which start with empty storage, still checked: Ready at 827 to 850 ms.

The same `startup` plan on the 11-inch iPad Pro, Safari 26.6.2, WebGPU, 3 October 2026. The iPad had just run 25 minutes of timing runs, so it was warm.

| Thread mode | Ready, stored result | Ready, `?check=fresh` | Frame done, both |
| --- | --- | --- | --- |
| Pipelined | 87 ms | 900 ms | 119 ms |
| Single-threaded | 63 ms | 845 ms | 83 to 87 ms |
| The other three thread modes | 85 to 90 ms | 875 to 877 ms | 110 to 124 ms |

The cold loads checked in both runs: Ready at 876 to 902 ms.

The warm-up time plan on the iPad, the same day, starts each benchmark scene and demo at the preset that the engine chooses. Its first two loads take `?shaders=fresh` and `?check=fresh`, as a first visit. Its last two take the stored result, as a repeat visit. The time from `createEngine` until the first frame was on screen, as medians of two loads:

| Path | First visit | Repeat visit |
| --- | --- | --- |
| WebGPU | 1.00 to 1.19 s; 1.82 to 2.36 s where the check lowered Medium to Low | 0.25 to 0.32 s |
| WebGL2 | 1.00 to 1.26 s; 1.91 to 2.21 s where the check lowered Medium to Low | 0.27 to 0.36 s; the math demo 0.52 s |

On a repeat visit the first view comes 0.7 to 2.1 s sooner. What remains is the start itself: the core, the setup, the pipelines and the uploads. The math demo's WebGL2 pipeline wait stayed at 275 to 288 ms on both visits.

### The designs

(a) Draw at once and check during play. `createEngine` resolves after the setup, and the check runs while the sketch plays. Rejected:

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

The engine stores a result only when it measured against the highest target, 60 frames per second, or the `?fps=` cap. A display that saves power with a lower refresh rate gives an easier target. Its result could keep a preset too heavy for a normal day. A result measured against the highest target is safe to take at any lower target.

A start that takes a stored result runs the stored preset from its setup on. Its settings fixed at the start keep the values of the preset that the check started from, as they do after the check's own steps. These are anti-aliasing, the shadow tiles, point light shadows and the prepass. A unit test checks that both paths give the same settings. `engine.mode.presetCheck` reports the stored result with `reused: true`. The `?check=fresh` switch measures again.

### three.js

three.js has no preset check. Apps choose a quality level themselves, or adapt during play. React Three Fiber's drei has `PerformanceMonitor` and `AdaptiveDpr`. They lower the pixel ratio after slow frames in front of the player, as design (a) would.

## Decision

(c): store the check's result per sketch, browser and device, for a week. It keeps the check's decision exactly, shows no switch, and needs no GPU names. A repeat visit on the iPad showed its first view after 0.25 to 0.52 s, against 1.0 to 2.4 s on a first visit. The first visit still waits for the check.

## Consequences

- `page/check-store.ts` reads and writes the stored result. `createEngine` reads it after the GPU probe, and starts at its preset with `checkedSettings`. It saves each result that a check measured.
- `PresetCheck` has `reused`. The `?check=fresh` switch measures again.
- The device runner's quality and preset check pages take `?check=fresh`, so each run measures. So do the first two loads of each scene in the warm-up time plan. Its later loads take the stored result, as a repeat visit does.
- The quality presets page and the loading screens guide describe repeat visits.
- The `startup` plan measures repeat visits, with and without `?check=fresh`. So does the warm-up time plan, whose last two loads of each scene take the stored result. The iPad runs of 3 October 2026 were 20261003-062311-startup, 20261003-062605-startup with `?check=fresh`, and 20261003-062907-warm-up-time.
- The record is in the table in README.md.
