---
id: api/reference/scene
title: "Scene: API reference"
status: generated
since: "0.1"
summary: "Every export of the Scene API, from the engine's doc comments."
---

# Scene: API reference

> [Scene](../scene.md) explains these exports. The engine's doc comments make this page.

## `BackgroundOptions`

Interface `BackgroundOptions`.

The options of `scene.setBackground` for a texture, an environment, a cube map or the sky. A call that leaves an option out takes its default.

| Member | Description |
| --- | --- |
| `intensity?: number` | The factor of the background's light, 0 or more, as three.js's `scene.backgroundIntensity`. The default is 1. |
| `blur?: number` | How much an environment blurs, from 0 (sharp) to 1, as three.js's `scene.backgroundBlurriness`. It reads the environment's light at that roughness, so a blurred background costs no more than a sharp one. Only environments blur. The default is 0. |
| `rotation?: readonly [number, number, number]` | The turn of a cube map or an environment about the scene, as Euler angles in radians in the order X, Y, Z, as three.js's `scene.backgroundRotation`. The default is `[0, 0, 0]`. |

## `BackgroundSource`

```ts
type BackgroundSource = Texture | Environment | Cubemap | SkyBackground;
```

What `scene.setBackground` draws behind every object in place of a plain color: a texture, an environment, a cube map or three.js's sky.

## `EnvironmentOptions`

Interface `EnvironmentOptions`.

The options of `scene.setEnvironment`. A call that leaves an option out takes its default.

| Member | Description |
| --- | --- |
| `intensity?: number` | The factor of the environment's light on every surface, 0 or more, as three.js's `scene.environmentIntensity`. A material's `envIntensity` multiplies it. The default is 1. |
| `rotation?: readonly [number, number, number]` | The turn of the environment about the scene, as Euler angles in radians in the order X, Y, Z, as three.js's `scene.environmentRotation`. The default is `[0, 0, 0]`. |

## `FogCurve`

```ts
type FogCurve = 'exponential' | 'exp2' | 'linear';
```

How fog thickens with distance. Exponential fog, `'exponential'`, follows light through an even haze. An object at distance d takes the fog color by a factor of 1 - exp(-density × d). Exponential squared fog, `'exp2'`, thickens with the square of the distance, as three.js's `FogExp2`: 1 - exp(-(density × d)²). Linear fog, `'linear'`, is clear up to `near` and hides objects from `far`, with a smooth step between them, as three.js's `Fog`.

## `FogOptions`

Interface `FogOptions`.

Options of `scene.setFog`. Fog measures each object's straight-line distance from the camera, so an object keeps its fog as the camera turns.

| Member | Description |
| --- | --- |
| `color: ColorInput` | The fog's color. Give the background the same color, because the background takes no fog. |
| `curve?: FogCurve` | How the fog thickens with distance. The default is `'exponential'`. |
| `density?: number` | How fast exponential and exponential squared fog thicken with distance: 0 or more. At the default of 0.01, exponential fog hides about two thirds of an object 100 units away. |
| `near?: number` | The distance where linear fog starts. The default is 1. |
| `far?: number` | The distance from which linear fog hides every object. It must be above `near`. The default is 1000. |
| `height?: number` | The height where the fog has its `density`, or its `near` and `far` distances. Above it, fog with a `heightFalloff` thins; below it, the fog thickens. The default is 0. |
| `heightFalloff?: number` | How fast the fog thins with height, 0 or more: its density falls by a factor of e, to about a third, every 1 / `heightFalloff` units up. The engine adds up the fog along each line of sight, so a view down into a valley sees thick fog and a view up sees clear air. The default is 0: the fog is the same at every height. |
| `sunGlow?: number` | How much of the main directional light the fog scatters toward the camera, 0 or more. Fog toward that light then glows in the light's color. The default is 0: no glow. |
| `sunGlowExponent?: number` | How tightly the glow gathers around the light's direction, above 0. Higher values make a smaller glow. The default is 8. |

## `InstanceBatch`

Class `InstanceBatch`.

Many copies of one mesh and material. Write rows straight into the typed arrays; a dynamic batch updates every row every frame, and a static batch updates the rows you mark dirty.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of rows: the batch's capacity. |
| `readonly positions: Float32Array` | Positions, 3 floats per row. |
| `readonly rotations: Float32Array` | Rotations as quaternions (x, y, z, w), 4 floats per row. |
| `readonly scales: Float32Array` | Scales, 3 floats per row. |
| `readonly colors: Float32Array \| undefined` | Linear RGBA colors, 4 floats per row, when the batch was created with `colors`. Each multiplies its row's base color and opacity. |
| `readonly values: Float32Array \| undefined` | The rows' own values, 4 floats per row, when the batch was created with `values`. A custom material's WGSL reads its row's as `object.values`. |
| `setActiveCount(count: number): void` | Draws only the first `count` rows. |
| `setLayers(mask: number): void` | Puts every row on the layers of a 32-bit mask, as `Object3D.setLayers` does for one object. A new mask needs no rebuild. |
| `setCastShadows(cast: boolean): void` | Makes every row cast the shadows of the lights that cast them, or stop, as `Object3D.setCastShadows` does for a mesh. The default is false. A change rebuilds the engine's tables of what it draws. |
| `setReceiveShadows(receive: boolean): void` | Makes shadows fall on every row, or stop, as `Object3D.setReceiveShadows` does for a mesh. The default is false. Unlit materials show no shadows. A change rebuilds the engine's tables of what it draws. |
| `on(type: ObjectEventType, handler: ObjectEventHandler): void` | Calls `handler` for each pointer event of `type` on a row of the batch, as `Object3D.on` does. The event's `instance` names the row. |
| `off(type: ObjectEventType, handler: ObjectEventHandler): void` | Removes a handler that `on` added for events of `type`. |
| `markDirty(start = 0, count = this.count - start): void` | Marks rows of a static batch to update and upload. |
| `destroy(): void` | Removes the batch and frees its rows. Its typed arrays are not valid after this: another batch can take their memory. |

## `InstanceOptions`

Interface `InstanceOptions`.

Options for `scene.createInstances`.

| Member | Description |
| --- | --- |
| `material: Material` | The material of every row. |
| `dynamic?: boolean` | Every row updates and uploads every frame; a static batch updates rows marked dirty only. |
| `colors?: boolean` | Adds a color per row (RGBA, linear) in `batch.colors`, white at first. It multiplies the material's base color and opacity, as a mesh's vertex colors do, and as three.js's `InstancedMesh.setColorAt` does. A material that lets light through draws its rows without it. |
| `values?: boolean` | Adds four numbers per row of the sketch's own in `batch.values`, 0 at first, such as a wind phase, an age or a tint. A custom material's `surface` and `vertexOffset` functions read the row's as `object.values`, as three.js's instanced attributes give a shader values per instance. With values, a masked material tests its alpha against its cutoff, without alpha to coverage or the alpha hash. |
| `layers?: number` | The layers every row is on, as a 32-bit mask. The default, 1, is layer 0. |
| `origin?: Vec3` | The point that every row's position is relative to. The default is (0, 0, 0). The engine keeps the origin at full precision, so rows near it keep the precision of 32-bit floats at any distance from the world's origin. Give a batch far from the origin, such as a forest on a planet, an origin among its rows. |
| `castShadows?: boolean` | True makes every row cast the shadows of the lights that cast them, as `castShadows` does for a mesh. The default is false. |
| `receiveShadows?: boolean` | True makes shadows fall on every row, as `receiveShadows` does for a mesh. The default is false. |

## `InstantiateOptions`

Interface `InstantiateOptions`, which extends `NodeOptions`.

Options for `scene.instantiate`: where the copy's group goes, and settings for all its meshes.

| Member | Description |
| --- | --- |
| `castShadows?: boolean` | True makes every mesh of the copy, and every row of its instance batches, cast the shadows of the lights that cast them. The default is false. |
| `receiveShadows?: boolean` | True makes shadows fall on every mesh of the copy, and on every row of its instance batches. The default is false. |
| `occluder?: boolean` | True makes every mesh of the copy block the view for occlusion culling, on WebGL2 and on WebGPU, like `setOccluder(true)`, and false makes none block. Left out, the meshes that the asset tool gave blockers block, and the others do not. |
| `layers?: number` | The layers of every object of the copy and of its instance batches, as a 32-bit mask. Left out, they keep the default, 1, which is layer 0. |

## `MeshOptions`

Interface `MeshOptions`, which extends `NodeOptions`.

Options for `scene.createMesh`.

| Member | Description |
| --- | --- |
| `mesh: MeshGeometry` | The shape to draw, from `ctx.geometry`. |
| `material: Material` | How the surface looks, from `ctx.materials`. |
| `castShadows?: boolean` | True makes the mesh cast the shadows of a directional light, like `setCastShadows(true)`. The default is false. |
| `receiveShadows?: boolean` | True makes shadows fall on the mesh, like `setReceiveShadows(true)`. The default is false. Unlit materials show no shadows. |
| `occluder?: boolean` | True makes the mesh block the view for occlusion culling, on WebGL2 and on WebGPU, like `setOccluder(true)`. The default is false. |

## `NodeOptions`

Interface `NodeOptions`.

Options every node takes when it is created.

| Member | Description |
| --- | --- |
| `name?: string` | A name for error messages. |
| `position?: Vec3` | The position relative to the parent. The default is (0, 0, 0). |
| `rotation?: Quat` | The rotation relative to the parent, as a quaternion (x, y, z, w). The default is none. |
| `scale?: Vec3` | The scale on each axis. The default is (1, 1, 1). |
| `parent?: Object3D \| null` | The node to attach this one to. The default, null, makes a root node. |
| `dynamic?: boolean` | True recomputes the node every frame without checks. A static node, the default for all but cameras, updates only when it changes. |
| `layers?: number` | The layers the node is on, as a 32-bit mask: bit n puts it on layer n. A camera draws the objects that share a layer with it. The default, 1, is layer 0. |

## `PrefabInstance`

Class `PrefabInstance`, which extends `Group`.

The group that holds a copy of a model, which `scene.instantiate` returns. Its children are the copies of the file's root nodes.

| Member | Description |
| --- | --- |
| `batches: readonly InstanceBatch[]` | The instance batches of the nodes with instancing of their own, as the file gives them. Their rows are placed in the world when the copy is created, and they do not move with the group. |
| `find(name: string): Object3D \| undefined` | The copy's first object with `name`, in the file's order, which is not destroyed, or undefined. It searches the copy's objects, so call it at setup. |
| `destroy(): void` | Removes the whole copy at the next frame: this group, every object that the copy created and that is not destroyed yet, and its instance batches. Objects that the sketch put under the copy later become roots, as children of any destroyed object do. |
| `setOutlined(outlined: boolean): void` | Outlines every mesh of the copy, or stops, as `Mesh.setOutlined` does for one mesh: the whole model takes one outline, as three.js's `OutlinePass` outlines a selected group. The copy's instance batches take none. |

## `Scene`

Class `Scene`.

The scene: every object, the active camera, the lights and the background.

| Member | Description |
| --- | --- |
| `find(name: string): Object3D \| undefined` | The first object created with `name` that is not destroyed, or undefined when no object has the name. It looks the name up in an index, so its cost does not grow with the scene. Call it at setup and keep the object it returns. |
| `createGroup(options: NodeOptions = {}): Group` | An empty node, for hierarchy. |
| `createMesh(options: MeshOptions): Mesh` | A drawn object. It is static unless `dynamic: true`. |
| `instantiate(prefab: Prefab, options: InstantiateOptions = {}): PrefabInstance` | Creates the objects of a model that `assets.loadGltf` loaded, under one new group that `options` places, and returns that group. All the objects are created with one batch of commands, and every copy shares the model's meshes, materials and textures. The group's `find` gives the copy's object of a node, by the node's name. A model with clips or skins gives the group an animator, which plays the clips: `copy.animator().play('Walk')`. Throws E1102 when the scene, the animation table or the batch table has no room for the copy. Then no part of the copy stays. `destroy()` on the group removes the whole copy. |
| `clone<T extends Object3D>(object: T): T` | Copies an object and every object below it, as three.js's `clone` does, with their meshes, materials, lights, cameras and settings, and returns the copy of the object. The copy has the same parent, so it starts in the same place. The copies are created with one batch of commands. An animated object's copy gets an animator of its own, with no clip playing, which moves the copies of its meshes, as three.js's `SkeletonUtils.clone` does. Instance batches are not objects, so they are not copied. Throws E1102 when the scene or the animation table has no room for the copies. Then no copy stays. |
| `createInstances(mesh: MeshGeometry, count: number, options: InstanceOptions): InstanceBatch` | Many copies of one mesh and material, with typed arrays of rows. Or many copies of a model that `assets.loadGltf` loaded, without a material: one batch for each mesh of the model, which share one set of rows, so one row places a whole copy. The model's lights are left out. Throws E1417 for a model with no meshes, or with instancing of its own. |
| `createInstances(prefab: Prefab, count: number, options?: Omit<InstanceOptions, 'material'>): InstanceBatch` | Many copies of one mesh and material, with typed arrays of rows. Or many copies of a model that `assets.loadGltf` loaded, without a material: one batch for each mesh of the model, which share one set of rows, so one row places a whole copy. The model's lights are left out. Throws E1417 for a model with no meshes, or with instancing of its own. |
| `createSprites(options: SpriteOptions): Promise<SpriteBatch>` | Many sprites in one batch: quads that face the camera, like three.js's `Sprite` with a `SpriteMaterial`. Typed arrays give each sprite its position, size, rotation, color and atlas frame, as an instance batch's arrays give its rows. Sprites blend by default, and blended sprites draw back to front with the other blended objects. The first call downloads the sprite code. Throws E1108 for an atlas side that is not a whole number from 1 to 2048, E1203 for a center that is not two finite numbers, and E1406 when the sprite code does not download. |
| `createPoints(options: PointOptions): Promise<PointBatch>` | Many points in one batch: squares that face the camera, all of one size, like three.js's `Points` with a `PointsMaterial`. Each point is a sprite: typed arrays give each point its position and color, as an instance batch's arrays give its rows. Sizes above one pixel work on every GPU path. Points are opaque by default, and blended points draw back to front with the other blended objects. The first call downloads the sprite code. Throws E1206 for points or colors that make no points, E1108 for a size that is not above 0, E1203 for a size that is not finite, and E1406 when the sprite code does not download. |
| `createLines(options: LineOptions): Promise<LineBatch>` | Lines of any width in one batch, like three.js's `Line2` and `LineSegments2` with a `LineMaterial`, and its `Line`, `LineSegments` and `LineLoop`. Each segment between two points draws as a quad with round ends that faces the camera, `width` CSS pixels wide, or world units wide with `worldUnits`. A typed array gives each point its position and color, as an instance batch's arrays give its rows. The first call downloads the line code. Throws E1206 for points or colors that make no line, E1217 for an unknown mode, E1108 for a width that is not positive or a dash or gap below 0, E1203 for a value that is not finite, and E1406 when the line code does not download. |
| `createPerspectiveCamera(options: PerspectiveCameraOptions = {}): PerspectiveCamera` | A perspective camera; `fov` is vertical, in degrees. Cameras are dynamic by default. |
| `createOrthographicCamera(options: OrthographicCameraOptions = {}): OrthographicCamera` | An orthographic camera, whose view is a box: things keep their size at every distance. Give `height`, and the width follows the canvas, or give `left`, `right`, `top` and `bottom`. Cameras are dynamic by default. |
| `setActiveCamera(camera: Camera): void` | Draws the scene from this camera. |
| `createDirectionalLight(options: DirectionalLightOptions = {}): DirectionalLight` | Light from one direction, like sunlight: `direction` is the way it travels. |
| `createPointLight(options: PointLightOptions): PointLight` | Light from a point in every direction, out to `range` meters, which it needs. |
| `createSpotLight(options: SpotLightOptions): SpotLight` | Light from a point in a cone, out to `range` meters, which it needs. |
| `createHemisphereLight(options: HemisphereLightOptions = {}): HemisphereLight` | Light from the sky above and the ground below. |
| `createAmbientLight(options: AmbientLightOptions = {}): AmbientLight` | Light on every surface, from no direction. |
| `setBackground(background: ColorInput \| BackgroundSource, options?: BackgroundOptions): void` | What the camera shows behind every object, as three.js's `scene.background`: a color, a texture, an environment from `assets.loadEnvironment` or `assets.builtinEnvironment`, a cube map from `assets.loadCubemap`, or three.js's sky with `{ sky: { sunPosition } }`. A texture fills the view and stretches to its shape. An environment or a cube map surrounds the scene, and `options` give its intensity, rotation and, for an environment, its blur, as three.js's `backgroundIntensity`, `backgroundRotation` and `backgroundBlurriness`. The color set before shows until a texture's texels are on the GPU, and again if the texture is destroyed. A color takes the place of any other background. Exposure and tone mapping change the background with the rest of the scene. Without a background, the canvas shows black, or the page behind it on a transparent canvas. Settings are values, not shader builds, and the call allocates nothing, so a sketch can move the sky's sun or turn a cube map every frame. Throws E1204 for a color it cannot read, E1203 for a number that is not finite, E1108 for a number out of its range, E1213 for an option that the background does not take, and E1101 for a texture, an environment or a cube map that was destroyed. |
| `setEnvironment(environment: Environment \| null, options?: EnvironmentOptions): void` | Lights the scene with an environment from `assets.loadEnvironment` or `assets.builtinEnvironment`, as three.js's `scene.environment` does with a texture from `PMREMGenerator`, or with none for null. Standard materials reflect it, sharply when smooth and blurred when rough, and take its diffuse light, each times its `envIntensity`. The scene draws without a file's environment until its map is on the GPU. The built-in room's map is whole in the first frame that uses it. It allocates nothing, so a sketch can turn the environment every frame. Throws E1203 for a number that is not finite, E1108 for a negative intensity, E1213 for a value that is not an environment, and E1101 for an environment that was destroyed. |
| `setFog(fog: FogOptions \| null): void` | Fog over every object, by each object's straight-line distance from the camera along a curve: exponential by default, exponential squared or linear. The fog can thin with height and glow toward the main directional light. Null removes the fog. The background takes no fog, and a material created with `fog: false` keeps its color. Throws E1108 for an unknown curve or a value out of its range, and E1203 for a value that is not finite. Converting the color allocates. |
| `raycast(origin: Vec3Like, direction: Vec3Like, options: RaycastOptions \| undefined, hit: RaycastHit): boolean` | Casts a ray from `origin` along `direction`, and writes its closest hit into `hit`. Returns true on a hit. On a miss it sets `hit.object` to null and leaves the other fields as they were. The direction needs no unit length. The ray tests the triangles of objects and instance rows on the layers of `options.layers`, as their materials draw them: front faces, or both faces for a double-sided material. Queries see the scene as the last frame's update left it, so a move, a new object or a destroy in this frame counts from the next frame, or from `onLateUpdate`. Create `hit` and `options` once and pass them each time. |
| `raycastAny(origin: Vec3Like, direction: Vec3Like, options?: RaycastOptions): boolean` | True when a ray from `origin` along `direction` hits anything on the layers of `options.layers`. It stops at the first hit it finds, so it is faster than `raycast`: use it for line-of-sight checks. |
| `raycastAll(origin: Vec3Like, direction: Vec3Like, options: RaycastOptions \| undefined, hits: RaycastHit[]): number` | Casts a ray as `raycast` does, writes every hit into `hits` nearest first, one hit for each triangle that the ray crosses, and returns how many. It fills the first entries of `hits`, adds hit objects when the array is too short, and leaves the entries after the hits as they were. |
| `raycastBatch(rays: ArrayLike<number>, options: RaycastOptions \| undefined, out: RaycastBatchHits): number` | Casts many rays at once on the job workers, and writes each one's closest hit into `out`. `rays` holds six numbers per ray: its origin, then its direction. Returns how many rays hit something. A miss writes -1 as its distance. |
| `overlapSphere(center: Vec3Like, radius: number, options: QueryOptions \| undefined, out: OverlapHit[]): number` | Finds the objects and instance rows on the layers of `options.layers` that have a triangle within `radius` meters of `center`, writes them into `out`, and returns how many. It fills `out` as `raycastAll` fills its hits, in no set order. |
| `overlapBox(min: Vec3Like, max: Vec3Like, options: QueryOptions \| undefined, out: OverlapHit[]): number` | Finds the objects and instance rows on the layers of `options.layers` that have a triangle inside the box from `min` to `max` or crossing it, as `overlapSphere` does. The box's sides lie along the world's axes. |
| `warmUp(): Promise<void>` | Builds every GPU pipeline that the scene needs as it stands, and resolves once they are all built. Hidden objects count too. After the first frame, an object whose pipeline is still building draws nothing, so create a loading stage's objects hidden, warm up, then show them. The first frame waits for its pipelines anyway. In the setup, a warm-up draws that frame once they are built, before the setup goes on. |

## `SkyBackground`

Interface `SkyBackground`.

three.js's analytic sky as a background: `scene.setBackground({ sky: { sunPosition } })`.

| Member | Description |
| --- | --- |
| `sky: SkyOptions` | The sky's settings. |

## `SkyOptions`

Interface `SkyOptions`.

The settings of three.js's sky, with the names and defaults of its `Sky` object's uniforms. A call that leaves a setting out takes its default.

| Member | Description |
| --- | --- |
| `sunPosition?: readonly [number, number, number]` | A point toward the sun, as three.js's `sunPosition`. Its direction places the sun. A point far below the horizon, hundreds of thousands of units down, also dims the sky, as in three.js. The default is the sun 2 degrees above the horizon toward -Z, as three.js's sky example sets it: `[0, 0.0349, -0.9994]`. |
| `turbidity?: number` | The haze in the air, 0 or more. The default is 2. |
| `rayleigh?: number` | The scattering by the air's molecules, which makes the sky blue, 0 or more. The default is 1. |
| `mieCoefficient?: number` | The scattering by haze, 0 or more. The default is 0.005. |
| `mieDirectionalG?: number` | How much the haze scatters toward the sun, from 0 to 1 (below 1). The default is 0.8. |
| `cloudCoverage?: number` | The share of the sky that clouds cover, from 0 to 1. 0 draws no clouds. The default is 0.4. |
| `cloudDensity?: number` | How solid the clouds are, 0 or more. The default is 0.4. |
| `cloudElevation?: number` | The height of the clouds, from 0 to 1: higher clouds look smaller. The default is 0.5. |
| `cloudScale?: number` | The size of the clouds' pattern, more than 0: larger values make smaller clouds. The default is 0.0002. |
| `cloudSpeed?: number` | How fast the clouds drift as `time` grows. The default is 0.00002. |
| `time?: number` | The time in seconds that moves the clouds, such as the sketch's `time`. The default is 0, so the clouds stand still until a sketch sets it. |
| `showSunDisc?: boolean` | Whether the sky shows the sun's disc. The default is true. |
| `secondSunPosition?: readonly [number, number, number]` | A point toward the sun of a second sky, which adds its light to this sky's at `secondSkyWeight`, with the same air and clouds. `timeOfDay` fades the moon's sky in over the sunset's sky with it. The default is straight up. |
| `secondSkyWeight?: number` | The weight of the second sky's light beside this sky's, 0 or more. Both then take the background's `intensity`. The default is 0, no second sky, which costs nothing. |

## `timeOfDay`

```ts
function timeOfDay(time: number | TimeOfDayPreset, options: TimeOfDayOptions = {}): TimeOfDay
```

Works out the settings of a time of day: an hour from 0 to 24, or a named preset. The sun rises at 6, stands highest at 12 and sets at 18. After sunset the sky dims to a deep blue, and then to a navy night sky lit from the moon's place, and the moon takes over as the main light. Each value comes from three.js's sky model, the one that the sky background draws, so the fog fades into the sky's horizon. Each call returns a new object, so call it when the time changes. Throws a `RangeError` for an hour that is not a finite number, or an unknown preset. ```ts const day = timeOfDay('goldenHour'); scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity }); scene.setEnvironment(skyLight, { intensity: day.skyIntensity }); sun.setDirection(...day.light.direction); sun.setColor(day.light.color); sun.setIntensity(day.light.intensity); scene.setFog({ color: day.fog.color, density: 0.01, sunGlow: day.fog.sunGlow }); post.set({ exposure: day.exposure }); ```

## `TimeOfDay`

Interface `TimeOfDay`.

The settings of one time of day, which `timeOfDay` works out. Apply them to the sky background, the sky's environment, the main directional light, the fog and the exposure.

| Member | Description |
| --- | --- |
| `hours: number` | The hour, from 0 up to 24. |
| `sky: { sunPosition: [number, number, number]; turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number; secondSunPosition: [number, number, number]; secondSkyWeight: number; }` | The sky's settings for `scene.setBackground({ sky })`: its sun and its air. At night the sky's sun stands at the moon's place, so the sky is lit from there and its disc is the moon. As night falls the second sky, the moon's, fades in over the sunset's sky; at other times its weight is 0. |
| `skyIntensity: number` | The factor of the sky's light for the background's and the environment's `intensity`. It dims the sky after sunset, as the sky model alone keeps a glow. |
| `light: { direction: [number, number, number]; color: [number, number, number]; intensity: number; }` | The main directional light: the sun while it is up, and the moon at night. `direction` points from the light into the scene, as `setDirection` takes it. `color` is linear. |
| `fog: { color: [number, number, number]; sunGlow: number; }` | The fog's linear color, the sky's color along the horizon, and the glow toward the main light, for `scene.setFog`. |
| `ambient: { color: [number, number, number]; intensity: number; }` | A linear ambient color and intensity of the sky's average light, for a scene that has no environment. A scene lit by the sky's environment needs no ambient light. |
| `exposure: number` | The exposure for `post.set({ exposure })`, higher as the light dims. |

## `TimeOfDayOptions`

Interface `TimeOfDayOptions`.

The options of `timeOfDay`. An option left out takes its default.

| Member | Description |
| --- | --- |
| `heading?: number` | The turn of the sun's path about +Y, in radians. At 0 the sun rises toward +X, stands toward -Z at noon and sets toward -X. The default is 0. |
| `noonElevation?: number` | How high the noon sun stands above the horizon, in radians, from above 0 to π/2. The default is π/3, 60 degrees. |

## `TimeOfDayPreset`

```ts
type TimeOfDayPreset = 'afternoon' | 'goldenHour' | 'blueHour' | 'night';
```

The named times of `timeOfDay`: `'afternoon'` (15:00), `'goldenHour'` (17:36, the sun 5 degrees up), `'blueHour'` (18:24, the sun 5 degrees down) and `'night'` (23:00, under the moon).
