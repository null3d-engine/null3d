# D-280: Bitmask ambient occlusion at half or quarter size

Status: decided. The bitmask variant passes the prototype's cost rule on the Mac's two GPU paths,
at half and at quarter size. It removes the dark halos that three.js's two-horizon search draws
behind thin objects. Its contacts follow the touch points, though the farthest sphere-pair contacts
are faint and the sphere-floor line is beaded. The engine adopts it in a fragment shader,
which needs no storage texture. The engine change is not built yet. It keeps three.js's denoise,
wider. The iPad's and the phone's figures stay with prototype S3. Task: M3-R8.

Summary: The bitmask keeps the same 3 slices of 6 steps. It turns its sample pattern by an
integer hash per texel. It shortens each sample's sector span by the distance falloff. Its denoise
is the same 16 taps at a wider radius. In four quiet-window runs its AO cost 0.13 to 0.16 ms less than the
current technique on WebGPU at half size. At quarter size it cost 0.02 to 0.04 ms less. On WebGL2
the four runs spread from 0.62 ms more to 0.72 ms less at half size. At quarter size they spread
from 0.18 ms more to 0.23 ms less. The two are equal there within the run's spread. The fragment
path binds no storage texture, so it fits WebGPU's default limit of four everywhere. A compute
design would need four textures at the reduced sizes. At full size it would need five, over the
default. On the prototype's scene the bitmask removes the gray bands behind the thin poles and the
rings around the spheres. The fixed hatch and the star splats are gone. Short ribbed teeth remain on
the wall-base marks, the box's right edge and the table line. The table's back edge is deeper than
the current technique's.

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
steps. The current technique uses three.js's denoise at a 4-texel radius. The bitmask writes the
same layout into the denoise and widens its radius to 8 texels. The bitmask also turns its sample
pattern by an integer hash per texel and shortens each sample's sector span by the distance
falloff. Both variants therefore do one horizon pass and one 16-tap denoise pass.

The canvas was 3,024 by 1,520 pixels at render scale 1. The AO targets were 1,512 by 760 at half
size and 756 by 380 at a quarter. The browser was Chrome 156.0.8078.79 on the MacBook Pro's Apple
M3 Max, with 30 GPU cores. Four runs took a quiet window through the job queue, with 5 rounds each.
Each figure is the median of 24 GPU-timed frames a round.

The horizon pass, in milliseconds of GPU time, for each of the four runs.

| Path and AO size | Current | Bitmask |
| --- | --- | --- |
| WebGPU, 1512 x 760 | 0.665, 0.658, 0.666, 0.664 | 0.593, 0.600, 0.597, 0.601 |
| WebGPU, 756 x 380 | 0.307, 0.317, 0.319, 0.317 | 0.292, 0.297, 0.305, 0.308 |
| WebGL2, 1512 x 760 | 2.017, 1.991, 2.125, 1.817 | 1.976, 2.079, 1.783, 2.078 |
| WebGL2, 756 x 380 | 1.510, 1.610, 1.603, 1.544 | 1.588, 1.520, 1.605, 1.448 |

AO's two passes, the horizon and the denoise, in milliseconds of GPU time.

| Path and AO size | Current | Bitmask |
| --- | --- | --- |
| WebGPU, 1512 x 760 | 1.529, 1.507, 1.507, 1.522 | 1.373, 1.376, 1.363, 1.380 |
| WebGPU, 756 x 380 | 0.672, 0.699, 0.690, 0.696 | 0.641, 0.656, 0.666, 0.669 |
| WebGL2, 1512 x 760 | 4.479, 4.385, 4.720, 4.047 | 4.406, 4.599, 4.000, 4.664 |
| WebGL2, 756 x 380 | 3.182, 3.425, 3.336, 3.209 | 3.365, 3.193, 3.361, 3.073 |

Reading. On WebGPU the bitmask's two passes cost 0.13 to 0.16 ms less at half size in every run.
At quarter size they cost 0.02 to 0.04 ms less. On WebGL2 the two are equal within the run's spread.
The half-size difference runs from 0.62 ms more to 0.72 ms less, with a median of 0.07 ms less. The
quarter-size difference runs from 0.18 ms more to 0.23 ms less. The GPU clock moves between runs and
between the turns within a run. The same WebGL2 half pass read 1.817 and 2.125 ms in two runs. So
each pair is read within its own run. The bitmask costs no more than the current technique on
WebGPU, and the two are equal on WebGL2.

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
thin pole. It also draws a dark ring around each sphere's silhouette. The bitmask removes both. The
contact darkening follows the touch points, and the nearest contacts read as one band. The contact
between the two receding spheres is much fainter, and breaks into a trace and a few specks. The
sphere-floor contact is a dark line with a beaded edge, under a fan of fine specks. The wall-floor
seam is a thin line. The table's back edge is darker and harder than the current technique's, so
that segment is not like it.

The first revision broke the contacts into detached wedges, drew hard rectangles above the rows,
and put a screen-period hatch on the structure render. Three changes fix them. The sample pattern
turns with an integer hash per texel. No flat surface then shows a screen-period hatch. Each
sample's sector span is shortened by the distance falloff. A wall beside a surface then does not
mark its whole height. The seam's width comes back to the current one, except at the table's back
edge. The denoise takes a wider 8-texel radius, which smooths the wedges into continuous bands.
The hatch itself came from the structure pass's 16-bit distance: its quantization flips the binary
mask on flat surfaces. The structure pass now writes 32-bit distances. The quarter-size star splats
are gone, and the box no longer has an ink outline. Short ribbed teeth remain on its right edge, on
the wall-base marks and along the table line.

Against the current technique at half size on WebGPU, 11.8% of the occlusion picture's pixels move
by more than 8 steps of 255. Of those, 5.2% grow darker and 6.6% grow lighter. At quarter size the
shares are 12.6%, 4.3% and 8.3%. The shaded scene moves by 0.27% of its pixels at half size and
0.12% at quarter, by the page's measure. That measure counts a pixel by its largest channel step,
against the three.js variant of the current technique. The look reviewer compared the bitmask with
the GTAO variant. It measured 0.07% of the shaded scene's pixels at half size, 0.14% at quarter and
0.08% on WebGL2, by per-pixel luminance. Both support a small change.

Pictures: `tests/image/references/*/webgpu|webgl2/proto-ao-{current,bitmask}-{half,quarter}.png`.
They were drawn on the Mac's GPU and on SwiftShader. `target/proto-s3/pictures/` holds the larger
side-by-side set. The separate look reviewer judges them. This record states what the pictures show,
and does not pass its own look.

## Decision

The engine adopts the bitmask variant, in a fragment shader:

- It removes the dark halos behind thin objects, which is the fault the variant exists to fix. Its
  contacts follow the touch points, and the seam's width comes back, except at the table's back
  edge.
- At the same slices, steps and 16-tap denoise, it costs less than the current technique. On
  WebGPU at half size the gap is 0.13 to 0.16 ms. On WebGL2 the two are equal within the run's
  spread.
- The fragment form needs no storage texture. It fits WebGPU's default limit of four on every
  device, so no capability flag or fallback is needed.

The compute form is rejected. At full size it needs five storage textures against a default of
four. It would need a capability check and a fallback. At the reduced sizes it needs four and fits.
It still costs a capability check, a buffer-based interface and a second implementation. It gives
no measured gain over the fragment form.

Three.js's denoise stays, at a wider 8-texel radius for the bitmask's mask. The bitmask writes the
same normal, and the denoise reads it. Filament's separable bilateral denoise stays a separate
change, as the technique review lists it.

## Consequences

- The engine change replaces the horizon search in `ao.wgsl` and leaves the two steps around it. It
  keeps the normal output that the denoise reads, and it widens the denoise's radius for the mask.
  It turns the sample pattern with an integer hash per texel. It shortens each sample's sector
  span by the distance falloff.
- The settings change meaning. `distanceExponent` still spreads the search's steps. `thickness`
  becomes the slab's thickness. `distanceFalloff` maps onto the falloff that shortens each sector
  span. It goes if the mapping cannot hold. The API reference, the three.js mapping and the skills
  change with that work.
- The prototype page, its driver and its four image tests retire when the engine's own AO tests draw
  the picture. Until then they keep this record's figures reproducible.
- The iPad's and the phone's AO cost is still S3's question. This record settles the Mac's two
  paths. The bitmask costs no more than the current technique at equal work. A device that can
  afford the current AO can afford the bitmask.
