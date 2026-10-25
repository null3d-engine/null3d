# D-260: A sky layer's colour takes the scene's exposure and the background's intensity

Status: decided on 25 October 2026, for the owner's review. Built: the layer's exposure and the
background's intensity in the box template, the WebGL2 capture's texture unit, and the
`sky-layer-exposure` page with its test. Date: 2026-10-25. Task: M3-R24.

Summary: The ground plane reflects every map, so the fault that the aurora demo showed was never in
the plane: a sky layer's colour was the one sky colour that the scene's exposure did not reach, so
the sky drew the aurora and the lake reflected it at two different brightnesses. The layer's box
template now scales its colour by the scene's exposure and the background's intensity, as the sky
around it does, and a browser test holds the sky and the lake together at two exposures.

## Question

Does a ground plane take the light of the sky's environment map, and if the aurora demo's lake shows
none of the aurora, where does it lose it?

## Rule

A surface must show what the map holds: a mirror plane under a map of the sky reads that map's own
colour, whatever sky the map was made from. A sky layer is a scene colour, so the pass that draws it
applies the scene's exposure and the background's intensity, as the sky around it does
(`docs/api/scene.md`, the `SkyLayer.color` row). The fix needs a test that fails before it and passes
after it, on WebGPU, compatibility mode and WebGL2.

## Data

The probe page draws a mirror plane at `y = 0` under a sky, a 55-degree camera 2.4 units above it
looking down the lake, and reads 5 by 5 pixel means with the tone mapping off and the exposure set
per run. The aurora page is the same page with the demo's own atmosphere, its own layer and the ice
of the demo beside a mirror half.

| Measure | Value | Device and browser |
| --- | --- | --- |
| The sky's map, and the room's | `rgb9e5ufloat`, 256 texels, 6 levels, both | Read from `Environment.format`, `.size`, `.levels` |
| Mirror plane under the room's map, physical night sky around it | Lake 190 and 237 levels, sky 8 to 31 | Mac, Chrome 153, WebGPU |
| The same with a sky layer installed | Lake 190, unchanged | Mac, Chrome 153, WebGPU |
| Mirror plane under the analytic sky's map, no layer | Lake 186 and 123, sky 173 and 115 | Mac, Chrome 153, WebGPU |
| Mirror plane under the physical night sky's map, no layer | Lake 17 and 9, sky 14 and 8 | Mac, Chrome 153, WebGPU |
| The same with a flat layer, exposure 1.1 | Lake 255 green, sky 255 | Mac, Chrome 153, WebGPU |
| Sky and lake under a flat layer, exposure 0.1 | Sky 255 green, lake 99 | Mac, Chrome 153, WebGPU |
| The same, exposure 0.01 | Sky 255 green, lake 29 | Mac, Chrome 153, WebGPU |
| The aurora, under the demo's camera, fog, bloom and exposure: mirror half, ice half, sky above | 148, 80 and 198 green | Mac, Chrome 153, WebGPU |
| The demo itself, live: the ice just below the horizon, then near the camera | 25, then 4 green | Mac, Chrome 153, WebGPU |

How the data was produced: a temporary probe page, one page load for each row, on 25 October 2026,
its pixels read through `engine.captureFrame()`. The page drew the plane and the sphere of the
question under each sky and posted the environment's format and levels; it is not kept, and
`sky-layer-exposure` holds the measurements that must not change.

## Look

The demo's ice is a dielectric of 4 per cent, and the picture follows that. Under the demo's own
camera, sky, fog, bloom and exposure, with the same lake split into a mirror half and the demo's ice
half, the aurora reads 148 green on the mirror and 80 on the ice at one pixel, where the sky above
them reads 198. The demo's own picture reads 25 green just below the horizon and 4 near the camera,
which is the same surface at a steeper angle. So the lake does take the aurora, and how much of it
the ice shows is its own reflectance: the owner's dark mirror is the change that makes the lake show
the sky, and this record does not decide that look.

## Decision

The plane's fault is ruled out, one explanation at a time. Its normal and winding are right: the
plane is built facing +Z and its rotation turns that to +Y. Size and space make no difference: a
4000-unit plane reads the same as a 40-unit one. The level a mirror samples is level 0, and it reads
the map's centre faces as the sky does. The map's format is the room's format, and the room's map
reflects at full strength under the same camera and the same sky. The physical sky's map reflects
too, so the panorama path fills and its stages read it.

What the run did find is that the sky drew a layer that its own reflection did not match. The layer's
box template wrote the layer's colour into the exposed scene without the exposure: with the exposure
at a tenth, the sky stayed at 255 while the lake fell from 99 to 29. The scene's colour is exposed
colour throughout (the tone-mapping library says so), so the template was the one sky shader that
skipped it, and it skipped the background's intensity with it. The page's own readings, with the
layer's green at 1, the exposure at 0.1 and the sky's intensity at 1: the sky 88.9, 254.8, 169.3
against the lake's 25.7, 88.8, 55.6; at a tenth of the exposure the sky does not move and the lake
falls to 3.4, 25.4, 12.7; at half the background's intensity the sky does not move either and the
lake stays where it was.

The template now scales the layer's colour by the scene's exposure and by the background's intensity,
which the layer's uniform carries in its spare value. The sky and the lake then hold one colour at
any exposure, and the background's intensity dims the sky alone, as it dims the built-in sky and
leaves the map that the lake takes alone.

WebGL2 had a second fault on this path, which the page showed as E1404 before the fix ran: a map with
a layer draws its light capture with the page's own `environment.wgsl` build, and the texture units
that the layer's programs claimed were read from its `sky` program, which reads no cube. The capture
now names its own program's unit, as the engine's cube draws do.

## Consequences

`sky-layer-exposure` runs on all three GPU paths and passes on each in about six seconds: at two
exposures ten times apart it requires the lake to show the sky's value within six levels, and at half
the background's intensity it requires the sky to fall while the lake keeps the value it had. Its
first run after the fix still read the old numbers, because the dev server had served the layer's
template from before the change: a template that a page's own WGSL joins is compiled by the server,
so a change to it needs the server restarted before the next run.

Every picture of a scene with a sky layer draws the layer at the exposure from now on, which is 9 per
cent less at the aurora demo's night exposure of 1.1, so that demo's references are drawn again
after this change lands. The held branch `fix/m3-sky-layer-light` holds a set drawn before it, and
the owner's ruling on the lake's look draws them again in any case.

One fault beside this one was found and is not this record's:

- The light that a fill reads back from the map splits the nine coefficients at three words each,
  where a capture writes one texel of four words to a coefficient (`LightCapture::coefficients`).
  Rotation and scale of the diffuse light of a layer's map are wrong while that holds. The held
  branch `fix/m3-sky-layer-light` carries that fix, and this branch leaves it alone.

A scene sets the background's intensity and the environment's intensity apart, and each place that
the sky is seen follows its own setting: the background draws its layer at the background's
intensity, and the lake reflects the map at the environment's. That is two settings doing what the
API says, not a fault, and the test holds it: the lake keeps the value it had while the background's
intensity halves.
