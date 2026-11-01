# Weather

An example add-on that puts rain where it lands: water on the ground, drops on a car's glass, and
the link to the particles add-on for the splashes and steam that rain makes. It adds the water to a
surface that a scene already draws, so the scene keeps its own material, its maps and its paint.

## The rain itself

The falling streaks are not this add-on's. They come from the core's draw from a vertex count
(`scene.createVertexDraw`), as the rain demo and Skyway draw them. The splashes and the steam come
from `@null3d/particles`, which this add-on wraps in two small calls.

## The wet surface

A scene's material owns its surface function. The add-on's water is one WGSL block that the surface
copies into its own file and calls at its end, because the shader build resolves only the engine's
library: a shader cannot import another shader. `wet.wgsl` holds the canonical block between the
markers `// <wet-surface>` and `// </wet-surface>`, and `wet.test.ts` fails when any copy is edited
alone. The wind add-on shares its field block the same way.

Copy the block into the material's WGSL after its own functions, then make the surface call it.
The material also declares the mirror texture and the three setting vectors, and imports the two
library items the block uses:

```wgsl
#import null3d::noise::{value2}
#import null3d::reflection::{reflection_uv}

struct Uniforms {
    // The scene's own values, then the add-on's three vectors.
    wet0: vec4f,
    wet1: vec4f,
    wet2: vec4f,
}

var wetMirror: texture_2d<f32>;

// <wet-surface>
// ... the block copied from wet.wgsl ...
// </wet-surface>

fn surface(input: SurfaceInput) -> Surface {
    var s = defaultSurface(input);
    // The scene's own look: its maps, its paint, its lane markings.
    // `depth` is the water depth: from the scene's map, or from wet_noise_depth.
    let depth = wet_noise_depth(input.worldPosition.xz, 16.0);
    return wet_surface(s, input, depth, material.wet0, material.wet1, material.wet2);
}
```

The block's settings are three vectors of four numbers:

| Vector | Numbers |
| --- | --- |
| `wet0` | The puddle coverage, the edge's softness, the ripple cell in meters, and the ripples a cell shows a second |
| `wet1` | How dark the water turns the surface, the planar mirror's share, the water's roughness, and how far the rings bend the normal |
| `wet2` | The time, the rain's strength, the asphalt grain's scale, and the planar mirror's share on the wet asphalt between the puddles |

A scene starts them from `createWetSurface` and passes them to the material:

```ts
import { createWetSurface } from '../../addons/weather/index';

const wet = createWetSurface(ctx, {
  coverage: 0.55,
  reflection: { scale: 0.5 },   // a planar pass; leave it out to reflect from the screen
});
const street = ctx.materials.shader({
  wgsl: streetWgsl,             // holds the block copy and the call
  uniforms: { ...wet.uniforms },
  textures: { wetMirror: wet.textures.wetMirror },
});
// In each frame, after the scene's own updates:
wet.update(street, time.now);
```

- `createWetSurface` makes the planar reflection pass when `reflection` is given, at a share of the
  render size and a cadence that follows the quality preset: every other frame on Low and Medium,
  every frame above. On a scene without a planar pass the block leaves the mirror to the engine's
  screen-space reflections, and the add-on binds a black stand-in texture.
- `update` writes the frame's time and the look into the material's three vectors, and draws the
  reflection in its turn. It allocates nothing.
- `set` changes the look, such as the rain's strength. `pause` stops the reflection while its
  surface is not drawn, for a cost page that compares two materials.
- `depth` is the scene's own water depth, from 0 for dry ground to 1 for deep water. A scene with a
  puddle map passes its value. A scene without one calls `wet_noise_depth` with the puddles' width
  in meters.
- `createWetGround` makes the add-on's own plain wet ground for a demo or a test that has no
  material of its own.

## Windshield drops

`createWindshield` puts a blended overlay on a car's canopy: beads of water that slide and leave
trails, and an optional wiper that clears them and lets them grow back. The overlay is its own
surface, so the canopy's paint and reflections stay under it.

```ts
import { createWindshield } from '../../addons/weather/index';
import { vehicleCanopy } from '../../addons/traffic-lanes/index';

const shield = createWindshield(ctx, {
  mesh: vehicleCanopy(ctx),      // the canopy of the traffic-lanes hull
  parent: carBody,
  wiper: { every: 7, duration: 0.9 },
});
// In each frame:
shield.update(time.now);
```

`vehicleCanopy` builds the default traffic-lanes vehicle's canopy with texture coordinates across
each face. A scene with another car gives the mesh of its own glass. `setRain` fades the drops to a
dry glass at 0, and `setVisible` turns them off.

## Splashes and steam

`createSplashes` and `createSteam` are small systems over `@null3d/particles`. The splashes are a
crown of water made in code, emitted in bursts where drops land on a patch. The steam is the
particles add-on's smoke puff, lit and drifting.

```ts
const spray = await createSplashes(ctx, { parent: car, position: [0, 2.4, 0] });
const vapour = await createSteam(ctx, { parent: car, position: [0, 1.2, -4.4] });
// In the late update, where every object's world place is this frame's:
spray.update();
vapour.update();
```

Each call returns the particle system, `setVisible` and `setRate`. A scene that computes its own
spray uses the particles add-on directly; these two only save the setup.

## Cost

The wet surface costs the ground pixels that it draws: two noise reads for the depth where a scene
uses `wet_noise_depth`, one hash for the ripple cell, and the mirror read where a planar pass is
bound. A scene reflects from the screen instead pays nothing extra for the water, since the engine's
screen-space reflections already run. The planar pass costs what any reflection pass costs, at the
share of the render size and the cadence its preset gives it.

The cost page and its spec are `tests/pages/weather-cost.ts` and `tests/image/weather-cost.spec.ts`.
The page times a plain ground against the wet ground, and the wet ground against the same ground
with the planar mirror, in turns. The figures per GPU path and preset are in
[the run file](../../../.dev/tested-devices/macbook-pro-m3-max-chrome/20261030-120731-weather-cost.md).

On an Apple M3 Max with Chrome 156 at 1920 by 1080, the wet surface added 0.568 ms of GPU time on
WebGPU at Low, 0.576 ms on compatibility and 0.559 ms on WebGL2. The three agree within 0.02 ms, so
the water's cost is the shader's own work rather than the path's. At Medium and above the run's
variation hides it.

The planar mirror was small on WebGPU and compatibility. On WebGL2 its CPU cost held at about
0.6 ms at every preset, and its GPU cost was 3.2 to 4.1 ms at Medium and above. At Low the GPU cost
is not firm: the two readings gave 0.83 and 1.59 ms, and the first sits beside WebGPU's 0.68 ms at
the same preset. No row moved a frame interval.

The windshield is one blended draw of the canopy's own triangles, and the splashes and steam are
particle buffers of the sizes their calls name.

## Limits

- The surface faces up, as a road, a floor or a roof does. The block bends the normal toward up.
- The block samples the planar mirror in the surface function. A material that declares an alpha
  mask runs its surface function in the shadow caster too, so keep the wet readers opaque.
- A custom material samples at most six textures of its own. A scene that already uses six has no
  room for `wetMirror`.
- A planar reflection pass once stopped the frame on WebGL2 when its view drew a particle system
  beside a blended mesh. The engine fault is fixed and recorded
  ([D-278](../../../.dev/decisions/D-278-reflection-pass-particle-trap.md)), so leaving the
  particles in the mirror is safe. `createSplashes` and `createSteam` still take `layers`, and a
  scene that leaves them out sets the layer on both the particles and the pass, while the camera's
  layers keep drawing them. The weather cost page and its picture test keep the split until their
  pictures are drawn again.
- A pass switch reaches the frame after the call (`render.setPassEnabled`). A scene that switched
  its pass and then held a single frame showed no mirror in it, with no error to say so. The
  add-on therefore switches its pass on at the first update and one update before each draw, and a
  picture test of a scene with a cadenced pass must let the pass draw once before it captures.
- The plan: the reader copies the block. An edited copy fails `wet.test.ts` until it is copied
  again from `wet.wgsl`.
- Eight of the pictures that this add-on moves are owed to a CI picture run: the weather test's
  three tiers, the Skyway demo's three (its ground is wet now) and the night town comparison's two
  (its street draws rain). The weather test's three are missing, so `bun run limits` fails until
  they are drawn. The other five exist but are stale, and so does the comparison's Linux WebGL2
  device reference, which the device tolerance of half a per cent leaves probably passing.
- The drops and the reflections need both GPU paths, as the rest of the engine does.

## Licence

MIT OR Apache-2.0. The engine's two licence files at the repository root hold the terms.
