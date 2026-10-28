# D-262: A sky layer's color takes the scene's exposure and the background's intensity

Status: decided, for the owner's review. Built: the layer's exposure and the background's intensity
in the box template, the WebGL2 capture's texture unit, and the `sky-layer-exposure` page with its
test. Task: M3-R24.

Summary: The ground plane reflects every map, so the fault that the aurora demo shows is not in the
plane. A sky layer's color is a sky color, so the scene's exposure must reach it. Otherwise the sky
draws the aurora and the lake reflects it at two different brightnesses. The layer's box template
scales its color by the scene's exposure and the background's intensity, as the sky around it does.
A browser test holds the sky and the lake together at two exposures.

## Question

Does a ground plane take the light of the sky's environment map, and if the aurora demo's lake shows
none of the aurora, where does it lose it?

## Rule

A surface must show what the map holds: a mirror plane under a map of the sky reads that map's own
color, whatever sky the map was made from. A sky layer is a scene color, so the pass that draws it
applies the scene's exposure and the background's intensity, as the sky around it does
(`docs/api/scene.md`, the `SkyLayer.color` row). The fix needs a test that fails before it and passes
after it, on WebGPU, compatibility mode and WebGL2.

## Data

The kept page `sky-layer-exposure` draws the question. A mirror plane lies under a sky with a flat
layer over it. A 55-degree camera 2.4 units above the lake looks down it. The page reads 5 by 5
pixel means of the sky, of the lake and of a rough white sphere through `engine.captureFrame()`, so
the sky's own light reaches a surface in the same frame. It reports the GPU tier that it drew with.
Each stretch sets its own exposure and background intensity: a bright one, one ten times dimmer by
exposure, and one at half the background's intensity.

The environment that the page builds is a `rgb9e5ufloat` map of 256 texels and 6 levels on every
path, as `Environment.format`, `.size` and `.levels` report. A mirror reads level 0
(`environment.wgsl`), so the lake samples the map's center faces, as the sky does.

A template that applies no scale to the layer's color puts the layer into the scene without the
scene's exposure or the background's intensity, where the core sky, the objects and the map's fill
all take the exposure. This record gives no figure for that drawing. The page's picture without the
scale needs a shader compiler built without that line, and the plugin's compiler carries the
engine's WGSL inside it.

| Measure | Value | Run |
| --- | --- | --- |
| The sky, the lake and the rough sphere with the fix, at exposures 0.1 and 0.01 and at half the background's intensity | The lake follows the sky within 6 levels at both exposures. The dim sky falls below 0.6 of the bright one. The lake keeps its value while the background's intensity halves. The rough sphere takes the map's light. | The run record below |
| The same page with the dim stretch only a fifth dimmer | All three tier tests failed at the exposure assertion, so the test can fail | the same run record |
| The aurora demo, in both reference sets | All six pictures pass. The frame moves within the test's tolerance: the layer draws 10 per cent brighter in linear light at the demo's exposure of 1.1. A pass does not show that no pixel moved. The six references' redraw belongs to M3-R27 | the same run record |

The runs are recorded in
`.dev/tested-devices/macbook-pro-chrome/20261026-013842-sky-layer-exposure.md`, with the machine,
the browser, the load at each start, the viewport and the log.

## Look

The demo's ice is a dielectric of 4 per cent, with roughness 0.16 and metalness 0, and the map that
it samples holds the aurora. The demo's own view has no lake to judge. The ice plane at
ground level does not reach the demo's held frame: an unlit magenta material on it changes no pixel,
at plane sizes of 100 and 4000, in both rotations, with and without the layer (M3-R27). The stored
`demo-aurora` reference shows the same flat lower half, so the plane is absent from it too.

The look of that lake is judged in M3-R27, which makes the plane draw at the demo's own camera and
redraws the six `demo-aurora` references. This record shows the sky's own color: in the kept page a
mirror plane at ground level reflects the map that the layer fills, and the sky and its reflection
hold one color at two exposures.

After M3-R27 the plane draws. Its absence was not a fault of the plane: the demo's sixteenth snow
cone, stretched about 10.7 times by a rotation quaternion that was not unit length, painted the band
that the plane lay behind (M3-R33). The engine scales such a rotation now, and the lake is a planar
reflection through a reflection pass at the render size, so the ridge, the pines and the sky stand
inverted in it.

## Decision

The plane's fault is ruled out, one explanation at a time. Its normal and winding are right: the
plane is built facing +Z and its rotation turns that to +Y. Size and space make no difference. The
plane is a mesh like any other, and the kept page draws it 4000 units across with no special case.
The level a mirror samples is level 0, so it reads the map's center faces, as the sky does. The map
is filled by the same pass from whichever sky the scene sets, layer and all, and the kept page's
lake reflects the map that its own layer fills.

A white metal lake under the physical sky in the demo reflects nothing, and the plane has no
normal or winding fault. In the kept page a mirror plane at ground level reflects the map that the
layer fills, so the plane's normal, its winding and its height are not at fault. The demo's lake
reflects nothing because the demo's ice plane at ground level does not reach the demo's own held
frame (M3-R27), not because its surface cannot reflect or because the lake sees a dark band of the
sky. The look is judged in M3-R27.

The fault is a sky that draws a layer that its own reflection does not match. A box template that
writes the layer's color into the exposed scene without the exposure leaves it unscaled, while the
lake's reflection takes the exposure through the map's fill. The sky then holds
its value as the exposure changes, and the lake follows it. The scene's color is exposed color
throughout (the tone-mapping library says so). So the template must take the exposure as every other
sky shader does, and the background's intensity with it.

The template scales the layer's color by the scene's exposure and by the background's intensity.
The layer's uniform carries the intensity in its spare value. The sky and the lake then hold one
color at any exposure. The background's intensity dims the sky alone, as it dims the
built-in sky and leaves the map that the lake takes alone.

WebGL2 needs one more piece on this path. A map with a layer draws its light capture with the
page's own `environment.wgsl` build. The capture names its own program's texture unit, as the
engine's cube draws do. Read from the layer's `sky` program, which reads no cube, the lookup fails,
and the page stops with E1404, "the render worker failed: a WebGL2 program reads no texture at group
0, binding 1".

## Consequences

`sky-layer-exposure` runs on all three GPU paths and passes on each. At two exposures ten times
apart it requires the lake to show the sky's value within six levels. At half the background's
intensity it requires the sky to fall while the lake keeps the value it had. The plugin's shader
compiler carries the engine's WGSL inside it. So a change to the template reaches a page only after
`bun run build` builds the compiler again and the server restarts.

Every picture of a scene with a sky layer draws the layer at the exposure. At the aurora demo's
night exposure of 1.1 the layer enters the scene 10 per cent brighter in linear light than without
the scale, so the held frame moves. The image test passes because the move stays inside its
tolerance: it counts a pixel only when it moves by more than about 13 levels, and it fails only when
more than 0.1 per cent of pixels do. Runs of `demo-aurora` on the Mac's GPU and with `CI=1` on
SwiftShader both pass all three tiers, though a pass does not show that no pixel moved. D-242
records an aurora picture that passes with 48.9 per cent of its pixels more than ten levels from the
drawn one, so the pass says little about these pictures. Their redraw belongs to M3-R27.

One fault beside this one is not this record's:

- A capture writes one texel of four words to each coefficient (`LightCapture::coefficients`), so
  the light that a fill reads back from the map takes each texel's first three words. A read that
  splits the nine coefficients at three words each turns and scales the diffuse light of a layer's
  map wrongly. [D-242](D-242-sky-layers.md) holds that read.

A scene sets the background's intensity and the environment's intensity apart. Each place that the
sky is seen follows its own setting. The background draws its layer at the background's intensity,
and the lake reflects the map at the environment's. That is two settings doing what the API says,
not a fault. The test holds it: the lake keeps the value it had while the background's intensity
halves.

## GPU check

The branch changes how the GPU draws, so it carries a judged check. The tool prints its whole line:

```text
GPU-Checked: 668b7a423..113de653a passed: s4 medium 4.28 to 4.23 ms (-0.9%); s6 medium 4.49 to 4.79 ms (+7.8%); s4 high 4.47 to 4.35 ms (-6.8%); s6 high 7.21 to 9.41 ms (+5.7%)
```

The comparison ran on the Mac's GPU at both presets, medium and high, with 120 Hz on every page.
The load was 39 before the run and 4 after it. The 39 was the prepare's own build decaying: the
timed part began 47 seconds after the prepare ended, and the load fell to 4.

No page exceeds the rule's threshold, and that is not the same as no change. S6 reads higher at
both presets. At high it is paired +5.7 per cent, within its 14.8 per cent spread. At medium it is
+7.8 per cent, under twice its 4.4 per cent spread. The two s4 figures are slightly faster, at
-0.9 and -6.8 per cent. The tool's format does not name the paired change. The wording that
stands is `paired +5.7 per cent on the high preset, within the run's spread of 14.8 per cent,
medians 7.21 and 9.41 ms`. The printed `passed` means no page exceeded its threshold. It does not
mean the figures were equal.

The check dropped one baseline run, s4 at high round 1, which measured 124 Hz where the page runs
at 120 Hz. It dropped the run rather than average it in, which is the tool's guard working.

The millisecond pair in the line is each build's median GPU time per frame. The percentage is the
judged change: the median, over the rounds, of each round's ratio of the new build to the baseline.
The two differ because a ratio of two medians is not the median of ratios, and the rounds spread
widely. The verdict rests on the percentage and on its noise, the standard error of that median
ratio. A page fails only when the change exceeds its threshold in percent and in milliseconds, and
twice its noise. For GPU time those thresholds are 25 per cent and 0.3 ms. S6 at high reads +5.7
per cent against a 14.8 per cent noise, so its wider medians are not separable from the machine.

The check did not measure the ground reflections. No benchmark scene installs a sky layer, so S4
and S6 never run the changed shader path: the 0.35 ms figure is noise, not a reflection's cost, and
at +7.8 per cent it sits under twice the run's 4.4 per cent noise. What the line establishes is that
nothing else got slower. M3-R26 builds a benchmark scene whose subject is a ground plane reflecting
a sky layer, and measures the real cost.

The base, `668b7a423`, is a milestone commit whose benchmark pages are identical to the branch's:
`git diff` names no file under `bench/pages` or `bench/scenes`, so the tool judged the comparison.
A run against main's merge base, `9369b1380..a3947322c`, says `not judged`, because the milestone
merge moves the pages themselves.
