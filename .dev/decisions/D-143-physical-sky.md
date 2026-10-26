# D-143: Physical sky and aerial perspective

Status: design decided by the helper of M2-EX26, for the owner's review. The owner approved the demo's look. Built: the physical sky is on main (`3dce97f60`), with the day's light and exposure under "The light through the day". The figures of cost and size are under Data. The owner's review of the design is pending. Task: M2-EX26; the moon and the sunset light: M2-EX8.

Summary: `scene.setBackground({ atmosphere })` draws a physical sky of Rayleigh and Mie scattering and ozone from Hillaire's three lookup tables, as Unreal Engine and Bevy do. The same air hazes distant objects in each surface's fog step, and the sky's environment, moon, stars, clouds and day's light follow it. Low draws three.js's analytic sky instead, matched in brightness, and nothing runs or downloads while no scene uses it.

## Question

The owner asked for the demos to be "as amazing as possible" (D-142). The analytic sky is three.js's Preetham model ([D-118](D-118-sky-environment.md)). It has no ozone, no twilight past 2 degrees under the horizon, and it does not haze the scene's objects. How does the engine draw a physical sky on all three GPU paths? How do distant objects take the air's color? How does it light the scene, and what does it cost?

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
| A: an analytic fit, such as Preetham (the analytic sky) or Hosek-Wilkie | Kept as the cheap sky. No ozone, no twilight, no altitude, and no physical link to the haze on objects |
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

Over the distances of a scene, the air's density falls with height as the fog's does, and the sun's light changes little. So the shaders integrate Rayleigh and Mie along each ray exactly, with the fog's own height integral, one per kind of particle. They take the phase of each light per pixel. The core works out, once a frame, the sun's and the moon's light at the camera and the multiple scattering there, from the same model as the tables. This is exact for an air of two exponential layers, and it ignores the earth's curve. That error stays small within a few tens of kilometers.

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

The `physical-sky` timing plan ran on the Mac (Apple M5 Max, Chrome 155, 120 Hz) at a load of 3.3 ([devices](../devices.md), [run file](../tested-devices/macbook-pro-chrome/20261012-214141-physical-sky.md)). Its page draws a ground of boxes under a low sun and clouds, with the window at 1512 x 758 points and 2 pixels to a point. Each item times three.js's analytic sky (off) against the physical sky (on), with the haze on the boxes. The figures are each side's median GPU time per frame, from the page's GPU timer.

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
- The allocation check (`bun run bench:allocation --atmosphere`, also with `--atmosphere-environment`, and on WebGL2) passes: no allocation per frame in the sketch worker or the render worker.
- Download sizes are under Consequences.

## Decision

- `scene.setBackground({ atmosphere })` draws the physical sky from Hillaire's three tables.
- Aerial perspective runs per pixel in the shaders' fog step, from values of each frame.
- The sky's environment reads a panorama of the sky made when each refresh starts.
- The Low preset draws the analytic sky with matched brightness.

## Consequences

- The sky model has two more copies: the shaders' and the core's CPU copy for the diffuse light and the frame's values. A unit test compares the CPU copy's transmittance and sky light with known values.
- The frame's uniform block grows by 96 bytes on every path.
- Every surface shader holds the haze step, so each shader build grows by 2 to 4% after Brotli, and the small sprite and line builds by 6 to 11%. The engine core grows by 2.5%, and the environment's generator by 2.2% for its panorama step. The physical sky's own shaders load on first use: 8 to 9 KB after Brotli for each GPU path.

## The light through the day

`timeOfDay(hour, { model: 'physical' })` gives the main light, the ambient light, the fog and the exposure that match the physical sky. The analytic model follows D-118's rules, and its moon keeps D-118's floor of 25 degrees.

### Exposure

- The exposure follows `ratio ** PHYSICAL_ADAPTATION`, at most `PHYSICAL_EXPOSURE_LIMIT`. Here `ratio` is the day sky's mean luminance over the sky's at the sun's height. `PHYSICAL_ADAPTATION` is 0.6, and the limit is 4. The exposure has no floor.
- The sky's mean luminance is continuous across the horizon, and its interpolation blends in log space between the table's rows. It falls about 9-fold from 15 degrees down to the horizon. By 6 degrees under it, it has fallen about 700-fold.
- The day's exposure is about 0.55, which brings the physical day's brightness to the analytic model's. The day's ambient luminance times its exposure is 0.66 at noon, against the analytic model's 0.64, and 0.62 at 10:00, against 0.68.
- The exposure follows the sun alone. It moves from the dusk's to the night's `NIGHT_EXPOSURE` of 1.1 as the sun sinks from 6 to 14 degrees under the horizon (`NIGHT_EXPOSURE_DEPTH`). It then holds at 1.1 until dawn.

### The moon is brightest at midnight

- The physical moon stands opposite the sun and rises from the horizon: its height is `Math.max(-elevation, 0)`, and the physical sky shows that moon. It is highest at midnight and on the horizon at dusk and dawn.
- The moon's light, its sky's light, and its share of the ambient light and the fog fall with its height (`moonShareAt`). The share is the sine of its height over the sine of 60 degrees, raised to the power 0.35, and at most 1. The fall is gentle near midnight and quickens near the horizon, where moonlight crosses the most air.
- The physical moon's light is `PHYSICAL_MOON = 0.3`, a little below the analytic model's 0.4.

### The main light goes out with the sun's disc

- The sun's light goes out as its disc sets: full on the horizon, gone 1 degree under it (`SUN_SET`). Once the disc is down, the glowing sky lights the scene through the ambient light and the sky's environment.
- The moon's light begins once the sun is 5 degrees down, and is complete by 18 degrees (`MOON_LIGHT = [-5, -18]`). So the moon never lights the scene while the sun stands up, and blue hour is the sun 5 degrees down, lit by the sky alone.
- Between the two, the light gives none, and only then does its direction turn from the sun's place to the moon's. Whenever the light is on, it comes from the sun's place, held 1 degree up as the sun sets, or from the moon's.
- The total light that a flat surface takes holds at 0.70 through the turn, against 0.68 at sunset. Walls that face the sunset lose their red light within four minutes of sunset, as they do outdoors.

### Ambient light and fog through the twilight

- The ambient light and the fog cross-fade between the sun's sky and the moon's night sky, with the same hand-over as the main light, so the twilight's fill never goes out.
- The sun's sky mean is held at a sun height of 5 degrees (`SUN_SKY_HOLD`), and the moon's sky at a moon height of 40 degrees (`MOON_SKY_FLOOR`). Either sky alone collapses at the crossing: the sun's sky mean falls to 0.001 at 6 degrees down. Held this way, a main light that goes out does not darken the scene.
- The moon's sky, times the exposure, falls from 0.13 at midnight to 0.09 at 05:00, and holds there until the sun's sky takes over. So the sky never goes dark before dawn, and the moon on the horizon shows a fifth of the glow that a full-strength moon would.

### Rejected options

- **A near-full adaptation, such as 0.85 with a limit of 200.** At the darkest dusk it drives the exposure to its limit, and surfaces wash out.
- **An exposure of at least 1.** The physical sky's ambient light is about 1.9 times the analytic model's at noon, so the day looks flat.
- **An exposure that follows the moon's height.** It rises as the moon sinks toward dawn, to 3.4 at 05:00 against 1.1 at midnight. The scene brightens as the moon sets, and the low moon's disc and glow read as a sun's.
- **A moon held 25 degrees up, as the analytic model holds it.** It already stands there at sunset, so a hand-over to it swings the light 25 degrees and flips the shadows.
- **A main light kept on through the hand-over.** For an hour after sunset it grazes the scene from bearings where neither the sun nor the moon stands. When its bearing crosses Creek's stream, the water's ripples catch it as a red glint path, and the slope that faces it lights up. A grazing light gives a flat surface almost nothing, so turning it off costs no light.

### The curve

`Total light` is the key plus the ambient, each times the exposure, for a flat surface: `max(0, -direction.y) * intensity * exposure + luminance(ambient.color) * ambient.intensity * exposure`.

| Hour | Light height | Light intensity | Exposure | Sun height | Total light |
| --- | --- | --- | --- | --- | --- |
| 0 | 60.0 | 0.300 | 1.10 | -60.0 | 0.330 |
| 3 | 37.8 | 0.266 | 1.10 | -37.8 | 0.209 |
| 4.5 | 19.4 | 0.214 | 1.10 | -19.4 | 0.102 |
| 5.3 | 9.1 | 0.039 | 2.61 | -9.1 | 0.377 |
| 6 | 1.0 | 0.234 | 3.78 | 0.0 | 0.679 |
| 8 | 25.7 | 3.124 | 0.79 | 25.7 | 1.580 |
| 10 | 48.6 | 3.315 | 0.60 | 48.6 | 2.108 |
| 12 | 60.0 | 3.360 | 0.55 | 60.0 | 2.253 |
| 15 | 37.8 | 3.262 | 0.66 | 37.8 | 1.895 |
| 17 | 13.0 | 2.754 | 1.08 | 13.0 | 1.086 |
| 17.6, golden hour | 5.2 | 1.976 | 1.70 | 5.2 | 0.613 |
| 18, the horizon | 1.0 | 0.234 | 3.78 | 0.0 | 0.679 |
| 18.4, blue hour | 5.2 | 0.000 | 4.00 | -5.2 | 0.702 |
| 19 | 13.0 | 0.124 | 1.17 | -13.0 | 0.116 |
| 21 | 37.8 | 0.266 | 1.10 | -37.8 | 0.209 |
| 23, night | 56.8 | 0.296 | 1.10 | -56.8 | 0.314 |

How the figures were produced: `timeOfDay(hour, { model: 'physical' })` from `packages/engine/src/scene/time-of-day.ts` at `e7df2a293`, with the total light worked out as above and Rec. 709 luminance.

- The total light falls from 2.25 at noon to 1.09 at 17:00 and 0.68 at the crossing. The night is brightest at midnight. From midnight it fades without a step to its least light at about 04:30, under a third of midnight's. The dawn's light then rises. The evening is the same curve in reverse.
- Over the whole day the exposure stays within 0.55 to 4, and no 0.1-hour step changes it by more than 1.5 times. Between 0.05-hour samples the total light changes by less than 1.25 times.
- The showcase moods Dawn (06:12) and Dusk (18:24) lie before the moon's part of the night.
- Unit tests in `time-of-day.test.ts` hold the exposure's band and step, and the continuity of the sky's mean light across the horizon. They hold that the light comes only from the sun's or the moon's place while it is on, that its direction moves with no step while it gives light, and that it never shines up from under the ground. They hold that the light is out at blue hour and that the moon takes no part while the sun stands up. They hold that the scene is brightest at midnight, falls without rising from midnight to 04:30, and keeps a quarter of midnight's light. They hold that the moon's light dims as it sinks while the exposure holds at 1.1.

## Fog follows the mean sky light

The fog takes the sky's mean light at every hour, and the exposure follows the same mean. The sky's light along the horizon is its brightest band, and at a low sun that band keeps the sunset's glow after the sun has gone. A fog of the horizon's light would reach an exposed luminance of 0.48 at blue hour, against 0.22 at golden hour. It would grow brighter as the sun sets and lay a warm haze over Creek and Night town, with only the fireflies reading. The analytic model's fog takes the sky's mean too.

- A unit test holds that the fog's red never exceeds 1.1 times its blue at any hour, which is the mean of a clear sky. The smoothness test holds the values between hours.
- Measured fog colors, red over blue: dawn 1.03, morning 0.75, midday 0.76, afternoon 0.75, golden hour 1.02, blue hour 1.03, night 0.52.
- The showcase scenes thin their own haze at golden hour: Creek's factor is 1.2, and Night town's is 0.7. `examples.md` records the pictures and the figures.

Without the veil, Creek at Dusk is dark. The sun is below the horizon, its main light is out, and the sky's environment is nearly out. The scene's fine detail survives: the spread that a one-pixel blur leaves out is 1.3 of 255 in the near band. A higher exposure, of 1.6 and 2.2 times, was rejected: it brightens the fog with the scene and adds no detail, so the exposure band stays as it is. A scene that faces the sunset, as the dawn side of Creek's route does, keeps a lit valley.
