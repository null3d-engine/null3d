# D-143: Physical sky and aerial perspective

Status: design decided by the helper of M2-EX26 on 11 October 2026, for the owner's review. The owner approved the demo's look on 13 October 2026. Its exposure band was fixed on 14 October 2026 (addendum). The figures of cost and size are under Data. Date: 2026-10-11. Task: M2-EX26.

Summary: `scene.setBackground({ atmosphere })` draws a physically based sky: Rayleigh and Mie scattering and ozone, from Hillaire's three lookup tables (2020), as Unreal Engine and Bevy draw theirs. The same air hazes distant objects by distance and by the sun's angle, inside each surface's shader, as fog does. The sky's environment, the moon, the stars and the clouds follow it. The Low preset draws three.js's analytic sky in its place, matched in brightness. Nothing runs or downloads while no scene uses it.

## Question

The owner asked on 11 October 2026 for the demos to be "as amazing as possible" (D-142). The sky is three.js's Preetham model ([D-118](D-118-sky-environment.md)). It has no ozone, no twilight past 2 degrees under the horizon, and it does not haze the scene's objects. How does the engine draw a physical sky on all three GPU paths? How do distant objects take the air's color? How does it light the scene, and what does it cost?

## Rule

- The best technique by default ([D-52](D-52-intent-parity.md)). The analytic sky stays, for ports of three.js's `Sky` and for phones.
- One look on WebGPU, compatibility mode and WebGL2, with image references on the Mac's GPU and on SwiftShader.
- Tables drawn again only when what they hold changes. No pass, no texture and no shader download while no scene draws the physical sky ([AGENTS.md](../../AGENTS.md#design-principles), principle 8).
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- It fits the sky's environment (D-118), the scene fog and the lit fog (D-133).

## Options

### The sky

| Option | Verdict |
| --- | --- |
| A: an analytic fit, such as Preetham (now) or Hosek-Wilkie | Kept as the cheap sky. No ozone, no twilight, no altitude, and no physical link to the haze on objects |
| B: Bruneton's precomputed tables (2008), 4D scattering in a 3D texture | Rejected. Its tables are large, and its precompute is long: seconds on a phone. three.js's community atmosphere uses it, for scenes seen from space |
| C: a march along each pixel's ray | Rejected. 30 or more steps of the air per pixel cost too much at full resolution, and more on phones |
| D: Hillaire's tables (2020): transmittance, multiple scattering and a sky view | Chosen. Unreal Engine and Bevy use it. The tables are small and quick to draw, and a pixel of the sky reads one texel |

How option D works here:

- **Transmittance**, 256 x 64 texels: the share of light that passes from a height to the top of the air, for each angle, after Bruneton's mapping. 40 steps a texel. Drawn when the air changes.
- **Multiple scattering**, 32 x 32 texels: the light that scatters more than once, as Hillaire's isotropic sum gives it, for each height and sun angle. 64 directions of 20 steps a texel. Drawn when the air changes.
- **Sky view**, 256 x 128 texels: the light of the whole sky seen from the camera's height, single scattering plus the table above. Its rows crowd near the horizon, as Hillaire's do. Its columns run around the whole sky, not from the sun, so the sun and the moon add their light in the same march. Drawn when the sun, the moon, the air or the camera's height changes.
- **The background** reads the sky view in each pixel's direction. It adds the sun's disc through the transmittance, the moon, the stars and the clouds.

Each table is one triangle over a small 16-bit float target, which every GPU path draws. WebGL2 needs `EXT_color_buffer_float` for that, as bloom does. The engine core records the tables as it records bloom's steps, so the three paths share one plan.

### Aerial perspective

| Option | Verdict |
| --- | --- |
| A: Hillaire's volume of 32 x 32 x 32 cells over the view, read by each surface | Rejected. Every mesh shader would bind one more texture, on every GPU path, beside the frame's group. A step that applies it after the opaque pass misses the transparent pass and the 8-bit path |
| B: a pass after the opaque objects that reads the depth | Rejected for the same reasons, and for its cost in bandwidth on phones |
| C: work it out per pixel in the shaders' fog step, from a few values of each frame | Chosen |

Over the distances of a scene, the air's density falls with height as the fog's does, and the sun's light changes little. So the shaders integrate Rayleigh and Mie along each ray exactly, with the fog's own height integral, one per kind of particle. They take the phase of each light per pixel. The core works out, once a frame, the sun's and the moon's light at the camera and the multiple scattering there, from the same model as the tables. This is exact for an air of two exponential layers, and it ignores the earth's curve. That error stays small within a few tens of kilometres.

The step runs before the scene fog, so fog still lies over a hazed scene. The lit fog (D-133) applies after the opaque pass, over both. The values grow the frame's uniform block by 96 bytes. Without a physical sky, the shaders skip the step on one value of the frame, as they skip fog.

`metersPerUnit` sets the scale of the scene, and `aerialPerspective` scales the haze: 0 turns it off, and more than 1 makes a small scene look large, as Unreal's distance scale does.

### Light from the sky

The sky's environment (D-118) shows whichever sky the background draws. For the physical sky:

- When a refresh of the map starts, the core draws the sky with its clouds into a panorama of 512 x 256 texels. The map's stages read that panorama, so all its faces show one sky while the sun moves. Its stages are the same 20 stages.
- The diffuse light comes from the CPU, as for the analytic sky, from a small copy of the model with coarse tables.

### Night

The moon is a second light of the air, as in the analytic sky's second sky (D-118). `moonIntensity` sets its light, and the sky adds what both lights scatter. `timeOfDay` fades it in between 6 and 12 degrees under the horizon, as D-118's cross-fade does. The physical sky keeps its own twilight below the horizon, so the fade needs no table of dusk light.

The background draws the moon's disc lit from the sun's side, so it shows its phase. Stars come from a hash of the direction, faded by the air toward the horizon. They add their light to the sky's, so they show only where the sky is dark enough.

### Phones

The coordinator asked that the Low preset keep the analytic sky. The quality setting `physicalSky` is off on Low. There, a physical sky's settings draw the analytic sky: the same sun, moon, air and clouds. The core matches its brightness to the physical sky's mean light, from both CPU models, so the scene's exposure fits either sky. The aerial perspective stays on, since it costs what fog costs.

## Data

The `physical-sky` timing plan ran on the Mac (Apple M5 Max, Chrome 155, 120 Hz) on 13 October 2026, at a load of 3.3 ([devices](../devices.md)). Its page draws a ground of boxes under a low sun and clouds, with the window at 1512 x 758 points and 2 pixels to a point. Each item times three.js's analytic sky (off) against the physical sky (on), with the haze on the boxes. The figures are each side's median GPU time per frame, from the page's GPU timer.

| Item | Analytic sky (ms) | Physical sky (ms) | Difference (ms) |
| --- | --- | --- | --- |
| WebGPU, scale 1, sun still | 1.97 | 1.44 | -0.52 |
| WebGPU, scale 1, sun moving | 1.97 | 2.16 | +0.20 |
| WebGPU, scale 0.5, sun still | 1.77 | 1.77 | 0.00 |
| WebGPU, scale 0.5, sun moving | 1.77 | 1.97 | +0.20 |
| WebGL2, scale 1, sun still | 3.32 | 3.26 | -0.06 |
| WebGL2, scale 1, sun moving | 3.25 | 3.29 | +0.04 |
| WebGL2, scale 0.5, sun still | 2.79 | 2.78 | -0.00 |
| WebGL2, scale 0.5, sun moving | 2.78 | 3.18 | +0.41 |

- With the sun still, the physical sky costs what the analytic sky costs, within the timer's noise of about half a millisecond. The sky view table is not drawn again, and the background reads it once per pixel.
- With the sun moving in every frame, the sky view table is drawn in every frame. That costs 0.04 to 0.41 ms per frame. The transmittance and multiple scattering tables are drawn only when the air's settings change, so a moving sun never draws them.
- Every item held the display's 120 Hz, so no frame was late on either side.
- The CPU time per frame of both workers stayed at 0.07 to 0.21 ms on both sides. The diffuse light from the CPU's copy of the model adds no time that the page can measure, even with the sun moving.
- The page's timer measures whole frames, so the plan gives no GPU time for each table alone. SwiftShader's times say nothing about a real GPU, so the plan runs on the Mac's GPU only.
- The Low preset draws the analytic sky, so its cost does not change. Medium, High and Ultra draw the physical sky at the costs above.
- The allocation check (`bun run bench:allocation --atmosphere`, also with `--atmosphere-environment`, and on WebGL2) passed on 12 October 2026: no allocation per frame in the sketch worker or the render worker.
- Download sizes are under Consequences.

## Decision

- `scene.setBackground({ atmosphere })` draws the physical sky from Hillaire's three tables.
- Aerial perspective runs per pixel in the shaders' fog step, from values of each frame.
- The sky's environment reads a panorama of the sky made when each refresh starts.
- The Low preset draws the analytic sky with matched brightness.

## Consequences

- The sky model now has two more copies: the shaders' and the core's CPU copy for the diffuse light and the frame's values. A unit test compares the CPU copy's transmittance and sky light with known values.
- The frame's uniform block grows by 96 bytes on every path.
- Every surface shader holds the haze step, so each shader build grows by 2 to 4% after Brotli, and the small sprite and line builds by 6 to 11%. The engine core grows by 2.5%, and the environment's generator by 2.2% for its panorama step. The physical sky's own shaders load on first use: 8 to 9 KB after Brotli for each GPU path.

## Addendum: the physical exposure's band and the sun-to-moon hand-over

Status: fixed on 14 October 2026, for the owner's review. Date: 2026-10-14. Task: none.

The owner hit a fault in the showcase scenes on 14 October 2026. Surfaces washed out at some times of day, and one moment was far too bright. The physical model's exposure rose to its limit of 200 just above the horizon, and its main light fell to zero there.

### The cause

The exposure followed `ratio ** PHYSICAL_ADAPTATION`, clamped to `PHYSICAL_EXPOSURE_LIMIT = 200`. Here `ratio` is the day sky's mean luminance over the sky's at the sun's height. That mean is continuous across the horizon. It falls about 9-fold from 15 degrees down to the horizon. By 6 degrees under it, it has fallen about 700-fold. The interpolation blends in log space between the table's rows. With a nearly full adaptation, 0.85, the exposure reached the 200 limit at the darkest dusk. The moon's main light was `nightfall ** 3`, which is zero until 6 degrees under the horizon. So the sun's light went out at the horizon, and nothing lit the scene from 0 to 6 degrees down.

| Hour | Exposure before | Exposure after | Main light before | Main light after |
| --- | --- | --- | --- | --- |
| 15 | 1 | 1 | 3.26 | 3.26 |
| 17.6, golden hour | 2.12 | 1.30 | 1.98 | 1.98 |
| 18.0, the horizon | 6.58 | 1.94 | 0 | 0.23 |
| 18.4, blue hour | 164 | 4.0 | 0 | 0.21 |
| 18.5 | 200 | 4.0 | 0 | 0.26 |
| 23, night | 3.5 | 3.5 | 0.4 | 0.4 |

### The fix

- `PHYSICAL_EXPOSURE_LIMIT` falls from 200 to 4, and `PHYSICAL_ADAPTATION` from 0.85 to 0.3. The sun on the horizon then gives an exposure of about 2, as the analytic model's `EXPOSURE` table does. The curve rises from 1 by day to 4 at the darkest dusk, then settles at 3.5 under the moon.
- The main light cross-fades from the sun to the moon between 6 degrees above and 12 degrees below the horizon (`MOON_LIGHT`). So the sun's light and the moon's overlap, and they are never both zero.
- The sky's mean luminance and its interpolation are unchanged: they were already continuous, and a unit test now holds them so.

Over 0 to 24 hours the exposure stays within 1 to 4, and no step of 0.1 hours changes it by more than 1.30 times. The main light's least intensity is 0.12, at about half a degree under the horizon. There the sun has gone and the moon has not yet risen. Before, the light was zero from 0 to 6 degrees down. Three unit tests hold the band, the step and the continuity of the sky's mean light across the horizon.

The exposure changes at golden hour and at blue hour, and in the atmosphere demo's held frame. Those image references must be made again in both sets.

The second addendum below raises the day's exposure and reworks this hand-over; its curve and its figures replace the ones here.

## Second addendum: the main light, the ambient and the day's exposure

Status: fixed on 14 October 2026, for the owner's review. Date: 2026-10-14. Task: none.

The owner found the first fix wrong in the showcase. Dusk and Night looked swapped, the day looked washed out, and the ambient went out at dusk. Dusk then read as the darkest moment of the day.

### The cause

- The moon stood at `Math.max(-elevation, MOON_FLOOR)`, and the floor of 25 degrees lifted it whenever the sun was less than 25 degrees below the horizon. At the horizon it already stood 25 degrees up, opposite the sun, so the hand-over swung the light 25 degrees and flipped the shadows. With the sky still the sunset's, that read as night.
- The moon's light began at a sun height of +6 degrees (`MOON_LIGHT = [-6, 12]`), while the sun was still warm.
- The ambient light added the sun's sky mean and the moon's, and the moon's was gated by `nightfall`. The sun's sky mean collapses below the horizon, so the ambient fell to 0.001 at 6 degrees down: a hole at dusk. The night, lit as by day from the moon, then had more light than the dusk.
- The exposure was held to at least 1, so the day never adapted below 1. The physical sky's ambient is about 1.9 times the analytic model's at noon, so the day looked flat.

### The fix

- The main light cross-fades its direction, its colour and its intensity between the sun and the moon. The direction sweeps about the horizon from the sun's bearing to the moon's, and its height passes between them, so nothing jumps.
- The physical model's own moon rises from the horizon: its height is `Math.max(-elevation, 0)`, and the physical sky shows that moon. The analytic model and its sky keep D-118's floor of 25 degrees, so its night look and its references do not change.
- The moon's light begins once the sun is 5 degrees down, and is complete by 18 degrees (`MOON_LIGHT = [-5, -18]`). The sun's own light fades over the same twilight (`SUN_TWILIGHT = [0, -18]`), so the light never falls to zero. Blue hour is then the sun 5 degrees down, as its name gives, and not the moon.
- The ambient light and the fog cross-fade between the sun's sky and the moon's night sky. They use the same hand-over, so the twilight's fill never goes out. The sun's sky mean is held at a sun height of 5 degrees (`SUN_SKY_HOLD`), and the moon's sky at a moon height of 40 degrees (`MOON_SKY_FLOOR`). Either sky alone collapses at the crossing.
- `PHYSICAL_ADAPTATION` rises from 0.3 to 0.6, and the floor of 1 on the exposure goes. The day's exposure is then about 0.55, which brings the physical day's brightness to the analytic model's.
- The physical moon's light is `PHYSICAL_MOON = 0.3`, a little below the analytic model's 0.4. The exposure moves to `NIGHT_EXPOSURE = 1.1` over the moon's first `MOON_EXPOSURE_RISE = 58` degrees of height, not over the sun's hand-over. The dusk's exposure is held while the moon is low, so its missing key is not paid for with a dark moment. The night is then dimmer than the dusk.

### The corrected curve

`Total light` is the key plus the ambient, each times the exposure, for a flat surface: `max(0, -direction.y) * intensity * exposure + luminance(ambient.color) * ambient.intensity * exposure`.

| Hour | Light height | Light intensity | Exposure | Sun height | Total light |
| --- | --- | --- | --- | --- | --- |
| 6 | 0.0 | 0.234 | 3.78 | 0.0 | 0.663 |
| 8 | 25.7 | 3.124 | 0.79 | 25.7 | 1.580 |
| 10 | 48.6 | 3.315 | 0.60 | 48.6 | 2.108 |
| 12 | 60.0 | 3.360 | 0.55 | 60.0 | 2.253 |
| 15 | 37.8 | 3.262 | 0.66 | 37.8 | 1.895 |
| 17 | 13.0 | 2.754 | 1.08 | 13.0 | 1.086 |
| 17.6 | 5.2 | 1.976 | 1.70 | 5.2 | 0.613 |
| 18 | 0.0 | 0.234 | 3.78 | 0.0 | 0.663 |
| 18.4 | -5.2 | 0.187 | 3.88 | -5.2 | 0.682 |
| 19 | 4.3 | 0.244 | 3.39 | -13.0 | 0.331 |
| 20 | 25.7 | 0.300 | 2.34 | -25.7 | 0.377 |
| 23 | 56.8 | 0.300 | 1.10 | -56.8 | 0.319 |

The day's ambient luminance times its exposure is 0.66 at noon against the analytic model's 0.64, and 0.62 at 10:00 against 0.68. The total light falls from 2.25 at noon to 1.09 at 17:00 and 0.68 at the crossing. From 18:00 to midnight it runs between 0.31 and 0.38. Dusk is 0.68, the low moon at 19:00 is 0.33, the moon at 20:00 is 0.38, and the night is 0.32. No hour falls more than a tenth below the night's value. The exposure stays within 0.55 to 4, and no 0.1-hour step changes it by more than 1.5 times. Between 0.05-hour samples the total light changes by less than 1.25 times. The main light's direction changes by less than 0.24, and its intensity by less than 0.39. The moon takes no part while the sun stands up. Four unit tests hold the direction and the intensity, the moon's absence by day, the presets' heights, and the total light's continuity and order.

The night and night-8-bit `physical-sky-*` tests draw different pixels, so their references are made again in both sets. The blue-hour, golden-hour, afternoon and no-haze images stay within their tolerance.
