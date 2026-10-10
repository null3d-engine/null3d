# D-124: The target frame rate on fast displays, in the stats overlay and as an option

Status: decided, 2026-10-10 (the owner). Date: 2026-10-10. Task: M2-EX2.

Summary: The engine keeps its target at the display's refresh rate, at most 60 frames per second, and still draws at the display's full rate. The stats overlay now shows the display's rate beside the target, with symbols, and a faint mark at the display's interval on each work bar. A page can defend the full rate with `createEngine({ targetFps: 'display' })`, or cap the target at a number. The `?target-fps=` switch wins over the option, and stored preset checks never cross targets.

## Question

On the owner's Mac, with its 120 Hz display, the stats overlay's header showed `120 fps` while its card read `Target 60 fps · 16.7 ms`. The owner asked why. The engine draws at the display's rate, but the preset check and the quality governor defend only 60 ([D-11](D-11-frames-in-flight.md#the-preset-checks-thresholds-m1-g3) set the 60). How should the overlay show the two rates, and should a page be able to defend more than 60?

## Rule

- The card stays short: the owner asked for symbols, not words. The full explanation goes into a tooltip.
- The default stays as D-11 set it. A preset that holds 60 plays smoothly on a faster display, and a higher target would push 120 Hz tablets and laptops to lighter presets.
- A page that wants the full rate, such as a game on a 120 or 144 Hz display, asks for it in one place. The preset check, the governor and the overlay all follow it.
- A stored preset check applies only to a start that defends the same target ([D-17](D-17-stored-preset-check.md)).
- The overlay's code stays in its own file that loads on first use, out of the start ([D-14](D-14-js-budget.md)).

## Data

The owner's report, 10 October 2026, from the Mac's 120 Hz display with the overlay open: the header read 120 fps, and the card read `Target 60 fps · 16.7 ms`. Every work bar's mark sat at 16.7 ms. [D-116](D-116-stats-overlay-figures.md#cost-and-size) records the same pages holding 120 frames a second in every run on that Mac.


## Options

1. **Show the display's rate in the header pill.** Rejected: the pill shows what the page gets now, and the ring compares it with the target. A second rate there would crowd the one place that must read at a glance.
2. **Show both rates in the card, in words** (`Display 120 Hz · target 60 fps`). The owner ruled it too long.
3. **Show both rates in the card with symbols, and the words in a tooltip.** Chosen.
4. **Raise the default target to the display's rate.** Rejected, as D-11 found: the iPad keeps a preset that holds 60 but not 120. A 120 Hz Mac would drop presets that play smoothly.
5. **An option on the sketch** (`defineSketch(setup, { targetFps })`). Rejected: the page decides whether a stored check applies before the sketch module loads, and the overlay runs on the page. Only a page option reaches every part in time.

## Decision

The owner's ruling, 10 October 2026: "yes make changes 1 and 2 to the overlay, but less verbose - use symbols. also do the opt-in setting for fps".

### The card's figures

- A display symbol follows the thread mode's symbol. It is a button with a tooltip, built as the mode's symbol is: hover or keyboard focus shows it, and a tap toggles it.
- Where the display refreshes faster than the target, the display's rate follows in a muted color, then the target as a floor: `120 Hz ≥60 fps · 16.7 ms`.
- Where the target is the display's rate, it shows once: `60 fps · 16.7 ms` on a 60 Hz display, or `120 fps · 8.3 ms` with the opt-in on a 120 Hz display. Before the display's rate is measured, the target shows alone.
- The tooltip gives the words. It names the display's rate, which the engine draws up to, and the rate that the engine defends. It says what each mark is, and that the `targetFps` option raises the target.

### The second mark

Each work bar keeps its dark mark at the target's interval, in its middle. Where the display refreshes faster than the target, a faint mark (30% opacity) shows the display's interval. A bar spans twice the target's interval. So the faint mark sits at the target over twice the display's rate: a quarter of the bar at 60 fps on 120 Hz. The tooltip explains both marks; the key stays as it was.

### The option

- `createEngine({ targetFps })` takes `'display'` or a whole number from 1 up. Without it the target is the display's rate, at most 60. `'display'` lifts the cap. A number caps the target at that rate. Another value fails with E1213. The type `TargetFps` is public.
- The `?target-fps=display` or `?target-fps=<n>` switch wins over the option, as `?preset=` does. A value that the option would refuse counts as no switch.
- The target is never above the display's rate, and the `?fps=` cap still holds it down. The engine draws at the display's rate in every case: the option changes what the engine defends, not how fast it draws.
- One rule computes the target everywhere (`checkTargetFps` in `quality/check.ts`). The page turns the setting and the `?fps=` cap into the highest target (`maxTargetFps`). It sends that number to the preset check, the governor and the overlay. `'display'` is infinity there.
- Before the display's rate is measured, the target is 60, or the highest target when that is lower. The preset check raises its target once the meter reads, as it did before.

### Stored preset checks

- The highest target is one of the stored check's conditions, beside the `?fps=` cap. A result measured under one target setting never applies under another.
- The engine stores a result measured against at least the target that a check starts from: 60, or the highest target when that is lower. Under the default this is the rule of D-17. Under `'display'`, a check at 120 Hz stores its result, and a check on a display that saves power at 30 Hz does not. A result from a 60 Hz display can apply later at 120 Hz on the same device, if the browser reports the same screen. The governor then lowers the render scale as it would for any heavy scene.

## Consequences

- `quality/check.ts`: `TargetFps`, `maxTargetFps`, and `checkTargetFps(refreshHz, highest)`. `quality/presets.ts`: `targetFpsOption` checks the option.
- The governor loop takes the highest target in place of the `?fps=` rate. The sketch runner, the protocol and the sketch worker carry `maxTargetFps` in place of `fps`.
- `page/check-store.ts` adds the highest target to the conditions and saves by the rule above.
- The overlay reads the highest target in place of the `?fps=` cap. `debug/overlay-look.ts` has a `Note` class that both symbols use. It also has the target's figures (`display`, `target`, `target-note`) and the faint marks. `debug/frame-target.ts` keeps the color rules only.
- Unit tests cover the target rule, the option, the switch, the governor with the opt-in, the stored checks across targets and the tooltip's words. The stats browser test checks the display's rate, the floor sign, the faint marks and the tooltip with `?target-fps=30`, and the single figure with `?target-fps=display`.
- `docs/concepts/quality-presets.md` gains "The target frame rate". `docs/api/engine.md`, `docs/api/quality.md`, `docs/api/debug.md`, the testing and loading screen guides and the generated preset rules describe the option, the switch and the card. The develop skill's quick reference, performance and testing references name them.
- D-11's open question on 120 Hz displays, the overlay's target rule in [D-116](D-116-stats-overlay-figures.md#the-rules) and D-17's storage rule point here.
