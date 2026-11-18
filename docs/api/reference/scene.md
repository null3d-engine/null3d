---
id: api/reference/scene
title: "Scene: API reference"
status: generated
since: "0.1"
summary: "Every export of the Scene API, from the engine's doc comments."
---

# Scene: API reference

> [Scene](../scene.md) explains these exports. The engine's doc comments make this page.

## `AtmosphereBackground`

Interface `AtmosphereBackground`.

The physical sky as a background: `scene.setBackground({ atmosphere: { sunPosition } })`.

| Member | Description |
| --- | --- |
| `atmosphere: AtmosphereOptions` | The physical sky's settings. |

## `AtmosphereOptions`

Interface `AtmosphereOptions`.

The settings of the physical sky: the earth's air, with Rayleigh and Mie scattering and ozone, lit by the sun and the moon. The same air hazes distant objects (aerial perspective). A call that leaves a setting out takes its default.

| Member | Description |
| --- | --- |
| `sunPosition?: readonly [number, number, number]` | A point toward the sun. Its direction places the sun. The default is 20 degrees above the horizon toward -Z: `[0, 0.342, -0.94]`. |
| `sunIntensity?: number` | The sun's light above the air, in the units of a directional light's intensity, 0 or more. The air dims it on its way down, more as the sun sinks. The default is 3.6, which gives a high sun's light about 3.2 at the ground. |
| `showSunDisc?: boolean` | Whether the sky shows the sun's disc. The default is true. |
| `rayleigh?: number` | The factor of the scattering by the air's molecules, which makes the sky blue, 0 or more. The default is 1, the earth's. |
| `haze?: number` | The factor of the haze in the air (Mie scattering), which whitens the sky and glows around the sun, 0 or more. The default is 1. |
| `ozone?: number` | The factor of ozone, which keeps the twilight sky blue, 0 or more. The default is 1. |
| `mieDirectionalG?: number` | How much the haze scatters toward the light, from 0 to 1 (below 1). The default is 0.8. |
| `groundAlbedo?: number` | The share of light that the ground below the horizon reflects, from 0 to 1. The default is 0.3. |
| `altitude?: number` | The height of the scene's y = 0 above the ground, in meters, 0 or more. The default is 0. |
| `metersPerUnit?: number` | The meters in one unit of the scene, more than 0. The default is 1. |
| `aerialPerspective?: number` | The factor of the haze between the camera and each object, 0 or more: 0 for none, 1 for the real air. A larger value makes a small scene look as large as a landscape. The default is 1. |
| `cloudCoverage?: number` | The share of the sky that clouds cover, from 0 to 1. 0 draws no clouds. The default is 0.4. |
| `cloudDensity?: number` | How solid the clouds are, 0 or more. The default is 0.4. |
| `cloudElevation?: number` | The height of the clouds, from 0 to 1: higher clouds look smaller. The default is 0.5. |
| `cloudScale?: number` | The size of the clouds' pattern, more than 0: larger values make smaller clouds. The default is 0.0002. |
| `cloudSpeed?: number` | How fast the clouds drift as `time` grows. The default is 0.00002. |
| `time?: number` | The time in seconds that moves the clouds, such as the sketch's `time`. The default is 0, so the clouds stand still until a sketch sets it. |
| `moonPosition?: readonly [number, number, number]` | A point toward the moon. The default is straight up. |
| `moonIntensity?: number` | The moon's light above the air, 0 or more. It lights the air as the sun does, and the sky shows its disc, lit from the sun's side. The default is 0, no moon. |
| `stars?: number` | The stars' brightness, 0 or more. They show where the sky is dark. The default is 0, no stars. |

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
type BackgroundSource = Texture | Environment | Cubemap | SkyBackground | AtmosphereBackground;
```

What `scene.setBackground` draws behind every object in place of a plain color: a texture, an environment, a cube map, three.js's sky or the physical sky.

## `bakeProbes`

```ts
function bakeProbes(scene: Scene, options: BakeProbesOptions): ProbeBake
```

Bakes a light probe grid over `options.box`, progressively (see `ProbeBake`).

## `BakeProbesOptions`

Interface `BakeProbesOptions`.

The options of `bakeProbes`: the box the probes cover, how fine they are, and where the light comes from.

| Member | Description |
| --- | --- |
| `box: { min: readonly [number, number, number]; max: readonly [number, number, number]; }` | The box the probes cover, in the world. |
| `spacing?: number \| readonly [number, number, number]` | The distance between probes along each axis, in meters, or one number for every axis. The default is 2. The grid starts at the box's least corner and takes as many probes as fit the box at that spacing, at least two along each axis. |
| `samples?: number` | The directions cast from each probe: 8 to 1024, the default 64. |
| `distance?: number` | How far a ray reaches before it counts as the sky, in meters. The default is the box's diagonal. |
| `environment?: Environment \| null` | The scene's environment: the light that a surface sends back when a ray hits it. Without one, the bake counts no bounce light. The sky itself never bakes, because the shader reads the environment's live light for it. |
| `environmentOptions?: EnvironmentOptions` | The intensity and rotation that `scene.setEnvironment` got, so the bounce light matches the scene's. The defaults are those of `scene.setEnvironment`. |
| `albedo?: (object: QueryTarget \| null, instance: number, normal: Float32Array) => readonly [number, number, number] \| undefined` | The color a ray takes when it hits a surface, for one colored bounce: the surface sends back that share of the environment's light at its normal, as a matte surface does. The bounce sees the whole sky, so the light of a hit has no occlusion of its own, and the bake counts no lamps. A ray whose hit has no color gives no bounce light, so a scene without this bakes the probes' sky visibility and validity alone. `normal` is reused from hit to hit, so copy what you keep, and return the same array each time where you can: the bake calls this for every hit. |

## `ChunkRowData`

Interface `ChunkRowData`.

One chunk's rows, in the order that a coarser level keeps: its count, and its arrays.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of rows. Every array holds this many entries. |
| `readonly positions: Float32Array` | The rows' positions, three floats each. |
| `readonly rotations: Float32Array` | The rows' rotations as unit quaternions, four floats each. |
| `readonly scales: Float32Array` | The rows' scales, three floats each. |
| `readonly colors: Float32Array` | The rows' linear RGBA colors, four floats each. |
| `readonly coverage: Float32Array` | The share of the chunk's surface that each prefix covers, at the prefix lengths that halve every two steps: index 0 is the whole chunk. The add-on measures it when it cuts the chunk. |

## `ChunkRowWriter`

Class `ChunkRowWriter`.

Packs chunked rows into an instance batch's rows. Store each chunk once with [`write`], then call [`pack`] with one chosen count for each slot. The pack writes the chosen prefix of each chunk, in slot order, and sets the batch's active count. The batch must own its rows' transforms. A batch that reads another batch's rows, such as a part of a model, or a sprite or line batch, takes no chunked rows: a pack on one writes nothing and keeps its active count. The writer keeps one plan array in the engine's memory, so a frame's pack allocates nothing once the slot count is set.

| Member | Description |
| --- | --- |
| `dropViews(): void` | Forgets the plan view, which the next pack makes again. |
| `reserve(slots: number): void` | Makes room for `slots` chunks, each with its own chosen count. Call it at setup, and again when the cloud grows more chunks. |
| `write(slot: number, rows: ChunkRowData): void` | Stores a chunk's arrays at `slot`, replacing what the slot held. Call it once when the chunk arrives, never in a frame. |
| `forget(slot: number): void` | Forgets a chunk at `slot`, so it takes no row. |
| `pack(counts: ArrayLike<number>): number` | Packs each chunk's chosen prefix into the batch's rows, in slot order, and sets the batch's active count. `counts` gives one chosen count for each slot; a slot past its end, or with a count of zero, takes no row. Returns the count that the batch draws after the pack, which is the rows it wrote, or the count it kept when it owns no transform rows. |
| `destroy(): void` | Forgets every chunk of this writer's cloud, and drops its plan view. |

## `emptyTimeOfDay`

```ts
function emptyTimeOfDay(): TimeOfDay
```

The settings of a time of day with every array empty, for a call that is given no object.

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
| `volumetric?: boolean \| FogVolumeOptions` | Lights the fog with the main directional light and the point and spot lights, through their shadows: sun rays through gaps in trees, and glowing cones under lamps and headlights. `true` takes the default options. While it draws, it replaces `sunGlow` with its own light of the sun. It needs HDR color, and the quality setting `fogSlices` above 0: on the Low preset the fog keeps its sun glow. The default is `false`. |

## `FogVolumeOptions`

Interface `FogVolumeOptions`.

Options of the volumetric fog in `scene.setFog`. The fog's `density` and `heightFalloff` say where the air holds fog, so the light falls through the same fog that dims the objects.

| Member | Description |
| --- | --- |
| `intensity?: number` | How much of the lights' light the fog scatters toward the camera, 0 or more: 1 scatters as much as the fog's density gives. Raise it for bolder rays. The default is 1. |
| `anisotropy?: number` | How much light the fog scatters forward, from -0.95 to 0.95: 0 scatters it evenly in every direction, and values toward 0.95 gather it around the lights, as haze around a low sun. The default is 0.6. |
| `distance?: number` | How far along the view the lit fog reaches, above 0. Past it, the fog still scatters the sun's light, without shadows. A shorter reach gives finer rays near the camera. The default is 100. |

## `InstanceBatch`

Class `InstanceBatch`.

Many copies of one mesh and material. Write rows straight into the typed arrays; a dynamic batch updates every row every frame, and a static batch updates the rows you mark dirty.

| Member | Description |
| --- | --- |
| `readonly count: number` | The number of rows: the batch's capacity. |
| `dropViews(): void` | Forgets the row arrays, which the next read makes again. |
| `readonly shaderId: number` | The number that a custom material's WGSL reads as `object.id` for every row of the batch. No other live batch or mesh has it. The WGSL tells the rows apart by `input.instance`. |
| `readonly positions: Float32Array` | Positions, 3 floats per row. |
| `readonly rotations: Float32Array` | Rotations as quaternions (x, y, z, w), 4 floats per row. |
| `readonly scales: Float32Array` | Scales, 3 floats per row. |
| `readonly colors: Float32Array \| undefined` | Linear RGBA colors, 4 floats per row, when the batch was created with `colors`. Each multiplies its row's base color and opacity. |
| `readonly values: Float32Array \| undefined` | The rows' own values, 4 floats per row, when the batch was created with `values`. A custom material's WGSL reads its row's as `object.values`. |
| `readonly ranges: Float32Array \| undefined` | The rows' distance ranges, two floats per row: the start distance at `2i` and the end distance at `2i + 1`, when the batch was created with `ranges`. A row draws between them, with a fade at each edge. `setDrawRange` sets every row's, and a later write to this array changes one row. Write it at setup: the engine reads it when it next rebuilds its draw tables, which `setDrawRange` and a new object or batch make. |
| `setDrawRange(start: number, end: number): void` | Sets the distances between which every row draws, as `Mesh.setDrawRange` does for one mesh: nothing nearer than `start`, which is 0 for none, and nothing past `end`, which is `Infinity` for none. The rows take a fade at each edge. A batch created with `ranges` gets the same range in its own array. Throws E1108 for a range that is not two numbers with 0 <= start < end. |
| `setFrustumCulled(culled: boolean): void` | Keeps every row of the batch whatever a camera's frustum says, or culls its rows again. An add-on whose own cull or count decides what draws marks its batch unculled. A change recomputes the rows' bounds, so make it at setup. |
| `createChunkRows(): Promise<ChunkRowWriter>` | Makes the writer that packs chunks of rows into this batch's rows, for an add-on whose rows arrive as chunks. The writer stores each chunk once when it arrives, then packs the chosen prefix of each into the rows in the core's memory, so a frame copies no rows through the sketch's heap. The batch must own its rows' transforms: a pack on a part of a model, or on a sprite or line batch, writes nothing. The code loads on first use. |
| `setActiveCount(count: number): void` | Draws only the first `count` rows. |
| `setBoundingRadius(radius: number): void` | Makes every row's bounding sphere, which culling tests, hold the sphere of `radius` meters around the row's origin, in place of the mesh's own sphere. Each sphere keeps the mesh's center (`mesh.center`), so its radius grows by that center's distance from the origin. A vertex shader that carries rows away from their origins, such as traffic along a lane, needs this: the engine culls a row moved beyond the mesh's own sphere while it is still on the screen. A later change of the mesh's radius, which a displaced material makes, replaces it. Every row is marked for update, and the call builds the engine's draw tables again, so make it at setup. Throws E1203 for a value that is not a finite number, and E1108 for 0 or below. |
| `setLayers(mask: number): void` | Puts every row on the layers of a 32-bit mask, as `Object3D.setLayers` does for one object. A new mask needs no rebuild. |
| `setCastShadows(cast: boolean): void` | Makes every row cast the shadows of the lights that cast them, or stop, as `Object3D.setCastShadows` does for a mesh. The default is false. A change rebuilds the engine's tables of what it draws. |
| `setReceiveShadows(receive: boolean): void` | Makes shadows fall on every row, or stop, as `Object3D.setReceiveShadows` does for a mesh. The default is false. Unlit materials show no shadows. A change rebuilds the engine's tables of what it draws. |
| `setOccluder(occluder: boolean): void` | Lets every row hide what lies behind it in GPU occlusion culling on WebGPU, or keeps every row from it. Rows of an opaque mesh may hide others by default, when they look large enough on the screen. Rows never block on WebGL2. A change rebuilds the engine's tables of what it draws. |
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
| `values?: boolean` | Adds four numbers per row of the sketch's own in `batch.values`, 0 at first, such as a wind phase, an age or a tint. A custom material's `surface`, `vertexOffset` and `lobe` functions read the row's as `object.values`, as three.js's instanced attributes give a shader values per instance. With values, a masked material tests its alpha against its cutoff, without alpha to coverage or the alpha hash. |
| `ranges?: boolean` | Adds a start and an end distance per row in `batch.ranges`, so each row draws in a band of its own. Leave it out for a range that every row shares, which costs no memory. |
| `layers?: number` | The layers every row is on, as a 32-bit mask. The default, 1, is layer 0. |
| `origin?: Vec3` | The point that every row's position is relative to. The default is (0, 0, 0). The engine keeps the origin at full precision, so rows near it keep the precision of 32-bit floats at any distance from the world's origin. Give a batch far from the origin, such as a forest on a planet, an origin among its rows. |
| `castShadows?: boolean` | True makes every row cast the shadows of the lights that cast them, as `castShadows` does for a mesh. The default is false. |
| `receiveShadows?: boolean` | True makes shadows fall on every row, as `receiveShadows` does for a mesh. The default is false. |
| `occluder?: boolean` | False keeps every row from hiding what lies behind it in GPU occlusion culling on WebGPU, like `setOccluder(false)`. Left out, or true, a row of an opaque mesh hides what lies behind it whenever it looks large enough. Rows never block on WebGL2. |

## `InstantiateOptions`

Interface `InstantiateOptions`, which extends `NodeOptions`.

Options for `scene.instantiate`: where the copy's group goes, and settings for all its meshes.

| Member | Description |
| --- | --- |
| `castShadows?: boolean` | True makes every mesh of the copy, and every row of its instance batches, cast the shadows of the lights that cast them. The default is false. |
| `receiveShadows?: boolean` | True makes shadows fall on every mesh of the copy, and on every row of its instance batches. The default is false. |
| `occluder?: boolean` | True makes every mesh of the copy block the view for occlusion culling, like `setOccluder(true)`, and false makes none block, on WebGL2 or WebGPU, nor any row of its instance batches on WebGPU. Left out, the meshes that the asset tool gave blockers block on WebGL2, and on WebGPU every opaque mesh and row may hide what lies behind it. |
| `layers?: number` | The layers of every object of the copy and of its instance batches, as a 32-bit mask. Left out, they keep the default, 1, which is layer 0. |

## `LightProbeGridData`

Class `LightProbeGridData`.

A baked grid: its placement, the L1 coefficients of its probes and the two masks that the shader reads beside them.

| Member | Description |
| --- | --- |
| `readonly origin: Float32Array` | The grid's corner of least x, y and z. |
| `readonly spacing: Float32Array` | The spacing between probes along each axis. |
| `readonly counts: [number, number, number]` | The probes along each axis. |
| `readonly coefficients: Float32Array` | Four RGB coefficients per probe, of the light that its surroundings bounce back. |
| `readonly validity: Float32Array` | One number per probe: 1 where the probe stands in open space and 0 where geometry encloses it. A probe with 0 gives no light, which keeps it from leaking through the wall around it. |
| `readonly skyVisibility: Float32Array` | One number per probe: the share of the sky that its rays reached, 0 to 1. |
| `toTexture(textures: Textures): Texture` | The `rgba16float` 3D texture that `scene.setLightProbeGrid` takes. |

## `LightProbeGridOptions`

Interface `LightProbeGridOptions`.

The options of `scene.setLightProbeGrid`: a grid of irradiance probes, baked by `bakeProbes` or elsewhere. `LightProbeGridData` gives the texture and the grid's three-number values, which pass in as they are.

| Member | Description |
| --- | --- |
| `texture: Texture` | The 3D texture of the probes' coefficients, from `LightProbeGridData.toTexture`. |
| `origin: ArrayLike<number>` | The grid's corner of least x, y and z, in the world: three numbers. |
| `spacing: ArrayLike<number>` | The distance between probes along each axis, in meters: three numbers. |
| `counts: ArrayLike<number>` | The probes along each axis: three whole numbers. |
| `intensity?: number` | The factor of the grid's light on every surface. The default is 1. A factor of 0 lights nothing from the grid, and the grid still takes the share of the environment's light that `environmentWeight` names. A fade to 0 then gives no environment light back. |
| `environmentWeight?: number` | The share of the environment's diffuse light that the grid takes over, 0 to 1. The default is 1. The grid then gives a surface the light that its probes baked from their surroundings, plus the live environment's light times how much sky each probe sees, so the sky follows the hour without a new bake. |

## `MeshOptions`

Interface `MeshOptions`, which extends `NodeOptions`.

Options for `scene.createMesh`.

| Member | Description |
| --- | --- |
| `mesh: MeshGeometry` | The shape to draw, from `ctx.geometry`. |
| `material: Material` | How the surface looks, from `ctx.materials`. |
| `castShadows?: boolean` | True makes the mesh cast the shadows of a directional light, like `setCastShadows(true)`. The default is false. |
| `receiveShadows?: boolean` | True makes shadows fall on the mesh, like `setReceiveShadows(true)`. The default is false. Unlit materials show no shadows. |
| `occluder?: boolean` | Whether the mesh blocks the view for occlusion culling, like `setOccluder`. True makes it a blocker on WebGL2 too. False keeps it from hiding anything on WebGPU. Left out, the mesh blocks nothing on WebGL2, and on WebGPU it hides what lies behind it whenever it looks large enough. |

## `NodeOptions`

Interface `NodeOptions`.

Options every node takes when it is created.

| Member | Description |
| --- | --- |
| `name?: string` | A name for error messages. |
| `position?: Vec3` | The position relative to the parent. The default is (0, 0, 0). |
| `rotation?: Quat` | The rotation relative to the parent, as a quaternion (x, y, z, w). The default is none. The engine scales a rotation more than one per cent off unit length, so a mistyped quaternion still only turns the object and never stretches or shears it. |
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

## `ProbeBake`

Class `ProbeBake`.

A progressive bake of a light probe grid: `step` bakes the next probes and `finish` gives the grid. Bake a few probes a frame from `onUpdate`, so a loading screen can show progress, or call `finish` once.

| Member | Description |
| --- | --- |
| `readonly grid: LightProbeGridData` | The grid, filled probe by probe. |
| `readonly total: number` | How many probes the grid holds. |
| `readonly done: number` | How many probes are baked. |
| `step(budget = 4): boolean` | Bakes up to `budget` probes. Returns true when every probe is baked. |
| `finish(): LightProbeGridData` | Bakes every remaining probe and returns the grid. |

## `ReflectionProbe`

Class `ReflectionProbe`.

A reflection probe, which `scene.createReflectionProbe` makes. It lights the surfaces inside its box with the scene around its capture point, in place of the environment.

| Member | Description |
| --- | --- |
| `set(options: ReflectionProbeOptions): void` | Sets every option of the probe, as `scene.createReflectionProbe` takes them. A new position or new layers capture the scene again. The other options need no capture. |
| `capture(): void` | Captures the scene again, in a frame soon, as after objects around the probe moved. A probe that refreshes always needs no call. |
| `destroy(): void` | Removes the probe. Surfaces in its box take the light of other probes or of the environment from the next frame on. Calling a method of the probe afterwards throws E1101. |

## `ReflectionProbeOptions`

Interface `ReflectionProbeOptions`.

The options of `scene.createReflectionProbe` and `probe.set`. Each call sets every option, and an option left out takes its default.

| Member | Description |
| --- | --- |
| `readonly box: { readonly min: Vec3; readonly max: Vec3; }` | The box that the probe lights, from its corner of least x, y and z to the opposite corner, in meters in the world. Surfaces inside it reflect what the probe captured, and reflections meet its sides, as a room's walls stand. |
| `readonly position?: Vec3` | The point that the probe captures the scene from, inside its box. The default is its center. |
| `readonly blend?: number` | How far beyond the box's sides the probe fades out, in meters, 0 or more. The probe lights its whole box, and the next probe, or the environment, lights the rest. The default is 1. 0 gives a hard edge. |
| `readonly intensity?: number` | The factor of the probe's light, 0 or more. The default is 1. |
| `readonly boxProjection?: boolean` | True makes reflections meet the box's sides, which suits rooms and streets. False reads the probe as light from far away, as an environment, which suits open ground. The default is true. |
| `readonly refresh?: 'once' \| 'always'` | `'once'` captures the scene when the probe is made or moved, and when `probe.capture()` asks. `'always'` captures it again and again, one probe a frame in turns, so moving objects show. The default is `'once'`. |
| `readonly layers?: number` | The layers of the objects that the probe's captures draw. The default is the default layer. |
| `readonly priority?: number` | Where boxes overlap, the probe with the higher priority lights the surfaces in both, and of two of the same priority, the smaller box. The default is 0. |

## `Scene`

Class `Scene`.

The scene: every object, the active camera, the lights and the background.

| Member | Description |
| --- | --- |
| `dropViews(): void` | Forgets the views of the scene's arrays and of the morph weights. |
| `find(name: string): Object3D \| undefined` | The first object created with `name` that is not destroyed, or undefined when no object has the name. It looks the name up in an index, so its cost does not grow with the scene. Call it at setup and keep the object it returns. |
| `createGroup(options: NodeOptions = {}): Group` | An empty node, for hierarchy. |
| `createMesh(options: MeshOptions): Mesh` | A drawn object. It is static unless `dynamic: true`. |
| `instantiate(prefab: Prefab, options: InstantiateOptions = {}): PrefabInstance` | Creates the objects of a model that `assets.loadGltf` loaded, under one new group that `options` places, and returns that group. All the objects are created with one batch of commands, and every copy shares the model's meshes, materials and textures. The group's `find` gives the copy's object of a node, by the node's name. A model with clips or skins gives the group an animator, which plays the clips: `copy.animator().play('Walk')`. Throws E1102 when the scene, the animation table or the batch table has no room for the copy. Then no part of the copy stays. `destroy()` on the group removes the whole copy. |
| `animateProperty(target: Light \| Camera \| Material \| Object3D, path: string, keyframes: PropertyKeyframes): PropertyAnimation` | Animates one value of a light, a camera, a material or an object from keyframes, such as a lamp that pulses or a color that changes, and returns an object that controls it. The engine writes the value in each frame, so the sketch has no update call to make. A glTF file animates the same kinds of value with its `KHR_animation_pointer` channels. `path` names the value. A light takes `'light.intensity'`, `'light.color'`, `'light.range'`, `'light.decay'`, `'light.angle'` or `'light.penumbra'`; a camera takes `'camera.fov'` (in degrees), `'camera.near'`, `'camera.far'` or `'camera.height'` (for an orthographic camera); a material takes the values that `setUniform` takes, such as `'material.opacity'` or `'material.color'`; and every object takes `'position'`, `'rotation'`, `'scale'` or `'visible'`. The prefix is optional, so `'intensity'` and `'position'` work too. Every object that uses the material changes with it, and an animation that writes every frame allocates nothing. `setTime` places the animation at a time; a frozen keyframes object is read once. Throws E1218 for a path that the target does not take, or for keyframes that do not fit the value's numbers per key. |
| `clone<T extends Object3D>(object: T): T` | Copies an object and every object below it, as three.js's `clone` does, with their meshes, materials, lights, cameras and settings, and returns the copy of the object. The copy has the same parent, so it starts in the same place. The copies are created with one batch of commands. An animated object's copy gets an animator of its own, with no clip playing, which moves the copies of its meshes, as three.js's `SkeletonUtils.clone` does. Instance batches are not objects, so they are not copied. Throws E1102 when the scene or the animation table has no room for the copies. Then no copy stays. |
| `createInstances(mesh: MeshGeometry, count: number, options: InstanceOptions): InstanceBatch` | Many copies of one mesh and material, with typed arrays of rows. Or many copies of a model that `assets.loadGltf` loaded, without a material: one batch for each mesh of the model, which share one set of rows, so one row places a whole copy. The model's lights are left out. Throws E1417 for a model with no meshes, or with instancing of its own. |
| `createInstances(prefab: Prefab, count: number, options?: Omit<InstanceOptions, 'material'>): InstanceBatch` | Many copies of one mesh and material, with typed arrays of rows. Or many copies of a model that `assets.loadGltf` loaded, without a material: one batch for each mesh of the model, which share one set of rows, so one row places a whole copy. The model's lights are left out. Throws E1417 for a model with no meshes, or with instancing of its own. |
| `createSprites(options: SpriteOptions): Promise<SpriteBatch>` | Many sprites in one batch: quads that face the camera, like three.js's `Sprite` with a `SpriteMaterial`. Typed arrays give each sprite its position, size, rotation, color and atlas frame, as an instance batch's arrays give its rows. Sprites blend by default, and blended sprites draw back to front with the other blended objects. The first call downloads the sprite code. Throws E1108 for an atlas side that is not a whole number from 1 to 2048, E1203 for a center that is not two finite numbers, and E1406 when the sprite code does not download. |
| `createPoints(options: PointOptions): Promise<PointBatch>` | Many points in one batch: squares that face the camera, all of one size, like three.js's `Points` with a `PointsMaterial`. Each point is a sprite: typed arrays give each point its position and color, as an instance batch's arrays give its rows. Sizes above one pixel work on every GPU path. Points are opaque by default, and blended points draw back to front with the other blended objects. The first call downloads the sprite code. Throws E1206 for points or colors that make no points, E1108 for a size that is not above 0, E1203 for a size that is not finite, and E1406 when the sprite code does not download. |
| `addFeatureDraw<const Wgsl extends string \| CompiledWgsl>(description: FeatureDescription, options: FeatureDrawOptions<Wgsl>): Promise<FeatureDraw<Wgsl>>` | An add-on's own kind of draw, declared by a feature description with the kind `'draw'`: its WGSL, its vertex data, its uniforms and the description's frame point, band and order. The engine draws the object on every GPU path and in every thread mode, as it draws the scene's other objects, and sorts a blended draw among the transparent pass's objects. The first call downloads the draw adapter. The description names the frame point: `'opaque'` with an opaque or masked material, `'transparent'` with a blended one, or `'resolve'` with a blended one that blends after the transparent pass's objects. With MSAA, a draw at `'resolve'` blends its surfaces back to front in a layer of one sample per pixel, which the engine then blends over the scene, so many overlapping surfaces, such as Gaussian splats, cost one blend per pixel instead of one per sample. Its surfaces show in front of every object of the transparent pass, and other views draw them in their own transparent pass. The band and order place a blended draw among the pass's objects. The adapter records in the main view alone, so a description with another view throws E1223. The description's `reads`, `writes`, `outputs` and `provides` stay with the feature registry: this draw draws no scene resource. Throws E1223 for a description that is not a draw the adapter can place, E1215, E1216 and E1217 for WGSL and values that `materials.shader` refuses, E1206 for vertex data that makes no mesh, and E1406 when the adapter does not download. |
| `addFeatureInstances<const Wgsl extends string \| CompiledWgsl>(description: FeatureDescription, options: FeatureInstancesOptions<Wgsl>): Promise<FeatureInstances<Wgsl>>` | An add-on's own kind of draw, repeated once for each row of an instance batch, declared by a feature description with the kind `'draw'`. It takes the options of `addFeatureDraw` and a number of copies; each row of `draw.batch` places one copy and brings its own color and four values. The engine culls and sorts the rows in each view as it does a batch's, so a blended draw of many copies draws back to front on both GPU paths. Throws E1223 for a description that the adapter cannot place, for a place that belongs to one object, or for a count that is not a whole number from 1 up, E1215, E1216 and E1217 for WGSL and values that `materials.shader` refuses, E1206 for vertex data that makes no mesh, and E1406 when the adapter does not download. |
| `addComputeInstances<const Wgsl extends string \| CompiledWgsl = string \| CompiledWgsl>(description: FeatureDescription, options: ComputeInstancesOptions<Wgsl>): Promise<ComputeInstances<Wgsl>>` | An add-on's own kind of draw whose instance count the GPU writes: the description places it, the options give its one shape, its shader and the most instances that it holds, and the add-on fills its per-instance data. On WebGPU the draw reads the add-on's instance buffer and the count word that its compute pass writes; the engine copies the count into the indirect draw each frame. WebGL2 has no compute, so the page sets the instances and the count on the CPU, which draws the same picture. The description names the frame point `'opaque'` and the main view alone. The draw is unculled: the add-on's own cull or count decides what draws. The first call downloads the adapter. Throws E1223 for a description that the adapter cannot place or a capacity that it cannot take, E1215, E1216 and E1217 for WGSL and values that `materials.shader` refuses, E1206 for vertex data that makes no mesh, and E1406 when the adapter does not download. A draw that arrives after the first frame on a device that draws directly fails the frame with E1506: create it in the setup, and await this call there. |
| `createVertexDraw<const Wgsl extends string \| CompiledWgsl = string \| CompiledWgsl>(options: VertexDrawOptions<Wgsl>): VertexDraw<Wgsl>` | A draw that has a custom material and a vertex count but no mesh data: its shader makes every vertex of every copy from `@builtin(vertex_index)` and `@builtin(instance_index)`, so a draw of 50,000 rain streaks uploads nothing in a frame. The draw's object gives its place, its layers and the sphere that culls it, and the material's values move its shapes. The draw blends, so it draws in the transparent pass. The options take every option of `materials.shader` but the maps: a draw's WGSL declares no texture. The draw's culling sphere holds every shape, or a shape that leaves it stops drawing. A draw that uses the camera's position, such as rain around the camera, reads it in its WGSL, and `null3d::wrap` wraps a position relative to the camera into a box. Throws E1108 for a count or a sphere that the draw cannot take, or when the scene holds the most draws already, E1215 for WGSL that the plugin did not compile as a draw shader, and E1217 for a texture or an alpha mode that a draw does not take. |
| `createParticleBuffer(options: ParticleBufferOptions): Promise<ParticleBuffer>` | A particle buffer: a scene object that draws a quad for each live particle, which the GPU moves and colors at the particle's age in closed form. The `@null3d/particles` add-on's emitters fill it; use the add-on rather than this call. The first call downloads the particle code. Throws E1108 for a capacity that is not a whole number from 1 to 4,194,304, or when the scene holds 256 particle buffers already, and E1406 when the particle code does not download. |
| `createLines(options: LineOptions): Promise<LineBatch>` | Lines of any width in one batch, like three.js's `Line2` and `LineSegments2` with a `LineMaterial`, and its `Line`, `LineSegments` and `LineLoop`. Each segment between two points draws as a quad with round ends that faces the camera, `width` CSS pixels wide, or world units wide with `worldUnits`. A typed array gives each point its position and color, as an instance batch's arrays give its rows. The first call downloads the line code. Throws E1206 for points or colors that make no line, E1217 for an unknown mode, E1108 for a width that is not positive or a dash or gap below 0, E1203 for a value that is not finite, and E1406 when the line code does not download. |
| `createPerspectiveCamera(options: PerspectiveCameraOptions = {}): PerspectiveCamera` | A perspective camera; `fov` is vertical, in degrees. Cameras are dynamic by default. |
| `createOrthographicCamera(options: OrthographicCameraOptions = {}): OrthographicCamera` | An orthographic camera, whose view is a box: things keep their size at every distance. Give `height`, and the width follows the canvas, or give `left`, `right`, `top` and `bottom`. Cameras are dynamic by default. |
| `setActiveCamera(camera: Camera): void` | Draws the scene from this camera. |
| `createView(options: SceneViewOptions): SceneView` | Draws the scene again from `camera`, into the rectangle of the canvas that `rect` gives, after the camera's view and in the same frame: a split screen or a picture in picture. The view draws the scene once more at the rectangle's pixels, with its own culling, so its cost follows the rectangle's area. It draws the sun and its shadows as the camera's view does, which costs nothing more, the background and the fog. Its objects take no ambient occlusion or screen-space reflections, which shade the camera's view; the camera's volumetric fog and outline reach the whole image, a view's rectangle included. An object whose material shows a render pass's texture does not draw in a view. The camera's view still draws the whole canvas first, so a split screen that covers the canvas draws the scene one more time than it needs for its two halves. The scene and its passes share 32 views, the camera's included. Throws E1501 when the 32 views are in use. Development builds throw E1213 for a camera or a rectangle that a view does not take, and E1203 for a number that is not finite. |
| `createDirectionalLight(options: DirectionalLightOptions = {}): DirectionalLight` | Light from one direction, like sunlight: `direction` is the way it travels. |
| `createPointLight(options: PointLightOptions): PointLight` | Light from a point in every direction, out to `range` meters, which it needs. |
| `createSpotLight(options: SpotLightOptions): SpotLight` | Light from a point in a cone, out to `range` meters, which it needs. |
| `createRectAreaLight(options: RectAreaLightOptions): RectAreaLight` | Light from a rectangle, `width` by `height` meters, out to `range` meters, which it needs. Its light leaves along `direction`. |
| `createTubeLight(options: TubeLightOptions): TubeLight` | Light from a tube, `length` meters along `direction`, out to `range` meters, which it needs. |
| `createHemisphereLight(options: HemisphereLightOptions = {}): HemisphereLight` | Light from the sky above and the ground below. |
| `createAmbientLight(options: AmbientLightOptions = {}): AmbientLight` | Light on every surface, from no direction. |
| `setBackground(background: ColorInput \| BackgroundSource, options?: BackgroundOptions): void` | What the camera shows behind every object, as three.js's `scene.background`: a color, a texture, an environment from `assets.loadEnvironment` or `assets.builtinEnvironment`, a cube map from `assets.loadCubemap`, three.js's sky with `{ sky: { sunPosition } }`, or the physical sky with `{ atmosphere: { sunPosition } }`, whose air also hazes distant objects. A texture fills the view and stretches to its shape. An environment or a cube map surrounds the scene, and `options` give its intensity, rotation and, for an environment, its blur, as three.js's `backgroundIntensity`, `backgroundRotation` and `backgroundBlurriness`. The color set before shows until a texture's texels are on the GPU, and again if the texture is destroyed. A color takes the place of any other background. Exposure and tone mapping change the background with the rest of the scene. Without a background, the canvas shows black, or the page behind it on a transparent canvas. Settings are values, not shader builds, and the call allocates nothing, so a sketch can move the sky's sun or turn a cube map every frame. Throws E1204 for a color it cannot read, E1203 for a number that is not finite, E1108 for a number out of its range, E1213 for an option that the background does not take, and E1101 for a texture, an environment or a cube map that was destroyed. |
| `setSkyLayer(description: FeatureDescription, options: SkyLayerOptions): SkyLayer` | Draws an add-on's sky layer over the background, under every object: the top of a sky, such as an aurora, a second layer of clouds or a space backdrop. The description is a feature description ([Add-on feature descriptions](../features.md)): it names the feature and records at the background point, as a draw, provides the sky, and draws in the main view, the scene passes and the reflections. The layer's WGSL, compiled by the null3D Vite plugin, declares `fn skyLayer(input: SkyLayerInput) -> SkyLayer`. The engine gives it the fragment's direction in the world, the core sky's cloud coverage, density, elevation and scale, the sketch time and the share of the sun that the layer hides, and it blends what the layer returns over the sky by the layer's coverage and opacity. A layer that hides part of the sun also dims the disc and glow that the core sky draws, through `sun`. The layer draws in the main view, in scene passes and in reflections, and draws nothing where the background draws nothing, as in a debug view. A second call replaces the layer. Throws E1223 for a description that the engine cannot place, E1215 for WGSL that the plugin did not compile as a sky layer, E1203 for a number that is not finite, and E1108 for a number out of its range. |
| `clearSkyLayer(): void` | Removes the sky layer that `setSkyLayer` installed, from the next frame on, and gives the core sky its full sun back. A call with no layer installed does nothing. |
| `setDecalLayers(mask: number): void` | Sets the layers whose objects decals mark, as a 32-bit mask as `setLayers` takes. An object that is also on a layer outside the mask shows no decals, so a character on a layer of its own walks through a puddle clean. Such objects draw a second time after the decals, over their own pixels, in each frame that has decals. The default is every layer. |
| `overrideMaterial: Material \| null` | Draws every mesh and instance batch of the main pass with this material in place of its own, as three.js's `scene.overrideMaterial` does, or with their own materials with null. Each object keeps its mesh, its place and its instances, so a batch draws every row with it, and every camera view draws with it, the scene passes among them. Sprites, points, lines and particle systems keep their own materials, and the shadow maps keep each object's material, as three.js's shadow maps do. A change rebuilds the engine's draw tables in the next frame; after that it adds no draw call and builds no pipeline. Throws E1224 for a sprite, point or line material, E1101 for a material that is destroyed, and E1103 for a material of another engine. |
| `setEnvironment(environment: Environment \| null, options?: EnvironmentOptions): void` | Lights the scene with an environment from `assets.loadEnvironment` or `assets.builtinEnvironment`, as three.js's `scene.environment` does with a texture from `PMREMGenerator`, or with none for null. Standard materials reflect it, sharply when smooth and blurred when rough, and take its diffuse light, each times its `envIntensity`. The scene draws without a file's environment until its map is on the GPU. The built-in room's map is whole in the first frame that uses it. It allocates nothing, so a sketch can turn the environment every frame. Throws E1203 for a number that is not finite, E1108 for a negative intensity, E1213 for a value that is not an environment, and E1101 for an environment that was destroyed. |
| `createReflectionProbe(options: ReflectionProbeOptions): ReflectionProbe` | Makes a reflection probe: the scene around a point, which the engine captures on the GPU and filters for each roughness, as an environment's map. It lights the surfaces inside its box in place of the environment, with reflections that meet the box's sides, as a room's walls or a street's houses stand. A probe captures in a frame soon after it is made, and frames before that draw with the environment. A scene has at most 16 probes. Their captures take 6 of the 32 views that the scene and its passes share. Throws E1430 past those limits, E1203 for a number that is not finite, E1108 for a negative blend or intensity or a box whose min does not lie below its max, and E1213 for an option that probes do not take. |
| `setLightProbeGrid(grid: LightProbeGridOptions \| null): void` | Lights the scene with a grid of irradiance probes, or with none for null. The grid's light takes the place of the environment's diffuse light where `environmentWeight` says so, so light that changes with a surface's place, bounced from colored walls or sky, reaches it. The probes' coefficients come from a 3D texture that `LightProbeGridData.toTexture` packs and uploads, from `bakeProbes` or from a grid baked elsewhere. Throws the errors that `scene.setEnvironment` throws for a value out of range, E1213 for something that is not a texture, and E1101 for a texture that was destroyed. |
| `setFog(fog: FogOptions \| null): void` | Fog over every object, by each object's straight-line distance from the camera along a curve: exponential by default, exponential squared or linear. The fog can thin with height and glow toward the main directional light. With `volumetric`, the sun and the point and spot lights light the fog through their shadows. Null removes the fog. The background takes no fog, and a material created with `fog: false` keeps its color. Throws E1108 for an unknown curve or a value out of its range, and E1203 for a value that is not finite. The call allocates nothing, so a sketch can change the fog in every frame. |
| `pick(x: number, y: number): Promise<PickHit \| null>` | Finds the object that the camera draws at a point of the canvas, or `null` where it draws nothing there. `x` and `y` are CSS pixels from the canvas's top-left corner, as `camera.screenToRay` takes them, and the point is tested at the pixel that the camera draws, not at a projected triangle: a cut-out material's holes and a surface thinner than a pixel answer as the image shows them. A hit carries `uv`, where on the surface the pixel landed in the mesh's first texture coordinates, blended across its triangle's three corners as a raycast's `uv` is, and `hasUv`, which says whether to read it. A ray from the camera of the frame that recorded the pick finds them from the same point, so the two ways of asking agree. A skinned or morphed character, and a custom material that offsets its vertices, draws a different shape than the mesh that the ray tests, so its coordinates can differ from the pose it drew. The answer arrives one or more frames later, through a promise, and a pick in every frame waits in a queue of its own. The frame that records the pick draws it, so the camera of that frame answers, and a camera that moves between the click and the frame can differ from the frame that the click saw. A scene with a source that the id target cannot hold, such as a custom material without a vertex offset, a blended surface or a sprite, answers with a raycast instead, which tests triangles and so ignores alpha masks. |
| `raycast(origin: Vec3Like, direction: Vec3Like, options: RaycastOptions \| undefined, hit: RaycastHit): boolean` | Casts a ray from `origin` along `direction`, and writes its closest hit into `hit`. Returns true on a hit. On a miss it sets `hit.object` to null and leaves the other fields as they were. The direction needs no unit length. The ray tests the triangles of objects and instance rows on the layers of `options.layers`, as their materials draw them: front faces, or both faces for a double-sided material. Queries see the scene as the last frame's update left it, so a move, a new object or a destroy in this frame counts from the next frame, or from `onLateUpdate`. A query before the first frame, as a bake in a sketch's setup, first applies the changes queued so far and updates them, so it sees what the setup has built. Create `hit` and `options` once and pass them each time. |
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

## `SkyLayer`

Interface `SkyLayer`.

A sky layer that `scene.setSkyLayer` installed over the background. `set` changes its values, and `scene.clearSkyLayer` removes it.

| Member | Description |
| --- | --- |
| `set(values: SkyLayerValues): void` | Changes the layer's opacity, the share of the sun that it hides, or both. |

## `SkyLayerOptions`

Interface `SkyLayerOptions`, which extends `SkyLayerValues`.

Options of `scene.setSkyLayer`: the layer's WGSL, compiled by the null3D Vite plugin, and its first values.

| Member | Description |
| --- | --- |
| `readonly wgsl: CompiledWgsl` | The layer's WGSL, which declares `fn skyLayer(input: SkyLayerInput) -> SkyLayer`. It draws over the background, under every object, on every GPU path. `SkyLayerInput` gives the fragment's direction, the core sky's cloud settings, the sketch time and the share of the sun that the layer hides. |

## `SkyLayerValues`

Interface `SkyLayerValues`.

The values of a sky layer that `scene.setSkyLayer` takes, and that a later call changes: its opacity, the share of the sun that it hides, and how often the sky's environment map captures it. A value that a later call leaves out keeps its own.

| Member | Description |
| --- | --- |
| `readonly opacity?: number` | How much of the layer's color draws, from 0 for none to 1 for all of it. The default is 1. |
| `readonly sun?: number` | How much of the sun the layer hides, from 0 for none to 1 for all of it. The core sky dims its disc and glow by the rest, and the layer reads the share to dim its own. The default is 0. |
| `readonly refresh?: number` | How often, in seconds, the sky's environment map captures a layer that its own clock moves: a second by default. The map lights reflections and the diffuse light of the sky from what it holds, so a layer that drifts needs the map to follow it. Give 0 for a layer that stands still: its map then fills only when the sky or the layer's values change. A shorter time follows a faster layer at a higher cost, one fill of the map spread over a few frames. |

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
function timeOfDay(time: number | TimeOfDayPreset, options: TimeOfDayOptions = {}, out: TimeOfDay = emptyTimeOfDay()): TimeOfDay
```

Works out the settings of a time of day: an hour from 0 to 24, or a named preset. The sun rises at 6, stands highest at 12 and sets at 18. After sunset the sky dims to a deep blue, and then to a navy night sky lit from the moon's place, and the moon takes over as the main light. Each value comes from three.js's sky model, the one that the sky background draws, so the fog fades into the sky's horizon. Throws a `RangeError` for an hour that is not a finite number, or an unknown preset. Give it `out`, an object of a previous call, and it writes the new settings into that object: a day cycle then allocates nothing, so a sketch can move the time in every frame. `bun run bench:allocation --time-of-day` checks that. Without it the call makes a new object. `emptyTimeOfDay()` makes the first one to pass. ```ts const day = emptyTimeOfDay(); timeOfDay('goldenHour', {}, day); scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity }); scene.setEnvironment(skyLight, { intensity: day.skyIntensity }); sun.setDirection(...day.light.direction); sun.setColor(day.light.color); sun.setIntensity(day.light.intensity); scene.setFog({ color: day.fog.color, density: 0.01, sunGlow: day.fog.sunGlow }); post.set({ exposure: day.exposure }); ```

## `TimeOfDay`

Interface `TimeOfDay`.

The settings of one time of day, which `timeOfDay` works out. Apply them to the sky background, the sky's environment, the main directional light, the fog and the exposure.

| Member | Description |
| --- | --- |
| `hours: number` | The hour, from 0 up to 24. |
| `sky: { sunPosition: [number, number, number]; turbidity: number; rayleigh: number; mieCoefficient: number; mieDirectionalG: number; secondSunPosition: [number, number, number]; secondSkyWeight: number; }` | The sky's settings for `scene.setBackground({ sky })`: its sun and its air. At night the sky's sun stands at the moon's place, so the sky is lit from there and its disc is the moon. As night falls the second sky, the moon's, fades in over the sunset's sky; at other times its weight is 0. |
| `atmosphere: TimeOfDayAtmosphere` | The physical sky's settings for `scene.setBackground({ atmosphere })`: the real sun and its light, and at night the moon, which lights the air too, and the stars. Spread it into the scene's own settings, such as its clouds and `aerialPerspective`. |
| `skyIntensity: number` | The factor of the sky's light for the background's and the environment's `intensity`. It dims the analytic sky after sunset, as its model alone keeps a glow. The physical sky dims by itself, so with the physical model it is 1. |
| `light: { direction: [number, number, number]; color: [number, number, number]; intensity: number; }` | The main directional light: the sun while it is up, and the moon at night. `direction` points from the light into the scene, as `setDirection` takes it. `color` is linear. |
| `fog: { color: [number, number, number]; sunGlow: number; }` | The fog's linear color, the sky's color along the horizon, and the glow toward the main light, for `scene.setFog`. |
| `ambient: { color: [number, number, number]; intensity: number; }` | A linear ambient color and intensity of the sky's average light, for a scene that has no environment. A scene lit by the sky's environment needs no ambient light. |
| `exposure: number` | The exposure for `post.set({ exposure })`, higher as the light dims. |

## `TimeOfDayAtmosphere`

Interface `TimeOfDayAtmosphere`.

The physical sky's settings that a time of day gives, in the form that `timeOfDay` writes them: a call fills the arrays in place, so they are not read-only.

| Member | Description |
| --- | --- |
| `sunPosition: [number, number, number]` | The sun's place, in a unit direction, as `scene.setBackground({ atmosphere })` takes it. |
| `sunIntensity: number` | The sun's own light, in the units of the physical sky. |
| `moonPosition: [number, number, number]` | The moon's place, opposite the sun and never below the height that lights the sky. |
| `moonIntensity: number` | The moon's light on the air, 0 while the sun is up. |
| `stars: number` | The stars' brightness, rising from 0 as night falls. |

## `TimeOfDayOptions`

Interface `TimeOfDayOptions`.

The options of `timeOfDay`. An option left out takes its default.

| Member | Description |
| --- | --- |
| `heading?: number` | The turn of the sun's path about +Y, in radians. At 0 the sun rises toward +X, stands toward -Z at noon and sets toward -X. The default is 0. |
| `noonElevation?: number` | How high the noon sun stands above the horizon, in radians, from above 0 to π/2. The default is π/3, 60 degrees. |
| `model?: 'analytic' \| 'physical'` | The sky that the light, the fog, the ambient light and the exposure match: `'analytic'`, three.js's sky of `scene.setBackground({ sky })`, or `'physical'`, the physical sky of `scene.setBackground({ atmosphere })`. The default is `'analytic'`. |

## `TimeOfDayPreset`

```ts
type TimeOfDayPreset = 'afternoon' | 'goldenHour' | 'blueHour' | 'night';
```

The named times of `timeOfDay`: `'afternoon'` (15:00), `'goldenHour'` (17:36, the sun 5 degrees up), `'blueHour'` (18:24, the sun 5 degrees down) and `'night'` (23:00, under the moon).
