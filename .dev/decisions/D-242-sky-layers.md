# D-242: Sky layers through a template that an add-on completes

Status: decided by the helper of M3-E10 on 24 October 2026, for the owner's review, and widened by
the owner's ruling of 25 October 2026 (addendum). Built: the template, the compiler, both GPU paths,
`scene.setSkyLayer`, the layer in the sky's environment map and in the diffuse light that the scene
takes from it, and the aurora example add-on. Date: 2026-10-24, widened 2026-10-25. Task: M3-E10.

Summary: A sky layer is one WGSL function, `fn skyLayer(input: SkyLayerInput) -> SkyLayer`, which
the shader compiler joins to the engine's sky-layer templates. The engine draws it as a box at the
far plane right after the background, in the background's place and depth state, with the frame's
group and one block of the core sky's values, and builds the same function into the shader that
fills the sky map's cube faces, so reflections show the layer and the diffuse light that the map
gives the scene carries it. `scene.setSkyLayer` installs it, and the layer's pipeline takes a
template of the page's own, as a custom effect's does.

## Question

D-173's hook H8 asks that an add-on draw over the sky: the top of the sky, a second layer of
clouds, an aurora or a space backdrop. What does an add-on write, how does the engine stitch and
draw it, and which of the sky's three places does it reach?

## Rule

- An add-on writes one WGSL function and no pipeline, no binding and no vertex. The engine owns
  the box, the bindings, the depth state and the blend, as the custom-effect template owns its
  triangle.
- The layer obeys the core sky's settings: it reads the cloud coverage, density, elevation and
  scale that the core sky's flat clouds obey, and the share of the sun that it hides dims the disc
  that the core sky draws.
- Both GPU paths draw it (D-173), and a layer whose shader has not arrived yet draws nothing and
  costs no frame.
- A layer may be replaced or removed while the page runs, so its pipeline cannot take an engine
  template id that a second shader would then have to replace: it takes a template of the page's
  own, from the custom range.

## Data

| Measure | The template registered as an engine template | A template per compiled layer |
| --- | --- | --- |
| A second shader installed on one page | The production backend keeps the first: a template that exists is never defined again | Works: the second layer takes another template |
| Hot update in development | Swaps the shader under the same id | Swaps as a custom effect's does |
| Mock backend's group check | Judges the layer's two groups | Judges none, as for every template from the custom range |

How the data was produced: the backends' `defineCustom` and `replaceCustom` in
`packages/engine/src/gpu/webgpu/pipelines.ts` and `packages/engine/src/gpu/webgl2/backend.ts` read
against `template::NAMES` and `groups::TABLE` in `crates/null3d-gpu/src/drawlist.rs`. The engine's
own templates hold fixed layouts because the engine decides them; a template whose shader comes
from the page is defined at its first use and never re-defined in a release build.

## Decision

A template per compiled layer. The engine's `background_layer.wgsl` stays a template that the
build checks with a stub and writes no module of, as the custom-effect template does, and the shader
compiler builds each layer's function into every variant of it. The draw list's template id follows
the page's shader, so installing a second layer, or replacing a layer, needs no rule beyond the one
custom effects already follow.

## Consequences

- `scene.setSkyLayer(description, { wgsl, opacity, sun })` installs a layer and returns it;
  `SkyLayer.set` changes its values and `scene.clearSkyLayer` removes it. The description is an
  instance of M3-R1's feature description: the `'background'` point, the `'draw'` kind, the `'sky'`
  slot and the three views. The layer draws in the camera's view, in scene passes and in
  reflections, and draws nothing where the background draws nothing, as in a debug view.
- `SkyLayerInput` gives the fragment's direction, the core sky's cloud settings, the sketch time
  and the share of the sun that the layer hides. A layer declares no uniforms, textures or
  bindings of its own, so it cannot read a picture or a value that the page changes after it is
  installed. A layer that needs those asks for uniforms in a later hook.
- The sky's environment map holds the layer, and so does the diffuse light that the scene takes
  from the map: the layer's WGSL is built into the map's shader, and a small pass sums the map onto
  the nine light coefficients that the engine reads back once a fill. The owner's ruling of 25
  October 2026 widened the record to both places, and the addendum holds the build and its costs.
- The aurora example add-on in `examples/addons/aurora/` is the first user, with the `aurora` demo
  and its image test on every GPU tier. `docs/api/scene.md` and `docs/api/features.md` record the
  call and drop the hook from the list that waits for a declaration.
- The layout `BACKGROUND_LAYER` takes id 59: the id 53 that the first sketch of the feature used is
  the compute pass's `COMPUTE_RGBA16_FLOAT` layout, and two layouts at one id stop the render worker.

## Addendum, 25 October 2026: the environment map and the CPU sky light

Status: reversed by the owner on 25 October 2026, before it was reviewed, and built the same day.
The narrowing that this addendum first recorded is kept below, because its measurements are the
reason the reversal costs what it does. The owner also made the reversal a rule: where options
differ in how the result looks, the one that looks better is chosen, and effort and schedule never
decide against it ([hard rule 40](../../AGENTS.md#hard-rules)).

### The narrowing, and why the owner reversed it

The task first asked the hook to draw into the background, the environment map and the CPU sky
light. The build reached the first place alone, and this addendum first narrowed the task to the
background and the sun's dimming, on the argument that the CPU light had no sound way to run an
add-on's WGSL and the map cost a day and lit reflections alone. The owner's ruling of 25 October:
a scene's sky is seen in two places as well as on the screen, and a layer that shows in only one of
them shows a different sky in each. A lake under an aurora would hold a stale sky, and the ground
under the aurora would stay lit as if the aurora were not there. Both places are built.

### Look

The wider line looks better wherever a scene shows its sky more than once. Under the aurora demo's
first fill the ice held the moon and the stars and no curtain, and the snow stood in a dim ambient
light of the sketch's own that no measure of the sky gave it. With the layer in the map, the ice
mirrors the curtains at the sky's own sharpness, and the ice and the snow take the aurora's green
from above, so the demo carries no light of its own for it. The cost is met within the frame
budget by taking it per change rather than per frame (below), which is a cheaper technique of the
same look, not a smaller look.

### How the layer reaches the map

The layer's one WGSL function is built a second time, into the shader that fills a sky map's cube
faces (`environment.wgsl`, marked `sky_layer_maps` in the manifest). Its `fs_sky` composites the
layer over the analytic sky in each sampled direction, and its `fs_panorama` composites it over the
panorama that the physical sky draws, so a map of either sky kind holds the layer. The generator
draws those texels with the page's own pipelines, which it builds at the map's first fill with the
layer; the layer's values arrive in the stage's command, as the core sky's cloud settings do.

The engine cannot tell how fast a layer moves, because its animation lives inside its WGSL. So the
layer declares `refresh`, the seconds between the map's captures of it, defaulting to one second;
0 marks a layer that stands still, whose map then fills only when the sky or the layer's values
change. A fill spreads over some twenty frames, a stage a frame, so a layer's look costs a rate:
one fill each `refresh` seconds, 15 stage draws a second at the default. A page that asks for a
faster capture gets one fill after another with no idle stage, which is the most the map can do,
and nothing is added to a frame.

### How the layer reaches the CPU sky light

The light is measured from the map rather than modelled from the layer. At the stage that the page
names, a new fragment, `fs_feedback`, sums the map's chain of levels onto the nine spherical
harmonics
coefficients of its diffuse light, in three.js's order and scale, on the same grid and with the same
solid angles that the CPU's own projection of the core sky uses (`crates/null3d-render/
src/sky_light.rs`). It draws nine texels of 32-bit words into an `RGBA32UI` target, which the frame
copies into a buffer of a ring that the core made, and the engine's existing asynchronous read
(`Op::ReadBuffer`, the one GPU picking uses) lands the coefficients in engine memory. The core then
takes them as the map's diffuse light, in place of the CPU model's.

Because the coefficients come from the texels the reflections read, the two places hold one sky by
construction: no second implementation of the layer exists, the add-on writes nothing for it, and a
layer of any shape lights the scene. The capture runs a stage or two before the fill's copy, so the
read lands first and no frame draws the map's levels beside the core sky's light alone; until a
new layer's first capture lands the map keeps the CPU model's own coefficients, so no frame loses
its light and none flashes dark before the layer arrives. The picture test checks that order on
every GPU tier: the light reaches the scene with the map's levels or a frame before them, never
after.

### The capture's stage, fixed 25 October 2026

The first build recorded the capture only at the copy stage. The core puts the readback buffer in
the command of the stage that the page names. So no fill ever summed the map's light. The
reflections held the layer while the diffuse light kept the CPU model of the core sky. So
`sky-layer-light` failed on all three GPU tiers, with a rough sphere that never turned green. Both
backends now sum the light at the stage that the core names, before the copy publishes the levels.

The WebGL2 layer's programs took the cube's texture unit from the sky draw, which samples no cube
texture on that path. Installing a layer therefore failed the first stage with E1405, and no tier
drew a map with it. The capture's own program names that unit now.

Two smaller faults came with those. A capture draws the frame again to read it back, and the light
capture ran a second time in that drawing, into a buffer whose read was still mapping it, which the
device refused with E1305. The capture now runs only in the frame that the page draws. And the read
of the nine coefficients took the first word of every third texel, where the target holds one texel
each, so the diffuse light mixed the coefficients of different directions; it now reads each
texel's first three words.

The test that tells whether a capture landed compared only the first twenty-seven words. That is
the number of coefficients, where their nine four-word texels take thirty-six. So a capture that
moved only the last two coefficients read as unchanged, and the map kept the light before them. It
now covers every word that the coefficients occupy, from 26 October 2026. A unit test moves only the
last coefficient.

The last fault was why the light arrived one fill after the levels. The drawing that a capture makes
ran the frame's own command to make each buffer, and a second make destroys the buffer it makes and
builds another. The light read of the ring then failed with "Buffer was destroyed before mapping was
resolved", so its fill's light never landed and the map's next fill, a grace of frames later,
supplied it one fill late. A capture now keeps the buffers that the frame made: three of the four
light reads of a run failed this way. With that fixed, `sky-layer-light` passes the whole spec on
webgpu, compatibility mode and webgl2 on SwiftShader, in 8 to 9 seconds on each tier at the Mac's
load of 82 to 90 on 18 cores.

A slow read still let the levels publish first. Full run 40172879653, at `89bd5640a` with the
kept-buffers fix in, failed the order check on WebGL2: the mirror took the layer at frame 17 and the
rough sphere at 19, where the spec allows the light to follow by one frame. WebGPU and compatibility
mode passed. Nothing held the copy for that read: it runs two stages before the copy, and the copy
published the levels whether the read had landed or not. The copy now waits for the capture that
its own fill made, up to four frames, and publishes without it after that. The core's tests check
that the copy waits and that a landing ends the wait.

Two figures in the runs need their true reading. The scene suite passed 870 of 870 when it ran on a
quieter machine; the checker, under load, measured 868 of the same 870, where two tests stopped at
their time limit in files that this branch does not touch. And the back ends import only
`environment-words`, while the two generator modules still import the steps module. Those modules
load on first use, so a page that uses no feature downloads neither, and the download test passes
10 of 10.

### The cost

| Measure | Cost |
| --- | --- |
| A layer's build, at the page's build | One more build of `environment.wgsl` with the layer, beside the box's build: 110 to 190 ms of the build, measured with the debug compiler that the tests run. The page carries the result as its own shader text: 40 KB of WGSL, 9 KB after Brotli, for the aurora's layer beside 11 KB and 3 KB for the box. The start's download does not change: none of it is an engine file that a first use fetches. The environment shader that a first sky environment fetches grows by 4 KB of WGSL for the capture and the layer's composite, about 1 KB after Brotli |
| A map fill with a layer | Nine texels of a projection over a 32-texel face of the chain: a few thousand cube samples, on the GPU, once a fill |
| The read back | 256 bytes copied and mapped asynchronously, once a fill, a stage or two before the copy publishes the levels |
| A frame | Nothing, and no frame waits: the projection and the read belong to the fill, the read is a map promise on WebGPU and a fence polled with a zero timeout on WebGL2, and a fill that cannot start while another runs starts on a later frame |
| A still layer, `refresh` 0 | One fill when the layer is installed, replaced or changed, and when the sky moves past a step |
| A moving layer | A rate: one fill each `refresh` seconds, so 15 stage draws a second at the default of 1 s, and a stage draw a frame while a fill runs. A page that asks for faster gets one fill after another with no idle stage, which is the most the map can do. The rate is the page's to choose: the engine does not slow it to the frame rate or hold it back |

The GPU projection mirrors the CPU's basis and solid angle in WGSL, as the engine's sky model is
already mirrored between `null3d::atmosphere` and `sky_light.rs`. The two grids are the same, so a
map without a layer and the CPU model agree; the mirror sphere and the rough sphere of the
`sky-layer-light` page check both places on every GPU tier.

### The pictures

`tests/image/sky-layer-light.spec.ts` draws a mirror sphere and a rough sphere under a still night
sky, installs a green layer, removes it, and checks that each sphere takes the layer's green and
loses it, and that neither shows it while the other does not beyond the frames that the light takes
to follow the map. It runs on every GPU tier through the `sky` plan.

The aurora demo's six pictures were redrawn on 25 October 2026, in the form [image
tests](../image-tests.md#references) records. The old ones were drawn on 24 October, before the
layer reached the map, and they still held the demo's stand-in ambient light, which the demo no
longer has. Against them the drawn picture differs in 48.9 per cent of its pixels by more than ten
levels. The new picture's ice has a mean green of 6.6, where the old one's was 22.5. The manifest's
tolerance weighs a pixel's colour distance rather than its levels, so those pixels passed it, and a
passing comparison alone did not mean the same picture. The Mac's GPU drew that set, and CI's software GPU draws the other.

`sky-layer-light` keeps no pictures: it reads the spheres' colours, so it needs no reference.

The sun dimming had only its values' plumbing and the shader's multiply until 25 October 2026.
`tests/image/sky-layer-sun.spec.ts` now draws it: a sky whose sun disc fills the middle of a narrow
view, and a layer that covers nothing but hides the whole sun. It reads the disc's middle and a block
of plain sky before the layer, with it, and after it is removed. The disc darkens by more than 40
levels and comes back within 4, while the plain sky stays within 4. With the layer's `sun` given 0,
the disc stays at 255 and the check fails, so the check fails without the effect. It passes on
webgpu, compatibility mode and webgl2 on SwiftShader.

The task's other proofs already stand on the branch. `tests/image/errors.spec.ts` runs in every
engine mode and in the production build, and it asserts the E1223 refusal in a running sketch.

The held frame's map may hold no aurora, and that is an inference. The checker measured the ice's
green excess fall from +7.7 to -0.8 against the sky above, which is a blue sky with no curtains.
The draw thread shows the map's build of the layer's shader present at every stage, and the light
capture running. Its light can still miss a held frame: a held frame is drawn once, and the capture
replays that drawing, so a light that lands after the frame's list is recorded cannot enter the
picture. On a loaded machine the light read was queued at 0.87 seconds and landed at 4.1, while the
capture answered at 5.65. The reflections are a separate question, and the checker's mechanism for
them is that a layer installed during setup arrives after the first fill, and hold mode draws no
later frame for the retry fill that would bring it in. That needs a proof, and one page can give it:
install the layer during setup and read the ice on the first frames, blue first and green only after
the next fill, or read one sky-map texel where the layer is bright. Until then it stays an
inference.

The demo's cloud coverage does not suppress the layer. The aurora's brightness scales by the clear
fraction, about 0.96 at the demo's settings (`examples/addons/aurora/aurora.wgsl`), not by the
coverage. A demo whose ice shows a plain blue sky is a look question under the owner's better-look
rule, and it is with the owner.

### The map's light and a layer that never arrives

A map fills with the layer only once the page's shader has reached the thread that draws. If it has
not when a fill starts, the map draws without the layer and its light capture finds no layer, so
both places lack it together rather than one of them; the next fill that any change starts brings
it in. The page sends a layer's shader when the sketch installs it, so a fill in the same frame
normally has it.

## Addendum, 26 October 2026: the cube's texture unit on WebGL2

A layer's map asked the WebGL2 backend for the texture units of its programs. It asked the wrong
program for the chain's cube: the unit belongs to the capture of the map's light, whose fragment
sums the chain. The program that draws a layer's sky samples no cube at all, whether it draws over
the analytic sky or over a panorama. A stage that samples no texture at a binding loses that
uniform, so the backend's lookup refused the request. The message was "a WebGL2 program reads no
texture at group 0, binding 1".

Two pages met it, with two codes. The aurora demo holds its picture, so `demo-aurora` stopped as
E1408 on WebGL2 in Chrome, in Safari and in Firefox. The `sky-layer-light` page failed while its
worker started, so it stopped as E1405. Four jobs of each CI run carried one of the two, 40163662542
and 40222451866. WebGPU was not affected: a bind group names every binding of its layout, so a
program that reads no cube still has one bound.

The layer-light page is red for a second cause. At `93720008d` the capture of the map's light never
ran, on any GPU tier. The stage split of `333a05a78` put the capture's buffer in the stage that the
page names, which draws. Both generators run the capture only in the copy stage, which has no
draws. So no fill summed the map's light, and the rough sphere read 0 in every capture. A stride
fault in the CPU's read of the coefficients is a second, smaller fault, and the sky layer's branch
carries the fix for both (`8bebdff7f`). On that branch the `sky-layer-light` page passes the whole
spec on WebGPU, compatibility mode and WebGL2 on the software GPU, and the light reaches the scene
with the levels. That page therefore has a fix for each of its two causes, and this record holds
the first.

The generator now asks the capture for that unit, which is its only use. On this branch that use
runs, and the page's WebGL2 tier shows the capture binding the chain at that unit. The unit test
`packages/engine/src/gpu/webgl2/environment.test.ts` builds a layer's programs with a stand-in host
that answers each lookup from the generated shader build. It refuses with the same message when the
programs' own code asks a program that samples no cube.

The fault came with the layer's reach into the map on 25 October 2026 (`1441b441d`). It is not a
fault of the per-map transform work, which touched other files.

### What the comparison shows

`demo-aurora` passes 3 of 3 on the Mac's GPU and 3 of 3 on the software GPU, the WebGL2 tier among
them. A pass does not show that no pixel moved. The comparison counts a pixel only past a color
distance, so a frame can pass with much of it changed.

The review compared the six aurora pictures that the fixed engine draws with their checked-in
references. Against those references, 0.000 to 0.012 per cent of pixels counted as different,
under the 0.1 per cent limit. More than ten levels separated 48.86 to 48.92 per cent of the
pictures' pixels, and the mean channel difference was about 5.2 levels. The test therefore says
nothing about those pictures.

The references are those of 24 October 2026, and they are stale for the code in this branch's own
base. The sky layer's work moved the demo's light in `1441b441d`. The redraw of the aurora
references sits on the unmerged `origin/fix/m3-sky-layer-light` branch (`89bd5640a`, `ac51f07b6`).

This change alters no draw and no reference, so it cannot move a picture. The pictures that differ
differ because of the work the branch already carries, and they keep their references here.

### The task line

"H8, sky layers: an add-on draws over the background and dims the sun, and the layer reaches the
sky's environment map and the diffuse light that the scene takes from it, so reflections show it and
it lights the ground it stands over. A moving layer declares how often its map captures it (D-242,
reversed on 25 October 2026)."

M3-F11 stays the place that draws the engine's own clouds into the same map and light. It is the
engine's own tier, so it sets the map's refresh step and the CPU light itself; a layer's presence
does not change how it works.
