---
id: guides/first-use-shaders
title: Shaders that load on first use
generated: true
summary: "The features whose shaders download on first use, which createEngine's preload takes."
---

# Shaders that load on first use

> [Loading screens](loading-screens.md#loading-everything-up-front) explains this table. The engine's shader manifest makes it, so it lists every feature of this version.

Most shaders come with the engine's start. The shaders of each feature below download the first time the sketch uses the feature. `createEngine`'s `preload` option takes these names, and loads their shaders before the first frame.

## Post-processing

| Feature | Its shaders download | Until they are built |
| --- | --- | --- |
| `'ao'` | when `post.set` turns ambient occlusion on, or with the first opaque material where the preset draws the screen-space bounce light that reads its steps |  |
| `'bloom'` | when `post.set` turns bloom on |  |
| `'dof'` | when `post.set` turns depth of field on |  |
| `'effect_groups'` | the first time custom effects join into one pass, or fold into the final pass | Until its shaders are built, each effect draws a pass of its own |
| `'exposure'` | when `post.set` turns automatic exposure on | The camera keeps its own exposure until the meter is built |
| `'fog_volume'` | when `scene.setFog` turns the volumetric fog on | The fog keeps its sun glow until the fog is built |
| `'taa'` | only by an internal test option of temporal anti-aliasing, which the public API does not offer | No quality preset turns it on, so a page never downloads these shaders, and preloading `'taa'` only adds to the download |

## Materials

| Feature | Its shaders download | Until they are built |
| --- | --- | --- |
| `'bump'` | with the first material with a bump map |  |
| `'coat_sheen'` | with the first material with a clear coat, a sheen, iridescence or anisotropy |  |
| `'decals'` | with the first mesh of a decal material (`materials.decal`) |  |
| `'displacement'` | with the first material with a displacement map, which also loads the builds of parallax | Its mesh draws nothing until they are built |
| `'particles'` | with the first particle system (`@null3d/particles`) |  |
| `'subsurface'` | with the first material whose light spreads under its surface (`subsurfaceRadius`) | The skin pass and the blur draw its light |

## Transparency

| Feature | Its shaders download | Until they are built |
| --- | --- | --- |
| `'coverage'` | with the first masked material that MSAA smooths with alpha to coverage |  |
| `'cutout'` | with the first masked object that casts shadows | It casts none until its shaders are built |
| `'hash'` | with the first material whose alpha mode is `'hash'` |  |
| `'moment'` | when the quality setting `momentTransparency` is on and the first blended surface draws | The surfaces draw sorted until the layer and its anti-aliasing are built |
| `'single_layer'` | with MSAA, when the first blended draw of a feature at the `'resolve'` frame point draws | Its surfaces blend in the transparent pass until the layer is built |
| `'translucency'` | with the first material that lets light through a thin surface (`diffuseTransmission`) |  |
| `'transmission'` | with the first material that lets light through (`transmission`) |  |
| `'weighted'` | with the first material of the `'weighted'` blending |  |

## Lights and shadows

| Feature | Its shaders download | Until they are built |
| --- | --- | --- |
| `'area_lights'` | with the first rectangle or tube light |  |
| `'occlusion'` | with the first opaque material while GPU occlusion culling runs on WebGPU | Until its shaders are built, the engine draws without it. WebGL2 has no such shaders |
| `'probe_grid'` | when the sketch first sets a light probe grid (`scene.setLightProbeGrid`) |  |

## Sky and background

| Feature | Its shaders download | Until they are built |
| --- | --- | --- |
| `'background'` | with the first texture, environment or cube map background |  |
| `'clouds'` | with the first sky background with clouds while `cloudSteps` is above 0, as High and Ultra set it, or with the first frame that draws the sky's volumetric cloud tier after `quality.set({ cloudSteps })` | A page that draws the flat layer downloads none of it. The noise field of its march is made in the browser when the tier first draws |
| `'physical_sky'` | with the first physical sky background (`atmosphere`) | The view shows the background color until the sky is built |
| `'sky'` | with the first sky background |  |

## Meshes and animation

| Feature | Its shaders download | Until they are built |
| --- | --- | --- |
| `'lines'` | with the first line batch |  |
| `'lod_fade'` | with the first mesh whose levels of detail fade, or whose distance bands fade | The quality setting `lodFade` turns the bands' fades off on Low, not a level's fade |
| `'morph'` | with the first morphed mesh, or as soon as the sketch reads a glTF file with morph targets | WebGPU morphs in the skinning pass, so there `'morph'` downloads the skinning shaders |
| `'picking'` | with the first `scene.pick()` call | which waits for the shaders |
| `'row_values'` | with the first instance batch whose rows have colors or values (`colors: true` or `values: true`) |  |
| `'skinning'` | with the first skinned mesh, or as soon as the sketch reads a glTF file with skins |  |
| `'sprites'` | with the first sprite batch |  |

## Engine passes

| Feature | Its shaders download | Until they are built |
| --- | --- | --- |
| `'cluster_levels'` | with the first frame that draws a tree of cluster patches (`setMeshPatches`), which builds the pass that picks a tree of patches | A scene without a tree downloads none of it, and WebGL2 never builds that pass |
| `'color_copy'` | with the first step that reads the color that the frame before showed: the first material that lets light through, screen-space reflections, or the bounce light that the preset draws | whose file downloads with the first opaque material |
| `'motion'` | when a pass first reads the motion | The motion debug view is such a pass, and it exists in development builds only |
| `'views'` | with the first scene pass | Its texture shows nothing until its shaders are built |

## Engine tests

A page never needs these features.

| Feature | Its shaders download | Until they are built |
| --- | --- | --- |
| `'instance_index'` | only in the engine's own tests, through a test switch of WebGPU's instance data |  |
| `'texcoords'` | only in the engine's own tests, which draw meshes colored by their texture coordinates |  |
