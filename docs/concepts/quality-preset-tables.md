---
id: concepts/quality-preset-tables
title: Quality preset tables
status: generated
since: "0.1"
summary: "Each preset's starting devices, GPU path caps, check rules and settings."
---

# Quality preset tables

> [Quality presets](quality-presets.md) explains these tables. The engine's own constants make them.

## Starting preset of each device

| Device | Main pointer | Smaller screen edge | Starting preset |
| --- | --- | --- | --- |
| Phone | coarse | under 600 CSS pixels | Low |
| Tablet | coarse | 600 CSS pixels or more | Medium |
| Desktop or laptop | fine | any | High |

A memory reading under 4 GB lowers the starting preset by one.

## Highest preset of each GPU path

| GPU path | Highest preset |
| --- | --- |
| WebGPU | Ultra |
| WebGPU's compatibility mode | Medium |
| WebGL2 | Medium |

## Rules of the preset check

| Rule | Value |
| --- | --- |
| Target frame rate | The display's refresh rate, at most 60 frames per second unless `targetFps` asks for more |
| A preset holds its target | At 90% of the target or more |
| Frames drawn before each measurement | 250 ms, and up to 2000 ms more while textures upload |
| Measurement of each preset | 500 ms |

## Settings of each preset

| Setting | Low | Medium | High | Ultra | Changes | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Pixel ratio cap (`maxPixelRatio`) | 1.5 | 2 | 2 | none | during play | built |
| Lowest render scale (`minRenderScale`) | 0.5 | 0.6 | 0.75 | 1 | during play | built |
| Highest render scale (`maxRenderScale`) | 1 | 1 | 1 | 1 | during play | built |
| Anti-aliasing (`antialias`) | FXAA | MSAA 4x | MSAA 4x | MSAA 4x | at the start | built |
| Moment transparency (`momentTransparency`) | no | no | no | no | at the start | built |
| Shadow cascades (`shadowCascades`) | 2 | 3 | 3 | 4 | at the start | built |
| Shadow map size in texels (`shadowMapSize`) | 1024 | 2048 | 2048 | 4096 | at the start | built |
| Shadow filter (`shadowFilter`) | 3 x 3 texels | 5 x 5 texels | 5 x 5 texels | 5 x 5 texels | during play | built |
| Far cascade updates (`farCascadeInterval`) | every 4th frame | every 3rd frame | every 2nd frame | every 2nd frame | during play | built |
| Far cascades follow moving casters (`followMovingCasters`) | yes | yes | yes | yes | during play | built |
| Far-animation updates (`farAnimationInterval`) | every 4th frame | every 4th frame | every 2nd frame | every frame | during play | built |
| Blend between shadow cascades (`shadowCascadeBlend`) | 10% of each cascade | 10% of each cascade | 10% of each cascade | 10% of each cascade | during play | built |
| Spot and point light shadow tiles (`shadowTiles`) | 4 | 8 | 16 | 24 | at the start | built |
| Shadow tile size in texels (`shadowTileSize`) | 512 | 512 | 1024 | 1024 | at the start | built |
| Hero shadow tile size in texels (`heroTileSize`) | 1024 | 2048 | 2048 | 4096 | at the start | built |
| Point light shadows (`pointLightShadows`) | no | no | yes | yes | at the start | built |
| Bloom's largest level in texels on the short side (`bloomSize`) | 64 | 512 | 512 | 512 | during play | built |
| Ambient occlusion (`aoScale`) | off | off | half resolution | half resolution | during play | built |
| Contact shadows (`contactShadowSteps`) | off | off (WebGL2: 4 steps at half resolution) | 8 steps at half resolution | 16 steps at half resolution | during play | built |
| Depth of field (`dofSamples`) | off | 22 taps at half resolution | 43 taps at half resolution | 71 taps at half resolution | during play | built |
| Subsurface blur of skin (`subsurfaceSamples`) | off | off | 17 taps each way | 25 taps each way | during play | built |
| Screen-space reflections (`ssrScale`) | off | quarter resolution | half resolution | half resolution | during play | built |
| Screen-space reflection steps per ray (`ssrSteps`) | 16 | 24 | 48 | 64 | during play | built |
| Screen-space bounce light (`bounceRays`) | off | off (WebGL2: 4 rays each way) | 4 rays each way | 8 rays each way | during play | built |
| Automatic exposure's meter (`exposureMeter`) | 16 x 16 cells | histogram on WebGPU, else 16 x 16 cells | histogram on WebGPU, else 16 x 16 cells | histogram on WebGPU, else 16 x 16 cells | during play | built |
| Volumetric fog (`fogSlices`) | off, sun glow only | 32 slices | 64 slices | 96 slices | during play | built |
| Reflection passes (`reflectionScale`) | quarter resolution | half resolution | half resolution | full resolution | during play | built |
| Reflection probe maps (`probeSize`) | 128 x 128 | 256 x 256 | 256 x 256 | 256 x 256 | during play | built |
| Area lights per frame (`areaLights`) | 4 | 8 | 16 | 32 | during play | built |
| Depth-fitted light clusters (WebGPU) (`lightFit`) | no | yes | yes | yes | during play | built |
| Level of detail threshold (`lodThreshold`) | 2 px | 1 px | 1 px | 1 px | during play | built |
| Level of detail threshold in shadows (`lodShadowThreshold`) | 1 texel | 1 texel | 1 texel | 1 texel | during play | built |
| Distance band fades (`lodFade`) | no | yes | yes | yes | during play | built |
| Physical sky (`physicalSky`) | the analytic sky stands in | from its tables | from its tables | from its tables | during play | built |
| Cloud march steps (`cloudSteps`) | flat layer | flat layer | 32 | 48 | during play | built |
| Frame-budget governor (`governor`) | on | on | on | on | during play | built |
| Depth prepass (`depthPrepass`) | no (WebGL2: yes) | no (WebGL2: yes) | no (WebGL2: yes) | no (WebGL2: yes) | at the start | built |
| GPU occlusion culling (WebGPU) (`gpuOcclusion`) | no | no | yes | yes | at the start | built |
| Morph targets per object on WebGL2 (`morphTargets`) | 8 | 16 | 32 | 64 | at the start | built |
| Software occlusion culling (WebGL2) (`softwareOcclusion`) | no | no | no | no | during play | built |
| Parallax occlusion mapping (`parallax`) | no | yes | yes | yes | during play | built |
| Soft particles (`softParticles`) | no | yes | yes | yes | during play | built |
| Anisotropic filtering cap (`maxAnisotropy`) | 2x | 4x | 8x | 16x | during play | built |
| Texture uploads per frame (`uploadBytesPerFrame`) | 2 MiB | 4 MiB | 8 MiB | 16 MiB | during play | built |
| Point and spot lights per frame (`maxLights`) | 256 | 256 | 512 | 1024 | at the start | planned |
| Lights per cluster (`maxLightsPerCluster`) | 32 | 64 | 64 | 128 | at the start | planned |
| Texture memory budget (`textureMemoryMiB`) | 256 MiB | 512 MiB | 1024 MiB | 2048 MiB | during play | built |
| Engine memory maximum (`memoryMaximumMiB`) | 1024 MiB | 1024 MiB | 1024 MiB | 1024 MiB | before loading | built |
