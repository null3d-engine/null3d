---
id: porting/threejs-mapping
title: three.js to null3D mapping
generated: true
summary: "Every three.js API a port is likely to meet, with its null3D equivalent."
---

# three.js to null3D mapping

Status values:

- `direct`: Same concept; the call or option changes name only.
- `changed`: Supported, with a different API or pattern. Follow the note.
- `manual`: Must be rewritten by hand, for example GLSL shaders or render hooks.
- `unsupported`: null3D has no equivalent. Use the workaround in the note.

## Renderer and loop

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| WebGLRenderer / WebGPURenderer | createEngine({ canvas, sketch }) on the page; scene code moves to sketch.ts inside defineSketch() | changed | The engine picks WebGPU or WebGL2 itself. `antialias: true` becomes `createEngine({ antialias: 'msaa' })`, and `false` becomes `'none'`. `alpha: true` becomes `transparent: true`, and `powerPreference` keeps its name. Details below the table. | [Your first scene](../getting-started/first-scene.md) |
| renderer.setPixelRatio(devicePixelRatio) | createEngine({ maxPixelRatio }) and the quality presets; quality.set({ maxPixelRatio }) in the sketch | changed | The engine sizes the canvas to its CSS size times the screen's pixel ratio, up to the quality preset's cap. The option replaces the cap, and quality.set changes it during play. | [Quality presets, dynamic resolution and frame budgets](../concepts/quality-presets.md) |
| renderer.setSize / window resize handler / camera.aspect + updateProjectionMatrix | Automatic | changed | The engine follows the canvas's CSS size. Perspective cameras, and orthographic cameras made with a height, follow its aspect ratio in every frame. Delete resize handlers and updateProjectionMatrix calls. | [Page API: createEngine](../api/engine.md) |
| requestAnimationFrame(animate) / renderer.setAnimationLoop / renderer.render(scene, camera) | onUpdate(dt) returned from defineSketch() | changed | The engine renders every frame by itself; never call a render function. Per-frame logic goes in onUpdate, camera-follow logic in onLateUpdate. | [Sketch API: defineSketch and the context](../api/sketch.md) |
| renderer.shadowMap.enabled / .type (PCFShadowMap, PCFSoftShadowMap) | castShadows: true on the light; the shadowFilter quality setting sets the filter | changed | PCFShadowMap and PCFSoftShadowMap become the shadowFilter setting: 3 x 3 or 5 x 5 texels, by preset. quality.set({ shadowFilter }) changes it during play. | [Shadows](../concepts/shadows.md) |
| BasicShadowMap / VSMShadowMap | None; the shadowFilter quality setting chooses the filter | unsupported | null3D filters every shadow with PCF, a 3 x 3 or 5 x 5 kernel chosen by the shadowFilter quality setting. It draws no basic or variance shadow map. | [Shadows](../concepts/shadows.md) |
| renderer.toneMapping (ACESFilmic, AgX, Neutral, Reinhard, Cineon, Custom, Linear) / toneMappingExposure | post.set({ toneMapping: 'agx' \| 'agx-punchy' \| 'neutral' \| 'aces' \| 'none' \| curveWgsl, exposure }) | changed | The engine default is `agx-punchy`, and three.js defaults to none, so a port of a scene with none sets `toneMapping: 'none'`. A port keeps its curve: AgX becomes `'agx'`, ACES `'aces'` and Neutral `'neutral'`. Copy `toneMappingExposure` to `exposure`, but keep `exposure` at 1 for NoToneMapping, which ignores it. Details below the table. | [Post-processing API](../api/post.md) |
| renderer.outputColorSpace / outputEncoding / ColorManagement / material.dithering | Nothing to do | direct | Output is sRGB from a linear working space, as in three.js r152+ defaults. Hex colors are sRGB, and `[r, g, b]` arrays are linear, as three.js reads them. Delete the output and color management lines. Details below the table. | [Color management](../concepts/color-management.md) |
| renderer.info / stats.js | debug.stats(true), or createEngine({ stats: true }) on the page; debug.frameStats() for numbers | changed | The overlay shows frame rates, per-thread CPU time, draw calls, the GPU tier and the preset. Click it for a card of thread and GPU times, objects drawn and memory. In the sketch, `debug.frameStats()` also gives the textures' GPU bytes, their budget and their dropped mip levels. Details below the table. | [Debug drawing and stats](../api/debug.md) |
| renderer.info.memory.textures | quality.textureMemory; textures.memoryBytes; the quality setting textureMemoryMiB; debug.frameStats().gpuTextureBytes and gpuBufferBytes | changed | three.js counts the textures it holds and sets no byte budget. null3D reports the textures' GPU bytes and holds them under the preset's budget. Past it, textures from files drop their largest mip levels, which load again when room returns. Details below the table. | [Quality presets, dynamic resolution and frame budgets](../concepts/quality-presets.md) |
| renderer.compile / compileAsync (pre-warming shaders) | await scene.warmUp() before hiding the loading screen | changed | The first frame waits for its pipelines. warmUp resolves once every pipeline that the scene needs is built, hidden objects included, so warm up a later loading stage before you show it. | [Loading screens and warm-up](../guides/loading-screens.md) |
| renderer.setClearColor / scene.background = color or texture | scene.setBackground('#rrggbb' \| texture \| environment \| cube map \| { sky }, options) | direct | A texture background fills the view behind every object and stretches to its shape. An environment or cube map surrounds the scene, as a PMREM texture or CubeTexture does. For an exact page color, set `toneMapping: 'none'` or use `createEngine({ transparent: true })` over CSS. Details below the table. | [Scene](../api/scene.md) |
| document.body.appendChild(renderer.domElement) | createEngine({ canvas }) | changed | Create the canvas in HTML or in page.ts and pass it in. The engine hands it to the render worker. | [Your first scene](../getting-started/first-scene.md) |
| preserveDrawingBuffer + canvas.toDataURL / readRenderTargetPixels | await engine.capture() on the page | changed | Resolves with a PNG Blob of the next frame that the engine draws. Tests read pixels with engine.captureFrame() instead. | [Page API: createEngine](../api/engine.md) |
| WebGLRenderTarget / RenderTarget / renderer.setRenderTarget (render to texture) | const pass = render.addPass({ kind: 'scene', camera, writes: 'myTexture', size: [width, height] }); materials.unlit({ map: textures.fromPass(pass) }) | changed | Declare a pass and let the render graph order it, run it while its texture shows, and plan its memory. A pass never draws objects that show its own texture. Scene passes draw point and spot lights and the background, but no ambient occlusion. Details below the table. | [Custom passes and render targets](../guides/custom-passes.md) |
| renderer.setViewport / setScissor (split screens, picture in picture) | scene.createView({ camera, rect }): one scene drawn again from another camera, into a rectangle of the canvas, after the camera's view | changed | `rect` is `[x, y, width, height]` as fractions of the canvas from its top-left corner. Give each view its own camera, and call `setRect` to change the rectangle without allocating. The camera's own view draws the whole canvas first. Details below the table. | [Multiple views](../guides/multiple-views.md) |
| renderer.capabilities / renderer.extensions | engine.capabilities on the page, and ctx.engine.capabilities in the sketch | changed | Reports the GPU tier, limits and features. Never branch on GPU names: some browsers hide them. | [GPU tiers and backends](../concepts/backends.md) |
| logarithmicDepthBuffer / reverseDepthBuffer | Nothing to do; createEngine({ largeWorld: true }) and batch origins for planet-scale scenes | direct | The engine draws reversed depth in a 32-bit float buffer. On WebGL2 without `EXT_clip_control`, that depth keeps GL's range, which is less precise. `engine.capabilities.depth` says which depth the device draws. Details below the table. | [Large worlds and precision](../concepts/large-worlds.md) |

<details>
<summary>Technical details: WebGLRenderer / WebGPURenderer</summary>

Without `antialias`, the quality preset picks FXAA on Low and MSAA 4x from Medium up. The default `powerPreference` is `'high-performance'`.

</details>

<details>
<summary>Technical details: renderer.toneMapping (ACESFilmic, AgX, Neutral, Reinhard, Cineon, Custom, Linear) / toneMappingExposure</summary>

`ReinhardToneMapping` and `CineonToneMapping` become the `reinhard` and `cineon` curves of `@null3d/three-compat`. `CustomToneMapping` becomes a custom tone curve: `post.set({ toneMapping: wgsl })`. The WGSL declares `fn toneCurve(color: vec3f) -> vec3f`. Leave out the curve's multiply by `toneMappingExposure`, because the color arrives exposed.

The curves use three.js's formulas. `'none'` applies the exposure, as `LinearToneMapping` does. null3D multiplies the exposure into each light rather than into the finished picture. This gives the same image, and bloom's threshold keeps its meaning. A scene in real units sets `ev100` instead, and exposure then acts as exposure compensation. At `ev100` 15, background and unlit colors draw black unless their values are in real units too.

A custom curve needs HDR color, as bloom does. Compatibility mode then draws in HDR color with FXAA. A device without an HDR target keeps the built-in curve.

</details>

<details>
<summary>Technical details: renderer.outputColorSpace / outputEncoding / ColorManagement / material.dithering</summary>

The final pass encodes sRGB and dithers. three.js dithers only materials with `dithering: true`, so delete that option. The difference is at most one step of an 8-bit color.

</details>

<details>
<summary>Technical details: renderer.info / stats.js</summary>

`debug.stats(true)`, `createEngine({ stats: true })`, `engine.stats(true)` or `?stats` turns the overlay on. It sits at the canvas's top right, or at its bottom right with `{ corner: 'bottom-right' }`. Its header shows the frame rate.

The card shows each thread's and the GPU's time against the target frame rate. It also shows the memory of the engine, the GPU's textures and buffers, the heap and the page.

Triangles count every pass, shadow maps included, as `renderer.info.render.triangles` does. Objects count the instances of each draw, so an object counts once per pass that draws it. Each part of a mesh with several materials counts once, as each part is a mesh of its own in three.js. `engine.measure(seconds)` on the page gives percentiles of CPU and GPU time, and memory. `@null3d/engine/stats` shows a three.js page's own figures in the same panel, with `StatsPanel`, or as text, with `statsText`.

</details>

<details>
<summary>Technical details: renderer.info.memory.textures</summary>

`debug.frameStats()` gives the bytes of every GPU texture and buffer that the engine holds. Render targets and shadow maps are included.

</details>

<details>
<summary>Technical details: renderer.setClearColor / scene.background = color or texture</summary>

Exposure and tone mapping change the background, as in three.js's `WebGPURenderer`. `WebGLRenderer` draws a background color, and an sRGB background texture, without them. `setClearColor(color, 0)` on an alpha canvas becomes `transparent: true` with no background.

</details>

<details>
<summary>Technical details: WebGLRenderTarget / RenderTarget / renderer.setRenderTarget (render to texture)</summary>

The texture holds linear color after the exposure. It is upright, with `v = 0` at the bottom, as three.js's render target texture. A reflection pass's texture on the HDR WebGPU path starts at the top row instead. Read it with `reflection_uv`, which turns the rows.

A scene pass draws the scene's background unless a `clearColor` replaces it. A light that only a pass sees casts no shadow there.

A render target the size of the canvas or a share of it takes `scale: 1`, `0.5` or `0.25` in place of `size`. It then follows the render size. A render target that a `ShaderPass` fills becomes a full-screen pass: `render.addPass({ kind: 'fullscreen', wgsl, writes, size or scale, textures })`.

</details>

<details>
<summary>Technical details: renderer.setViewport / setScissor (split screens, picture in picture)</summary>

A split screen that covers the canvas draws the scene once for the camera and once for each view. Each view costs one cull and one scene draw at its rectangle's pixels. The sun's shadows and the lights cost nothing more.

A view's objects take no ambient occlusion or screen-space reflections. The camera's volumetric fog and outline reach the whole image, a view's rectangle included.

For a minimap that a material shows in the world, a scene pass into a texture (`textures.fromPass`) is cheaper than a view. `destroy` removes the view.

</details>

<details>
<summary>Technical details: logarithmicDepthBuffer / reverseDepthBuffer</summary>

The engine renders relative to the camera through per-cell offsets. With `largeWorld: true`, positions keep their full precision at any distance. `createInstances` also takes an origin that its rows are relative to. The page switch `?depth=standard` draws depth as three.js's `WebGLRenderer` does by default. That helps compare pictures with a three.js original. The switch works on WebGL2 only and draws no shadows.

</details>

## Scene graph

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| new THREE.Scene() | The scene from the sketch context: defineSketch(({ scene }) => ...) | changed | Objects are created in the scene directly. | [Scene](../api/scene.md) |
| scene.environment (PMREMGenerator, RoomEnvironment, HDR files) | scene.setEnvironment(await assets.loadEnvironment('/env/sunset.ktx2')) | changed | `loadEnvironment` takes an HDR file, or a map from `bunx @null3d/cli assets env` that needs no filtering. `pmremGenerator.fromScene(new RoomEnvironment(), 0.04)` becomes `await assets.builtinEnvironment('room')`, with the same blur and no file. `scene.environmentIntensity` becomes the `intensity` option. Details below the table. | [Lighting and environment](../concepts/lighting.md) |
| scene.fog = new Fog(color, near, far) | scene.setFog({ curve: 'linear', color, near, far }) | changed | The linear curve keeps three.js's smooth step and its defaults of 1 and 1000. null3D measures the straight-line distance from the camera, where three.js measures depth along the view. So fog at the screen's corners is a little thicker, and it no longer shifts as the camera turns. Details below the table. | [Scene](../api/scene.md) |
| scene.fog = new FogExp2(color, density) | scene.setFog({ curve: 'exp2', color, density }) | changed | Pass three.js's density; its default there is 0.00025, and null3D's is 0.01. null3D measures the straight-line distance from the camera, where three.js measures depth along the view. So fog at the screen's corners is a little thicker, and it no longer shifts as the camera turns. Details below the table. | [Scene](../api/scene.md) |
| VolumeNodeMaterial (webgpu_volume_lighting) / GodRaysEffect | scene.setFog({ color, density, heightFalloff, volumetric: { intensity, anisotropy, distance } }) | changed | three.js has no lit fog in core. Its webgpu_volume_lighting example marches rays through a box, lit by point and spot lights with shadows. null3D lights the scene's own fog instead, in a grid that follows the camera's view, with the sun's cascades and the lights' shadows. Details below the table. | [Scene](../api/scene.md) |
| new Group() / new Object3D() | scene.createGroup({ name, position }) | direct |  | [Objects and transforms](../api/objects.md) |
| parent.add(child) / remove / attach / scene.add | child.setParent(parent); setParent(parent, { keepWorld: true }) for attach(); getParent() for object.parent; destroy() to remove | changed | Objects are in the scene as soon as they are created. `setParent` keeps the local transform, like `add()`, and `getParent()` returns the parent, or null for a root object. Creating, destroying and re-parenting rebuild the draw tables in that frame, so hide with `setVisible` and pool with `setActiveCount` during play ([Performance guide](../guides/performance.md)). Details below the table. | [Objects and transforms](../api/objects.md) |
| object.position.set / .x = / .copy / translateX/Y/Z | obj.setPosition(x, y, z); obj.translate(x, y, z) for translateX/Y/Z | changed | translate moves along the object's own axes, as translateX, translateY and translateZ do together. For many moving objects, use an instance batch and write its positions array directly instead of calling setters. | [Objects and transforms](../api/objects.md) |
| object.rotation (Euler) / rotateX/Y/Z / rotateOnAxis | obj.setRotationEuler(x, y, z, 'XYZ'), obj.rotateX/Y/Z(angle), or obj.setRotation(qx, qy, qz, qw) | changed | Euler order strings match three.js. rotateX, rotateY and rotateZ turn the object about its own axes, as in three.js. For rotateOnAxis, multiply the quaternion from obj.getRotation by one from quat.setAxisAngle, and pass the product to setRotation. | [Objects and transforms](../api/objects.md) |
| object.quaternion.set / slerp / setFromAxisAngle | obj.setRotation(x, y, z, w), with the quaternion from quat.setAxisAngle, quat.fromEuler, quat.multiply or quat.slerp | changed | The quat helpers write into an array that you create once with quat.create(). Pass its four numbers to setRotation. The rotations array of an instance batch takes the same order. | [Math helpers](../api/math.md) |
| object.scale.set / setScalar | obj.setScale(x, y, z) | changed |  | [Objects and transforms](../api/objects.md) |
| object.lookAt(target) | obj.lookAt(x, y, z) | changed | Meshes and groups turn their +Z axis to the point. Cameras and lights turn their -Z axis there, as in three.js. The call assumes that the object's parents are not rotated. | [Objects and transforms](../api/objects.md) |
| object.getWorldPosition / getWorldQuaternion / matrixWorld | obj.getWorldPosition(out), obj.getWorldQuaternion(out), obj.getWorldMatrix(out) | changed | Each getter copies into an array that you make once, with vec3.create(), quat.create() or mat4.create(). They read the engine's last transform update, so a change made in onUpdate shows in the same frame's onLateUpdate. getWorldMatrix gives 16 numbers, column by column, like matrixWorld.elements. | [Objects and transforms](../api/objects.md) |
| matrixAutoUpdate = false / updateMatrix / updateMatrixWorld / matrixWorldNeedsUpdate | Nothing to do: objects are static by default and update when a setter changes them; create objects that move every frame with dynamic: true | changed | Remove manual matrix calls. Move single objects with their setters. Only instance batches take writes to their typed arrays, and a static batch uploads only the rows you mark with markDirty. | [Static and dynamic objects](../concepts/static-dynamic.md) |
| object.traverse / getObjectByName / children | scene.find(name) for getObjectByName; scene.listObjects() at setup, or your own arrays of objects, instead of traverse and children | changed | `scene.find(name)` returns the first object created with that name, from an index. `scene.listObjects()` returns every object as a new array, and `getParent()` returns an object's parent. No call returns an object's children, so keep the objects you need in arrays. Details below the table. | [Objects and transforms](../api/objects.md) |
| object.visible = false | obj.setVisible(false) | direct | Hiding is cheap: it uploads the object's matrix and draw entry. It never rebuilds the draw tables, so use it instead of removing and adding objects during play. The objects under a hidden object, dynamic ones too, stop updating until it shows again. Details below the table. | [Objects and transforms](../api/objects.md) |
| object.castShadow / receiveShadow | mesh.setCastShadows(true) / setReceiveShadows(true), or the castShadows and receiveShadows options of createMesh | direct | Both flags are false by default, as in three.js. The directional, spot and point lights cast them on both GPU paths. Point lights cast where the preset's `pointLightShadows` is on. Details below the table. | [Objects and transforms](../api/objects.md) |
| object.layers / camera.layers (set, enable, disable) | obj.setLayers(mask), obj.getLayers(), camera.setLayers(mask), batch.setLayers(mask); the layers option of createMesh, createInstances and createPerspectiveCamera | changed | Masks use the same 32 bits and the same default of layer 0 alone. A camera draws an object when their masks share a bit. `layers.set(n)` becomes `setLayers(1 << n)`, and `enableAll()` becomes `setLayers(0xffffffff)`. Details below the table. | [Render layers](../concepts/render-layers.md) |
| object.renderOrder | mesh.setRenderOrder(n) | direct | Lower orders draw first, before their depth, as in three.js. An object's depth is the depth of its bounding sphere's center, as in three.js. The engine orders opaque and masked objects itself for speed. Details below the table. | [Objects and transforms](../api/objects.md) |
| object.frustumCulled = false | mesh.setFrustumCulled(false) | direct | Usually needed only for shader-displaced geometry; prefer mesh.setBounds(center, radius) with larger bounds, which keeps culling at work. | [Objects and transforms](../api/objects.md) |
| object.userData | Your own arrays, or a Map keyed by the object | manual | Engine objects have no userData, and their TypeScript types refuse new properties. A Map from each object to its data keeps the data beside the object. Arrays indexed the way your sketch counts objects stay fastest in per-frame loops. | [Handles and objects](../concepts/handles.md) |
| object.onBeforeRender / onAfterRender | onUpdate / onLateUpdate, or a declared pass | manual | The engine draws from lists that the sketch records, so it calls no sketch code per draw. Move per-object work into onUpdate or onLateUpdate. | [Sketch API: defineSketch and the context](../api/sketch.md) |
| object.clone() / SkeletonUtils.clone(gltf.scene) | scene.instantiate(prefab) for loaded models; scene.clone(obj) for built objects | changed | Each instantiate shares the model's meshes, materials and textures. scene.clone copies an object and every object below it, lights and cameras included, under the same parent. A copy of an animated model gets an animator of its own, as SkeletonUtils.clone gives a copy its own skeleton. | [Scene](../api/scene.md) |
| geometry.dispose() / material.dispose() / texture.dispose() | texture.destroy(); material.destroy(); mesh.destroy(); prefab.destroy() for a loaded glTF model | changed | `texture.destroy()` frees a texture's GPU memory, and `material.destroy()` frees the material's place. `mesh.destroy()` frees a mesh's GPU memory at the next frame, and throws E1111 while an object or batch uses it. Destroy objects and batches first, then the mesh. Details below the table. | [Textures](../api/textures.md) |
| scene.overrideMaterial | scene.overrideMaterial = material, and null for each object's own material | direct | The material draws every mesh and instance batch of the main pass. Each keeps its mesh, place and instances, as three.js does. Sprites, points, lines and particle systems keep their own materials, and the shadow maps keep each object's material. Details below the table. | [Scene](../api/scene.md) |
| scene.environmentRotation / backgroundRotation / material.envMapRotation | scene.setEnvironment(env, { rotation }) and scene.setBackground(env, { rotation }) | direct | Rotation is an Euler array in radians, in the order X, Y, Z, as in three.js. Each material shares the scene's rotation, so material.envMapRotation has none of its own. scene.setBackground turns environments and cube maps, not textures or the sky. | [Scene](../api/scene.md) |
| scene.backgroundBlurriness / backgroundIntensity | scene.setBackground(env, { blur, intensity }) | direct | Each `setBackground` call sets that background's options, where three.js keeps them on the scene. The blur reads the environment's level for that roughness, so it costs nothing extra. Only environments blur: ask `assets.loadEnvironment` for one. Details below the table. | [Scene](../api/scene.md) |

<details>
<summary>Technical details: scene.environment (PMREMGenerator, RoomEnvironment, HDR files)</summary>

`pmremGenerator.fromScene(sceneWithSky)` becomes `await assets.skyEnvironment()`, called once. Its map follows `scene.setBackground({ sky })`, so drop calls that rebuild the map after each change. The map leaves out the sun's disc, whose light the directional light gives.

The standard material takes the environment's light with three.js's split-sum table, energy compensation and specular occlusion. three.js's PMREM blurs a little less than GGX. So each roughness reads the level that matches three.js's light best.

</details>

<details>
<summary>Technical details: scene.fog = new Fog(color, near, far)</summary>

null3D mixes the fog in linear color before the tone mapping, as `WebGPURenderer` does. It does the same as `WebGLRenderer` when that draws into a half-float target. Only `WebGLRenderer`'s default 8-bit canvas mixes the fog after the sRGB encoding. There the same fog looks a little darker at middle distances.

Materials opt out with `fog: false`. For new scenes, the default exponential curve looks more like real haze. The fog can also thin with height (`heightFalloff`) and glow toward the sun (`sunGlow`).

</details>

<details>
<summary>Technical details: scene.fog = new FogExp2(color, density)</summary>

null3D mixes the fog in linear color before the tone mapping, as `WebGPURenderer` does. It does the same as `WebGLRenderer` when that draws into a half-float target. Only `WebGLRenderer`'s default 8-bit canvas mixes the fog after the sRGB encoding. There the same fog looks a little darker at middle distances. Materials opt out with `fog: false`.

</details>

<details>
<summary>Technical details: VolumeNodeMaterial (webgpu_volume_lighting) / GodRaysEffect</summary>

Drop the box. The fog's `density` and `heightFalloff` say where the air holds haze, and its scattering intensity becomes `intensity`. The god ray effects of add-on libraries blur a mask of the sky toward the sun on the screen. null3D's rays also come from lamps and from shadows off the screen.

The rays draw where the quality setting `fogSlices` is above 0: Medium and up. On Low the fog keeps its `sunGlow`.

</details>

<details>
<summary>Technical details: parent.add(child) / remove / attach / scene.add</summary>

Under a parent turned and scaled by different amounts per axis, `keepWorld` keeps the child in place. Its rotation and scale then come out close to the old ones, as with `attach()`.

</details>

<details>
<summary>Technical details: object.traverse / getObjectByName / children</summary>

`scene.listObjects` walks the whole scene and allocates. Call it at setup, never in every frame.

</details>

<details>
<summary>Technical details: object.visible = false</summary>

three.js updates the matrices of hidden objects anyway. So hide a pool of spare objects under one parent.

</details>

<details>
<summary>Technical details: object.castShadow / receiveShadow</summary>

Unlit materials show no shadows. An instance batch takes `castShadows` and `receiveShadows` in `createInstances`. `batch.setCastShadows(true)` and `setReceiveShadows(true)` set them for every row.

</details>

<details>
<summary>Technical details: object.layers / camera.layers (set, enable, disable)</summary>

For enable and disable, read the mask with `getLayers()` and pass the new mask. `layers.mask` becomes `getLayers()`. An `InstancedMesh`'s layers become its batch's, for every row. Raycasts and declared passes take layer masks.

Shadow casters differ. three.js tests them against the camera's layers, and null3D tests them against the light's. Give each shadow-casting light the layers of every object that must cast. Otherwise those objects cast nothing.

</details>

<details>
<summary>Technical details: object.renderOrder</summary>

The rows of an instance batch sort by depth one by one. three.js sorts an `InstancedMesh` as one object.

</details>

<details>
<summary>Technical details: geometry.dispose() / material.dispose() / texture.dispose()</summary>

Objects that still use a destroyed material draw nothing. A custom material's pipelines free with its last material. `prefab.destroy()` frees every mesh, material and texture of a loaded model, and its skeleton and clips. It waits until its copies are destroyed.

three.js's `dispose` leaves the object usable and uploads it again on the next render. null3D's destroy ends it, and later calls throw E1101.

</details>

<details>
<summary>Technical details: scene.overrideMaterial</summary>

A masked caster still cuts its shadow. A sprite, point or line material throws E1224. The change rebuilds the draw tables in the next frame, and adds no draw call or pipeline after that.

</details>

<details>
<summary>Technical details: scene.backgroundBlurriness / backgroundIntensity</summary>

three.js turns a blurred `CubeTexture` into a PMREM texture. `intensity` applies to textures, environments, cube maps and the sky.

</details>

## Cameras

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| PerspectiveCamera(fov, aspect, near, far) | scene.createPerspectiveCamera({ fov, near, far, position, target }) | direct | `fov` is vertical and in degrees, as in three.js, and the aspect ratio is automatic. The `fov`, `near` and `far` properties are read-only: change them with `camera.setFov` and `camera.setNearFar`. The defaults are three.js's: fov 50, near 0.1 and far 2000. | [Cameras](../api/cameras.md) |
| PerspectiveCamera.setFocalLength / getFocalLength / filmGauge | camera.setFocalLength(mm) and camera.focalLength | changed | null3D's sensor is full frame, 24 mm tall along the canvas's height, so a focal length gives the same view on every canvas shape. three.js measures its 35 mm `filmGauge` along the longer side. The two agree on a square canvas with `filmGauge` 24. Details below the table. | [Cameras](../api/cameras.md) |
| OrthographicCamera(left, right, top, bottom, near, far) | scene.createOrthographicCamera({ height, near, far, position, target }), or left, right, top and bottom in place of height | direct | With `height` alone, the width follows the canvas's aspect ratio, so resize code goes away. The four edges keep their shape on any canvas, as in three.js. To zoom, call `camera.setOrthoHeight` with the original height divided by three.js's zoom. Details below the table. | [Cameras](../api/cameras.md) |
| camera.setViewOffset(fullWidth, fullHeight, x, y, width, height) / clearViewOffset() | camera.setLensShift(x, y) and camera.lensShift, on perspective and orthographic cameras | changed | A lens shift moves the view off the camera's axis and keeps the perspective. It counts in fractions of the view's width and height, with y up. A full-size view offset becomes `setLensShift(x / fullWidth, -y / fullHeight)`, and `clearViewOffset()` becomes `setLensShift(0, 0)`. Details below the table. | [Cameras](../api/cameras.md) |
| Vector3.project(camera) / Vector3.unproject(camera) | camera.worldToScreen(point, out) for [x, y, depth]; camera.screenToRay(x, y, ray) for a ray through a point | changed | Both take and give CSS pixels from the canvas's top-left corner, not device coordinates. The depth is the distance in front of the camera, and below 0 behind it. A ray through the pointer uses the camera of the frame on screen at the event. Details below the table. | [Cameras](../api/cameras.md) |
| CubeCamera (dynamic reflections) | scene.createReflectionProbe({ box: { min, max }, position, refresh: 'always' }); a reflection pass for a flat mirror: render.addPass({ kind: 'reflection', writes, plane }) | changed | A `CubeCamera` with a `WebGLCubeRenderTarget`, filtered by `PMREMGenerator`, becomes a reflection probe. The probe captures the scene from its position on the GPU and filters it for each roughness. `cubeCamera.update()` in every frame becomes `refresh: 'always'`, and one update after a change becomes `probe.capture()`. Details below the table. | [Scene](../api/scene.md) |
| ArrayCamera / StereoCamera | None; split screens use scene.createView with one camera for each view | unsupported | null3D has no stereo rendering. For split screens, give each view a camera and a rectangle of the canvas. | [Unsupported three.js features](../porting/threejs-unsupported.md) |

<details>
<summary>Technical details: PerspectiveCamera.setFocalLength / getFocalLength / filmGauge</summary>

Depth of field takes the camera's focal length unless its settings give one.

</details>

<details>
<summary>Technical details: OrthographicCamera(left, right, top, bottom, near, far)</summary>

The default height of 2 gives the same view as three.js's default edges, -1 to 1.

</details>

<details>
<summary>Technical details: camera.setViewOffset(fullWidth, fullHeight, x, y, width, height) / clearViewOffset()</summary>

For an offset that draws one tile of a larger picture, also narrow the lens on a canvas of the tile's shape. Set the half angle's tangent to `tan(fov / 2) * height / fullHeight`. An orthographic camera's height becomes `height / fullHeight` of the full one. Then shift by `((x + width / 2) / fullWidth - 0.5) * fullWidth / width` across. Shift by `(0.5 - (y + height / 2) / fullHeight) * fullHeight / height` up.

Culling, shadows, picking, `screenToRay`, `worldToScreen`, labels and views all follow the shift. Delete code that turns the camera to move a subject off center. A turn makes upright lines lean.

</details>

<details>
<summary>Technical details: Vector3.project(camera) / Vector3.unproject(camera)</summary>

three.js starts an orthographic ray on the camera's plane. `screenToRay` starts it on the near plane.

</details>

<details>
<summary>Technical details: CubeCamera (dynamic reflections)</summary>

The probe lights every surface inside its box, not one material. Its box projects the reflections, so walls reflect at their own distance. Give the probe a box around the space that the object moves in. `boxProjection: false` reads it as three.js reads a cube map, as light from far away.

The near and far of the `CubeCamera` fall away. Captures draw from 5 cm out to the camera's far plane. Leave the reflecting object out of its own probe's captures with layers.

</details>

## Lights and shadows

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| DirectionalLight (+ target, shadow.camera bounds) | scene.createDirectionalLight({ direction, color, intensity, castShadows, shadow }) | changed | The light is an object. Pass the target minus the position as `direction`, or call `light.lookAt(x, y, z)` again whenever the target moves. Surfaces show up to four directional lights: the first created casts shadows, and up to three more add fill and rim light. Details below the table. | [Lights](../api/lights.md) |
| PointLight(color, intensity, distance, decay) | scene.createPointLight({ position, color, intensity, range, decay, castShadows, shadow, intensityUnit }) | direct | `distance` becomes `range`, which every point light needs; 0 is refused. `intensity` stays in candela, and `light.power` in lumens becomes `intensity` with `intensityUnit: 'lumen'`. `castShadow` becomes `castShadows`; `shadow` takes `bias` and `normalBias` in meters, and `shadow.camera` has no equivalent. Details below the table. | [Lights](../api/lights.md) |
| SpotLight(color, intensity, distance, angle, penumbra, decay) | scene.createSpotLight({ position, direction \| target, angle, penumbra, range, decay, intensity, map, castShadows, shadow, intensityUnit }) | direct | `distance` becomes `range`, which every spot light needs, and `intensity` stays in candela. `light.power` in lumens becomes `intensity` with `intensityUnit: 'lumen'`, and `target` is a point. `shadow.camera` has no equivalent: call `light.lookAt(x, y, z)` when the target moves. Details below the table. | [Lights](../api/lights.md) |
| HemisphereLight | scene.createHemisphereLight({ skyColor, groundColor, intensity }) | changed | The sky lies along the light's +Y axis: turn the light to tilt it, where three.js moves it. It lights surfaces as three.js's does, diffuse only, and its light adds to the environment's. Any number of them cost the same per pixel. Details below the table. | [Lights](../api/lights.md) |
| AmbientLight | scene.createAmbientLight({ color, intensity }) | direct | Several ambient lights add up. intensity stays in lux, three.js's unit. | [Lights](../api/lights.md) |
| RectAreaLight | scene.createRectAreaLight({ color, intensity, width, height, range }) | changed | It needs a `range`, where three.js's light has no end. The light leaves along -Z, as in three.js, and casts no shadows. The engine shades it with linearly transformed cosines, as three.js does. Details below the table. | [Lights](../api/lights.md) |
| RectAreaLightUniformsLib / RectAreaLightTexturesLib | Nothing: the engine loads the area lights' tables with the first area light | changed | Remove the init() call. | [Lights](../api/lights.md) |
| LightProbe / LightProbeGenerator | scene.setLightProbeGrid: a grid of irradiance probes lights the scene where a surface stands | changed | One `LightProbe` that lights the whole scene is an environment: `scene.setEnvironment` takes its diffuse spherical harmonics with the environment map. `bunx @null3d/cli assets env` computes that map offline. For light that changes from place to place, bake a grid with `bakeProbes` and set it with `scene.setLightProbeGrid`. Details below the table. | [Scene](../api/scene.md) |
| LightProbeGrid (addons: a baked grid of L2 irradiance probes) | scene.setLightProbeGrid with a grid that bakeProbes bakes in the sketch | changed | three.js's grid stores L2 spherical harmonics per probe, and null3D's stores L1. That takes four texture reads per pixel in place of seven: three of coefficients and one of its masks. The light keeps its direction, but small bright patches spread a little wider. Details below the table. | [Scene](../api/scene.md) |
| ClusteredLighting / ClusteredLightsNode (addons, webgpu_lights_clustered) | Built in: scene.createPointLight and scene.createSpotLight; the engine clusters every light | changed | Delete the add-on and its setup. null3D sorts point and spot lights into clusters on both GPU paths, and they may cast shadows. three.js's add-on takes point lights without shadows, on WebGPU only. | [Lights](../api/lights.md) |
| CSM addon (three/addons/csm) | Built in: shadow: { cascades } on the directional light | direct | Delete the addon: its `cascades`, `maxFar` and `shadowMapSize` become the `cascades`, `distance` and `mapSize` settings. The cascades keep still edges as the camera turns, and far cascades draw every few frames. The `mode` setting has no equivalent. Details below the table. | [Shadows](../concepts/shadows.md) |
| SunLight / SunLightShadow / SunShadowNode (addons) | scene.createDirectionalLight({ direction, castShadows: true, shadow: { cascades: 2 } }) | changed | Delete the add-on. The directional light's shadow takes cascades fitted to the camera's view, with a blend between neighbors. SunLight's two cascades become `cascades: 2`. Details below the table. | [Shadows](../concepts/shadows.md) |
| SSSNode / sss() (screen-space shadows) | Contact shadows of the directional light: scene.createDirectionalLight({ castShadows: true, shadow: { contactDistance } }) | changed | Both search the camera's depth toward the main light for short shadows where objects touch. `shadow.contactDistance` sets their reach in meters, 0.3 by default. Only the first directional light draws them, while it casts shadows. Details below the table. | [Lights](../api/lights.md) |
| light.shadow.mapSize / bias / normalBias / intensity / radius / camera | shadow: { mapSize, bias, normalBias, intensity, cascades, distance } in the directional light's options, or light.setShadow() | changed | `mapSize` is one number, the texels on each side. `bias` and `normalBias` are in meters, where three.js gives `bias` in depth units, so start from the defaults. `shadow.camera` has no equivalent, and `shadowSide` has no option. Details below the table. | [Shadows](../concepts/shadows.md) |
| physicallyCorrectLights / useLegacyLights | Physical light units, as in three.js r155 and later | changed | Scenes tuned in three.js's legacy light mode need new intensities: retune them with parity images. | [Lighting and environment](../concepts/lighting.md) |

<details>
<summary>Technical details: DirectionalLight (+ target, shadow.camera bounds)</summary>

Delete `shadow.camera` bounds. The engine's shadow cascades fit the view, and the shadow distance follows the farthest visible receiver by default. A port with its own `shadow.camera.far` passes that number as `shadow: { distance }`. The engine also draws contact shadows, which three.js lacks: on High and Ultra, and on Medium on WebGL2. Set `shadow: { contactDistance: 0 }` to match three.js's look.

`intensity` stays in lux, three.js's unit. three.js has no hero shadow. A port that fits a second shadowed light, or a shadow camera, to one object uses `light.setShadow({ hero: object })`, which follows it.

</details>

<details>
<summary>Technical details: PointLight(color, intensity, distance, decay)</summary>

`intensityUnit: 'lumen'` divides by 4π as `power` does, and `setIntensity` then takes lumens. The quality preset sets the tile size in place of `shadow.mapSize`.

</details>

<details>
<summary>Technical details: SpotLight(color, intensity, distance, angle, penumbra, decay)</summary>

`intensityUnit: 'lumen'` divides by π at any cone angle, as `power` does. `castShadow` becomes `castShadows`, and `shadow` takes `bias` and `normalBias` in meters. The quality preset sets the tile size in place of `shadow.mapSize`.

`light.map` becomes `map`: sRGB pixels as `{ width, height, data }`, or an engine texture. `setMap` takes the same. The light projects it over its cone as three.js projects it. Its top row follows the world's up, as three.js aims its map's camera. So a light rolled about its axis shows the same map.

The engine copies a texture into its own light image once. A texture that changes every frame, a `VideoTexture` included, throws E1112. The engine keeps the picture's detail up to 512 texels a side, and reduces a larger texture to that. three.js samples the texture itself. Up to 32 lights show a map at once.

</details>

<details>
<summary>Technical details: HemisphereLight</summary>

`intensity` stays in lux, three.js's unit.

</details>

<details>
<summary>Technical details: RectAreaLight</summary>

Delete `RectAreaLightUniformsLib.init()`. `intensity` stays in nits, three.js's unit.

</details>

<details>
<summary>Technical details: LightProbe / LightProbeGenerator</summary>

The grid holds L1 spherical harmonics per probe, where three.js's `LightProbeGrid` holds L2. The scene page's light probe grid section shows both calls.

</details>

<details>
<summary>Technical details: LightProbeGrid (addons: a baked grid of L2 irradiance probes)</summary>

three.js adds the grid's light to the environment's diffuse light. null3D's grid takes the environment's place, and the live environment's light times each probe's sky visibility. Bake the grid again with `bakeProbes` when the scene changes.

</details>

<details>
<summary>Technical details: CSM addon (three/addons/csm)</summary>

The `farCascadeInterval` quality setting says how often far cascades draw. The `fade` option is on by default: neighboring cascades blend over a band, which the `shadowCascadeBlend` quality setting sizes. `fade: false` maps to `shadowCascadeBlend: 0`.

The `mode` setting has no equivalent. The engine's split leans a little more toward the camera than the addon's practical mode, so its near cascade is shorter. `debug.shadowCamera(camera)` lets the cascades follow a camera other than the one that renders, as the addon's `camera` option does. It works in development builds only.

</details>

<details>
<summary>Technical details: SunLight / SunLightShadow / SunShadowNode (addons)</summary>

The CSM entry maps the other settings.

</details>

<details>
<summary>Technical details: SSSNode / sss() (screen-space shadows)</summary>

They draw where the quality setting `contactShadowSteps` is above 0: on High and Ultra, and on Medium on WebGL2.

</details>

<details>
<summary>Technical details: light.shadow.mapSize / bias / normalBias / intensity / radius / camera</summary>

`intensity` is 0 to 1 and carries over as it stands. The directional light's map stores 16-bit depth. In each cascade, `bias` covers at least 1.5 of its depth steps. That is about 2 cm in a far cascade 200 m out.

`radius` and `blurSamples` become the `shadowFilter` quality setting, 3 or 5 texels on each side. `shadow.camera` has no equivalent: the cascades fit the camera's view. The shader mixes each shadow lookup toward full light by the rest, at no cost to the frame.

Casters draw only the faces that point away from the light, as three.js's default `shadowSide` does. Double-sided materials draw both.

</details>

## Geometry

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| Box / Sphere / Plane / Cylinder / Cone / Torus / Capsule / Circle / Ring Geometry | geometry.box({ width, height, depth }), geometry.sphere({ radius }), and one generator for each class | direct | Constructor arguments become options with the same names and defaults. `new CylinderGeometry(0.3, 0.4, 2)` is `geometry.cylinder({ radiusTop: 0.3, radiusBottom: 0.4, height: 2 })`. The meshes match three.js's vertices, normals, texture coordinates and triangles. Details below the table. | [Geometry](../api/geometry.md) |
| geometry.rotateX / rotateY / rotateZ / translate / scale / center / applyMatrix4 | obj.setRotationEuler(x, y, z), obj.setPosition(x, y, z) or obj.setScale(x, y, z) on the object that draws the mesh | changed | A mesh keeps the vertices its generator built, so the transform goes on the object or instance row. `floor.setRotationEuler(-Math.PI / 2, 0, 0)` lays a plane flat. To build the transform into the vertices, transform the arrays and pass them to `geometry.fromArrays`. | [Geometry](../api/geometry.md) |
| TorusKnot / Icosahedron / Octahedron / Tetrahedron / Dodecahedron / Polyhedron / Lathe / Extrude / Shape / Tube Geometry | geometry.fromArrays(torusKnot({ radius, tube, tubularSegments, radialSegments, p, q })), and icosahedron, octahedron, tetrahedron, dodecahedron, polyhedron, lathe, shape, extrude and tube, from @null3d/geometry | direct | Install `@null3d/geometry`. Each function takes the constructor's arguments as named options with three.js's defaults, and returns arrays for `geometry.fromArrays`. `Shape`, `Path`, the curves and `ShapeUtils` keep their names and methods, but points are arrays. Details below the table. | [Geometry](../api/geometry.md) |
| BufferGeometry + setAttribute / setIndex / BufferAttribute | geometry.fromArrays({ positions, normals, uvs, uvs1, colors, tangents, joints, weights, indices }) | changed | `geometry.fromArrays` returns a mesh that `createMesh` and `createInstances` accept. The attributes `position`, `normal`, `uv`, `uv1`, `color` and `tangent` each become one array, and `setIndex` becomes `indices`, 16-bit or 32-bit. The engine copies the arrays. Details below the table. | [Geometry](../api/geometry.md) |
| attribute.needsUpdate / setUsage(DynamicDrawUsage) / addUpdateRange (vertices changing every frame) | mesh.updateVertices(name, values, start, count) | changed | Pass the attribute's values of every vertex, in the array type the mesh was made with. `start` and `count` pick the vertices that change, as `addUpdateRange` does, but in vertices. The mesh keeps the bounding sphere it was made with, so call `setBounds` when vertices move outside it. Details below the table. | [Geometry](../api/geometry.md) |
| computeVertexNormals / computeTangents / computeBoundingSphere | geometry.fromArrays({ ..., computeNormals: true, computeTangents: true }) | changed | The results match three.js's bit for bit. computeTangents needs uvs, and works without indices too. Bounds are always automatic, so computeBoundingSphere and computeBoundingBox need no call. | [Geometry](../api/geometry.md) |
| EdgesGeometry / WireframeGeometry | WireframeGeometry: a material with wireframe: true on the mesh itself. EdgesGeometry: scene.createLines({ positions, mode: 'segments' }) with two points per edge | changed | A wireframe material draws each triangle's three edges, as WireframeGeometry lists them, with no copy of the mesh. null3D does not find a mesh's feature edges for you, as EdgesGeometry does with its angle threshold. Build that list of edge points from the mesh's arrays, or with EdgesGeometry at build time, and draw it as pairs of points. | [Lines](../api/lines.md) |
| TextGeometry / FontLoader / troika-three-text | DOM labels (ui.trackLabel), a texture with pre-rendered text, or a text mesh baked into glTF | changed | null3D draws no text of its own. Use DOM labels for text that follows an object, a texture for text on a surface, and a baked mesh for 3D letters. | [Unsupported three.js features](../porting/threejs-unsupported.md) |
| morphAttributes / morphTargetInfluences / morphTargetDictionary | mesh.setMorphWeight(indexOrName, weight) and mesh.getMorphWeight(indexOrName); geometry.fromArrays({ ..., morphTargets: { positions, normals, colors, names } }) | changed | glTF morph targets and their default weights load with the model, and its clips animate the weights. Targets are deltas, as with `morphTargetsRelative = true`. `mesh.mesh.morphTargetNames` lists the names in target order, in place of `morphTargetDictionary`. Details below the table. | [Animation](../api/animation.md) |
| DecalGeometry (addon), with a material that has polygonOffset | scene.createMesh({ mesh: geometry.box(), material: materials.decal({ map, normalMap, roughness }), position, rotation, scale: size }) | changed | No geometry is cut: the box projects the material onto every opaque surface inside it. It draws in a pass after the opaque objects, lit by every light and shadow. `DecalGeometry`'s position, orientation and size become the box's position, rotation and scale. Details below the table. | [Materials](../api/materials.md) |
| A PlaneGeometry displaced on the CPU, with heights from ImprovedNoise or a height map | createTerrain(ctx, { size, height, layers, splat, maxLevel, camera }) from @null3d/terrain; terrain.update(eye) in onUpdate; terrain.heightAt(x, z) | changed | A port replaces one displaced grid with a height field drawn as a camera-centered quadtree of blocks. The ground near the camera keeps fine detail, and the far hills draw coarse blocks. A skirt around each block hides the seam between neighbors more than one level apart. Details below the table. | [Terrain (@null3d/terrain)](../api/terrain.md) |
| A tree model per species loaded from a glTF file, or a procedural plant from an add-on such as Sapling or ez-tree, swaying in a custom wind shader | const tree = await assets.loadGltf(url); scene.createInstances(tree.find(name).mesh, count, { material }) for the copies of each species; a materials.shader material whose vertexOffset samples the field of createWind(ctx, { camera }) from @null3d/wind, with swayDistance; far copies as cards from @null3d/impostors, with handOverToCards(meshes, cards.batch, switchDistance) | changed | null3D ships no plant generator, so a port keeps its tree models. Export a procedural tree from Blender's Sapling, ez-tree or a similar tool as a glTF file, or build the tree in code. Draw each species' copies as one instance batch, so the engine gives them levels of detail and culling. Details below the table. | [Wind (@null3d/wind)](../api/wind.md) |
| A field of grass blades as an InstancedMesh or a custom shader that bends them in a time-based wind | await createGrass(ctx, { height, area, count, seed, mask, wind, camera, swayDistance }) from @null3d/grass, with grass.setWindLayer(field) in each frame to bend the blades in the wind add-on's field, grass.fit(preset) for a preset's share and grass.setSwayDistance(swayDistanceFor(preset)) when the preset changes | changed | three.js has no grass. A port replaces the hand-made blades and their wind shader with one call. The add-on places the tufts on the ground's height by integer hash, so one seed places the same grass on every device. Details below the table. | [Grass (@null3d/grass)](../api/grass.md) |

<details>
<summary>Technical details: Box / Sphere / Plane / Cylinder / Cone / Torus / Capsule / Circle / Ring Geometry</summary>

Each object has one material. An array of materials for the face groups of a box or a cylinder needs one object for each group.

</details>

<details>
<summary>Technical details: TorusKnot / Icosahedron / Octahedron / Tetrahedron / Dodecahedron / Polyhedron / Lathe / Extrude / Shape / Tube Geometry</summary>

`ExtrudeGeometry`'s caps and sides form one mesh, which takes one material. `CurvePath.getPoint(t)`, and `Path`'s and `Shape`'s, throws a `RangeError` when `t` is above 1 or the path is empty. three.js returns null there. A custom `UVGenerator`'s `generateTopUV` and `generateSideWallUV` take no geometry argument first, so drop it. A list of shapes makes one mesh with one material, where `ShapeGeometry` gives each shape a group. Make one shape call per material.

</details>

<details>
<summary>Technical details: BufferGeometry + setAttribute / setIndex / BufferAttribute</summary>

`skinIndex` and `skinWeight` become `joints` and `weights`. 8-bit and 16-bit integer arrays stay integers on the GPU. `{ array, normalized: true }` keeps a `BufferAttribute`'s normalized flag.

</details>

<details>
<summary>Technical details: attribute.needsUpdate / setUsage(DynamicDrawUsage) / addUpdateRange (vertices changing every frame)</summary>

Meshes with joints or morph targets take no updates. For many moving objects, use instances instead of rewriting vertices.

</details>

<details>
<summary>Technical details: morphAttributes / morphTargetInfluences / morphTargetDictionary</summary>

Color targets (`morphAttributes.color`, glTF's COLOR_0 targets) change vertex colors, so the mesh needs colors too. The colors stay between 0 and 1 as glTF asks; three.js does not clamp them. A glTF target without COLOR_0, while another target has it, changes no color, as glTF says. three.js r186 adds the base color there.

Tangent targets morph tangents, as glTF gives them, which three.js does not do. A clip blends its weights with the object's own, as `AnimationMixer` does. On WebGL2 each object draws only its largest weights, by the `morphTargets` quality setting: 8 on Low up to 64 on Ultra.

</details>

<details>
<summary>Technical details: DecalGeometry (addon), with a material that has polygonOffset</summary>

The image lies on the box's x and y sides and looks along its z axis, as `DecalGeometry` lays it. There is no target mesh: the decal marks every opaque surface in its box. `polygonOffset`, `depthWrite: false` and `transparent: true` are not needed.

`angleFade` and `edgeFade` fade the decal on surfaces that turn away and near the box's ends, where `DecalGeometry` stretches the image. A batch of boxes with one decal material draws many decals in one draw. Blended surfaces show no decals. Projected texture libraries, such as three-projected-material, become a large decal box.

</details>

<details>
<summary>Technical details: A PlaneGeometry displaced on the CPU, with heights from ImprovedNoise or a height map</summary>

Up to four tiled layers blend by a splat map. The add-on fills the map by default from the height and the slope, in place of a hand-painted or vertex-colored ground. Each layer's own height pushes it through its neighbors at a boundary. Every pixel lights from normals baked over the whole ground, so the far hills keep their relief.

The terrain carries no collision. A port that walked on the ground reads `heightAt` and `normalAt` to place objects instead of a physics collider. A port that morphed between levels drops its own morph. Each block morphs toward its parent block's surface before it hands over, so the ground does not pop. `morph: false` switches each block at once.

</details>

<details>
<summary>Technical details: A tree model per species loaded from a glTF file, or a procedural plant from an add-on such as Sapling or ez-tree, swaying in a custom wind shader</summary>

For wind, replace the three.js shader's sway with one custom material whose vertex offset reads the wind add-on's field, as `api/wind` shows. The sway fades to nothing at the material's `swayDistance`, so far trees stand still and keep their cached shadows. Past the last level, cards from the impostors add-on stand in for the trees, and `handOverToCards` sets the two distance bands.

</details>

<details>
<summary>Technical details: A field of grass blades as an InstancedMesh or a custom shader that bends them in a time-based wind</summary>

The add-on bends the blades in the wind add-on's field, so the grass answers the same gusts as the rest of the scene. On WebGPU a compute pass builds the blade list each frame, culls it to the view and thins the far tufts. WebGL2 draws the same rows as an instance batch. The grass casts and receives the sun's shadows. A blade shape, a width along the blade and the fold of its keel, takes the place of a hand-made blade geometry.

</details>

## Materials

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| MeshStandardMaterial | materials.standard({ color, map, metalness, roughness, normalMap, aoMap, emissive, ... }) | direct | Both follow glTF's metallic-roughness model with the same formulas, so color, metalness, roughness and emissive carry over. `roughnessMap` and `metalnessMap` become one `metalnessRoughnessMap`. A texture's repeat, offset and rotation become the material's `uvTransform`, or a per-map `mapUvTransforms` entry. Details below the table. | [Materials](../api/materials.md) |
| MeshPhysicalMaterial (clearcoat, transmission, dispersion, sheen, iridescence, anisotropy, specular) | materials.standard, with ior, specularIntensity, specularColor and their maps, transmission, dispersion, clearcoat, sheen, iridescence and anisotropy | changed | `materials.standard` takes `ior`, `specularIntensity`, `specularColor` and their maps, `transmission`, `dispersion`, `clearcoat`, `sheen`, `iridescence` and `anisotropy`. Each uses three.js's names and formulas, with the detail on its own entry. | [Materials](../api/materials.md) |
| MeshPhysicalMaterial ior / reflectivity / specularIntensity / specularColor / specularIntensityMap / specularColorMap | materials.standard({ ior, specularIntensity, specularColor, specularIntensityMap, specularColorMap }) | direct | Same names, ranges and formulas, so the values carry over, and glTF's `KHR_materials_ior` and `KHR_materials_specular` load into them. `specularColor` takes linear components above 1, as three.js's Color does. `reflectivity` has no option: set `ior = (1 + 0.4 * reflectivity) / (1 - 0.4 * reflectivity)`, as three.js converts it. Details below the table. | [Materials](../api/materials.md) |
| MeshPhysicalMaterial transmission / thickness / attenuationColor / attenuationDistance / dispersion | materials.standard({ transmission, thickness, ior, dispersion, roughness, attenuationColor, attenuationDistance }) | changed | Same names, ranges and formulas, and glTF's transmission, volume and dispersion extensions load into them. Give `transmission` when you create the material, even as 0, to change it later. A masked material keeps its transmission, and the hash alpha mode has no counterpart and throws. Details below the table. | [Materials](../api/materials.md) |
| MeshSSSNodeMaterial / SubsurfaceScatteringShader (thicknessColor, thicknessDistortion, thicknessAmbient, thicknessAttenuation, thicknessPower, thicknessScale, thicknessMap) | materials.standard({ diffuseTransmission, diffuseTransmissionColor, diffuseTransmissionMap, doubleSided: true }), with subsurfaceRadius and subsurfaceColor for skin | changed | Light from behind a thin surface shows on its front through glTF's diffuse transmission, which `KHR_materials_diffuse_transmission` also loads. Map `thicknessColor`, `thicknessScale` and `thicknessMap` to the diffuse transmission options. `thicknessDistortion` and `thicknessPower` have no option, and the front keeps `1 - diffuseTransmission` of its light. Details below the table. | [Materials](../api/materials.md) |
| MeshPhysicalMaterial clearcoat / clearcoatRoughness / clearcoatNormalScale / clearcoatMap / clearcoatRoughnessMap / clearcoatNormalMap | materials.standard({ clearcoat, clearcoatRoughness, clearcoatNormalScale, clearcoatMap, clearcoatRoughnessMap, clearcoatNormalMap }) | changed | Same names, ranges and formulas, and glTF's `KHR_materials_clearcoat` loads into them. Give a clear coat option when you create the material, even as 0, to change it later. `clearcoatMap` and `clearcoatRoughnessMap` must be one texture, with the coat in red and its roughness in green. Details below the table. | [Materials](../api/materials.md) |
| MeshPhysicalMaterial iridescence / iridescenceIOR / iridescenceThicknessRange / iridescenceMap / iridescenceThicknessMap | materials.standard({ iridescence, iridescenceIor, iridescenceThicknessRange, iridescenceMap, iridescenceThicknessMap }) | changed | The same thin-film formulas apply, and glTF's `KHR_materials_iridescence` loads into them. three.js names the index of refraction `iridescenceIOR` and takes its thickness as one range. Give `iridescenceIor` and `iridescenceThicknessRange`, in nanometers. Details below the table. | [Materials](../api/materials.md) |
| MeshPhysicalMaterial anisotropy / anisotropyRotation / anisotropyMap | materials.standard({ anisotropy, anisotropyRotation, anisotropyMap }) | changed | The same anisotropic GGX lobe applies, with three.js's formulas, and glTF's `KHR_materials_anisotropy` loads into it. Leave the map out and the stretch still draws: its direction comes from the mesh's tangents, else the texture coordinates. A surface with neither takes a steady direction of its own. Details below the table. | [Materials](../api/materials.md) |
| MeshPhysicalMaterial sheen / sheenColor / sheenRoughness / sheenColorMap / sheenRoughnessMap | materials.standard({ sheenColor, sheenRoughness, sheenColorMap, sheenRoughnessMap }) | changed | The same Charlie sheen applies, with three.js's formulas, and glTF's `KHR_materials_sheen` loads into it. There is no `sheen` option: give `sheenColor` times three.js's `sheen`, which defaults to 0. Give a sheen option when you create the material to change it later. Details below the table. | [Materials](../api/materials.md) |
| MeshBasicMaterial | materials.unlit({ color, map, opacity, alphaMode, vertexColors }) | direct | Its map's alpha and the vertex alpha join the opacity, as in three.js. The exposure and the tone mapping apply to it, as three.js applies them. | [Materials](../api/materials.md) |
| MeshLambertMaterial / MeshPhongMaterial | materials.standard with metalness 0 and roughness near 1 (Lambert), or roughness tuned to the Phong shininess | changed | Expect small visual differences: the standard material adds a faint highlight and keeps energy as three.js's MeshStandardMaterial does. Compare screenshots of both versions, then accept or tune. | [Materials](../api/materials.md) |
| MeshToonMaterial | materials.shader({ wgsl, uniforms }) with a toon surface function | manual | A surface function cannot read the scene's lights. Pass the light direction as a uniform, step the light into bands, and return the result as emissive. A lobe function, `fn lobe(input: LobeInput) -> vec3f`, does read each light. Details below the table. | [Surface functions](../shaders/surface-functions.md) |
| MeshNormalMaterial / MeshDepthMaterial / MeshDistanceMaterial / MeshMatcapMaterial | debug.view('normals' \| 'depth') for debugging; matcap is a recipe with an unlit function, fn unlit | changed | debug.view shades the whole scene, in development builds only. Its normals are in world space, where MeshNormalMaterial's are in view space. Its depth is white at the near plane, on a logarithmic scale for a perspective camera. | [Debug drawing and stats](../api/debug.md) |
| ShaderMaterial / RawShaderMaterial (GLSL) | materials.shader({ wgsl, uniforms, textures }) with a WGSL surface function, an unlit function (fn unlit), or a full WGSL shader | manual | Rewrite in WGSL, in one literal tagged `/* wgsl */`. Prefer a surface function, so lighting, shadows, fog and instancing keep working. A shader that ignores the lights becomes an unlit function, `fn unlit`, which keeps the uniforms, the textures and the fog. Details below the table. | [Surface functions](../shaders/surface-functions.md) |
| material.onBeforeCompile (shader-chunk patching) | materials.shader({ wgsl }) with a surface function or a vertex-offset function | manual | The engine has no shader chunks to patch. Keep the standard options on the new material: defaultSurface applies them. A custom material takes no standard maps (map, normalMap and the rest): declare textures in the WGSL and pass them with the textures option. | [Surface functions](../shaders/surface-functions.md) |
| A ShaderMaterial that samples the scene's depth texture | materials.shader({ sceneInputs: ['sceneDepth'], wgsl }) with sceneDepth(uv) or sceneDistance(uv) | changed | Declare `sceneInputs: ['sceneDepth']` and read the opaque scene's depth in the surface function, with `uv = input.fragCoord.xy / frame.resolution`. The engine binds a copy of the opaque depth. `sceneDepth` gives 1 at the near plane and 0 at the far plane, and `sceneDistance` gives the distance in world units. Details below the table. | [Materials](../api/materials.md) |
| ShaderMaterial built-ins: uv1, gl_FragCoord, gl_InstanceID / instanceIndex, modelMatrix, normalMatrix, viewMatrix, projectionMatrix, cameraNear, cameraFar | input.uv1, input.fragCoord, input.instance, object.worldMatrix, object.normalMatrix, camera.view, camera.projection, camera.near, camera.far | changed | The engine works relative to the camera, so its matrices do too. `object.worldMatrix` has its translation relative to the camera, and `camera.view` holds the camera's rotation only. `camera.projection * camera.view * object.worldMatrix` places a vertex, as `projectionMatrix * modelViewMatrix` does. Details below the table. | [Built-in shader inputs](../shaders/builtins.md) |
| TSL / NodeMaterial (three/tsl, three/webgpu) | materials.shader({ wgsl }) with a WGSL surface function | manual | Most TSL nodes map to one WGSL expression; see the shader porting reference. | [Surface functions](../shaders/surface-functions.md) |
| transparent / opacity / alphaTest / depthWrite / depthTest / blending / vertexColors / flatShading / colorWrite | alphaMode: 'blend' \| 'mask' (with alphaCutoff), depthWrite, depthTest, colorWrite, blending: 'normal' \| 'additive' \| 'multiply' \| 'weighted', vertexColors, flatShading | changed | `transparent: true` becomes `alphaMode: 'blend'`, and `alphaTest` becomes `alphaMode: 'mask'` with `alphaCutoff`. `depthTest: false` writes no depth either, as in three.js's WebGL renderer. `colorWrite: false` writes depth and no color. Details below the table. | [Materials](../api/materials.md) |
| oitPass(scene, camera) (OITPassNode) | alphaMode: 'blend' with blending: 'weighted' on each material that the pass blended, or the quality setting momentTransparency: true for the better layer | changed | The same weighted blended order-independent transparency applies, with three.js's default weight. three.js's pass takes every transparent material of normal blending without transmission; null3D takes the materials that ask for it. The weighted surfaces blend over the other see-through surfaces, test the scene's depth and write none, and `weightNode` has no counterpart. Details below the table. | [Materials](../api/materials.md) |
| side: DoubleSide | doubleSided: true | changed | A back face lights as if it faced the camera, as in three.js. A double-sided material with `alphaMode: 'blend'` draws its back faces first, then its front faces, as three.js does. `BackSide` has no equivalent: flip the geometry. Details below the table. | [Materials](../api/materials.md) |
| forceSinglePass: true | forceSinglePass: true | direct | With alphaMode: 'blend' and doubleSided: true, both faces draw in one draw, in the mesh's triangle order. Fixed when the material is created. | [Materials](../api/materials.md) |
| alphaToCoverage: true (with alphaTest) | alphaMode: 'mask', alphaCutoff (alphaToCoverage is on by default) | changed | The cut edges fade over one pixel above the cutoff, and MSAA covers that share of each pixel, as in three.js. null3D turns it on for every mask; `alphaToCoverage: false` turns it off. Without MSAA it is a plain mask. Details below the table. | [Materials](../api/materials.md) |
| alphaHash: true | alphaMode: 'hash' | changed | Three.js's cells and threshold apply to each point's place on the mesh, so the alpha sets the share of the surface that draws. The noise pattern differs: null3D hashes each cell with integer math, so every GPU draws the same pattern. `alphaCutoff` has no effect in this mode. Details below the table. | [Materials](../api/materials.md) |
| material.wireframe = true | materials.standard({ wireframe: true }), and the same option on unlit and custom materials | direct | Each triangle's edges draw as lines one pixel wide with the material's own shading, from an edge list that the engine keeps for each mesh. Its shadows draw lines too. Flat shading and bump maps have no effect, as in three.js, and `wireframeLinewidth` has none either. Details below the table. | [Materials](../api/materials.md) |
| material.envMap / envMapIntensity | scene.setEnvironment(env); materials.standard({ envIntensity }) | changed | One environment lights the scene; a material takes no environment of its own. envMapIntensity becomes `envIntensity`, which multiplies the scene's intensity. three.js uses scene.environmentIntensity in place of envMapIntensity under scene.environment. | [Lighting and environment](../concepts/lighting.md) |
| material.needsUpdate = true | Nothing to do | changed | Options that change the shader or the pipeline, such as texture maps, vertexColors, doubleSided and flatShading, are fixed when a material is created. Create each variant during loading: a new one compiles a pipeline, which can make a frame late. | [Materials and pipelines](../concepts/materials.md) |
| ShadowMaterial (shadow-catcher planes) | materials.shadowCatcher({ color, opacity }) | direct | The plane shows the main directional light's shadow in the material's color where the shadow falls, and nothing where the light reaches it. The default color is black, as three.js's. Create the mesh with `receiveShadows: true`, or call `setReceiveShadows(true)`. Details below the table. | [Materials](../api/materials.md) |
| material fog: false | fog: false in the material options | direct |  | [Materials](../api/materials.md) |
| material.bumpMap / bumpScale | materials.standard({ bumpMap, bumpScale }) | direct | The same formula applies: the red channel's change from one pixel to the next bends the normal. The look is the same, and it depends on the surface's size on screen as three.js's does. A normal map wins over it, as in three.js, and `bumpScale` changes with `set`. Details below the table. | [Materials](../api/materials.md) |
| material.displacementMap / displacementScale / displacementBias | materials.standard({ displacementMap, displacementScale, displacementBias }) | changed | Vertices move as in three.js: along the normal by the red channel times the scale, plus the bias, after skinning and morph targets. Shadows and the depth prepass follow, and culling grows each object's bounds by the farthest move. No `setBounds` call is needed. Details below the table. | [Materials](../api/materials.md) |
| material.alphaMap | Alpha packed into the base color map's alpha channel offline, or a surface function that sets s.alpha from the texture | manual | three.js reads the alpha map from its green channel. Copy that channel into the base color map's alpha, and set alphaMode to 'mask' or 'blend'. | [Materials](../api/materials.md) |
| renderer.clippingPlanes / material.clippingPlanes / localClippingEnabled | A surface function with alphaMode 'mask' that sets alpha to 0 beyond the plane, using input.worldPosition | manual | Pass the plane as a `vec4f` uniform. The shadow is cut at the plane too, as three.js does with `clipShadows: true`. A masked material's shadow caster runs the alpha that its surface function sets. Details below the table. | [Surface functions](../shaders/surface-functions.md) |
| material.polygonOffset / polygonOffsetFactor / polygonOffsetUnits | depthBias: { constant, slopeScale } in the material options | direct | depthBias.constant takes polygonOffsetUnits, and depthBias.slopeScale takes polygonOffsetFactor. Signs differ because WebGPU uses reversed depth: the engine converts, so keep the three.js intent (push away from the camera). | [Materials](../api/materials.md) |
| material.lightMap / lightMapIntensity, with the light map texture's offset and repeat | materials.standard({ lightMap, lightMapIntensity, lightMapOffset, lightMapRepeat }) | changed | The light map adds baked light to the ambient light, times `lightMapIntensity`. The texture's offset and repeat become `lightMapOffset` and `lightMapRepeat`, fixed when the material is created. The engine computes `uv × repeat + offset` for the light map alone, and the other maps keep their transform. Details below the table. | [Materials](../api/materials.md) |
| material.toneMapped = false | toneMapped: false in the material's options, fixed when the material is created | changed | The material keeps its display color on both paths. The 8-bit path handles it in the material's shader; the HDR path's final pass reads a mask. For the exact color on a blended surface, use the 8-bit path with `hdr: false`. | [Porting post-processing](../porting/threejs-postprocessing.md) |

<details>
<summary>Technical details: MeshStandardMaterial</summary>

Roughness has three.js r187's floor of 0.045. Highlights on small curved shapes widen by Filament's specular anti-aliasing. three.js adds its own term, so they are a little brighter and narrower there. A normal map that tilts a reflection below the surface fades the environment's reflection, which three.js does not. A normal map on a mesh without tangents takes its frame from how positions and texture coordinates change between pixels, as in three.js.

</details>

<details>
<summary>Technical details: MeshPhysicalMaterial ior / reflectivity / specularIntensity / specularColor / specularIntensityMap / specularColorMap</summary>

A glTF `ior` of 0 becomes 1000, as `GLTFLoader` reads it.

</details>

<details>
<summary>Technical details: MeshPhysicalMaterial transmission / thickness / attenuationColor / attenuationDistance / dispersion</summary>

The surface samples a mipmapped copy of the opaque objects' colors where its bent ray leaves the volume, as three.js does. The copy holds opaque objects only. three.js also draws the back faces of double-sided glass into it. Where the bent ray lands on an opaque object in front of the surface, null3D shows what lies straight behind. three.js shows that object's color.

`transmissionMap` and `thicknessMap` keep row slots of their own and sample the specular slots' arrays. The red and green channels there scale the transmission and the thickness. So a material with them may also give the specular maps where the two textures share an array.

A thickness map never shares a specular color map's array, because one is linear and the other sRGB. A development build refuses that pair. A layered material keeps the two maps beside its layers, unless a layer map fills the array that one of them samples. A development build refuses that too.

`dispersion` spreads the index of refraction over three rays, one per color, with red taking the lowest. A prism then separates the light behind it into colors. Its cost falls on the materials that set it. A custom material sets `s.transmission` in its surface function.

</details>

<details>
<summary>Technical details: MeshSSSNodeMaterial / SubsurfaceScatteringShader (thicknessColor, thicknessDistortion, thicknessAmbient, thicknessAttenuation, thicknessPower, thicknessScale, thicknessMap)</summary>

`thicknessScale` stays between 0 and 1, and the thickness map's value sits in alpha. `thicknessAmbient` maps to the ambient and environment light, which shine through by themselves.

three.js's term glows most when the camera looks toward the light. `thicknessDistortion` and `thicknessPower` shape the glow. null3D's light from behind spreads evenly, as glTF describes. So those two have no option, and the glow looks softer head on.

For skin, wax and marble, add `subsurfaceRadius` and `subsurfaceColor`. The subsurface blur spreads the diffuse light on the High and Ultra presets. A custom material sets `s.diffuseTransmission` in its surface function.

</details>

<details>
<summary>Technical details: MeshPhysicalMaterial clearcoat / clearcoatRoughness / clearcoatNormalScale / clearcoatMap / clearcoatRoughnessMap / clearcoatNormalMap</summary>

Pack two textures into one for that pair. A material with a clear coat or a sheen takes no `lightMap`, `specularIntensityMap` or `specularColorMap`. A custom material sets `s.clearcoat` in its surface function.

The car paint example add-on ([Car paint](../guides/car-paint.md)) builds metal flakes and panel seams over this clear coat. three.js has no flake lobe: its metal flakes are a normal map.

</details>

<details>
<summary>Technical details: MeshPhysicalMaterial iridescence / iridescenceIOR / iridescenceThicknessRange / iridescenceMap / iridescenceThicknessMap</summary>

Give an iridescence option when you create the material to change it later. A material with iridescence takes no `lightMap`, `specularIntensityMap` or `specularColorMap`, and no clear coat's or sheen's maps. A custom material sets `s.iridescence`, `s.iridescenceIor` and `s.iridescenceThickness` in its surface function.

</details>

<details>
<summary>Technical details: MeshPhysicalMaterial anisotropy / anisotropyRotation / anisotropyMap</summary>

It takes no `lightMap`, `specularIntensityMap` or `specularColorMap`, and no clear coat's or sheen's maps. Rectangles and tubes of light shade it as three.js does, without the stretch.

</details>

<details>
<summary>Technical details: MeshPhysicalMaterial sheen / sheenColor / sheenRoughness / sheenColorMap / sheenRoughnessMap</summary>

A three.js material without sheen shows none, so its port leaves the sheen options out. `sheenColorMap` and `sheenRoughnessMap` must be one texture, with the roughness in alpha, as glTF packs them. A material with a clear coat or a sheen takes no `lightMap`, `specularIntensityMap` or `specularColorMap`.

</details>

<details>
<summary>Technical details: MeshToonMaterial</summary>

The engine calls the lobe for the main directional light and for each point and spot light, with the light's direction and its shadowed irradiance. It adds the lobe's color to that light's specular, beside the base lighting. So bands made there follow every such light and its shadows.

Set the surface's `baseColor` to black and its roughness to 1, as the uniform recipe does, so the base lighting adds little beside the bands. The engine calls no lobe for the fill directional lights and the area lights. So the bands do not follow them.

</details>

<details>
<summary>Technical details: ShaderMaterial / RawShaderMaterial (GLSL)</summary>

The built-ins that `ShaderMaterial` adds have WGSL names of their own (see the ShaderMaterial built-ins entry). Declare the uniforms once, as `struct Uniforms`. Updates such as `material.uniforms.uSpeed.value = 2` become `material.set({ speed: 2 })`. The type check rejects a name that `struct Uniforms` lacks.

A `sampler2D` uniform becomes `var name: texture_2d<f32>;` in the WGSL and an entry of the `textures` option. Sample it with `textureSample(name, nameSampler, uv)`. Textures are fixed when the material is created. Full shaders take no textures.

</details>

<details>
<summary>Technical details: A ShaderMaterial that samples the scene's depth texture</summary>

A surface in the opaque pass, or in a scene or reflection pass, reads 0, the far plane.

</details>

<details>
<summary>Technical details: ShaderMaterial built-ins: uv1, gl_FragCoord, gl_InstanceID / instanceIndex, modelMatrix, normalMatrix, viewMatrix, projectionMatrix, cameraNear, cameraFar</summary>

`object.position` gives the origin in the world. `object.normalMatrix` turns normals into world space, where three.js's `normalMatrix` turns them into view space. Multiply by `camera.view` for view space. `camera.projection` has reversed depth, 1 at the near plane. `input.fragCoord` counts from the top left, so `gl_FragCoord.y` becomes `frame.resolution.y - input.fragCoord.y`.

`input.instance` is the row in an instance batch, 0 for an object of the scene. `object.id` and `mesh.shaderId` tell objects apart, which three.js leaves to uniforms. Only WGSL that reads `uv1`, `instance`, an id or the object's matrices pays for them.

</details>

<details>
<summary>Technical details: transparent / opacity / alphaTest / depthWrite / depthTest / blending / vertexColors / flatShading / colorWrite</summary>

Its objects draw before the opaque objects that write color, so the depth holds back their color behind the surface. three.js orders that by material. `blending` takes effect with `alphaMode: 'blend'` only. three.js blends an opaque material with additive or multiply blending too. A mask's cut edges are smoothed by default; `alphaToCoverage: false` keeps three.js's hard edges.

The engine blends in linear color before the tone mapping, as `WebGPURenderer` does. `WebGLRenderer` blends after its tone mapping and sRGB encoding. So see-through surfaces look a little lighter in null3D, and additive glows a little weaker. A blended material writes depth by default, as three.js's transparent materials do. Set `depthWrite: false` on glows and on surfaces that cross, so they never hide each other.

</details>

<details>
<summary>Technical details: oitPass(scene, camera) (OITPassNode)</summary>

The coverage sums `-log2(1 - alpha)` instead of multiplying `1 - alpha`, so both targets blend alike. Compatibility mode needs that; the result is the same. The layer draws at one sample on every path, where three.js's matches the scene's samples on WebGPU. Custom materials do not take it.

The quality setting `momentTransparency` blends the same surfaces with a store of four depth moments. That is nearer an exact back-to-front blend than the weighted average is, and it draws them twice. It is off on every preset. It takes the standard, basic and sprite materials whose blending is normal or weighted.

</details>

<details>
<summary>Technical details: side: DoubleSide</summary>

`side` is fixed when the material is created.

</details>

<details>
<summary>Technical details: alphaToCoverage: true (with alphaTest)</summary>

Without `alphaTest`, three.js turns raw alpha into coverage: use `alphaMode: 'hash'` for that look. A custom material takes it too, where its WGSL sets or reads the surface's alpha. Its shadow caster then keeps the mask's holes. The mode is fixed when the material is created. Its shadow cuts at `alphaCutoff`, where three.js's shadow cuts at 0.5.

</details>

<details>
<summary>Technical details: alphaHash: true</summary>

three.js's sine hash changes from GPU to GPU. A hashed surface casts a hashed shadow, where three.js casts the whole shape. A custom material takes the mode where its WGSL sets or reads the surface's alpha, and its shadow and motion keep the same pattern.

</details>

<details>
<summary>Technical details: material.wireframe = true</summary>

The option is fixed when the material is created.

</details>

<details>
<summary>Technical details: ShadowMaterial (shadow-catcher planes)</summary>

Point and spot light shadows do not show on it. The scene's fog leaves it alone. Put the plane just above the surface whose shadows it catches.

</details>

<details>
<summary>Technical details: material.bumpMap / bumpScale</summary>

A normal map converted offline costs less at run time: `bunx @null3d/cli assets normal-from-bump bump.png normal.ktx2 --scale <bumpScale>`.

</details>

<details>
<summary>Technical details: material.displacementMap / displacementScale / displacementBias</summary>

Without a `normalMap` or `bumpMap`, null3D bends the normals by the map's slope, so the light follows the moved surface. three.js keeps the flat mesh's normals, so a displaced surface without a normal map shades as if it were flat. With a normal map, both engines light it the same. `parallax: true` adds parallax occlusion mapping from the same map, which three.js does not have. Raycasts see the mesh before the map moves it, in both engines.

</details>

<details>
<summary>Technical details: renderer.clippingPlanes / material.clippingPlanes / localClippingEnabled</summary>

three.js's default is `clipShadows: false`, which keeps the whole shadow. For that, also declare `fn coverage(input: SurfaceInput) -> f32` and return 1.0. The shadow caster then tests the coverage in place of the alpha.

</details>

<details>
<summary>Technical details: material.lightMap / lightMapIntensity, with the light map texture's offset and repeat</summary>

Load the map with `uvSet: 1` where three.js sets its channel to 1. A material with a clear coat, a sheen, iridescence or anisotropy takes no light map.

</details>

## Textures

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| new TextureLoader().load / loadAsync | await assets.loadTexture(url, { colorSpace, flipY, wrap, filter, mipmaps, anisotropy, uvSet, premultipliedAlpha }) | changed | It returns a promise of the texture, which draws once its texels upload. flipY is true by default, as in three.js, and colorSpace is 'srgb'. | [Textures](../api/textures.md) |
| texture.colorSpace = SRGBColorSpace (older: encoding = sRGBEncoding) | colorSpace: 'srgb' for color maps, 'linear' for data maps | direct | Same rule as three.js: base color and emissive maps are sRGB; normal, roughness, metalness and AO maps are linear. The default is `'srgb'` for images and `'linear'` for data. glTF models set them automatically. Details below the table. | [Color management](../concepts/color-management.md) |
| texture.flipY | flipY in the loadTexture options | direct | The default is true, as in three.js. A KTX2 file takes no flipY: true, so encode it flipped. glTF textures never flip. | [Textures](../api/textures.md) |
| wrapS / wrapT / repeat / offset / rotation / center | wrap: 'repeat' \| 'clamp' \| 'mirror' in the texture options; repeat, offset and rotation go in the material's uvTransform | changed | `uvTransform` takes three.js's repeat, offset and rotation with the default center, and places every map of the material with it. `mapUvTransforms` gives one map, by its option name such as `emissiveMap`, a transform of its own. A glTF file's transforms stay per map. Details below the table. | [Textures](../api/textures.md) |
| minFilter / magFilter / generateMipmaps / anisotropy | filter: 'linear' \| 'nearest', mipmaps, anisotropy (capped by the preset) | changed |  | [Textures](../api/textures.md) |
| DataTexture / DataArrayTexture / Data3DTexture | textures.fromData({ width, height, depth, format, data }) | changed | `textures.fromData` takes `rgba8unorm` and `rgba16float` data. A depth above 1 makes a texture array, and the standard materials read its first layer. Filters are linear by default, where three.js's `DataTexture` is nearest: pass `filter: 'nearest'`. Details below the table. | [Textures](../api/textures.md) |
| CanvasTexture (a 2D canvas redrawn at run time) | Draw on an OffscreenCanvas in the sketch, then textures.fromCanvas(canvas, { refreshHz }) and texture.refresh(rect) | changed | The sketch worker has no DOM canvas; `OffscreenCanvas` with a 2D context works in workers. The canvas's last row goes to `v = 0`, so it stands upright on a plane, as three.js shows a `CanvasTexture`. `refresh` uploads only the rectangle, where three.js's `needsUpdate` uploads the whole canvas. Details below the table. | [Textures](../api/textures.md) |
| VideoTexture | engine.registerVideo(video, { name }) on the page, then textures.fromVideo(name) in the sketch | changed | A video element lives on the page, where it plays with its own controls and sound. The page sends each presented frame, scaled down to `maxSize`, and the sketch uploads the newest one within the frame's budget. A paused video presents no frame, so it costs nothing. Details below the table. | [Video textures](../guides/video-textures.md) |
| CubeTextureLoader / CubeTexture | assets.loadCubemap([px, nx, py, ny, pz, nz]) for sky boxes with scene.setBackground; assets.loadEnvironment for lighting | changed | The faces come in three.js's order and draw as three.js draws a `CubeTexture` background, mirrored across x. Each face is square, of one size, at most 2,048 pixels a side. A cube map does not light materials and does not blur. Details below the table. | [Assets](../api/assets.md) |
| RGBELoader / EXRLoader / HDRLoader / UltraHDRLoader + PMREMGenerator | await assets.loadEnvironment('sunset.hdr'), or `bunx @null3d/cli assets env sunset.hdr sunset.ktx2` and assets.loadEnvironment('sunset.ktx2') | changed | One call loads a Radiance (.hdr) or OpenEXR (.exr) file and prefilters it on the GPU, as `HDRLoader` or `EXRLoader` with `PMREMGenerator.fromEquirectangular` do. No loader object and no generator to dispose. The tool's file skips the filtering at load. Details below the table. | [Assets](../api/assets.md) |
| KTX2Loader + setTranscoderPath + detectSupport | assets.loadTexture('x.ktx2') | direct | The engine loads the transcoder with the first KTX2 file and picks the device's format, so delete the setup. The file's first row is at `v = 0`, as with `KTX2Loader`. UASTC HDR files load too: as BC6H where the device has BC formats, else as `rgb9e5ufloat`. Details below the table. | [Textures](../api/textures.md) |
| CompressedTexture / CompressedArrayTexture | assets.loadTexture('x.ktx2'); texture.format names the compressed format | changed | Compressed textures come from KTX2 files of ETC1S or UASTC data, with the file's mip levels. No call takes compressed blocks from code. | [Textures](../api/textures.md) |
| texture.channel (which UV set a map uses) | uvSet: 0 or 1 in the texture's options | direct | Each map of a material reads the set that its texture names. glTF models carry this per texture, so loaded models need nothing. | [Textures](../api/textures.md) |
| material.premultipliedAlpha / texture.premultiplyAlpha | loadTexture(url, { premultipliedAlpha: true }), which multiplies each color by its alpha as the image decodes | changed | Blending needs no material flag: the engine blends premultiplied colors. On a blended material, a base color map loaded with `premultipliedAlpha: true` looks the same as one loaded without it. The shader divides its colors by their alpha before it lights them. Details below the table. | [Textures](../api/textures.md) |

<details>
<summary>Technical details: texture.colorSpace = SRGBColorSpace (older: encoding = sRGBEncoding)</summary>

`NoColorSpace` and `LinearSRGBColorSpace` become `colorSpace: 'linear'`.

</details>

<details>
<summary>Technical details: wrapS / wrapT / repeat / offset / rotation / center</summary>

The default wrap is `'clamp'`, as three.js's default is `ClampToEdgeWrapping`.

</details>

<details>
<summary>Technical details: DataTexture / DataArrayTexture / Data3DTexture</summary>

A custom material declares an array as `var name: texture_2d_array<f32>` and samples a layer with `textureSample(name, nameSampler, uv, layer)`. `rgba16float` takes a `Uint16Array` of half floats or a `Float32Array`.

A `Data3DTexture` made as a color grading table for `LUTPass` becomes `assets.lutFromData({ size, data })`. Data textures have no mip levels unless `mipmaps` is true, as `DataTexture`'s `generateMipmaps` is false.

</details>

<details>
<summary>Technical details: CanvasTexture (a 2D canvas redrawn at run time)</summary>

Ask for the 2D context with `willReadFrequently: true`, so the browser keeps the pixels where the engine reads them.

</details>

<details>
<summary>Technical details: VideoTexture</summary>

The sketch's call then sends the frame that the video holds. Keep a frame within the upload budget, 2 MiB on Low: 512 texels of a 16:9 video is 576 KiB. Safari and Firefox cannot make a `VideoFrame` from a video element. So every browser reads frames through `createImageBitmap`.

</details>

<details>
<summary>Technical details: CubeTextureLoader / CubeTexture</summary>

For `envMap` or a blurred background, load an environment from an HDR or EXR image with `assets.loadEnvironment`.

</details>

<details>
<summary>Technical details: RGBELoader / EXRLoader / HDRLoader / UltraHDRLoader + PMREMGenerator</summary>

`UltraHDRLoader`'s JPEG files with gain maps do not load: convert them to .hdr or .exr. EXR files with DWAA or DWAB compression, tiled or multi-part EXR files, do not load either.

</details>

<details>
<summary>Technical details: KTX2Loader + setTranscoderPath + detectSupport</summary>

three.js uses ASTC HDR or half floats there. Both stay linear, so keep tone mapping on. The engine keeps each transcoded texture in its cache of derived data, so a repeat visit skips the transcoder. `KTX2Loader` transcodes on every visit.

</details>

<details>
<summary>Technical details: material.premultipliedAlpha / texture.premultiplyAlpha</summary>

Other materials show the multiplied colors, as three.js does.

</details>

## Loaders

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| GLTFLoader().load / loadAsync | const prefab = await assets.loadGltf(url); scene.instantiate(prefab) | changed | A worker parses the file, and `scene.instantiate(prefab)` makes a copy. Named nodes come from `prefab.find(name)`, a copy's objects from `instance.find(name)`, and its maps from `prefab.find(name).maps`. KTX2, WebP, AVIF and meshopt need no decoder setup. Details below the table. | [Assets](../api/assets.md) |
| LoadingManager.setURLModifier | assets.loadGltf(url, { rewriteUrl: (address) => address }) | changed | Checks or changes each address that a glTF file names, for its buffers and images. Return null to refuse the file with E1416. It covers glTF files only. | [Assets](../api/assets.md) |
| DRACOLoader + setDecoderPath | Built in: assets.loadGltf(url) decodes Draco data | direct | Delete the setup and the decoder files. The engine ships Draco's glTF decoder and downloads it, about 60 KB after Brotli, with the first Draco file. Convert the files to meshopt with `bunx @null3d/cli assets optimize`: meshopt files decode faster, with a decoder of about 6 KB. | [Assets and prefabs](../concepts/assets.md) |
| MeshoptDecoder / setMeshoptDecoder | Built in: assets.loadGltf(url) decodes meshopt data | direct | Delete the setup. The loader reads KHR_meshopt_compression and EXT_meshopt_compression, and downloads the decoder with the first compressed file. | [Assets and prefabs](../concepts/assets.md) |
| FBXLoader / OBJLoader / MTLLoader / ColladaLoader / STLLoader / PLYLoader / 3DMLoader / USDZLoader | Convert to glTF before release: `bunx @null3d/cli assets convert model.fbx model.glb` for FBX, OBJ with MTL, STL and PLY; Blender for Collada, 3DM and USDZ | changed | The engine loads glTF only. The command keeps FBX skins, blend shapes and clips, turns materials into metal-rough ones, and puts units in meters with Y up. Bump maps become normal maps. Details below the table. | [The asset pipeline (the `assets` command)](../guides/assets-pipeline.md) |
| LoadingManager / onProgress callbacks | assets.onProgress((loaded, total) => ...) and assets.preload([...urls]) | changed | `loaded` and `total` count bytes, not files. A download that announces no length still adds its bytes to `loaded`, while `total` stays unknown. Divide by `Math.max(total, loaded)`. | [Loading screens and warm-up](../guides/loading-screens.md) |
| FileLoader / ImageLoader / ImageBitmapLoader | assets.loadBinary(url), assets.loadJson(url), assets.loadImageBitmap(url) | changed | ImageBitmapLoader's texture becomes textures.fromImageBitmap, which puts the bitmap's first row at v = 0. assets.loadImageBitmap flips the rows by default, as createImageBitmap does with imageOrientation: 'flipY', so the texture stands upright, as three.js's TextureLoader shows it. | [Assets](../api/assets.md) |
| THREE.Cache.enabled | Nothing to do | changed | Loads of one URL at the same time share one download. Files that `assets.preload` downloaded wait in memory until a load takes them. The HTTP cache keeps the rest. | [Assets](../api/assets.md) |

<details>
<summary>Technical details: GLTFLoader().load / loadAsync</summary>

`prefab.bounds` frames the model. Clips play through the copy's animator: `scene.instantiate(prefab).animator().play(name)`, with the names in `prefab.clips`. Joints are not objects. Morph targets draw, and clips animate their weights.

Materials follow `GLTFLoader`'s rules. Vertex colors turn on, a mesh without normals shades flat, and blended materials write no depth. A mesh without tangents turns the normal map's green channel over. `KHR_lights_punctual` lights load with the intensities that three.js gives them. A clip without a name is named `animation_0`, `animation_1` and so on, as three.js names it.

`KHR_animation_pointer` needs no plugin: the loader reads it. It moves the same texture transform values as three.js's plugin. `assets.registerGltfExtension(handler)` takes the place of `GLTFLoader.register()` for an add-on's extensions. `GLTFLoader` ignores the MSFT_lod levels of `bunx @null3d/cli assets optimize --lod` and draws the full mesh.

</details>

<details>
<summary>Technical details: FBXLoader / OBJLoader / MTLLoader / ColladaLoader / STLLoader / PLYLoader / 3DMLoader / USDZLoader</summary>

The command is `bunx @null3d/cli assets convert model.fbx model.glb` for FBX, OBJ with MTL, STL and PLY; Blender handles Collada, 3DM and USDZ. The engine draws no glTF points, so a converted PLY point cloud loads with nothing to draw. three.js draws it.

</details>

## Instancing and batching

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| InstancedMesh + setMatrixAt / setColorAt / instanceMatrix.needsUpdate | scene.createInstances(mesh, count, { material, dynamic, colors }); write batch.positions / rotations / scales / colors | changed | Static batches call `markDirty(start, count)` after writes; dynamic batches upload every frame without it. `colors: true` adds the colors array: linear RGBA per row, which multiplies the base color and opacity. `scene.createInstances(prefab, count)` instances a glTF model, with one set of rows for all its meshes. Details below the table. | [Instances and batching](../concepts/instances.md) |
| BatchedMesh | Nothing special: the engine batches objects that share a mesh and material | changed | Use createInstances for many copies of one mesh, and separate meshes for varied geometry. | [Instances and batching](../concepts/instances.md) |
| InstancedBufferGeometry / InstancedBufferAttribute (custom per-instance data) | createInstances(mesh, count, { material, values: true }) adds batch.values, four floats per row, which a custom material's vertexOffset and surface functions read as object.values | changed | Four floats per row replace named attributes: pack a phase, an age, a tint or a size into them. A shader that read an instanced attribute reads object.values.x to .w instead. A material with a vertexOffset casts shadows that follow it. | [Instances and batching](../concepts/instances.md) |
| A BufferGeometry with no attributes, drawn from a vertex count in a ShaderMaterial (gl_VertexID and gl_InstanceID) | scene.createVertexDraw({ shader, vertices, instances, bounds, ...material options }) | changed | The shader makes every vertex from `@builtin(vertex_index)` and `@builtin(instance_index)`, so a frame uploads nothing. three.js needs a geometry with a placeholder attribute and an `InstancedBufferGeometry` for the instance count. A draw blends, sorts as one object, takes no texture, casts no shadow, and a raycast does not hit its shapes. | [Draws from a vertex count](../api/vertex-draws.md) |
| LOD (addLevel) / SimplifyModifier | Nothing for a mesh made in code of 4,096 triangles or more, or of 256 or more whose copies hold 65,536: it plans its levels on the job workers at its first draw, and `await mesh.buildLevels()` plans another; or baseMesh.setLevels([{ mesh, distance }]) on the base mesh, then draw the base mesh; or levels from `bunx @null3d/cli assets optimize --lod`, which assets.loadGltf reads | changed | Levels belong to the mesh, and each object and instance row picks its own level each frame. It measures to the nearest point of an object's bounds, where three.js measures to its position, so a large object switches later. `getCurrentLevel` and `autoUpdate` have no match. Details below the table. | [Levels of detail](../concepts/lod.md) |

<details>
<summary>Technical details: InstancedMesh + setMatrixAt / setColorAt / instanceMatrix.needsUpdate</summary>

`setColorAt`'s color works the same as a row color. `castShadow` and `receiveShadow` become `castShadows` and `receiveShadows`, or `batch.setCastShadows` and `setReceiveShadows`. An `InstancedMesh`'s `boundingSphere` becomes `batch.setBoundingRadius(radius)` for that batch. Each row's sphere then holds that radius around the row's origin.

</details>

<details>
<summary>Technical details: LOD (addLevel) / SimplifyModifier</summary>

A mesh made in code plans measured levels with the asset tool's planner, as three.js's `SimplifyModifier` would make far copies by hand. They switch at once while the threshold stays small. `levels: false` in its arrays opts out.

Each object and row picks its level on the GPU or on job workers, by the level's error, distance or screen coverage. A distance holds on every screen height, and so does a coverage. A hand-set level fades over a dithered band, which replaces hysteresis. A level with a measured error switches at once while the threshold stays small, and fades above about one and a half pixels. A mesh whose bound covers fewer pixels than the threshold draws nothing.

Each shadow map picks a caster's level in its own texels, so the level holds while the camera moves. A level may name a material of its own, so a far level shades more cheaply.

`object.setLevelBias(bias)` moves one object's threshold, as the inverse of Godot's `lod_bias`: a Godot bias of 2 is about a null3D bias of 0.5. Above 1 it draws coarser levels, and below 1 it keeps more detail. `object.setDrawRange(start, end)` draws a mesh only inside a band of distances, and fades it at each edge.

Far copies can also draw as impostor cards or as one merged mesh per far cell, from `@null3d/impostors`. The cards blend the three nearest stored views and light from the normals the bake stores. So a moving sun relights them with the meshes.

A large static mesh can also take a tree of cluster patches from `bunx @null3d/cli assets optimize --clusters`. The engine then draws fine patches near the camera and coarse ones far from it. It does so on both GPU paths where the browser draws many ranges in one call, and whole levels elsewhere. three.js has no equivalent, and its LOD picks one level for the whole object.

</details>

## Animation

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| AnimationMixer / clipAction / play / crossFadeTo / fadeIn / fadeOut / time / setEffectiveWeight / timeScale / mixer.update(dt) | const anim = obj.animator(); anim.play('run', { fade: 0.2, loop: true, speed: 1 }); anim.crossFade('walk', 0.3); anim.play('walk', { time: 0.4, weight: 0.7 }); anim.setWeight('walk', 0.5); anim.setLayerWeight(1, 0.5); anim.setTimeScale(0.5); anim.onEvent('finished', handler) | changed | No update call: the engine advances and blends every animator on its job workers. `action.time = t` before `play()` becomes `play(name, { time: t })`. `setLoop(LoopOnce)` becomes `loop: false`, which holds the last frame, as `clampWhenFinished` does; `startAt` has no counterpart. Details below the table. | [Animation](../api/animation.md) |
| AnimationClip / KeyframeTrack built in code | const pulse = scene.animateProperty(lamp, 'light.intensity', { times: [0, 1, 2], values: [0, 5, 0], loop: true }); const recolor = scene.animateProperty(material, 'color', { times: [0, 1], values: [1, 0, 0, 0, 0, 1] }) | changed | A track names a value of a light, a camera, a material or an object. Keys hold one number, two for a map's offset or scale, three for a color, position or scale, and four for a rotation. glTF files play their `KHR_animation_pointer` tracks through the model's animator. Details below the table. | [Animation](../api/animation.md) |
| SkinnedMesh / Skeleton / Bone built by hand | Author the skeleton in a modeling tool and export glTF: const hero = scene.instantiate(await assets.loadGltf(url)); hero.animator().play('walk') | manual | Building skeletons in code is not supported, and joints are not objects. Meshes that hang on bones, such as a sword in a hand, follow their joints when the file puts them under the bone. To turn a joint from code, use the animator's joint calls (see the bone rotation entry). Details below the table. | [Animation](../api/animation.md) |
| bone.quaternion / bone.rotation set after mixer.update(dt); bone.lookAt(target); skeleton.getBoneByName | const head = anim.joint('Head'); anim.setJointRotation(head, q, weight); anim.addJointRotation(head, q, weight); anim.lookAt(target, { joints: ['Spine', 'Neck', 'Head'], limit }, weight) | changed | Setting `bone.quaternion` after the mixer's update becomes `setJointRotation`, and multiplying it becomes `addJointRotation`, which turns the joint in its own frame. Turn a `bone.rotation` Euler into a quaternion with `quat.fromEuler` first. Both take a weight from 0 to 1 that blends with the animated rotation. Details below the table. | [Animation](../api/animation.md) |
| AnimationUtils.subclip / makeClipAdditive | anim.play(name, { additive: true }) for makeClipAdditive. Split clips for subclip in the modeling tool | changed | An additive play adds the clip's change from its first frame, as makeClipAdditive does with its default reference frame. The engine makes the additive form once, at the first additive play. | [Animation](../api/animation.md) |

<details>
<summary>Technical details: AnimationMixer / clipAction / play / crossFadeTo / fadeIn / fadeOut / time / setEffectiveWeight / timeScale / mixer.update(dt)</summary>

`setEffectiveWeight(w)` on actions that play together becomes `play(name, { weight: w })`, then `setWeight(name, w)`. A play with a weight joins its layer's clips, and a play without one fades them out. `setWeight` leaves a running fade in place, which multiplies the weight. A fade out starts from the clip's current weight, not from full weight.

`fadeOut(duration)` becomes `stop(name, { fade: duration })`. A clip with a negative speed starts at its end. Filtered clips for upper and lower body become layers with `setLayerMask`. Walk and run blends become `playBlend` and `setBlend`, which keep the clips in step. This covers blends whose weights and time scales the code works out from a speed.

`crossFadeTo` and `crossFadeFrom` map to `crossFade`, which keeps the weighted blend that three.js shows. It never uses an inertial transition, which samples only the new clip. `startAt` has no direct call: call `play` at that time. `mixer.addEventListener('loop' or 'finished')` becomes `anim.onEvent('loop' or 'finished', handler)`, which also gets the events in the clip's data. Handlers run at the start of the next frame, before `onUpdate`. So code sees what the clips reached in the frame before, as after `mixer.update`.

A clip blends only where it has tracks, as in three.js. Poses, fades, masked layers, additive clips and blends match three.js's within 0.0004. A clip whose keys follow no single grid is stored at 30 keys per second. Its fastest joints can then cut corners by up to 0.005.

</details>

<details>
<summary>Technical details: AnimationClip / KeyframeTrack built in code</summary>

The values include `'light.intensity'`, `'light.color'`, `'camera.fov'`, a material value that `setUniform` takes, `'material.uvOffset'` or `'material.uvScale'`, and `'position'`, `'rotation'`, `'scale'` and `'visible'`.

Interpolation is `'linear'`, `'step'` or glTF's cubic spline (`'cubic'`). A cubic key holds an in-tangent, the value and an out-tangent. `animation.setTime(t)` places the animation. `setSpeed`, `setPaused`, `setLoop` and `stop` control it. A material animation changes every object that uses the material.

The glTF tracks carry the clip's time, speed, fades and weights. They cover a light's intensity, color and range, a material's values, and the offset and scale of a base color or emissive texture's transform. They also cover a node's visibility, and a node's transform or morph weights.

A material keeps a transform for each of its maps, so a file that moves two of them apart plays both. Each plays on its own map. A pointer the engine does not read leaves its value as the file has it, with a warning in development builds. three.js needs a plugin for the extension.

</details>

<details>
<summary>Technical details: SkinnedMesh / Skeleton / Bone built by hand</summary>

The mesh's own world matrix places the skinned vertices, as three.js draws a `SkinnedMesh`. Each pass skins the mesh in its vertex shader, as three.js does, custom materials included.

</details>

<details>
<summary>Technical details: bone.quaternion / bone.rotation set after mixer.update(dt); bone.lookAt(target); skeleton.getBoneByName</summary>

A rotation holds in every frame until `clearJoint`, where three.js's mixer overwrites the bone in its next update. `bone.lookAt` becomes `lookAt`, which turns a chain of up to 4 joints toward a point in the world. Each turns within its limit, and it aims again every frame until `lookAt(null)`. The joints below follow, so a held rifle aims with the arms.

</details>

## Interaction and controls

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| Raycaster.setFromCamera + intersectObject(s) | camera.screenToRay(x, y, ray); scene.raycast(ray.origin, ray.direction, { layers }, hit) | changed | `scene.raycast` writes the closest hit into a hit object that you create once, and `scene.raycastAll` writes every hit, nearest first. A layer mask defaults to layer 0 alone, as `Raycaster`'s does, and hidden objects are never hit. A skinned mesh is tested in its bind pose, not its animated pose. Details below the table. | [Raycasting and spatial queries](../api/raycast.md) |
| DOM pointer, mouse, touch and keyboard listeners | input.pointer, input.isDown('KeyW'), input.wasPressed('Mouse0'), input.touches, input.actions.define(); obj.on('click' \| 'pointerdown' \| 'pointerup' \| 'pointermove' \| 'pointerenter' \| 'pointerleave', fn) | changed | The page forwards pointer, touch, keyboard and gamepad input to the sketch, which reads it once per frame and adds no DOM listeners. Keys take `KeyboardEvent.code` names, and the main mouse button or a tap is `Mouse0`. A canvas that takes touch gestures needs `touch-action: none` in its CSS. Details below the table. | [Input](../api/input.md) |
| OrbitControls / MapControls | createOrbitControls(ctx, camera, { target, enableDamping, dampingFactor, minDistance, maxDistance, maxPolarAngle }) or createMapControls(ctx, camera) from @null3d/controls; controls.update(dt) in onUpdate | changed | Option names and defaults match `OrbitControls` and `MapControls`, and the same input gives the camera the same pose. `mouseButtons` and `touches` take strings such as `'rotate'` and `'dolly-pan'`. There is no DOM element, so `connect`, `disconnect` and `dispose` have no equivalent. Details below the table. | [Controls (@null3d/controls)](../api/controls.md) |
| TrackballControls / ArcballControls | None; createOrbitControls, or your own rotation from ctx.input | unsupported | null3D has orbit and map controls. It has no trackball or arcball rotation. | [Unsupported three.js features](../porting/threejs-unsupported.md) |
| FlyControls / FirstPersonControls / PointerLockControls | createFlyControls(ctx, camera, { movementSpeed, rollSpeed, dragToLook, autoForward }) or createFirstPersonControls(ctx, camera, { movementSpeed, lookSpeed, pointerSpeed, minPolarAngle, maxPolarAngle }) from @null3d/controls; controls.update(dt) in onUpdate | changed | Option names and defaults match `FlyControls`, `FirstPersonControls` and `PointerLockControls`. First-person controls take the place of the last two: while the canvas holds the pointer lock, the mouse turns the view as `PointerLockControls` turn it. `lock()`, `unlock()` and `isLocked` have no equivalent. Details below the table. | [Controls (@null3d/controls)](../api/controls.md) |
| TransformControls / DragControls | createTransformControls(ctx, camera, { mode, space, size, showX, showY, showZ, translationSnap, rotationSnap, scaleSnap }) from @null3d/controls, then attach(object) and controls.update(dt) in onUpdate; createDragControls(ctx, camera, objects, { recursive, transformGroup, rotateSpeed, mouseButtons, touches }) | changed | Option names and defaults match `TransformControls` and `DragControls`. There is no DOM element, `getHelper` or event: the controls make their handles in the scene and report `dragging`, `axis`, `hovered` and `state`. `update(dt)` returns true when it moved something. Details below the table. | [Controls (@null3d/controls)](../api/controls.md) |

<details>
<summary>Technical details: Raycaster.setFromCamera + intersectObject(s)</summary>

A hit has `object`, `instance` (`instanceId`), `point`, `normal`, `distance` and `triangle` (`faceIndex`). It also has `uv` (`intersection.uv`) with `hasUv`, which says whether the hit triangle has texture coordinates. `camera.screenToRay` uses the camera of the frame on screen at the pointer's event. For clicks and hover on objects, `obj.on('click', fn)` casts the ray itself. Acceleration structures are built in. Rays hit sprites, points and lines as they draw.

`raycaster.far` becomes `maxDistance`. `params.Points.threshold` and `params.Line.threshold` become the `pointThreshold` and `lineThreshold` options. three.js gives both a default of 1 world unit, and null3D none. Without them, a ray hits a point's square, or a line within half its width. A hit near a line, or near a point within a threshold, is the ray's closest point. three.js puts a `Line`'s hit on the line instead.

Triangles hit as their material draws them, front faces only or both with `doubleSided: true`, as `Raycaster` reads `material.side`. A ray hits a dashed line's gaps, and a sprite or point where its map is clear, as in three.js. `scene.pick(x, y)` tests the pixel that the image shows, through the GPU, and returns a promise. three.js has no pixel pick.

Sprites, points and lines sized in pixels use the active camera, or the camera of the event's frame, in place of `raycaster.camera`. three.js's `Line2` and `LineSegments2` ignore `raycaster.far`; `maxDistance` limits every null3D hit, lines too.

</details>

<details>
<summary>Technical details: DOM pointer, mouse, touch and keyboard listeners</summary>

`obj.on` replaces a canvas listener that raycasts: the closest object under the pointer gets the event, then its parents. `input.pointer.wheel` gives the scroll in pixels, counting a line as 16 pixels and a page as 100, as three.js's controls count `deltaMode`.

</details>

<details>
<summary>Technical details: OrbitControls / MapControls</summary>

`listenToKeyEvents()` takes no element: it turns on the keys, which the sketch's `input` already reads. There are no change, start or end events: `update(dt)` returns true when the camera moved.

`zoomToCursor`, `keys`, `keyPanSpeed`, `keyRotateSpeed`, `cursor`, `minTargetRadius`, `maxTargetRadius`, `saveState` and `reset` keep three.js's names and behavior. A held key repeats after half a second, then 30 times a second, where three.js follows the system's key repeat. An orthographic camera zooms by its view height, and `minZoom` and `maxZoom` count zoom as three.js does from the height when the controls start. `getDistance`, `getPolarAngle` and `getAzimuthalAngle` keep three.js's meaning. `rotateLeft`, `rotateUp`, `pan`, `dollyIn` and `dollyOut` take effect at the next update, not at once.

`dampingFactor` is the share at 60 frames per second. The engine scales it to each frame's step, so the motion takes the same time at any frame rate. The controls orbit around +Y, where three.js orbits around the camera's up. three.js takes a frame's events one at a time, so a two-finger pan can differ by a few percent of the move.

</details>

<details>
<summary>Technical details: FlyControls / FirstPersonControls / PointerLockControls</summary>

The page asks for the lock in a click handler with `engine.requestPointerLock()`, and the sketch reads `input.pointer.locked`. For code that moves the camera itself, set `movementSpeed: 0` and call `controls.moveForward` and `controls.moveRight`. There is no DOM element, dispose or change event: `update(dt)` returns true when the camera moved.

In fly controls, the keys add to the pointer's turn, where three.js's pointer replaces the arrow keys' turn. First-person controls turn the camera with no roll, where `PointerLockControls` keep a roll the camera had. With the pointer locked, a frame's mouse moves add up before the polar limits apply.

three.js applies the limits after each move, so a frame can end at a different angle. With two fingers down, the first finger turns the view, where three.js follows the finger that touched down last. `dampingFactor` is the share at 60 frames per second, scaled to each frame's step.

</details>

<details>
<summary>Technical details: TransformControls / DragControls</summary>

A gizmo turns an object by the exact angle that the pointer sweeps around the axis, where three.js scales a linear approximation of it. `minX` to `maxZ` clamp a move, and `showXY`, `showYZ` and `showXZ` hide the plane handles, as in three.js. `showX`, `showY` and `showZ` hide the plane handles too. A press on a handle reaches the handle alone, so a click handler on the object behind it does not hear it.

`dragging` and `axis` replace `TransformControls`' dragging-changed, objectChange, mouseDown and mouseUp events. `dragging`, `hovered` and `state` replace `DragControls`' dragstart, drag, dragend, hoveron and hoveroff events.

</details>

## Helpers and debugging

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| AxesHelper / GridHelper / BoxHelper / Box3Helper / ArrowHelper / CameraHelper / light helpers / SkeletonHelper / PlaneHelper | debug.axes, debug.grid, debug.box, debug.sphere, debug.arrow, debug.frustum, debug.light, debug.skeleton | changed | Call them in `onUpdate`: each call draws for one frame, and debug drawing exists in development builds only. `debug.grid` takes `GridHelper`'s size and divisions, and its `color` and `centerColor` default to `GridHelper`'s `color2` and `color1`. `PlaneHelper` and `PolarGridHelper` have no equivalent. Details below the table. | [Debug drawing and stats](../api/debug.md) |
| three.js's Inspector add-on or developer tools extension, or code that walks scene.children to find an object while debugging | ?inspect on the page in a development build; engine.inspect(call, args) from page code; bunx @null3d/cli mcp for a coding agent | changed | The `?inspect` panel lists the scene as a tree and outlines the object that you select. It shows and changes the object's transform, and a mesh's base color, roughness, metalness and opacity. A change lasts until the page reloads, so copy the final values into the sketch. Details below the table. | [Debugging](../guides/debugging.md) |

<details>
<summary>Technical details: AxesHelper / GridHelper / BoxHelper / Box3Helper / ArrowHelper / CameraHelper / light helpers / SkeletonHelper / PlaneHelper</summary>

`debug.frustum` draws orange by default, as `CameraHelper` draws a frustum. `debug.box` takes a box's lowest and highest corners. `debug.light` draws directional lights only. `debug.skeleton` draws an animated object's skin joints, blue at the joint and green at its parent, as `SkeletonHelper` does.

</details>

<details>
<summary>Technical details: three.js's Inspector add-on or developer tools extension, or code that walks scene.children to find an object while debugging</summary>

`engine.inspect` runs the same calls from code, and the page answers capture itself with `{ png, bytes }`. The MCP server gives a coding agent the same calls, frame captures and the frame figures. All three work in a development build only, because a production build leaves the channel out. A held page or a replay opens no panel.

</details>

## Math

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| new Vector3 / Quaternion / Matrix4 / Euler / Color / Box3 / Sphere / Ray / Plane | Plain arrays and the vec3, quat, mat4 and color helpers from @null3d/engine, such as vec3.add(out, a, b) and quat.slerp(out, a, b, t) | changed | Create scratch arrays once with `vec3.create()`, `quat.create()` or `mat4.create()`, outside `onUpdate`. Most names match three.js, and each helper does three.js's arithmetic, so the results match. Coordinates are right-handed with +Y up, as in three.js. Details below the table. | [Math helpers](../api/math.md) |
| Clock / getDelta / getElapsedTime | onUpdate(dt) or ctx.time.dt, and ctx.time.now | changed | getDelta() becomes the dt that onUpdate gets, also in ctx.time.dt, and getElapsedTime() becomes ctx.time.now. Sketch time stops while the engine is paused or the page is hidden. A fixed-step simulation, such as world.step(1 / 60), moves to onFixedUpdate. | [Time](../api/time.md) |
| MathUtils (degToRad, clamp, lerp, damp, randFloat, seededRandom) | math.degToRad, radToDeg, clamp, lerp, inverseLerp, mapLinear, damp, smoothstep, euclideanModulo, randFloat, randInt and randFloatSpread; math.seed and math.random | direct | Same names and arithmetic, and the random helpers draw from `math.random`, which hold mode seeds. `MathUtils.seededRandom(s)` becomes `math.seed(s)` once, then `math.random()`. `smootherstep`, `pingpong` and `generateUUID` have no equivalent. Details below the table. | [Math helpers](../api/math.md) |
| Color.set / setHex / setHSL / setRGB / lerp | '#rrggbb' or '#rgb' strings, 0xrrggbb numbers, or [r, g, b] linear arrays from 0 to 1; color.fromHex, color.fromSrgb and color.fromHsl give linear RGB | changed | Hex values are sRGB, as `setHex` and `setStyle` read them, and the engine converts them to linear. `[r, g, b]` arrays are linear, as `setRGB` reads them, so the color helpers' results go straight into color options and instance colors. `color.fromSrgb` converts sRGB components, `color.fromHsl` gives what `setHSL` gives, and `vec3.lerp` blends two colors. Details below the table. | [Color management](../concepts/color-management.md) |

<details>
<summary>Technical details: new Vector3 / Quaternion / Matrix4 / Euler / Color / Box3 / Sphere / Ray / Plane</summary>

A `mat4` holds its 16 numbers column by column, as `Matrix4.elements` does, with the translation in elements 12, 13 and 14. `multiplyMatrices(a, b)` is `mat4.multiply(out, a, b)`, and `multiplyQuaternions(a, b)` is `quat.multiply(out, a, b)`. Both apply b first, then a. `setFromRotationMatrix(m)` is `quat.fromMat4(out, m)`, which needs a matrix without scale. Use `mat4.decompose` for one with scale.

`applyQuaternion` is `vec3.transformQuat`, `applyMatrix4` is `vec3.transformMat4`, `multiplyScalar` is `vec3.scale`, and `addScaledVector` is `vec3.scaleAndAdd`. `setFromUnitVectors` is `quat.rotationTo`, and `setFromEuler` is `quat.fromEuler`, in radians. There are no helpers for `Box3`, `Sphere`, `Ray` or `Plane`.

three.js math classes may stay in setup code during a port, but not in per-frame code. Game rules that a server replays import the exact helpers from `@null3d/engine/math/vec3`, `quat`, `mat4` and `math`. They build `setAxisAngle`, `fromEuler`, `rotateX`, `rotateY`, `rotateZ`, `slerp`, `vec3.angle` and `math.damp` with `createMath` on an exact math library.

</details>

<details>
<summary>Technical details: MathUtils (degToRad, clamp, lerp, damp, randFloat, seededRandom)</summary>

Game rules that a server replays import `clamp`, `lerp` and the other exact helpers from `@null3d/engine/math/math`. They build `damp` with `createMath` on an exact math library, and draw random numbers from a generator of their own.

</details>

<details>
<summary>Technical details: Color.set / setHex / setHSL / setRGB / lerp</summary>

`color.srgbToLinear` and `color.linearToSrgb` convert one component by the same curve as `SRGBToLinear` and `LinearToSRGB`.

</details>

## Post-processing

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| EffectComposer / RenderPass / OutputPass / PostProcessing (three/webgpu) / pmndrs postprocessing | post.set({ ... }) | changed | The chain is built in and merged into few passes. Delete the composer, RenderPass and OutputPass; keep only each pass's settings. | [The post-processing chain](../concepts/post-processing.md) |
| UnrealBloomPass / BloomEffect / bloom() node | post.set({ bloom: { intensity, threshold, knee, blend, weights } }) | changed | null3D draws bloom through a chain of mip levels, so the settings map rather than copy. `UnrealBloomPass` uses `blend: 'add'`, the same threshold, knee 0.01, and intensity about 8.8 times strength. Take weights from radius with the port skill's table, or its `map-bloom.mjs` script for the app's canvas size. Details below the table. | [The post-processing chain](../concepts/post-processing.md) |
| SSAOPass / SAOPass / GTAOPass / N8AO | post.set({ ao: { radius, thickness, distanceExponent, distanceFalloff, scale, samples, intensity } }) | changed | `GTAOPass`'s search and denoise draw at half resolution, with its setting names. `blendIntensity` becomes `intensity`, and `distanceFallOff` is spelled `distanceFalloff`. It darkens only the ambient light, where `GTAOPass` darkens the whole image. Details below the table. | [The post-processing chain](../concepts/post-processing.md) |
| SSGINode / ssgi() (bounce light from the screen) / VXGINode | A light probe grid for bounce light (scene.setLightProbeGrid), with ambient occlusion (post.set({ ao })) | changed | null3D has no bounce light from the screen and no voxel cone tracing. The probe grid gives colored bounce light everywhere, from objects off the screen too, at a fixed cost per pixel. Light from moving objects reaches it only when the sketch bakes it again. | [Scene](../api/scene.md) |
| FXAAPass / FXAAShader / SMAAPass / TAARenderPass / SSAARenderPass | createEngine({ antialias: 'fxaa' }); the quality presets take MSAA 4x from Medium, and FXAA on Low | changed | FXAA runs inside the final pass, where three.js adds `FXAAPass` after `OutputPass`. null3D has no TAA of a moving view. A still view blends jittered frames into a sharper picture, then rests, so TAA and SSAA passes have no counterpart. Details below the table. | [Quality presets, dynamic resolution and frame budgets](../concepts/quality-presets.md) |
| TRAANode / traa() / TAAUNode / TemporalReprojectNode | MSAA, which the quality presets take from Medium up, with FXAA on Low | changed | null3D has no temporal anti-aliasing and no temporal upscaler. Drop the node and keep the scene's MSAA, which `TAAUNode` had to turn off. For speed on phones, the governor lowers the render scale, and the final pass scales the image up. | [Quality presets, dynamic resolution and frame budgets](../concepts/quality-presets.md) |
| FSR1Node / fsr1() (spatial upscale and sharpening) | The render scale: quality.set({ minRenderScale, maxRenderScale }) | changed | The engine draws the scene below the canvas size when the render scale is under 1. Its final pass scales the image up with GSR 1, an edge-aware spatial upscaler, which fills FSR 1's role. It has no FSR 1 pass. Details below the table. | [Quality API](../api/quality.md) |
| SharpenNode / sharpen() (RCAS) | post.set({ sharpen }) | changed | Both sharpen display color with FSR 1's RCAS in the final pass, so the port needs no render target and no pass of its own. three.js scales the sharpening by `2^-sharpness`, where 0 sharpens the most and 2 does nothing. Set `sharpen` to that factor, so three.js's default of 0.2 is `sharpen: 0.87`. Details below the table. | [Post-processing API](../api/post.md) |
| OutlinePass / OutlineEffect | post.set({ outline: { color, hiddenColor, width } }) and mesh.setOutlined(true), or createOutlinePass(ctx, { color, hiddenColor, strength, thickness, glow, pulsePeriod }) from @null3d/three-compat | changed | `selectedObjects` becomes `setOutlined(true)` on each mesh, or on a model's copy from `scene.instantiate`. null3D draws a crisp line of one width in CSS pixels, with no blur. `visibleEdgeColor` and `hiddenEdgeColor` become `color` and `hiddenColor`; the pattern texture has no setting. Details below the table. | [Porting post-processing](../porting/threejs-postprocessing.md) |
| BokehPass / DepthOfFieldEffect / dof() node | post.set({ dof: { focusDistance, focusPoint, aperture, focalLength, maxBlur, blades } }), with camera.setFocalLength(mm) | changed | The same intent uses a camera's lens: the blur grows with the distance from the focus, and the near and far fields blur apart. So a sharp object spreads no halo into a blurred background. `BokehPass`'s focus becomes `focusDistance`. Details below the table. | [The post-processing chain](../concepts/post-processing.md) |
| None built in; pmndrs ToneMappingEffect with ToneMappingMode.REINHARD2_ADAPTIVE (adaptationRate, middleGrey), AdaptiveLuminancePass, AdaptiveToneMappingPass | post.set({ autoExposure: { metering, percentiles, centerWeight, speedUp, speedDown, minEv, maxEv, compensation } }) | changed | three.js has no automatic exposure; `renderer.toneMappingExposure` stays `post.set({ exposure })`, and the eye adapts from it. pmndrs's adaptive tone mapping becomes `autoExposure` with `metering: 'mean'`. Its `adaptationRate` becomes about `speedUp` and `speedDown`, and its `middleGrey` the compensation, `log2(middleGrey / 0.18)` stops. Details below the table. | [Post-processing API](../api/post.md) |
| ShaderPass (custom full-screen GLSL) | post.addEffect({ wgsl, uniforms, textures, order }), or render.addPass({ kind: 'fullscreen', wgsl, writes, size or scale }) for a pass that writes a render target of its own | manual | Rewrite the fragment shader in WGSL as `fn effect(input: EffectInput) -> vec4f`. `texture2D(tDiffuse, vUv)` becomes `effectColor(input.uv)`, and `pass.uniforms.x.value = v` becomes `post.setEffectUniform(effect, 'x', v)`. The engine joins effects that read only their own pixel into one pass. Details below the table. | [Porting post-processing](../porting/threejs-postprocessing.md) |
| FilmPass / GlitchPass / HalftonePass / DotScreenPass / RenderPixelatedPass | A custom effect for each, with post.addEffect | manual | Port each shader as a ShaderPass is ported. Grain and noise sized for display color look weaker on HDR color, so tune them by eye. GlitchPass's random texture becomes a texture of the effect, from textures.fromData, or noise from null3d::noise. | [Porting post-processing](../porting/threejs-postprocessing.md) |
| AfterimagePass / AfterimageShader | None | unsupported | AfterimagePass blends in the frame before, which an effect cannot read, so it has no port. | [Porting post-processing](../porting/threejs-postprocessing.md) |
| LUTPass / LUTCubeLoader / LUT3dlLoader | post.set({ lut: await assets.loadLut('grade.cube'), lutIntensity }), or a table from assets.lutFromData({ size, data }) | direct | `LUTPass`'s intensity becomes `lutIntensity`. The table grades display color after the tone mapping, as `LUTPass` after `OutputPass` does. A `Data3DTexture` that code fills for `LUTPass` becomes `await assets.lutFromData({ size, data })`. Details below the table. | [Porting post-processing](../porting/threejs-postprocessing.md) |
| VignetteShader / VignetteEffect | post.set({ vignette: { intensity, size, falloff, roundness } }) | changed | null3D's vignette multiplies HDR color before the tone mapping, so bright corners darken instead of turning gray. `VignetteShader`'s offset becomes `size` and darkness becomes `intensity`. Under ACES, the default falloff of 2 and roundness of 0 give a close match. Details below the table. | [Porting post-processing](../porting/threejs-postprocessing.md) |
| SSRPass / ReflectorForSSRPass / ssr() node | post.set({ ssr: { maxDistance, thickness, intensity } }) with quality.set({ ssrScale }) | changed | It reflects what the screen shows in smooth opaque surfaces, in place of the environment's reflection, through the material's Fresnel term. `SSRPass` adds its reflections over the finished image instead. `maxDistance` and `thickness` keep their names, `opacity` becomes `intensity`, and `selects` and `blur` have no settings. Details below the table. | [Post-processing API](../api/post.md) |
| Reflector / Refractor / Water / Water2 (addons) | const pass = render.addPass({ kind: 'reflection', writes: 'water', plane: { point, normal } }); materials.shader({ wgsl, textures: { mirror: textures.fromPass(pass) } }), whose surface function sets s.reflection from reflection_uv | changed | A reflection pass draws the camera's view mirrored across the plane, and an oblique near plane clips everything below it. The mesh no longer carries the reflection. A custom material reads the pass texture by screen position with `null3d::reflection::reflection_uv`, then sets the surface's reflection. Details below the table. | [Render graph API](../api/render.md) |
| Sky / SkyMesh (addons) | scene.setBackground({ sky: { sunPosition, turbidity, rayleigh, mieCoefficient, mieDirectionalG, cloudCoverage, ... } }) | changed | three.js's `Sky` works as the scene's background, with its uniforms' names, defaults and formulas, clouds and sun disc included. Drop the mesh and its scale: the sky draws behind every object. `SkyMesh` moves its clouds by the renderer's clock; pass the sketch's time as `time` instead. Details below the table. | [Scene](../api/scene.md) |
| A physical sky and aerial perspective (add-ons such as @takram/three-atmosphere: SkyMaterial, AerialPerspectiveEffect) | scene.setBackground({ atmosphere: { sunPosition, sunIntensity, rayleigh, haze, ozone, aerialPerspective, metersPerUnit, moonPosition, moonIntensity, stars, cloudCoverage, ... } }) | changed | The engine's own physical sky comes from Hillaire's lookup tables, with no files to load. One background call draws the sky and hazes every object by its distance, so drop the sky mesh and its textures. Set `metersPerUnit` to the scene's scale, and `aerialPerspective` above 1 to make a small scene look larger. Details below the table. | [Scene](../api/scene.md) |
| Lensflare / LensflareElement (addons) | Screen-space sprites placed with camera.worldToScreen | manual |  | [Sprites](../api/sprites.md) |
| GammaCorrectionShader / sRGB conversion passes in the composer | Delete: output is converted to sRGB exactly once | changed | Keeping such a pass applies gamma twice and washes the image out. | [Color management](../concepts/color-management.md) |

<details>
<summary>Technical details: UnrealBloomPass / BloomEffect / bloom() node</summary>

The `bloom()` node is the same at a third of the intensity. pmndrs `BloomEffect` uses `blend: 'screen'`, intensity as is, `threshold` from `luminanceThreshold` and `knee` from `luminanceSmoothing`. Its weights come from radius and levels. Drop the resolution argument.

The match holds at one canvas size, 1080 pixels on the shorter side by default. three.js's glow spans pixels, so on a larger screen null3D's looks wider. A strong bloom also spreads a little wider at the frame's edges than three.js's. three.js's faint haze fades toward the corners; lower strength or radius to soften it. In WebGPU's compatibility mode with MSAA, bloom moves the engine to HDR color with FXAA.

</details>

<details>
<summary>Technical details: SSAOPass / SAOPass / GTAOPass / N8AO</summary>

It draws where the quality setting `aoScale` is above 0: on High and Ultra, or after `quality.set({ aoScale: 0.5 })` on phones and tablets. For `SSAOPass`, `SAOPass` and `N8AO`, start from the defaults and tune `radius` and `scale` by eye.

In the engine's parity tests with `GTAOPass`'s defaults, under 0.1% of the pixels differ from three.js's image on every GPU path. With a wider, darker search, under 1% differ, along the soft edges. A scene that only ambient light lights gives the same image in both.

</details>

<details>
<summary>Technical details: FXAAPass / FXAAShader / SMAAPass / TAARenderPass / SSAARenderPass</summary>

SMAA 1x smooths the moment transparency layer's edges under the share that its moments cover. The rest of the image keeps MSAA's samples or FXAA. `sampleLevel` has no counterpart. The motion debug view reads the motion vectors that the engine records for each object.

</details>

<details>
<summary>Technical details: FSR1Node / fsr1() (spatial upscale and sharpening)</summary>

Sharpening is a setting of its own, `post.set({ sharpen })`, which draws at the whole canvas's render scale.

</details>

<details>
<summary>Technical details: SharpenNode / sharpen() (RCAS)</summary>

null3D damps the sharpening where the ring around a pixel is noise, which three.js does only with `denoise: true`. It draws at the whole canvas's render scale; below one, the upscale sharpens the image itself.

</details>

<details>
<summary>Technical details: OutlinePass / OutlineEffect</summary>

`OutlinePass` draws its edge at half size, so `edgeThickness` t becomes `width` of about 2t. `OutlinePass` draws a dark brown line around hidden parts by default. null3D draws none until `hiddenColor` is set, so set `hiddenColor: [0.1, 0.04, 0.02]`, its linear default, to keep it.

pmndrs `OutlineEffect`: `xRay: false` becomes `hiddenColor: false`. Its edge is one texel of its mask at `resolutionScale`, so `width` is about `1 / resolutionScale`.

For `OutlinePass` itself, install `@null3d/three-compat` and call `createOutlinePass(ctx, { color, hiddenColor, strength, thickness, glow, pulsePeriod })`. `edgeStrength`, `edgeThickness` and `edgeGlow` keep their values as `strength`, `thickness` and `glow`, and `pulsePeriod` keeps its name. `visibleEdgeColor` and `hiddenEdgeColor` become `color` and `hiddenColor`. It draws the soft edge, the glow and the pulse, and it turns the crisp line off. The mask reads at half size, and `downSampleRatio` is fixed at 2. The core's crisp line stays the cheaper choice where a soft edge is not needed.

One outline style covers every outlined object in either form. For a soft glow built by hand, a full-screen pass reads the mask with `input: 'outlineMask'`, at scale 0.5. An effect then adds its texture to the scene color; `width: 0` drops the crisp line ([Custom passes and render targets](../guides/custom-passes.md), a soft outline glow).

</details>

<details>
<summary>Technical details: BokehPass / DepthOfFieldEffect / dof() node</summary>

Its aperture scales the blur with the distance from the focus. null3D's aperture is an f-number, so pick one by eye, such as 2.8, with the camera's focal length (`camera.setFocalLength`). `maxblur` is a share of the canvas's width, and `maxBlur` of its height, so multiply by the aspect ratio.

pmndrs `DepthOfFieldEffect`: `worldFocusDistance` becomes `focusDistance`, a target to focus on becomes `focusPoint`, and `bokehScale` becomes `maxBlur` with the aperture. Tune it by eye. It draws where the quality setting `dofSamples` is above 0: Medium and up, or `quality.set({ dofSamples: 16 })` on Low.

</details>

<details>
<summary>Technical details: None built in; pmndrs ToneMappingEffect with ToneMappingMode.REINHARD2_ADAPTIVE (adaptationRate, middleGrey), AdaptiveLuminancePass, AdaptiveToneMappingPass</summary>

Its Reinhard curve becomes a custom tone curve. The meter runs on the GPU in the same frame: a histogram on WebGPU, or 16 x 16 cells on WebGL2 and the Low preset. The quality setting is `exposureMeter`.

It weights the center and adapts at its own speeds for brighter and darker scenes. It stays within `minEv` and `maxEv`, in stops from the camera's exposure. Hold mode settles at once, so image tests stay the same. It needs HDR color, as bloom does.

</details>

<details>
<summary>Technical details: ShaderPass (custom full-screen GLSL)</summary>

Effects run on linear HDR color before the tone curve. A `ShaderPass` after `OutputPass` sees display color, so retune its numbers. The uv's y axis is flipped: replace `vUv.y` with `1.0 - input.uv.y` where direction matters. Other textures of the shader become `var name: texture_2d<f32>` with the `textures` option. Sample a render pass's texture at `effectPassUv(input.uv)`. A reflection pass's texture on the HDR WebGPU path starts at the top row instead: sample it at `input.uv`.

A `ShaderPass` that writes a render target of its own, which a later pass reads, becomes a full-screen pass. Its input image goes as `input: 'sceneColor'`, or a texture. `effectViewPosition(uv)` gives the surface's view-space position, whose z is negative in front of the camera, as in three.js.

</details>

<details>
<summary>Technical details: LUTPass / LUTCubeLoader / LUT3dlLoader</summary>

The order is the same, red fastest, with three or four numbers per texel, whose fourth is skipped. Give floats from 0 to 1, so divide 8-bit values by 255. `LUTImageLoader`'s PNG strips are not read: export the grade as a .cube file. Both read the table with a linear filter between its texel centers.

The engine maps the colors of a .cube file's domain onto the table, which `LUTPass` leaves out. A .3dl input grid whose points differ from even steps by one loads, where `LUT3dlLoader` refuses it. In the engine's parity test, a .cube table matches three.js's composer in all but under 0.1% of the pixels on every GPU path.

</details>

<details>
<summary>Technical details: VignetteShader / VignetteEffect</summary>

Under AgX, intensity stays at 1 or less with a falloff of 3. With darkness below 1, three.js also lifts dark corners toward a gray, and null3D does not. The postprocessing library's `VignetteEffect` maps the same way with its ESKIL technique. Its default technique darkens with another curve, so tune intensity and size by eye.

</details>

<details>
<summary>Technical details: SSRPass / ReflectorForSSRPass / ssr() node</summary>

The material's roughness picks the surfaces and blurs their reflections, up to `maxRoughness`. A `groundReflector` (`ReflectorForSSRPass`) becomes a reflection pass, which wins on its plane. The `ssr()` node's `resolutionScale` becomes the `ssrScale` quality setting, which is 0 on the Low preset of phones. Its quality becomes `ssrSteps`, the most steps of each ray. Where a ray hits nothing on the screen, the environment's reflection shows.

</details>

<details>
<summary>Technical details: Reflector / Refractor / Water / Water2 (addons)</summary>

The texture's rows start at the top on the HDR WebGPU path, and `reflection_uv` turns the lookup there. `Reflector`'s `textureWidth` and `textureHeight` become `scale`, a share of the render size. Its color becomes the material's color with metalness 1 and roughness 0.

`Water`'s `distortionScale` becomes the factor on the normal's tilt in `reflection_uv`'s offset. `waterColor` becomes the material's color, and `sunColor` the scene's sun. `Water`'s normal map becomes ripples in the surface function. The reflection draws the scene's background, the sun's light and shadows, and the point and spot lights that it sees.

For a river or a lake, `createWater` from `@null3d/water` does this work. It adds the soft shore, the foam, the caustics and the view from under the water. A reflection pass stays the way to mirror a floor. For an open sea, `createOcean` from `@null3d/water` transforms wave spectra into the surface's heights and slopes on the GPU. `Refractor` and `Water2`'s refraction become transmission: give the water's custom material `transmission` and `thickness`. Its surface function sets `s.transmission` and its rippled normal.

</details>

<details>
<summary>Technical details: Sky / SkyMesh (addons)</summary>

The sky lights nothing, as in three.js. For its light, `scene.setEnvironment(await assets.skyEnvironment())` follows the sky in place of `pmremGenerator.fromScene`. `timeOfDay(hours)` gives a sky, a sun, fog and an exposure that match each other.

For a physical sky with ozone, twilight and haze on distant objects, move to `{ atmosphere }`. It looks different from three.js's sky. The default `sunPosition` is the sun of three.js's sky example, 2 degrees over the horizon toward -Z. It is not a `Sky` uniform default.

The sky is about 5 at the horizon by day, and three.js's sky examples use an exposure of 0.5. So a port lit by the sky's environment at full intensity looks brighter. Lower the environment's intensity or the exposure.

</details>

<details>
<summary>Technical details: A physical sky and aerial perspective (add-ons such as @takram/three-atmosphere: SkyMaterial, AerialPerspectiveEffect)</summary>

The sun's light is in the units of a directional light. Aim the scene's light at the sun yourself, or take it from `timeOfDay(hours, { model: 'physical' })`. The sky lights nothing by itself: `scene.setEnvironment(await assets.skyEnvironment())` follows it. The Low preset draws the analytic sky in its place. No separate aerial perspective effect is needed.

</details>

## Sprites, points, lines and labels

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| Sprite / SpriteMaterial | await scene.createSprites({ count, map, atlas, sizeAttenuation, center }) | changed | Camera-facing quads draw in one batch, with typed arrays of positions, sizes, rotations, colors and atlas frames per sprite. The call is async, because the first one downloads the sprite code. Sprites blend by default, as three.js's do. Details below the table. | [Sprites](../api/sprites.md) |
| Points / PointsMaterial | await scene.createPoints({ positions, colors, size, sizeAttenuation, map }) | changed | Points of one size draw in one batch as camera-facing squares, at any size on every backend. The call is async, because the first one downloads the sprite code. Points are opaque by default, as three.js's are; `transparent` becomes `alphaMode 'blend'`, and `alphaMap` has no counterpart. Details below the table. | [Points](../api/points.md) |
| Line / LineSegments / LineLoop / LineBasicMaterial / LineDashedMaterial / Line2 / LineSegments2 / LineMaterial | await scene.createLines({ positions, colors, mode, width, worldUnits, dashed }) | changed | Segments between points draw in one batch as quads with round ends, as `Line2` draws them, at any width on every backend. `mode` replaces the line classes, and `width` replaces `linewidth`. The call is async, and `LineMaterial.resolution` needs no setting. Details below the table. | [Lines](../api/lines.md) |
| Points or InstancedMesh particles moved on the CPU / three.quarks ParticleSystem / three-nebula | await createParticles(ctx, { rate, bursts, lifetime, shape, speed, gravity, drag, wind, turbulence, size, colors, alphaOverLife, blending, map, flipbook }) from @null3d/particles; system.update() in onLateUpdate | changed | three.js has no particle system. A port replaces the loop that moves `Points` or `InstancedMesh` rows with an emitter whose particles the GPU moves in closed form. Gravity, drag toward the wind, turbulence and a bouncing ground come from options. Details below the table. | [Particles (@null3d/particles)](../api/particles.md) |
| CSS2DRenderer / CSS3DRenderer (HTML labels) | Sketch: ui.trackLabel(obj, 'hp-12', { offset: [0, 2, 0] }). Page: engine.labels.bind('hp-12', element). A plane of the scene: ui.trackLabel(obj, 'card', { transform: 'world' }), or 'billboard' with a rotation | changed | The sketch places each label with the camera of each frame, and the page moves the element over it in the frame on screen. The element's center sits where `CSS2DRenderer` puts a `CSS2DObject`'s, and the offset turns and scales with the object. The engine has no camera view offset. Details below the table. | [Labels that follow objects](../api/ui.md) |

<details>
<summary>Technical details: Sprite / SpriteMaterial</summary>

Without size attenuation, sizes are in CSS pixels, not a fraction of the view's height. A three.js scale s shows `s × h / (2 × tan(fov / 2))` CSS pixels on a canvas h CSS pixels high. `center` holds one value for the whole batch, not one per sprite. An atlas read through `texture.offset` and `texture.repeat` becomes `atlas` and `frames`.

`alphaTest` becomes `alphaMode 'mask'` with `alphaCutoff`. Raycasts hit each sprite's quad, as `Raycaster` does, with the active camera in place of `raycaster.camera`. `sprites.on('click', fn)` takes pointer events, and the event's `instance` is the sprite.

</details>

<details>
<summary>Technical details: Points / PointsMaterial</summary>

`alphaTest` becomes `alphaMode 'mask'` with `alphaCutoff`. With size attenuation, `size` is in world units: three.js's size times `tan(fov / 2)`. Without it, size is in CSS pixels, as in three.js. A point does not vanish when its center leaves the screen, as a WebGL point does. Blended points sort back to front.

Raycasts hit each point's square by default. The `pointThreshold` option gives `Raycaster.params.Points.threshold`'s test instead: a hit within that distance of the point, whatever its size. `points.on('click', fn)` takes pointer events, and the event's `instance` is the point. The geometry's position and color attributes become `positions` and `colors`.

With an orthographic camera, three.js ignores size attenuation, so port with `sizeAttenuation: false` and three.js's size. three.js's WebGPU renderer draws points one pixel wide, and WebGL lets a GPU cap their size as low as 1 pixel.

</details>

<details>
<summary>Technical details: Line / LineSegments / LineLoop / LineBasicMaterial / LineDashedMaterial / Line2 / LineSegments2 / LineMaterial</summary>

`'segments'` also replaces `LineSegments2` with `LineSegmentsGeometry`. A one-pixel `Line` ports as `width` 1. Point colors are linear RGB, stored at 8 bits per channel. `positions` replaces `LineGeometry.setPositions` or the position attribute, and `colors` replaces `setColors` or the color attribute.

`dashed` and the dash values replace `LineDashedMaterial` and `computeLineDistances`. `dashed` is fixed when the batch is created, and `lines.material.set` changes the four dash values, whose defaults match `LineMaterial`'s. `lit: true` shades lines with the scene's lights.

Raycasts hit a segment within half its width, as `Line2` does, in pixels through the active camera or in world units. The `lineThreshold` option gives `Raycaster.params.Line.threshold`'s test instead, as for `Line`. `maxDistance` limits line hits too, though three.js's `Line2` ignores `raycaster.far`. `lines.on('click', fn)` takes pointer events, and the event's `instance` is the segment.

</details>

<details>
<summary>Technical details: Points or InstancedMesh particles moved on the CPU / three.quarks ParticleSystem / three-nebula</summary>

Write the effect's look as curves over life in place of per-frame color and size code. `AdditiveBlending` becomes `blending 'additive'`; particles never write depth. A sprite atlas becomes `map` with `flipbook`. three.quarks's sub-emitters become `subEmitters` on `'death'` or `'ground'`. A system does not sort its own particles, cast shadows or take light.

</details>

<details>
<summary>Technical details: CSS2DRenderer / CSS3DRenderer (HTML labels)</summary>

Put the elements in a container that covers the canvas. Hidden labels get `visibility: hidden`, not `display: none`. There is no z-index by distance, and no center. Give an element `pointer-events: auto` for the clicks that `CSS3DRenderer` gives it.

For `CSS3DRenderer`, a label with `transform 'world'` takes a `CSS3DObject`'s matrix. `'billboard'` takes a `CSS3DSprite`'s, with `rotation2D` as `rotation`. The page moves the element into a container inside its parent, which holds the camera's perspective. It then turns the element with its world matrix, as `CSS3DRenderer` draws it. An element is sized in CSS pixels, which are the scene's units. Both perspective and orthographic cameras carry the planes, so a scene that uses either lens ports as it is.

The engine hides a plane whose anchor is behind the camera or outside the near and far planes. `CSS3DRenderer` does not do that. The offset follows the object as a `CSS2DObject`'s position does under its parent. The engine leaves the pointer to your CSS. It writes a transform only when it changes, and a page holds its planes with `maxLabels3d`.

All seven of three.js's CSS3D examples have a port: css3d_periodictable, css3d_molecules, css3d_sprites, css3d_sandbox, css3d_orthographic, css3d_mixed and css3d_youtube. Three also draw WebGL content: mixed, sandbox and orthographic. Where the mixed example's invisible plane writes depth alone to show its embedded page clean, a material with `colorWrite: false` does the same.

A cell table ports directly: one object and one `ui.trackLabel(object, id, { transform: 'world' })` for each cell. The cell's HTML goes in the element, and the example's camera. The port skill's architecture guide shows it.

</details>

## Other

| three.js | null3D | Status | Notes | Docs |
| --- | --- | --- | --- | --- |
| WebXR (renderer.xr, VRButton, ARButton) | None | unsupported | null3D has no WebXR support. Keep an XR view in three.js. | [Unsupported three.js features](../porting/threejs-unsupported.md) |
| GaussianSplat / GaussianSplatPLYLoader / SPZLoader / SPLATLoader / KSPLATLoader (addons) | const splats = await createSplats(ctx, { url }) from @null3d/splats; assets.loadGltf for a KHR_gaussian_splatting model | changed | Importing `@null3d/splats` registers the `KHR_gaussian_splatting` reader, so a glTF model of splats loads with `assets.loadGltf`. An SPZ file loads through `createSplats`, which cuts the cloud into detail levels. It chooses the splats within a budget that follows the quality preset and the GPU path, then lets the engine sort them by depth. Details below the table. | [Gaussian splats (@null3d/splats)](../api/splats.md) |
| Audio / PositionalAudio / AudioListener / AudioLoader | @null3d/sound: createSound in the sketch, connectSound on the page | changed | `AudioListener` is `createSound`'s listener option, usually the camera. A looping `PositionalAudio` is a `sound.loop` at a place, with `refDistance` as `near`; one that plays once per event is a `sound.shot`. `AudioLoader` and `AudioAnalyser` have no counterpart: name the file by its address, and analyze the page's own Web Audio. Details below the table. | [Sound (@null3d/sound)](../api/sound.md) |
| lil-gui / dat.gui panels | Keep the panel on the page; send changes with engine.postToSketch and receive them with page.onMessage | changed | Keep the panel on the page. Send changes with `engine.postToSketch` and receive them with `page.onMessage`. For values that you only tune while you develop, the `?inspect` panel of a development build changes transforms and material values with no code ([Debugging](../guides/debugging.md)). | [Messages between sketch and page](../api/page.md) |
| cannon-es / Rapier / Ammo / Oimo | Run the physics library in the sketch worker; copy body transforms into dynamic arrays after each step | changed | null3D has no physics API. WebAssembly physics builds run in workers. | [Using a physics library](../guides/physics.md) |
| three-mesh-bvh (computeBoundsTree, acceleratedRaycast) | Built in | direct | Delete the setup. Every query walks the engine's own trees over each mesh's triangles and over the scene's objects. | [Raycasting and spatial queries](../api/raycast.md) |
| React Three Fiber / drei (Canvas, useFrame, useGLTF, OrbitControls, Environment, Html) | React stays for the page UI; the scene moves into sketch.ts | manual | React keeps the page UI and talks to the sketch through messages. Rewrite each scene component and drei helper by hand. drei's `<Html>` becomes `ui.trackLabel` in the sketch, and `ContactShadows` and `onPointerMissed` have no counterpart. Details below the table. | [Messages between sketch and page](../api/page.md) |
| GLSL source strings (gl_FragColor, gl_Position, #include <chunk>) | WGSL, which the null3D Vite plugin compiles | manual | See the custom shaders guide and the WGSL rules for portable shaders. | [Custom shaders](../guides/custom-shaders.md) |
| document or window access inside scene code | DOM code stays in page.ts; data travels in messages; sizes come from ctx.engine.viewport | changed | The sketch worker has no DOM. createEngine({ sketchThread: 'main' }) runs the sketch on the page's thread, where it can reach the DOM. | [Sketch API: defineSketch and the context](../api/sketch.md) |
| vite.config.js (the app built with Vite) | `plugins: [null3d()]` in vite.config.ts, with `null3d` imported from `@null3d/vite-plugin` | changed | Every Vite build of a null3D project needs the plugin, for the dev server and for production, which a three.js project does not. It sends the headers that let worker threads share memory, compiles the WGSL, and builds the engine's workers. null3D supports Vite alone, so a project on another bundler moves to Vite. Details below the table. | [Install null3D](../getting-started/install.md) |
| new Worker(...) / worker.postMessage / SharedArrayBuffer | runTask: the task's module and its WebAssembly run in the engine's job workers | changed | An add-on starts no worker of its own. Give `runTask` the address of a module that exports `run`, and await its answer. A `SharedArrayBuffer` in the task's input is shared with the worker rather than copied. Details below the table. | [Tasks on the job workers](../api/tasks.md) |

<details>
<summary>Technical details: GaussianSplat / GaussianSplatPLYLoader / SPZLoader / SPLATLoader / KSPLATLoader (addons)</summary>

A large cloud loads as a splat stream: `createSplats` reads an index of chunk files and downloads only the chunks that the view needs. The cloud then draws before its whole file arrives. three.js has no equivalent. Update them once in each frame with `splats.update(eye)`, from the camera's `getPosition`. The first spherical-harmonic band gives each splat's color; higher bands are ignored. three.js's `GaussianSplat` and its loaders are add-ons, so each name maps to this one add-on.

</details>

<details>
<summary>Technical details: Audio / PositionalAudio / AudioListener / AudioLoader</summary>

three.js's `maxDistance` only stops the fall with distance, while `far` fades the sound out. Give `far` where the sound should end. A non-positional `Audio` is a loop with `positional: false`. The page loads the named file once the user starts the sound.

</details>

<details>
<summary>Technical details: React Three Fiber / drei (Canvas, useFrame, useGLTF, OrbitControls, Environment, Html)</summary>

The directional light's contact shadows are another technique in place of `ContactShadows`, a blurred shadow on a ground plane. Mesh events such as `onClick` and `onPointerEnter` become `obj.on('click')` and `obj.on('pointerenter')`.

React Three Fiber casts only against objects with handlers, and passes an event to every hit until `stopPropagation`. null3D passes it to the closest drawn object and its parents, so an object without handlers in front takes it. React Three Fiber's `onClick` also fires after a drag. null3D gives no click after a drag past 2 CSS pixels, or 10 for a finger. For a pointer miss, set a flag in click handlers, and treat `input.wasReleased('Mouse0')` without it as a miss.

</details>

<details>
<summary>Technical details: vite.config.js (the app built with Vite)</summary>

A one-file trial can load the engine from a CDN instead.

</details>

<details>
<summary>Technical details: new Worker(...) / worker.postMessage / SharedArrayBuffer</summary>

The engine never waits for a task in a frame, and an answer arrives between frames.

</details>
