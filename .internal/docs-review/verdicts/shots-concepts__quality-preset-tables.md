# Shot and demo-link verdicts: concepts/quality-preset-tables

Generated page. Source: tools/lib/docs.ts (preset tables from packages/engine/src/quality/presets.ts).

## Shots

### presets-side-by-side: keep, with a corrected source

The picture helps. The settings table has about 50 rows, and four tiles show at a glance how much the look changes between presets.

The island is the wrong scene. Its sketch (examples/showcase/island/sketch.ts) overrides the presets on every preset:
- It keeps the physical sky on Low. The table says Low draws the analytic sky.
- It turns screen-space bounce light off on every preset.
- It pins the render scale at 1 and sets anisotropy to 16x on every preset.
- It turns the governor off on High and Ultra.
- It starts with moment transparency on (demos.ts). The table says no preset turns it on.

So the Low tile would show settings that contradict the table above it.

Corrected source: scripted, Skyway (examples/showcase/skyway/), which keeps the stock preset settings unless a test switch asks otherwise. Steps: on a WebGPU browser (Ultra needs WebGPU), load `examples/?demo=skyway&hold=1&preset=low`, then the same address with `medium`, `high` and `ultra`; capture each held frame. Skyway's hold time is 1 second. The caption must say that the scene also draws fewer facades and less traffic on the lighter presets.

### stats-overlay-preset: keep, with a corrected source and place

The overlay's heading shows the GPU path, the preset and the render scale (packages/engine/src/debug/overlay.ts). Its open card shows the frame rate against the target.

Problems with the proposal:
- Place. One capture shows the preset that one machine got. It does not show the device rule (phone, tablet, desktop), so it does not fit under "Starting preset of each device". It fits under "Rules of the preset check": the target frame rate and the preset that the check kept.
- Steps. The overlay is collapsed by default (examples/lib/run.ts), and a held frame never shows it, so "capture it over the first view" in hold mode gives no overlay.
- Scene. The island pins the render scale at 1, so the scale figure never moves and does not reflect the preset.

Corrected source: scripted, Skyway (examples/showcase/skyway/), live mode. Steps: load `examples/?demo=skyway&check=fresh&stats=open` (click the overlay's header if it stays collapsed); wait until the preset in the heading stops changing; capture the top-right corner with the open card.

## Demo links

### showcase/island/ for "Each preset's settings on a real scene": reject as worded

The code exists in examples/demos.ts. But the island changes many preset settings on every preset (see above), so a reader who opens its code sees settings that differ from the table. Use `showcase/skyway/` instead: it keeps the stock settings and fits its own content to the preset.

## Concepts said to have no demo

- Device rules for the starting preset: confirmed. No demo shows them. The comparisons sort devices with the same pointer and screen-size test (examples/lib/ramp.ts), but only to cap their pixel ratio and their ramp, not to pick a preset.
- GPU path caps: confirmed. No demo forces a GPU path to show Medium as the highest preset.
- Preset check rules: confirmed. No demo is about the check. The stats overlay shot above, with `check=fresh`, is the nearest view.
