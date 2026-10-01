---
id: porting/threejs-mapping
title: three.js to null3D mapping
status: generated
since: "0.3"
summary: "Every three.js API a port is likely to meet, with its null3D equivalent."
---

# three.js to null3D mapping

Status values:

- `direct`: Same concept; the call or option changes name only.
- `changed`: Supported, with a different API or pattern. Follow the note.
- `manual`: Must be rewritten by hand, for example GLSL shaders or render hooks.
- `post-1.0`: Not in version 1.0. Use the workaround in the note.
- `unsupported`: Out of scope for null3D. Use the workaround in the note.

The "Since" column gives the first engine version with the feature:

- 0.1: the core renderer, with cameras, materials, lights and shadows
- 0.2: content, such as glTF models, animation, raycasting and post-processing
- 0.3: developer tools, such as the `null3d` command, templates and the porting tools
- 1.0: the stable API

## Renderer and loop

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| WebGLRenderer / WebGPURenderer | createEngine({ canvas, sketch }) on the page; scene code moves to sketch.ts inside defineSketch() | changed | 0.1 | The engine picks WebGPU or WebGL2 itself. antialias: true maps to createEngine({ antialias: 'msaa' }) and false to 'none'; without the option the quality preset picks FXAA on Low and MSAA 4x from Medium up; alpha: true maps to createEngine({ transparent: true }); powerPreference maps to createEngine({ powerPreference }), whose default is 'high-performance'. | `getting-started/first-scene` |
| renderer.setPixelRatio(devicePixelRatio) | createEngine({ maxPixelRatio }) and the quality presets; quality.set({ maxPixelRatio }) in the sketch | changed | 0.1 | The engine sizes the canvas to its CSS size times the screen's pixel ratio, up to the quality preset's cap. The option replaces the cap, and quality.set changes it during play. | `concepts/quality-presets` |
| renderer.setSize / window resize handler / camera.aspect + updateProjectionMatrix | Automatic | changed | 0.1 | The engine follows the canvas's CSS size. Perspective cameras, and orthographic cameras made with a height, follow its aspect ratio in every frame. Delete resize handlers and updateProjectionMatrix calls. | `api/engine` |
| requestAnimationFrame(animate) / renderer.setAnimationLoop / renderer.render(scene, camera) | onUpdate(dt) returned from defineSketch() | changed | 0.1 | The engine renders every frame by itself; never call a render function. Per-frame logic goes in onUpdate, camera-follow logic in onLateUpdate. | `porting/threejs-loop-and-threads` |
| renderer.shadowMap.enabled / .type (PCFSoftShadowMap, VSMShadowMap) | castShadows: true on the light; filtering follows the preset | changed | 0.1 | Presets use 3 x 3 or 5 x 5 PCF filtering. VSM has no equivalent. | `concepts/shadows` |
| renderer.toneMapping (ACESFilmic, AgX, Neutral, Reinhard, Cineon, Linear) / toneMappingExposure | post.set({ toneMapping: 'aces' \| 'agx' \| 'neutral' \| 'none', exposure }) | changed | 0.1 | The engine default is ACES; three.js defaults to no tone mapping, so ports of scenes without it set toneMapping: "none". The curves use three.js's formulas. "none" applies the exposure, as LinearToneMapping does; NoToneMapping ignores toneMappingExposure, so keep exposure at 1 when porting it. Reinhard and Cineon have no built-in equivalent: use "neutral", or a custom final effect (0.2). | `api/post` |
| renderer.outputColorSpace / outputEncoding / ColorManagement | Nothing to do | direct | 0.1 | Output is sRGB with a linear working space, as in three.js r152+ defaults: the final pass encodes sRGB and dithers. Hex colors are sRGB and [r, g, b] arrays are linear, as three.js reads them. Delete these lines. | `concepts/color-management` |
| renderer.info / stats.js | debug.stats(true); debug.frameStats() for numbers | changed | 0.1 | The overlay shows frame phases per thread, GPU tier and preset. | `api/debug` |
| renderer.compile / compileAsync (pre-warming shaders) | await scene.warmUp() before hiding the loading screen | changed | 0.1 | The first frame waits for its pipelines. warmUp resolves once every pipeline that the scene needs is built, hidden objects included, so warm up a later loading stage before you show it. | `guides/loading-screens` |
| renderer.setClearColor / scene.background = color or texture | scene.setBackground('#rrggbb' \| texture \| environment) | direct | 0.1 | A texture fills the view behind every object and stretches to its shape, as a texture background does in three.js. Exposure and tone mapping change the background, as in three.js's WebGPURenderer; WebGLRenderer draws a background color, and an sRGB background texture, without them. For an exact page color, set toneMapping: "none", or use createEngine({ transparent: true }) over a CSS background. setClearColor(color, 0) on an alpha canvas becomes transparent: true with no background. Environment backgrounds come in 0.2. | `api/scene` |
| document.body.appendChild(renderer.domElement) | createEngine({ canvas }) | changed | 0.1 | Create the canvas in HTML or in page.ts and pass it in. The engine hands it to the render worker. | `getting-started/first-scene` |
| preserveDrawingBuffer + canvas.toDataURL / readRenderTargetPixels | await engine.capture() on the page | changed | 0.1 | Resolves with a PNG Blob of the next frame that the engine draws. Tests read pixels with engine.captureFrame() instead. | `api/engine` |
| WebGLRenderTarget / RenderTarget / renderer.setRenderTarget (render to texture) | render.addPass({ kind: 'scene', camera, writes: 'myTexture', size }) and sample 'myTexture' in a material | changed | 0.2 | Passes are declared, not called: the render graph orders them and manages their memory. | `guides/custom-passes` |
| renderer.setViewport / setScissor (split screens, picture in picture) | A render-to-texture pass plus a final effect, for minimaps and picture in picture (0.2) | post-1.0 | - | Several full views (scene.createView), such as split screens, come after 1.0. | `guides/multiple-views` |
| renderer.capabilities / renderer.extensions | engine.capabilities on the page, which sends the sketch what it needs with engine.postToSketch | changed | 0.1 | Reports GPU tier, limits and features. Never branch on GPU names: some browsers hide them. | `concepts/backends` |
| logarithmicDepthBuffer / reverseDepthBuffer | Nothing to do; createEngine({ largeWorld: true }) for planet-scale scenes | direct | 0.1 | The engine draws reversed depth in a 32-bit float buffer on WebGPU, and on WebGL2 where the browser has EXT_clip_control. engine.capabilities.depth says which depth the device draws. The engine also renders relative to the camera through per-cell offsets. | `concepts/backends` |

## Scene graph

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| new THREE.Scene() | The scene from the sketch context: defineSketch(({ scene }) => ...) | changed | 0.1 | Objects are created in the scene directly. | `api/scene` |
| scene.environment (PMREMGenerator, RoomEnvironment, HDR files) | scene.setEnvironment(await assets.loadEnvironment('/env/studio.ktx2')) | changed | 0.2 | Prefilter HDR files offline with `bunx @null3d/cli assets env`. A built-in neutral studio environment replaces RoomEnvironment: assets.builtinEnvironment('studio'). | `concepts/lighting` |
| scene.fog = new Fog(color, near, far) / new FogExp2(color, density) | scene.setFog({ type: 'linear', color, near, far }) or { type: 'exp2', color, density } | direct | 0.1 | Same formulas and defaults. Materials opt out with fog: false. null3D mixes the fog in linear color, as WebGPURenderer does. WebGLRenderer mixes it after the sRGB encoding when it draws to the canvas, so there the same fog looks a little darker at middle distances. | `api/scene` |
| new Group() / new Object3D() | scene.createGroup({ name, position }) | direct | 0.1 |  | `api/objects` |
| parent.add(child) / remove / attach / scene.add | child.setParent(parent); setParent(parent, { keepWorld: true }) for attach(); destroy() to remove | changed | 0.1 | Objects are in the scene as soon as they are created. setParent keeps the local transform, like add(). Creating, destroying and re-parenting rebuild the draw tables in that frame, so during play hide with setVisible and pool with setActiveCount instead (guides/performance). | `api/objects` |
| object.position.set / .x = / .copy / translateX/Y/Z | obj.setPosition(x, y, z); obj.translate(x, y, z) for translateX/Y/Z | changed | 0.1 | translate moves along the object's own axes, as translateX, translateY and translateZ do together. For many moving objects, write instance-batch or dynamic arrays directly instead of calling setters. | `api/objects` |
| object.rotation (Euler) / rotateX/Y/Z / rotateOnAxis | obj.setRotationEuler(x, y, z, 'XYZ'), obj.rotateX/Y/Z(angle), or obj.setRotation(qx, qy, qz, qw) | changed | 0.1 | Euler order strings match three.js. rotateX, rotateY and rotateZ turn the object about its own axes, as in three.js. For rotateOnAxis, multiply the quaternion from obj.getRotation by one from quat.setAxisAngle, and pass the product to setRotation. | `api/objects` |
| object.quaternion.set / slerp / setFromAxisAngle | obj.setRotation(x, y, z, w), with the quaternion from quat.setAxisAngle, quat.fromEuler, quat.multiply or quat.slerp | changed | 0.1 | The quat helpers write into an array that you create once with quat.create(). Pass its four numbers to setRotation. The rotations array of an instance batch takes the same order. | `api/math` |
| object.scale.set / setScalar | obj.setScale(x, y, z) | changed | 0.1 |  | `api/objects` |
| object.lookAt(target) | obj.lookAt(x, y, z) | direct | 0.1 | Cameras and lights look down -Z, as in three.js. | `api/objects` |
| object.getWorldPosition / getWorldQuaternion / matrixWorld | obj.getWorldPosition(out), obj.getWorldQuaternion(out), obj.getWorldMatrix(out) | changed | 0.1 | Each getter copies into an array that you make once, with vec3.create(), quat.create() or mat4.create(). They read the last frame that the engine processed, so a change made in onUpdate shows from the next onUpdate on. getWorldMatrix gives 16 numbers, column by column, like matrixWorld.elements. | `api/objects` |
| matrixAutoUpdate = false / updateMatrix / updateMatrixWorld / matrixWorldNeedsUpdate | Nothing to do: objects are static by default and update when a setter changes them; create objects that move every frame with dynamic: true | changed | 0.1 | Remove manual matrix calls. Only dynamic objects and instance batches may be written through typed arrays. | `concepts/static-dynamic` |
| object.traverse / getObjectByName / children | scene.find(name) for getObjectByName; your own arrays of objects instead of traverse and children | changed | 0.1 | scene.find returns the first object created with the name, from an index. No call walks an object's children, so keep the objects you need in arrays at setup time. | `api/objects` |
| object.visible = false | obj.setVisible(false) | direct | 0.1 | Cheap: it uploads the object's matrix and draw entry and never rebuilds the draw tables, so use it instead of removing and adding objects during play. | `api/objects` |
| object.castShadow / receiveShadow | mesh.setCastShadows(true) / setReceiveShadows(true), or the castShadows and receiveShadows options of createMesh | direct | 0.1 | Both are false by default, as in three.js. The directional light's shadows draw on WebGPU; WebGL2 draws none yet. Unlit materials show no shadows. Instance batches neither cast nor receive them yet. | `api/objects` |
| object.layers / camera.layers (set, enable, disable) | obj.setLayers(mask), camera.setLayers(mask), batch.setLayers(mask); the layers option of createMesh, createInstances and createPerspectiveCamera | changed | 0.1 | Masks have the same 32 bits and the same default, layer 0 alone, and a camera draws an object when their masks share a bit. layers.set(n) becomes setLayers(1 << n). For enable and disable, keep the mask in your code and pass the new mask. An InstancedMesh's layers become its batch's, for every row. Raycasts and declared passes take layer masks from 0.2. | `concepts/render-layers` |
| object.renderOrder | mesh.setRenderOrder(n) | direct | 0.1 | Orders blended objects, lower first, before their depth, as in three.js. The engine orders opaque and masked objects itself for speed. The rows of an instance batch sort by depth one by one, where three.js sorts an InstancedMesh as one object. | `api/objects` |
| object.frustumCulled = false | mesh.setFrustumCulled(false) | direct | 0.1 | Usually needed only for shader-displaced geometry; prefer mesh.setBounds(center, radius) with larger bounds, which keeps culling at work. | `api/objects` |
| object.userData | Your own arrays, or a Map keyed by the object | manual | 0.1 | Engine objects are not extensible. A Map from each object to its data keeps the data beside the object, and arrays indexed the way your sketch counts objects stay fastest in per-frame loops. | `concepts/handles` |
| object.onBeforeRender / onAfterRender | onUpdate / onLateUpdate, or a declared pass | manual | 0.1 | Sketch code never runs in the render worker, so per-draw callbacks cannot exist. | `porting/threejs-loop-and-threads` |
| object.clone() / SkeletonUtils.clone(gltf.scene) | scene.instantiate(prefab) for loaded models; scene.clone(obj) for built objects | changed | 0.2 | Skinned models clone correctly with instantiate. | `api/scene` |
| geometry.dispose() / material.dispose() / texture.dispose() | destroy() on the engine object | changed | 0.1 | texture.destroy() frees a texture's GPU memory, and materials that map it draw with their colors alone. A prefab (0.2) frees its GPU data when the prefab and its last instance are destroyed. | `api/assets` |
| scene.overrideMaterial | render.addPass({ kind: 'scene', materialOverride }) or debug.view('normals') | changed | 0.2 |  | `guides/custom-passes` |
| scene.environmentRotation / backgroundRotation / material.envMapRotation | scene.setEnvironment(env, { rotation }) and scene.setBackground(env, { rotation }) | direct | 0.2 | Rotation is an Euler array in radians, as in three.js. | `api/scene` |
| scene.backgroundBlurriness / backgroundIntensity | scene.setBackground(env, { blur, intensity }) | direct | 0.2 |  | `api/scene` |

## Cameras

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| PerspectiveCamera(fov, aspect, near, far) | scene.createPerspectiveCamera({ fov, near, far, position, target }) | direct | 0.1 | fov is vertical and in degrees, as in three.js. The aspect ratio is automatic. The fov, near and far properties are read-only: change them with camera.setFov(degrees) and camera.setNearFar(near, far). | `api/cameras` |
| OrthographicCamera(left, right, top, bottom, near, far) | scene.createOrthographicCamera({ height, near, far, position, target }), or left, right, top and bottom in place of height | direct | 0.1 | With height alone, the width follows the canvas's aspect ratio, so code that recomputes left and right on resize goes away. The four edges keep their shape on any canvas, as in three.js. To zoom, call camera.setOrthoHeight with the original height divided by three.js's zoom. | `api/cameras` |
| CubeCamera (dynamic reflections) | A static environment map, or reflection probes baked offline | post-1.0 | - |  | `porting/threejs-unsupported` |
| ArrayCamera / StereoCamera | None; split screens come after 1.0 with multiple views | unsupported | - | Stereo rendering belongs to XR, which is out of scope. | `porting/threejs-unsupported` |

## Lights and shadows

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| DirectionalLight (+ target, shadow.camera bounds) | scene.createDirectionalLight({ direction, color, intensity, castShadows, shadow }) | changed | 0.1 | The light is an object. Pass the target minus the position as direction, or call light.lookAt(x, y, z), again whenever the target moves. Surfaces show the first directional light created, which casts the shadows. Delete shadow.camera bounds: the engine's shadow cascades fit the view by themselves. | `api/lights` |
| PointLight(color, intensity, distance, decay) | scene.createPointLight({ position, color, intensity, range, decay }) | direct | 0.1 | distance becomes range, which every point light needs: 0, a light with no end, is not allowed, because the engine finds the lights near each surface by their ranges. The light is stored but does not light surfaces yet. | `api/lights` |
| SpotLight(color, intensity, distance, angle, penumbra, decay) | scene.createSpotLight({ position, direction \| target, angle, penumbra, range, decay, intensity }) | direct | 0.1 | distance becomes range, which every spot light needs. target is a point: call light.lookAt(x, y, z) when it moves. The light is stored but does not light surfaces yet. Spot light cookies (light.map) come after 1.0. | `api/lights` |
| HemisphereLight | scene.createHemisphereLight({ skyColor, groundColor, intensity }) | direct | 0.1 | The sky lies along the light's +Y axis: turn the light to tilt it, where three.js moves it. The light is stored but does not light surfaces yet. | `api/lights` |
| AmbientLight | scene.createAmbientLight({ color, intensity }) | direct | 0.1 | Several ambient lights add up. | `api/lights` |
| RectAreaLight | A spot light plus emissive geometry | post-1.0 | - |  | `porting/threejs-unsupported` |
| LightProbe / LightProbeGenerator | scene.setEnvironment: diffuse spherical harmonics come with the environment | changed | 0.2 | `bunx @null3d/cli assets env` computes them offline. | `concepts/lighting` |
| CSM addon (three/addons/csm) | Built in: shadow: { cascades } on the directional light | direct | 0.1 | Delete the addon. | `concepts/shadows` |
| light.shadow.mapSize / bias / normalBias / radius / camera | shadow: { mapSize, bias, normalBias, cascades, distance } in the directional light's options, or light.setShadow() | changed | 0.1 | mapSize is one number, the texels on each side. bias and normalBias count texels of each cascade, not depth units and meters, so start from the defaults. radius and blurSamples will map to the preset's filter size; shadow.camera has no equivalent. | `concepts/shadows` |
| physicallyCorrectLights / useLegacyLights | Physical light units, as in three.js r155 and later | changed | 0.1 | Scenes tuned in three.js's legacy light mode need new intensities: retune them with parity images. | `concepts/lighting` |

## Geometry

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| Box / Sphere / Plane / Cylinder / Cone / Torus / Capsule / Circle / Ring Geometry | geometry.box({ width, height, depth }), geometry.sphere({ radius }), and one generator for each class | direct | 0.1 | The constructor's arguments become options with the same names and defaults: new CylinderGeometry(0.3, 0.4, 2) is geometry.cylinder({ radiusTop: 0.3, radiusBottom: 0.4, height: 2 }). The meshes match three.js's vertex for vertex, with the same positions, normals, texture coordinates and triangles. Each object has one material, so an array of materials for the face groups of a box or a cylinder needs one object for each group. | `api/geometry` |
| geometry.rotateX / rotateY / rotateZ / translate / scale / center / applyMatrix4 | obj.setRotationEuler(x, y, z), obj.setPosition(x, y, z) or obj.setScale(x, y, z) on the object that draws the mesh | changed | 0.1 | A mesh keeps the vertices its generator built, so the transform goes on each object or instance row: floor.setRotationEuler(-Math.PI / 2, 0, 0) lays a plane flat. To build the transform into the vertices, transform the arrays and pass them to geometry.fromArrays. | `api/geometry` |
| TorusKnot / Icosahedron / Octahedron / Tetrahedron / Dodecahedron / Polyhedron / Lathe / Extrude / Shape / Tube Geometry | The same generators from @null3d/geometry | direct | 0.2 | Same parameters as three.js; Shape and Path objects are ported too. | `api/geometry` |
| BufferGeometry + setAttribute / setIndex / BufferAttribute | geometry.fromArrays({ positions, normals, uvs, uvs1, colors, tangents, indices }) | changed | 0.1 | Returns a mesh that createMesh and createInstances accept. The attributes position, normal, uv, uv1, color and tangent each become one array, and setIndex becomes indices, 16-bit or 32-bit. The engine copies the arrays. | `api/geometry` |
| attribute.needsUpdate / setUsage(DynamicDrawUsage) (vertices changing every frame) | meshAsset.updateVertices(name, data, start, count) | changed | 0.2 | For many moving objects, use instances instead of rewriting vertices. | `api/geometry` |
| computeVertexNormals / computeTangents / computeBoundingSphere | geometry.fromArrays({ ..., computeNormals: true, computeTangents: true }) | changed | 0.1 | The results match three.js's bit for bit. computeTangents needs uvs, and works without indices too. Bounds are always automatic, so computeBoundingSphere and computeBoundingBox need no call. | `api/geometry` |
| EdgesGeometry / WireframeGeometry | scene.createLines({ fromEdges: meshAsset, thresholdAngle }); debug.view('wireframe') for debugging | changed | 0.2 |  | `api/lines` |
| TextGeometry / FontLoader / troika-three-text | DOM labels (ui.trackLabel), a texture with pre-rendered text, or a text mesh baked into glTF | post-1.0 | - | SDF text rendering comes after 1.0. | `porting/threejs-unsupported` |
| morphAttributes / morphTargetInfluences / morphTargetDictionary | glTF morph targets load automatically; obj.setMorphWeight(indexOrName, weight) | changed | 0.2 |  | `api/animation` |

## Materials

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| MeshStandardMaterial | materials.standard({ color, map, metalness, roughness, normalMap, aoMap, emissive, ... }) | direct | 0.1 | Both follow glTF's metallic-roughness model with the same formulas, so color, metalness, roughness and emissive values carry over. roughnessMap and metalnessMap become one metalnessRoughnessMap, and a texture's repeat, offset and rotation become the material's uvTransform. | `api/materials` |
| MeshPhysicalMaterial (clearcoat, transmission, sheen, iridescence, anisotropy, specular) | materials.standard for the base layer | changed | 0.1 | Clearcoat, transmission, sheen and specular are planned for after 1.0. Until then, approximate them or write a surface function. | `porting/threejs-materials` |
| MeshBasicMaterial | materials.unlit({ color, map, opacity, alphaMode, vertexColors }) | direct | 0.1 | Its map's alpha and the vertex alpha join the opacity, as in three.js. | `api/materials` |
| MeshLambertMaterial / MeshPhongMaterial | materials.standard with metalness 0 and roughness near 1 (Lambert), or roughness tuned to the Phong shininess | changed | 0.1 | Expect small visual differences: the standard material adds a faint highlight and keeps energy as three.js's MeshStandardMaterial does. Check with parity images and accept or tune. | `api/materials` |
| MeshToonMaterial | A toon surface function (recipe in the materials reference) | manual | 0.1 |  | `porting/threejs-materials` |
| MeshNormalMaterial / MeshDepthMaterial / MeshDistanceMaterial / MeshMatcapMaterial | debug.view('normals' \| 'depth') for debugging; matcap is a surface-function recipe | changed | 0.1 |  | `porting/threejs-materials` |
| ShaderMaterial / RawShaderMaterial (GLSL) | materials.shader({ wgsl, uniforms, textures }) with a WGSL surface function, or a full WGSL shader | manual | 0.1 | Rewrite in WGSL, in one literal tagged /* wgsl */. Prefer a surface function, so lighting, shadows, fog and instancing keep working. Declare the uniforms once, as struct Uniforms. | `shaders/surface-functions` |
| material.onBeforeCompile (shader-chunk patching) | materials.shader({ wgsl }) with a surface function or a vertex-offset function | manual | 0.1 | The engine has no shader chunks to patch. Keep the standard options on the new material: defaultSurface applies them. | `shaders/surface-functions` |
| TSL / NodeMaterial (three/tsl, three/webgpu) | materials.shader({ wgsl }) with a WGSL surface function | manual | 0.1 | Most TSL nodes map to one WGSL expression; see the shader porting reference. | `shaders/surface-functions` |
| transparent / opacity / alphaTest / side / depthWrite / depthTest / blending / vertexColors / flatShading | alphaMode: 'blend' \| 'mask' (with alphaCutoff), doubleSided, depthWrite, depthTest, blending: 'normal' \| 'additive' \| 'multiply', vertexColors, flatShading | changed | 0.1 | transparent: true becomes alphaMode: 'blend'; alphaTest becomes alphaMode: 'mask' with alphaCutoff; side: DoubleSide becomes doubleSided: true. BackSide has no equivalent: flip the geometry. depthTest: false writes no depth either, as in three.js's WebGL renderer. blending takes effect with alphaMode: 'blend' only, where three.js blends an opaque material with additive or multiply blending too. | `porting/threejs-materials` |
| material.wireframe = true | debug.view('wireframe') for debugging; scene.createLines({ fromEdges }) for production wireframes | changed | 0.2 | WebGPU has no line-polygon mode, so wireframe is not a material flag. | `api/lines` |
| material.envMap / envMapIntensity | The scene environment; per-material envIntensity | changed | 0.2 |  | `concepts/lighting` |
| material.needsUpdate = true | Nothing to do | changed | 0.1 | Options that change the shader or the pipeline, such as texture maps, vertexColors, doubleSided and flatShading, are fixed when a material is created. Create each variant during loading: a new one compiles a pipeline, which can make a frame late. | `concepts/materials` |
| ShadowMaterial (shadow-catcher planes) | materials.shadowCatcher({ opacity }) | direct | 0.2 |  | `api/materials` |
| material fog: false | fog: false in the material options | direct | 0.1 |  | `api/materials` |
| material.bumpMap / bumpScale | A normal map converted offline: `bunx @null3d/cli assets normal-from-bump` | changed | 0.2 | Normal maps are cheaper at run time and look the same or better. | `guides/assets-pipeline` |
| material.displacementMap / displacementScale / displacementBias | A vertexOffset function that reads the texture with textureSampleLevel | manual | 0.1 | Enlarge the object bounds with setBounds so culling does not hide displaced vertices. | `porting/threejs-materials` |
| material.alphaMap | A surface function that sets s.alpha from the texture, or alpha packed into the base color map offline | manual | 0.1 | three.js reads the alpha map from its green channel; keep that channel in the surface function. | `porting/threejs-materials` |
| renderer.clippingPlanes / material.clippingPlanes / localClippingEnabled | A surface function with alphaMode "mask" that sets alpha to 0 beyond the plane (cookbook recipe) | manual | 0.1 | Shadows still use the unclipped mesh unless the shadow pass uses the same material. | `porting/threejs-materials` |
| material.polygonOffset / polygonOffsetFactor / polygonOffsetUnits | depthBias: { constant, slopeScale } in the material options | direct | 0.1 | Signs differ because WebGPU uses reversed depth: the engine converts, so keep the three.js intent (push away from the camera). | `api/materials` |
| material.toneMapped = false | Put the objects on a layer drawn by a declared pass after the post chain (render graph, 0.2) | post-1.0 | - | A per-material flag comes after 1.0; tone mapping runs once for the whole image. | `porting/threejs-postprocessing` |

## Textures

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| new TextureLoader().load / loadAsync | await assets.loadTexture(url, { colorSpace, flipY, wrap, filter, mipmaps, anisotropy, uvSet, premultipliedAlpha }) | changed | 0.1 | It returns a promise of the texture, which draws once its texels upload. flipY is true by default, as in three.js, and colorSpace is 'srgb'. | `api/textures` |
| texture.colorSpace = SRGBColorSpace (older: encoding = sRGBEncoding) | colorSpace: 'srgb' for color maps, 'linear' for data maps | direct | 0.1 | Same rule as three.js: base color and emissive maps are sRGB; normal, roughness, metalness and AO maps are linear. The default is 'srgb' for images and 'linear' for data. glTF sets them automatically. | `concepts/color-management` |
| texture.flipY | flipY in the loadTexture options | direct | 0.1 | glTF textures never flip. | `api/textures` |
| wrapS / wrapT / repeat / offset / rotation / center | wrap: 'repeat' \| 'clamp' \| 'mirror' in the texture options; repeat, offset and rotation go in the material's uvTransform | changed | 0.1 | uvTransform takes three.js's repeat, offset and rotation with the default center, and every map of the material shares it. three.js keeps one transform per texture. | `api/textures` |
| minFilter / magFilter / generateMipmaps / anisotropy | filter: 'linear' \| 'nearest', mipmaps, anisotropy (capped by the preset) | changed | 0.1 |  | `api/textures` |
| DataTexture / DataArrayTexture / Data3DTexture | textures.fromData({ width, height, depth, format, data }) | changed | 0.1 | Formats rgba8unorm and rgba16float (a Uint16Array of half floats or a Float32Array). depth above 1 makes a texture array of that many layers. Filters are linear by default, where three.js's DataTexture is nearest: pass filter: 'nearest'. | `api/textures` |
| CanvasTexture (a 2D canvas redrawn at run time) | Draw on an OffscreenCanvas in the sketch worker, then textures.fromImageBitmap(bitmap) and texture.update(bitmap) | changed | 0.1 | The sketch worker has no DOM canvas; OffscreenCanvas with a 2D context works in workers. Decode with createImageBitmap(canvas, { imageOrientation: 'flipY' }) so the drawing stands upright, as three.js flips it. | `api/textures` |
| VideoTexture | After 1.0: engine.registerVideo on the page and textures.fromVideo in the sketch. Until then, send ImageBitmap frames from the page and call texture.update(bitmap) | post-1.0 | - | The ImageBitmap route decodes and uploads every frame, so keep frames small (null3d-develop recipe 14). | `guides/video-textures` |
| CubeTextureLoader / CubeTexture | assets.loadCubemap(urls) for sky boxes; assets.loadEnvironment for lighting | changed | 0.2 |  | `api/textures` |
| RGBELoader / EXRLoader / HDRLoader / UltraHDRLoader + PMREMGenerator | `bunx @null3d/cli assets env studio.hdr` offline, then assets.loadEnvironment | changed | 0.2 | Prefiltering happens once at build time instead of on every visit. | `guides/assets-pipeline` |
| KTX2Loader + setTranscoderPath + detectSupport | assets.loadTexture('x.ktx2') | direct | 0.1 | Built in: delete the setup. The engine loads the transcoder with the first KTX2 file and picks the device's format. The file's first row is at v = 0, as with KTX2Loader. | `api/textures` |
| CompressedTexture / CompressedArrayTexture | assets.loadTexture('x.ktx2'); texture.format names the compressed format | changed | 0.1 | Compressed textures come from KTX2 files of ETC1S or UASTC data, with the file's mip levels. No call takes compressed blocks from code. | `api/textures` |
| texture.channel (which UV set a map uses) | uvSet: 0 or 1 in the texture's options | direct | 0.1 | Each map of a material reads the set that its texture names. glTF files carry this per texture, so loaded models need nothing. | `api/textures` |
| material.premultipliedAlpha / texture.premultiplyAlpha | loadTexture(url, { premultipliedAlpha: true }), which multiplies each color by its alpha as the image decodes | changed | 0.1 | Blending needs no material flag: the engine blends premultiplied colors. On a blended material, a base color map loaded with premultipliedAlpha: true looks the same as the image loaded without it, because the shader divides its colors by their alpha before it lights them. Other materials show the multiplied colors, as three.js does. | `api/textures` |

## Loaders

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| GLTFLoader().load / loadAsync | const prefab = await assets.loadGltf(url); scene.instantiate(prefab) | changed | 0.2 | Animations are in prefab.animations; named nodes via prefab.find(name). | `api/assets` |
| DRACOLoader + setDecoderPath | Draco files load, but convert them to meshopt with `bunx @null3d/cli assets optimize` | changed | 0.2 | meshopt decodes faster and needs no separate decoder download. | `guides/assets-pipeline` |
| MeshoptDecoder / setMeshoptDecoder | Built in | direct | 0.2 | Delete the setup. | `guides/assets-pipeline` |
| FBXLoader / OBJLoader / MTLLoader / ColladaLoader / STLLoader / PLYLoader / 3DMLoader / USDZLoader | Convert to glTF before release (`bunx @null3d/cli assets convert`, or Blender) | changed | 0.2 | The engine loads glTF only. | `guides/assets-pipeline` |
| LoadingManager / onProgress callbacks | assets.onProgress((loaded, total) => ...) and assets.preload([...urls]) | changed | 0.1 |  | `guides/loading-screens` |
| FileLoader / ImageLoader / ImageBitmapLoader | assets.loadBinary(url), assets.loadJson(url), assets.loadImageBitmap(url) | changed | 0.1 |  | `api/assets` |
| THREE.Cache.enabled | Nothing to do | changed | 0.1 | Loads of one URL at the same time share one download, files that assets.preload downloaded wait in memory until a load takes them, and the HTTP cache keeps the rest. | `api/assets` |

## Instancing and batching

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| InstancedMesh + setMatrixAt / setColorAt / instanceMatrix.needsUpdate | scene.createInstances(meshOrPrefab, count, { material, dynamic }); write batch.positions / rotations / scales / colors | changed | 0.1 | Static batches call markDirty(start, count) after writes; dynamic batches upload every frame without it. | `concepts/instances` |
| BatchedMesh | Nothing special: the engine batches objects that share a mesh and material | changed | 0.1 | Use createInstances for many copies of one mesh, and separate meshes for varied geometry. | `concepts/instances` |
| InstancedBufferGeometry / InstancedBufferAttribute (custom per-instance data) | createInstances(mesh, count, { material, attributes: { tint: 4 } }) adds per-instance arrays that surface functions can read | changed | 0.2 |  | `concepts/instances` |
| LOD (addLevel) | scene.createLod({ levels: [{ mesh, distance }] }), or LODs generated by `bunx @null3d/cli assets optimize --lod` | changed | 0.2 | The engine picks levels on job workers or on the GPU, per instance. | `concepts/lod` |

## Animation

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| AnimationMixer / clipAction / play / crossFadeTo / fadeIn / fadeOut / setEffectiveWeight / timeScale / mixer.update(dt) | const anim = obj.animator(); anim.play('run', { fade: 0.2, loop: true, speed }); anim.crossFade('walk', 0.3); anim.setLayerWeight(layer, w) | changed | 0.2 | No update call: the engine samples animation on job workers. | `api/animation` |
| AnimationClip / KeyframeTrack built in code | Animate values in onUpdate; transform clips authored in glTF play through the animator (0.2) | post-1.0 | - | Property animation (scene.animateProperty and glTF KHR_animation_pointer) comes after 1.0. | `api/animation` |
| SkinnedMesh / Skeleton / Bone built by hand | Skins load from glTF; anim.setJointOverride(jointName, rotation) for procedural aiming | changed | 0.2 | Building skeletons in code is not supported; author them in a modeling tool. | `api/animation` |
| AnimationUtils.subclip / makeClipAdditive | `bunx @null3d/cli assets` splits clips and makes them additive offline; anim.play(name, { additive: true }) | changed | 0.2 |  | `api/animation` |

## Interaction and controls

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| Raycaster.setFromCamera + intersectObject(s) | camera.screenToRay(x, y, ray); scene.raycast(ray.origin, ray.direction, { layers }, hit) | changed | 0.2 | Returns the closest hit; scene.raycastAll returns every hit. Acceleration structures are built in. | `api/raycast` |
| DOM pointer, mouse, touch and keyboard listeners | input.pointer, input.isDown('KeyW'), input.wasPressed('Mouse0'), input.touches, input.actions.define(); obj.on('pointerenter' \| 'pointerleave' \| 'click', fn) (0.2) | changed | 0.1 | The page forwards pointer, touch, keyboard and gamepad input to the sketch, which reads it once per frame and adds no DOM listeners. Keys take KeyboardEvent.code names, and the main mouse button or a tap is Mouse0. A canvas that takes touch gestures needs touch-action: none in its CSS. | `api/input` |
| OrbitControls / MapControls / TrackballControls / ArcballControls | createOrbitControls(ctx, camera, { target, enableDamping, dampingFactor, minDistance, maxDistance, maxPolarAngle }) or createMapControls(ctx, camera) from @null3d/controls; controls.update(dt) in onUpdate | changed | 0.1 | Option names and defaults match OrbitControls and MapControls, and mouseButtons and touches take strings such as 'rotate' and 'dolly-pan'. There is no DOM element, dispose or change event: update(dt) returns true when the camera moved. For keys, call controls.pan or controls.rotateLeft with the input the sketch reads. An orthographic camera zooms by its view height, and minZoom and maxZoom count zoom as three.js does from the height when the controls start. zoomToCursor, keys, listenToKeyEvents, saveState and reset are not built yet. Trackball and Arcball come after 1.0. | `api/controls` |
| FlyControls / FirstPersonControls / PointerLockControls | createFlyControls / createFirstPersonControls from @null3d/controls | changed | 0.2 | Pointer lock is requested on the page: engine.requestPointerLock(). | `api/controls` |
| TransformControls / DragControls | Dragging with scene.raycast against a plane | post-1.0 | - | Gizmos come after 1.0. | `porting/threejs-unsupported` |

## Helpers and debugging

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| AxesHelper / GridHelper / BoxHelper / Box3Helper / ArrowHelper / CameraHelper / light helpers / SkeletonHelper / PlaneHelper | debug.axes, debug.grid, debug.box, debug.sphere, debug.arrow, debug.frustum, debug.light, debug.skeleton | changed | 0.1 | Call them in onUpdate: each call draws for one frame. Debug drawing exists in development builds only. debug.grid takes GridHelper's size and divisions. debug.skeleton comes with animation in 0.2. | `api/debug` |

## Math

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| new Vector3 / Quaternion / Matrix4 / Euler / Color / Box3 / Sphere / Ray / Plane | Plain arrays and the vec3, quat, mat4 and color helpers from @null3d/engine, such as vec3.add(out, a, b) and quat.slerp(out, a, b, t) | changed | 0.1 | Create scratch arrays once with vec3.create(), quat.create() or mat4.create(), outside onUpdate. Most names match three.js. applyQuaternion is vec3.transformQuat, applyMatrix4 is vec3.transformMat4, multiplyScalar is vec3.scale and addScaledVector is vec3.scaleAndAdd. setFromUnitVectors is quat.rotationTo, and setFromEuler is quat.fromEuler, in radians. There are no helpers for Box3, Sphere, Ray or Plane. three.js math classes may stay in setup code during a port, but not in per-frame code. | `api/math` |
| Clock / getDelta / getElapsedTime | onUpdate(dt) or ctx.time.dt, and ctx.time.now | changed | 0.1 | getDelta() becomes the dt that onUpdate gets, also in ctx.time.dt, and getElapsedTime() becomes ctx.time.now. Sketch time stops while the engine is paused or the page is hidden. A fixed-step simulation, such as world.step(1 / 60), moves to onFixedUpdate. | `api/time` |
| MathUtils (degToRad, clamp, lerp, damp, randFloat, seededRandom) | math.degToRad, math.clamp, math.lerp, math.damp, math.randFloat and the other MathUtils names; math.seed and math.random | direct | 0.1 | Same names and arithmetic. The random helpers draw from math.random, which hold mode seeds. MathUtils.seededRandom(s) becomes math.seed(s) once, then math.random(). | `api/math` |
| Color.set / setHex / setHSL / setRGB / lerp | '#rrggbb' or '#rgb' strings, 0xrrggbb numbers, or [r, g, b] linear arrays from 0 to 1; color.fromHex, color.fromSrgb and color.fromHsl give linear RGB | changed | 0.1 | Hex values are sRGB, as setHex and setStyle read them, and the engine converts them to linear. [r, g, b] arrays are linear, as setRGB reads them, so the color helpers' results go straight into color options and instance colors. color.fromSrgb converts sRGB components, color.fromHsl gives what setHSL gives, and vec3.lerp blends two colors. | `concepts/color-management` |

## Post-processing

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| EffectComposer / RenderPass / OutputPass / PostProcessing (three/webgpu) / pmndrs postprocessing | post.set({ ... }) | changed | 0.2 | The chain is built in and merged into few passes. Delete the composer; keep only each pass's settings. | `porting/threejs-postprocessing` |
| UnrealBloomPass / BloomEffect / bloom() node | post.set({ bloom: { strength, radius, threshold } }) | direct | 0.2 | Similar response to UnrealBloomPass; tune with parity images. | `porting/threejs-postprocessing` |
| SSAOPass / SAOPass / GTAOPass / N8AO | post.set({ ao: { radius, intensity } }) | changed | 0.2 | GTAO at half resolution, on the High and Ultra presets. | `porting/threejs-postprocessing` |
| FXAAPass / FXAAShader / SMAAPass / TAARenderPass / SSAARenderPass | createEngine({ antialias: 'fxaa' }); the quality presets take MSAA 4x from Medium, and FXAA on Low | changed | 0.1 | FXAA runs inside the final pass, where three.js adds FXAAPass after OutputPass. SMAA and SSAA have no equivalent. TAA comes after 1.0. | `porting/threejs-postprocessing` |
| OutlinePass / OutlineEffect | post.set({ outline: { color, thickness } }) and obj.setOutlined(true) | direct | 0.2 |  | `porting/threejs-postprocessing` |
| BokehPass / DepthOfFieldEffect | Skip it, or write a custom final effect (scene depth is available to it) | post-1.0 | - |  | `porting/threejs-unsupported` |
| ShaderPass (custom full-screen GLSL) | post.addEffect({ name, wgsl, uniforms }) | manual | 0.2 | Rewrite the effect in WGSL; per-pixel effects merge into the final pass for free. | `porting/threejs-postprocessing` |
| FilmPass / GlitchPass / HalftonePass / AfterimagePass / DotScreenPass / RenderPixelatedPass | Custom effects with post.addEffect | manual | 0.2 | The cookbook has recipes for film grain, pixelation and afterimage. | `porting/threejs-postprocessing` |
| LUTPass / LUTCubeLoader / LUT3dlLoader | post.set({ lut: await assets.loadLut('grade.cube') }) | direct | 0.2 |  | `porting/threejs-postprocessing` |
| SSRPass / ReflectorForSSRPass | The environment map | post-1.0 | - | Planar and screen-space reflections come after 1.0. | `porting/threejs-unsupported` |
| Reflector / Refractor / Water / Water2 (addons) | A water surface function that samples the environment map | post-1.0 | - |  | `porting/threejs-unsupported` |
| Sky (addons) | scene.setBackground({ sky: { turbidity, rayleigh, sunDirection } }) | changed | 0.2 | A built-in analytic sky with the same parameters. | `api/scene` |
| Lensflare / LensflareElement (addons) | Screen-space sprites positioned with camera.worldToScreen (cookbook recipe) | manual | 0.2 |  | `porting/threejs-unsupported` |
| GammaCorrectionShader / sRGB conversion passes in the composer | Delete: output is converted to sRGB exactly once | changed | 0.1 | Keeping such a pass applies gamma twice and washes the image out. | `porting/threejs-postprocessing` |

## Sprites, points, lines and labels

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| Sprite / SpriteMaterial | scene.createSprites(count, { texture \| atlas, sizeMode: 'world' \| 'screen' }) | changed | 0.2 | Camera-facing quads drawn in one batch. | `api/sprites` |
| Points / PointsMaterial | scene.createPoints({ positions, colors, size, sizeAttenuation, texture }) | changed | 0.2 | Point sizes above one pixel work on every backend. | `api/points` |
| Line / LineSegments / LineLoop / LineBasicMaterial / LineDashedMaterial / Line2 / LineMaterial | scene.createLines({ positions, colors, width, widthUnits: 'pixels' \| 'world', dashed }) | changed | 0.2 | Widths above one pixel work on every backend, so Line2 and LineMaterial need no special handling. | `api/lines` |
| CSS2DRenderer / CSS3DRenderer (HTML labels) | Sketch: ui.trackLabel(obj, 'hp-12', { offset: [0, 2, 0] }). Page: engine.labels.bind('hp-12', element) | changed | 0.2 | The engine writes screen positions into shared memory each frame, and the page moves the elements; no messages per frame. CSS3D transforms come after 1.0. | `guides/ui-overlays` |

## Other

| three.js | null3D | Status | Since | Notes | Docs |
| --- | --- | --- | --- | --- | --- |
| WebXR (renderer.xr, VRButton, ARButton) | None | unsupported | - | XR is out of scope for version 1. | `porting/threejs-unsupported` |
| Audio / PositionalAudio / AudioListener / AudioLoader | Web Audio on the page | unsupported | - | The sketch writes the positions of moving sounds into a shared array, which it sends to the page once. It sends one message with page.post for each sound event. | `guides/audio` |
| lil-gui / dat.gui panels | Keep the panel on the page; send changes with engine.postToSketch and receive them with page.onMessage | changed | 0.1 |  | `guides/ui-overlays` |
| cannon-es / Rapier / Ammo / Oimo | Run the physics library in the sketch worker; copy body transforms into dynamic arrays after each step | changed | 0.1 | WebAssembly physics builds run in workers. An official Rapier adapter comes after 1.0. | `guides/physics` |
| three-mesh-bvh (computeBoundsTree, acceleratedRaycast) | Built in | direct | 0.2 | Delete the setup. | `api/raycast` |
| React Three Fiber / drei (Canvas, useFrame, useGLTF, OrbitControls, Environment, Html) | React stays for the page UI; the scene moves into sketch.ts | manual | 0.1 | See the React Three Fiber guide for the component mapping. | `porting/react-three-fiber` |
| GLSL source strings (gl_FragColor, gl_Position, #include <chunk>) | WGSL, which the null3D Vite plugin compiles | manual | 0.1 | See the shader porting reference. | `porting/threejs-shaders` |
| document or window access inside scene code | DOM code stays in page.ts; data travels in messages; sizes come from ctx.engine.viewport | changed | 0.1 | The sketch worker has no DOM. | `porting/threejs-loop-and-threads` |
