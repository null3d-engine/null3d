---
id: porting/threejs-unsupported
title: Unsupported three.js features
summary: "three.js features with no null3D equivalent, with workarounds."
---

# Unsupported three.js features

Most three.js features have a null3D equivalent, which the [three.js to null3D mapping](threejs-mapping.md) gives. This page lists the features that have none, and the parts of features that behave differently. Each entry gives the workaround.

Check this list before a port starts. When a feature is central to the app, such as an XR experience, keep the app in three.js. Never drop a feature without telling the app's owner.

Do not draw a three.js canvas over the null3D canvas to keep one effect. Two GPU contexts double the memory, and their frames fall out of step.

## Rendering and output

| three.js | In null3D | Workaround |
| --- | --- | --- |
| WebXR: `renderer.xr`, `VRButton`, `ARButton` | null3D draws to a canvas on the page, with no XR session | Keep an XR app in three.js |
| `ArrayCamera` and `StereoCamera` | No stereo drawing | For split screens, give each view a camera and a rectangle of the canvas ([Multiple views](../guides/multiple-views.md)) |
| `BasicShadowMap` and `VSMShadowMap` | Shadows use percentage-closer filtering | The `shadowFilter` quality setting sets the filter size ([Shadows](../concepts/shadows.md)) |
| `light.shadow.camera` | The shadow cascades fit the camera's view | Tune `mapSize`, `cascades` and the bias |
| `side: BackSide` | Materials draw front faces, or both sides with `doubleSided: true` | Flip the geometry's winding |
| `material.envMap` on one material | One environment lights the whole scene | `scene.setEnvironment`, with `envIntensity` on each material ([Lighting](../concepts/lighting.md)) |
| A `CubeTexture` as a material's map | Materials do not sample cube maps | A cube map can be a background with `assets.loadCubemap`. For reflections, load an environment with `assets.loadEnvironment` |
| `AfterimagePass` | Effects cannot read the previous frame | No port |
| `TAARenderPass` with a moving camera | A still view blends jittered frames, but a moving view does not | Use MSAA or FXAA |
| `OITPass`'s `weightNode` | The weighted blending uses three.js's default weight | No change of weight |

## Materials and shaders

| three.js | In null3D | Workaround |
| --- | --- | --- |
| `MeshToonMaterial` | Surface functions cannot read the scene's lights | A toon surface function with the light's direction as a uniform, or a lobe function that follows each light ([Porting materials and textures](threejs-materials.md#meshtoonmaterial-and-meshmatcapmaterial)) |
| Standard maps on a `ShaderMaterial` | A custom material takes no standard maps, such as `map` or `normalMap` | Declare up to 6 textures in the WGSL, and pass them with the `textures` option ([Porting shaders](threejs-shaders.md)) |
| An `InstancedBufferAttribute` with more than four floats for each instance | A batch row carries four values and a color | Pack the data into the four values. Or keep the rest in a data texture from `textures.fromData`, and read it with `textureLoad` at the row's place, `input.instance` ([Per-row values](../concepts/instances.md#per-row-values)) |
| A `ShaderMaterial` whose uniforms pass 32 numbers | A custom material's uniforms fit in 32 numbers, less one for each texture | Keep the rest in a data texture, and read it with `textureLoad` ([Porting shaders](threejs-shaders.md)) |
| `onBeforeCompile` shader chunks | The engine has no shader chunks to patch | A surface function or a vertex offset function |
| `material.alphaMap` | No separate alpha map | Copy the map's green channel into the base color map's alpha |
| `PointsMaterial.alphaMap` | No alpha map on points | Put the alpha in the points' `map` |
| Clipping planes | No clipping planes | A surface function with `alphaMode: 'mask'` ([Porting materials and textures](threejs-materials.md)) |

## Objects and scenes

| three.js | In null3D | Workaround |
| --- | --- | --- |
| `SkinnedMesh`, `Skeleton` and `Bone` built in code | Skeletons come from glTF files, and joints are not objects | Make the skeleton in a modeling tool and export glTF. Turn a joint from code with the animator's joint calls ([Animation](../api/animation.md)) |
| `object.userData` and subclasses of `Mesh` | Engine objects take no new properties | Your own `Map` or typed arrays, keyed by object or row |
| `onBeforeRender` and `onAfterRender` | No sketch code runs while the engine draws | `onUpdate` or `onLateUpdate`, or a declared pass |
| Shadows from lines, points and sprites | Lines, points and sprites cast no shadows and receive none | Use a mesh where a shadow matters |
| Particles lit by the scene's lights | Particles take no light and cast no shadows | Color the particles with their own curves ([Particles](../api/particles.md)) |
| `TextGeometry`, `FontLoader` and troika-three-text | null3D draws no text of its own | HTML labels with `ui.trackLabel` for text that follows an object, a texture for text on a surface, or a text mesh baked into glTF |
| Physics add-ons | null3D has no physics API | Run cannon-es or Rapier in the sketch worker ([Using a physics library](../guides/physics.md)) |
| Terrain collision | `@null3d/terrain` has no collision | Give the physics library its own height field |

## Controls and helpers

| three.js | In null3D | Workaround |
| --- | --- | --- |
| `TrackballControls` and `ArcballControls` | No trackball or arcball controls | `createOrbitControls`, or your own rotation from `ctx.input` |
| Controls events: `change`, `start` and `end` | The controls send no events | `update(dt)` returns true when the camera moved |
| `PlaneHelper` and `PolarGridHelper` | No debug drawing for them | Draw the shape with `debug.arrow`, `debug.box` or lines |
| `MathUtils.smootherstep`, `pingpong`, `generateUUID` and the power of two helpers | No helpers of these names | Write them in a line each, or use `crypto.randomUUID()` |

## Audio

| three.js | In null3D | Workaround |
| --- | --- | --- |
| `AudioLoader` | No loader | Name the file by its address. The page loads it once the user starts the sound ([Sound](../api/sound.md)) |
| `AudioAnalyser` | No analyser | Analyze the page's own Web Audio |

## React Three Fiber and drei

| React Three Fiber or drei | In null3D | Workaround |
| --- | --- | --- |
| drei `<ContactShadows />` | No blurred shadow from above | `materials.shadowCatcher` shows the directional light's own shadow |
| `onPointerMissed` | No miss event | Set a flag in the click handlers, and treat a release without it as a miss |
| drei `<AdaptiveDpr>` with `performance.regress()` | The governor follows frame times, not camera movement | Remove the `regress()` calls |
| Pointer events on objects behind the closest one | Only the closest object and its parents get an event | `scene.raycastAll` finds the objects behind, nearest first |

null3D's own [contact shadows](../concepts/shadows.md#contact-shadows) are another effect: the short dark line where an object meets the ground, cast toward the main directional light ([demo](https://github.com/null3d-engine/null3d/tree/main/examples/contact-shadows/)).

[Porting React Three Fiber](react-three-fiber.md) covers the rest of a React Three Fiber port.

## Related pages

- [Porting from three.js](threejs-overview.md)
- [three.js to null3D mapping](threejs-mapping.md)
- [Porting materials and textures](threejs-materials.md)
- [Porting shaders](threejs-shaders.md)
- [Verifying a port](verification.md)
