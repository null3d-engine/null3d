# D-262: A sky layer's colour takes the scene's exposure and the background's intensity

Status: decided on 25 October 2026, for the owner's review. Built: the layer's exposure and the
background's intensity in the box template, the WebGL2 capture's texture unit, and the
`sky-layer-exposure` page with its test. Date: 2026-10-25. Task: M3-R24.

This record takes 262. The milestone branch took 260 the same day for open-source readiness and 263
for the untaken shadow filter cost. 261 belongs to the moment transparency record on its own branch,
which has not landed.

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

The kept page `sky-layer-exposure` draws the question. A mirror plane lies under a sky with a flat
layer over it. A 55-degree camera 2.4 units above the lake looks down it. The page reads 5 by 5
pixel means of the sky, of the lake and of a rough white sphere through `engine.captureFrame()`, so
the sky's own light reaches a surface in the same frame. It reports the GPU tier that it drew with.
Each stretch sets its own exposure and background intensity: a bright one, one ten times dimmer by
exposure, and one at half the background's intensity.

The environment that the page builds is a `rgb9e5ufloat` map of 256 texels and 6 levels on every
path, as `Environment.format`, `.size` and `.levels` report. A mirror reads level 0
(`environment.wgsl`), so the lake samples the map's centre faces, as the sky does.

The layer before the fix entered the scene without the scene's exposure. Its template multiplied
the layer's colour by the background's intensity alone, where the core sky, the objects and the
map's fill all take the exposure. This record gives no figure for that drawing. The page's pre-fix
picture needs a shader compiler built without that line, and the plugin's compiler carries the
engine's WGSL inside it.

| Measure | Value | Run |
| --- | --- | --- |
| The sky, the lake and the rough sphere with the fix, at exposures 0.1 and 0.01 and at half the background's intensity | The lake follows the sky within 6 levels at both exposures. The dim sky falls below 0.6 of the bright one. The lake keeps its value while the background's intensity halves. The rough sphere takes the map's light. | The run record below |
| The same page with the dim stretch only a fifth dimmer | All three tier tests failed at the exposure assertion, so the test can fail | the same run record |
| The aurora demo, in both reference sets | All six pictures pass unchanged, so the fix does not move the held frame | the same run record |

The runs are recorded in
`.dev/tested-devices/macbook-pro-chrome/20261026-013842-sky-layer-exposure.md`, with the machine,
the browser, the load at each start, the viewport and the log.

## Look

The demo's ice is a dielectric of 4 per cent, and the picture follows that. One frame of the demo's
own camera, with its sky, layer, fog, bloom and exposure, held the lake split in two. A mirror half
lay on the left of the frame, and the demo's own ice on the right. The frame itself, looked at
rather than read as pixels, showed why the halves differ. The left half carries the curtains' own shapes into the
water, with their folds and rays repeated from the horizon to the bottom of the frame. The right
half is a smooth, even green-teal with none of that structure, darkening toward the camera. The
join is a straight vertical edge at the middle of the frame. On the left the lake is a second sky;
on the right it is a dim surface with the sky's colour in it and none of its detail.

The two halves are read at points on one row, so they share a view angle. They do not share a
direction. A flat lake reflects a different azimuth on each side of the frame, and the aurora is
not the same brightness in both. The gap between the halves therefore carries the sky's own
variation as well as the surface's share. Telling the two apart needs the same pixel drawn twice.

The geometry says what that share is. The sampled row's rays meet the lake about 73 degrees from
its normal. There a dielectric of index 1.5 reflects about a fifth of a mirror by Schlick's
approximation. The rest of the gap is the aurora being brighter at one azimuth. That is what a
dielectric does: its reflection is strong near the horizon and nearly nothing at a steep angle. The
rough ice's wider lobe gathers more of the bright sky than a mirror does. A mirror and the same ice
therefore never read alike. The gap between them is the surface's own reflection, not a reflection
that went missing. The record keeps the ice as it draws, which is the picture the owner asked to
see before judging the lake's look.

A temporary probe drew the same pixel under three materials, the ice, the ice without roughness and
a mirror, and that page was not kept. This section therefore quotes no measured share from it, and
the geometry above gives the share that the look follows.

## Decision

The plane's fault is ruled out, one explanation at a time. Its normal and winding are right: the
plane is built facing +Z and its rotation turns that to +Y. Size and space make no difference. The
plane is a mesh like any other, and the kept page draws it 4000 units across with no special case.
The level a mirror samples is level 0, so it reads the map's centre faces, as the sky does. The map
is filled by the same pass from whichever sky the scene sets, layer and all, and the kept page's
lake reflects the map that its own layer fills.

To say it plainly for the reader who finds the earlier trial, where a white metal lake under the
physical sky reflected nothing: the plane has no normal or winding fault, and a mirror over that sky
does reflect it. What the trial read was the sky it pointed at, not a surface that could not
reflect: a flat lake reflects one narrow band of elevations, and that band is dark in the night sky
except where a curtain crosses it.

What the investigation found is that the sky drew a layer that its own reflection did not match. The
layer's box template wrote the layer's colour into the exposed scene without the exposure. The code shows
what that line did: without it the layer's colour entered the exposed scene unscaled, while the
lake's reflection took the exposure through the map's fill. The sky therefore held its value as
the exposure changed, and the lake followed it. The scene's colour is exposed colour throughout
(the tone-mapping library says so), so the template was the one sky shader that skipped it, and it
skipped the background's intensity with it.

The template now scales the layer's colour by the scene's exposure and by the background's
intensity. The layer's uniform carries the intensity in its spare value. The sky and the lake then
hold one colour at any exposure. The background's intensity dims the sky alone, as it dims the
built-in sky and leaves the map that the lake takes alone.

WebGL2 had a second fault on this path. The page failed with E1404, "the render worker failed: a
WebGL2 program reads no texture at group 0, binding 1", before the fix ran. A map with a layer
draws its light capture with the page's own `environment.wgsl` build. The texture units that the
layer's programs claimed were read from its `sky` program, which reads no cube. The capture now
names its own program's unit, as the engine's cube draws do.

## Consequences

`sky-layer-exposure` runs on all three GPU paths and passes on each. At two exposures ten times
apart it requires the lake to show the sky's value within six levels. At half the background's
intensity it requires the sky to fall while the lake keeps the value it had. Its first run after
the fix still drew the layer without it. The plugin's shader compiler carries the engine's WGSL
inside it. So a change to the template reaches a page after `bun run build` builds the compiler
again and the server restarts.

Every picture of a scene with a sky layer draws the layer at the exposure from now on. At the
aurora demo's night exposure of 1.1 the layer enters the scene 10 per cent brighter than it did.
The demo's held picture does not move beyond what the image test counts, though. That comparison
counts a pixel only when it moves by more than its threshold, about 13 levels. It fails only when
more than 0.1 per cent of pixels do. Runs of `demo-aurora` on the Mac's GPU and with `CI=1` on
SwiftShader both pass all three tiers against the unchanged references. The six aurora pictures
therefore stay as they are.

One fault beside this one was found and is not this record's:

- The light that a fill reads back from the map splits the nine coefficients at three words each.
  A capture writes one texel of four words to a coefficient (`LightCapture::coefficients`).
  Rotation and scale of the diffuse light of a layer's map are wrong while that holds. The held
  branch `fix/m3-sky-layer-light` carries that fix, and this branch leaves it alone.

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
-0.9 and -6.8 per cent. The tool's current format does not name the paired change. The wording that
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
per cent against a 14.8 per cent noise, so its wider medians are not separable from the machine. No
benchmark scene installs a sky layer, so the checked pages never run the changed path.

The base, `668b7a423`, is a milestone commit whose benchmark pages are identical to the branch's:
`git diff` names no file under `bench/pages` or `bench/scenes`, so the tool judged the comparison.
An earlier run against main's merge base, `9369b1380..a3947322c`, said `not judged` because the
milestone merge moved the pages themselves. This line supersedes that one.
