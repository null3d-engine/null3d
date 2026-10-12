# D-143: Physical sky and aerial perspective

Status: design decided by the helper of M2-EX26 on 11 October 2026, for the owner's review. The figures of cost and size follow the build. Date: 2026-10-11. Task: M2-EX26.

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

To follow the build: each table's GPU time on the Mac and on SwiftShader, on all three paths; the background per pixel against the analytic sky; the cost per preset with the sky on and off; the CPU time of the diffuse light; download sizes; and the allocation check.

## Decision

- `scene.setBackground({ atmosphere })` draws the physical sky from Hillaire's three tables.
- Aerial perspective runs per pixel in the shaders' fog step, from values of each frame.
- The sky's environment reads a panorama of the sky made when each refresh starts.
- The Low preset draws the analytic sky with matched brightness.

## Consequences

- The sky model now has two more copies: the shaders' and the core's CPU copy for the diffuse light and the frame's values. A unit test compares the CPU copy's transmittance and sky light with known values.
- The frame's uniform block grows by 96 bytes on every path.
- Every surface shader holds the haze step, so each shader build grows by 2 to 4% after Brotli, and the small sprite and line builds by 6 to 11%. The engine core grows by 2.5%, and the environment's generator by 2.2% for its panorama step. The physical sky's own shaders load on first use: 8 to 9 KB after Brotli for each GPU path.
