# D-280: Bitmask ambient occlusion at half or quarter size

Status: decided. The bitmask variant passes the prototype's cost rule on the Mac's two GPU paths,
at half and at quarter size. It removes the dark halos that three.js's two-horizon search draws
behind thin objects. The engine adopts it in a fragment shader, which needs no storage texture. The
engine change is not built yet. It keeps three.js's denoise. The iPad's and the phone's figures stay
with prototype S3. Task: M3-R8.

Summary: Across four quiet-window runs the bitmask's horizon pass used the same slices and steps
as three.js's. On WebGPU at half size it was 0.06 to 0.10 ms faster. It was 0.02 to 0.07 ms faster
at quarter size. On WebGL2 at half size three runs were 0.05 to 0.20 ms faster and one was 0.13 ms
slower. At quarter size three runs were 0.05 to 0.43 ms faster and one was 0.13 ms slower. The denoise is the same shader in both variants,
but its time moves by up to 0.47 ms between them because its input differs. The horizon pass is
therefore the measure of the technique. The fragment path binds no storage texture, so it fits
WebGPU's default limit of four everywhere. A compute design would need four textures at the reduced
sizes. At full size it would need five, over the default. On the prototype's scene the bitmask
removes the gray bands behind the thin poles and the rings around the spheres. It keeps the
darkening where the spheres meet the floor.

## Question

Should the engine replace three.js's two-horizon search with the visibility bitmask? The bitmask
models each depth sample as a slab of constant thickness. It marks the sectors of the hemisphere
that the slab hides. Which AO size keeps it inside WebGPU's default limits? Bevy's version needs
five storage textures per stage at full size. WebGPU's default is four.

## Rule

- [D-53](D-53-technique-defaults.md) ruling 14: S3 picks AO's method. The bitmask variant wins if it
  costs little more than GTAO on the iPad. A prototype's figures settle the method. The phone
  presets stay off until S3 meets its pass rules.
- Hard rule 6: the WebGPU path stays inside WebGPU's default limits. A feature beyond them needs a
  capability flag and a fallback.
- Hard rule 40: the better-looking option wins. Cost and schedule never decide against it.
- This prototype passes when the bitmask costs no more than the current technique at the same
  samples on both GPU paths. It must also remove the halos behind thin objects. A picture that
  merely moves is not a pass.

## Data

The prototype page draws a fixed scene. It has a floor and a wall in a crease, a grid of spheres,
and a row of thin poles in front of the wall. It also has boxes and a table on four thin legs. Each
variant reads the same depth copy, which is the prepass's depth. Each uses the same 3 slices of 6
steps and the same three.js denoise. The two variants differ only in the horizon pass.

The canvas was 3,024 by 1,520 pixels at render scale 1. The AO targets were 1,512 by 760 at half
size and 756 by 380 at a quarter. The browser was Chrome 156.0.8078.79 on the MacBook Pro's Apple
M3 Max, with 30 GPU cores. Four runs took a quiet window through the job queue, with 5 rounds each.
Each figure is the median of 24 GPU-timed frames a round.

The horizon pass, in milliseconds of GPU time, for each of the four runs.

| Path and AO size | Current | Bitmask |
| --- | --- | --- |
| WebGPU, 1512 x 760 | 0.690, 0.738, 0.709, 0.692 | 0.619, 0.639, 0.639, 0.636 |
| WebGPU, 756 x 380 | 0.426, 0.345, 0.352, 0.653 | 0.410, 0.322, 0.329, 0.586 |
| WebGL2, 1512 x 760 | 2.000, 2.252, 1.947, 1.839 | 1.879, 2.202, 1.746, 1.971 |
| WebGL2, 756 x 380 | 1.725, 1.597, 1.701, 1.807 | 1.677, 1.723, 1.615, 1.382 |

Reading. At half size the bitmask's pass is faster in every WebGPU run, by 0.06 to 0.10 ms. On
WebGL2 three runs are 0.05 to 0.20 ms faster and one is 0.13 ms slower. At quarter size it is 0.02
to 0.07 ms faster on WebGPU. On WebGL2 at quarter size three runs are 0.05 to 0.43 ms faster and
one is 0.13 ms slower. The GPU clock moved between
runs: the same WebGL2 half pass read 1.839 and 2.252 ms in two of them. So each pair is read within
its own run. The denoise, the other pass of AO, is the same shader in both variants. Its time still
moves by up to 0.47 ms between them, because its input differs. The horizon pass alone is therefore
the measure, and the bitmask costs no more than the current technique within 0.14 ms in every run.
It is faster in most of them.

The storage limit. The page reads the device's per-stage storage texture limit. It reports the
counts that each design needs.

| Design | Storage textures | WebGPU default 4 | Reported limit on this device |
| --- | --- | --- | --- |
| Fragment, as run | 0 | fits | fits |
| Compute at half or quarter size | 4 | fits | fits |
| Compute at full size | 5 | does not fit | does not fit |

The fragment path is the one that was timed, and it needs no device check. A compute design would
need four textures at the reduced sizes, which fits. At full size it would need five, which does
not fit. The reduced sizes are the ones measured here. A compute design could run there without a
fallback. The fragment design removes the risk on every device.

How the data was produced: `bun tests/proto-s3-run.ts --pictures --tiers=webgpu,webgl2
--rates=0.5,0.25`, then `QUIET_OK=1 zsh heavy.sh bun tests/proto-s3-run.ts --timing
--tiers=webgpu,webgl2 --rates=0.5,0.25 --rounds=5` four times. The driver writes each run's figures,
pictures and look comparison to `target/proto-s3/`. The page, its renderers and the driver are
`tests/pages/proto-s3.ts`, `tests/pages/lib/proto-s3-*`, `crates/null3d-shaders/wgsl/proto_s3_*`
and `tests/proto-s3-run.ts`.

## Look

The pictures show the difference at the same frame, camera and preset, on both paths at both sizes.
They show the occlusion view. The current technique draws a broad gray band on the wall behind each
thin pole. It also draws a dark ring around each sphere's silhouette. The bitmask removes both. It
keeps the dark line in the floor and wall crease. It keeps the darkening at each sphere's contact
with the floor, and the shadow under the table top.

The change is a redistribution, not a lighter effect everywhere. Against the current technique at
half size on WebGPU, 12.7% of the occlusion picture's pixels move by more than 8 steps of 255. Of
those, 6.8% grow darker and 5.9% grow lighter. At quarter size the shares are 14.0%, 7.3% and 6.7%.
The shaded scene moves by 0.72% of its pixels at half size and 0.41% at quarter. WebGL2 moves the
same way, within 0.1 percentage points of those figures.

Pictures: `tests/image/references/*/webgpu|webgl2/proto-ao-{current,bitmask}-{half,quarter}.png`.
They were drawn on the Mac's GPU and on SwiftShader. `target/proto-s3/pictures/` holds the larger
side-by-side set. The separate look reviewer judges them. This record states what the pictures show,
and does not pass its own look.

## Decision

The engine adopts the bitmask variant, in the fragment-shader form that Filament ships:

- It removes the dark halos behind thin objects, which is the fault the variant exists to fix.
- At the same slices and steps it costs no more than three.js's horizon search within 0.14 ms. It is
  faster in most runs, at both sizes.
- The fragment form needs no storage texture. It fits WebGPU's default limit of four on every
  device, so no capability flag or fallback is needed.

The compute form is rejected. At full size it needs five storage textures against a default of
four. It would need a capability check and a fallback. At the reduced sizes it needs four and fits.
It still costs a capability check, a buffer-based interface and a second implementation. It gives
no measured gain over the fragment form.

Three.js's denoise stays. The bitmask writes the same normal, and the denoise reads it. The variant
changes one pass. Filament's separable bilateral denoise stays a separate change, as the technique
review lists it.

## Consequences

- The engine change replaces the horizon search in `ao.wgsl` and leaves the two steps around it. It
  keeps the normal output that the denoise reads.
- The settings change meaning. `distanceExponent` still spreads the search's steps. `thickness`
  becomes the slab's thickness. `distanceFalloff` has no effect in a bitmask search. The engine
  change removes it, and the porting guide says that three.js's `distanceFallOff` no longer applies.
  The API reference, the three.js mapping and the skills change with that work.
- The prototype page, its driver and its four image tests retire when the engine's own AO tests draw
  the picture. Until then they keep this record's figures reproducible.
- The iPad's and the phone's AO cost is still S3's question. This record settles the Mac's two
  paths. The bitmask costs no more than the current technique at equal work. A device that can
  afford the current AO can afford the bitmask.
