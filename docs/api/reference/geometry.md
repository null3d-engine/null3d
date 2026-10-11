---
id: api/reference/geometry
title: "Geometry: API reference"
status: generated
since: "0.1"
summary: "Every export of the Geometry API, from the engine's doc comments."
---

# Geometry: API reference

> [Geometry](../geometry.md) explains these exports. The engine's doc comments make this page.

## `BoxOptions`

Interface `BoxOptions`.

Options for `geometry.box`. The box is centered on its origin. Segment counts are whole numbers of at least 1.

| Member | Description |
| --- | --- |
| `width?: number` | The size along the X axis. The default is 1. |
| `height?: number` | The size along the Y axis. The default is 1. |
| `depth?: number` | The size along the Z axis. The default is 1. |
| `widthSegments?: number` | How many faces divide each side along the width. The default is 1. |
| `heightSegments?: number` | How many faces divide each side along the height. The default is 1. |
| `depthSegments?: number` | How many faces divide each side along the depth. The default is 1. |

## `CapsuleOptions`

Interface `CapsuleOptions`.

Options for `geometry.capsule`: a cylinder with a half sphere on each end. The capsule stands on the Y axis, centered on its origin, and its full height is `height` plus twice the radius. Segment counts are whole numbers.

| Member | Description |
| --- | --- |
| `radius?: number` | The radius of the capsule and of its half spheres. The default is 1. |
| `height?: number` | The height of the middle part, between the half spheres. The default is 1. |
| `capSegments?: number` | How many rows of faces go along each half sphere. The default is 4, and the least is 1. |
| `radialSegments?: number` | How many faces go around the capsule. The default is 8, and the least is 3. |
| `heightSegments?: number` | How many rows of faces go along the middle part. The default is 1, and the least is 1. |

## `CircleOptions`

Interface `CircleOptions`.

Options for `geometry.circle`: a flat disc of triangles around its center. The circle lies in the XY plane, centered on its origin, and faces +Z. Angles are in radians.

| Member | Description |
| --- | --- |
| `radius?: number` | The radius. The default is 1. |
| `segments?: number` | How many triangles make the circle: a whole number. The default is 32, and the least is 3. |
| `thetaStart?: number` | Where the circle starts, from the +X axis toward +Y. The default is 0. |
| `thetaLength?: number` | How far the circle goes. The default is `Math.PI * 2`. Less makes a slice of the circle. |

## `ConeOptions`

Interface `ConeOptions`.

Options for `geometry.cone`. The cone stands on the Y axis, centered on its origin, with its point at the top. Angles are in radians, and segment counts are whole numbers of at least 1.

| Member | Description |
| --- | --- |
| `radius?: number` | The radius of the bottom. The default is 1. |
| `height?: number` | The height. The default is 1. |
| `radialSegments?: number` | How many faces go around the cone. The default is 32. |
| `heightSegments?: number` | How many rows of faces go up the side. The default is 1. |
| `openEnded?: boolean` | Leaves out the bottom. The default is false. |
| `thetaStart?: number` | Where the side starts around the Y axis, from the +Z axis. The default is 0. |
| `thetaLength?: number` | How far the side goes around the Y axis. The default is `Math.PI * 2`, all the way. |

## `CylinderOptions`

Interface `CylinderOptions`.

Options for `geometry.cylinder`. The cylinder stands on the Y axis, centered on its origin. Angles are in radians, and segment counts are whole numbers of at least 1.

| Member | Description |
| --- | --- |
| `radiusTop?: number` | The radius of the top. The default is 1. With 0, the top is a point. |
| `radiusBottom?: number` | The radius of the bottom. The default is 1. With 0, the bottom is a point. |
| `height?: number` | The height. The default is 1. |
| `radialSegments?: number` | How many faces go around the cylinder. The default is 32. |
| `heightSegments?: number` | How many rows of faces go up the side. The default is 1. |
| `openEnded?: boolean` | Leaves out the top and the bottom, so the cylinder is a tube. The default is false. |
| `thetaStart?: number` | Where the side starts around the Y axis, from the +Z axis. The default is 0. |
| `thetaLength?: number` | How far the side goes around the Y axis. The default is `Math.PI * 2`, all the way. |

## `Geometry`

Class `Geometry`.

Mesh generators with the parameters and defaults of three.js's geometry classes, and meshes from arrays.

| Member | Description |
| --- | --- |
| `readonly memoryBytes: number` | The GPU bytes that every mesh holds: the shared vertex and index buffers, which keep room to grow, and the texture of morph target deltas. It counts what the frames made so far, so it grows once a frame draws a new mesh. Destroyed meshes give their room to later ones, so a scene that loads and destroys the same models keeps the same figure. |
| `box(options: BoxOptions = {}): MeshGeometry` | A box, like three.js's `BoxGeometry`. |
| `sphere(options: SphereOptions = {}): MeshGeometry` | A sphere, like three.js's `SphereGeometry`. |
| `plane(options: PlaneOptions = {}): MeshGeometry` | A flat rectangle, like three.js's `PlaneGeometry`. |
| `cylinder(options: CylinderOptions = {}): MeshGeometry` | A cylinder, like three.js's `CylinderGeometry`. |
| `cone(options: ConeOptions = {}): MeshGeometry` | A cone, like three.js's `ConeGeometry`: a cylinder whose top is a point. |
| `torus(options: TorusOptions = {}): MeshGeometry` | A torus, like three.js's `TorusGeometry`. |
| `capsule(options: CapsuleOptions = {}): MeshGeometry` | A capsule, like three.js's `CapsuleGeometry`. |
| `circle(options: CircleOptions = {}): MeshGeometry` | A flat circle, like three.js's `CircleGeometry`. |
| `ring(options: RingOptions = {}): MeshGeometry` | A flat ring, like three.js's `RingGeometry`. |
| `fromArrays(arrays: MeshArrays): MeshGeometry` | A mesh from arrays of vertex attributes and triangle indices, like three.js's `BufferGeometry` with `setAttribute` and `setIndex`. The mesh keeps the attributes it gets, each in the type of number it came in, and meshes whose attributes have the same types share GPU buffers. A mesh can have any number of vertices. Throws E1206 when an array's length does not fit the vertex count, when its attribute does not take its type of number, when an index names no vertex, for a value that is not a finite number, and for morph targets whose arrays do not fit the vertices or whose lists hold different numbers of targets. |

## `IntegerArray`

```ts
type IntegerArray = Int8Array | Uint8Array | Int16Array | Uint16Array;
```

The integer typed arrays that vertex attributes take: 8-bit and 16-bit, signed and unsigned.

## `MeshArrays`

Interface `MeshArrays`.

The arrays of a mesh for `geometry.fromArrays`. Each array holds its values for vertex 0, then vertex 1, and so on, as three.js's `BufferGeometry` keeps its attributes. The engine copies them. An attribute can come as 32-bit floats, or as the 8-bit and 16-bit integers that glTF's `KHR_mesh_quantization` allows for it. The mesh keeps that type on the GPU. Smaller types take less memory and upload faster. Integer positions keep their own scale, so give the object the scale that turns them into meters, as a glTF node does. Meshes share GPU buffers with the meshes whose attributes have the same types.

| Member | Description |
| --- | --- |
| `positions: VertexValues` | Three numbers per vertex: x, y and z. Like three.js's `position` attribute. Takes floats, or 8-bit or 16-bit integers, normalized or plain. |
| `normals?: VertexValues` | Three numbers per vertex: a direction of length 1 away from the surface. Like three.js's `normal` attribute. Pass normals, or set `computeNormals` instead. Takes floats, or an `Int8Array` or `Int16Array`, whose integers read as fractions from -1 to 1. |
| `uvs?: VertexValues` | Texture coordinates: two numbers per vertex, u and v. Like three.js's `uv` attribute. Takes floats, or 8-bit or 16-bit integers, normalized or plain. |
| `uvs1?: VertexValues` | A second set of texture coordinates, two numbers per vertex, such as those of a light map. Like three.js's `uv1` attribute. Takes the same types as `uvs`. |
| `colors?: VertexValues` | Linear colors, three numbers per vertex from 0 to 1, or four with alpha. Like three.js's `color` attribute. Takes floats, or a `Uint8Array` or `Uint16Array`, whose integers read as fractions from 0 to 1. |
| `tangents?: VertexValues` | Four numbers per vertex: the direction in which u grows along the surface, then 1 or -1 for the direction in which v grows. Like three.js's `tangent` attribute. Takes the same types as `normals`. |
| `joints?: VertexValues` | The joints that move each vertex of a skinned mesh: four joint indices per vertex, in a `Uint8Array`, a `Uint16Array` or a plain array. Like three.js's `skinIndex` attribute. Give `weights` with them. |
| `weights?: VertexValues` | How much each of a vertex's four joints moves it: four numbers per vertex, which add up to 1. Like three.js's `skinWeight` attribute. Takes floats, or a `Uint8Array` or `Uint16Array`, whose integers read as fractions from 0 to 1. |
| `indices?: Uint16Array \| Uint32Array \| readonly number[]` | Three vertex indices per triangle, counter-clockwise when you look at its front. 16-bit and 32-bit indices both work. Without indices, each three vertices in a row make a triangle. Like three.js's `setIndex`. |
| `computeNormals?: boolean` | Computes the normals from the triangles, as three.js's `computeVertexNormals` does: each vertex gets the average of its triangles' normals, weighted by their areas. |
| `computeTangents?: boolean` | Computes the tangents from the positions, the normals and `uvs`, as three.js's `computeTangents` does, on the job workers. |
| `morphTargets?: MorphTargets` | The mesh's morph targets: shapes that each object of the mesh blends in by its own weights. The engine keeps, for each vertex, only the targets that move it. |

## `MeshGeometry`

Class `MeshGeometry`.

A mesh the engine can draw: its id in the engine core, its bounding radius, and its morph targets.

| Member | Description |
| --- | --- |
| `readonly radius: number` | The distance from the mesh's origin to its farthest vertex, at rest. |
| `readonly morphTargets: number` | How many morph targets the mesh has. 0 for a mesh without any. |
| `readonly morphTargetNames: readonly string[]` | The morph targets' names, by target, or none when the mesh's arrays named none. Like three.js's `morphTargetDictionary`, turned around. `mesh.setMorphWeight` takes a name too. |
| `destroy(): void` | Destroys the mesh, like three.js's `geometry.dispose()`. The engine frees its GPU memory and its other data at once, and later meshes take its room. Destroy the objects and instance batches that use it first, in the same frame or before. Throws E1111 while one still uses it, and E1101 for a mesh that is destroyed already. Later calls that pass the mesh throw E1101. |

## `MorphTargets`

Interface `MorphTargets`.

A mesh's morph targets, like three.js's `morphAttributes` with `morphTargetsRelative` set, as glTF stores them. Each list holds one array per target, of three numbers per vertex, or for colors as many as the mesh's `colors` hold. They say how far the target moves the vertex's position, normal, tangent or color at weight 1. Every list has the same number of targets, from 1 to 256. A mesh's targets move its vertices by their weights, which each object sets with `setMorphWeight`, and clips animate.

| Member | Description |
| --- | --- |
| `positions?: readonly (Float32Array \| readonly number[])[]` | For each target, how far it moves each position. Like `morphAttributes.position`. |
| `normals?: readonly (Float32Array \| readonly number[])[]` | For each target, how far it turns each normal. Like `morphAttributes.normal`. |
| `tangents?: readonly (Float32Array \| readonly number[])[]` | For each target, how far it turns each tangent's direction: three numbers per vertex, as glTF gives them. three.js does not morph tangents. |
| `colors?: readonly (Float32Array \| readonly number[])[]` | For each target, how far it changes each vertex color: three or four numbers per vertex, as many as the mesh's `colors` hold, in linear color. Like `morphAttributes.color`. A morphed color is clamped to the range 0 to 1, as the glTF specification asks. Needs `colors`. |
| `names?: readonly string[]` | The targets' names, one per target, which `setMorphWeight` takes in place of numbers. |

## `PlaneOptions`

Interface `PlaneOptions`.

Options for `geometry.plane`. The plane lies in the XY plane, centered on its origin, and faces +Z. Segment counts are whole numbers of at least 1.

| Member | Description |
| --- | --- |
| `width?: number` | The size along the X axis. The default is 1. |
| `height?: number` | The size along the Y axis. The default is 1. |
| `widthSegments?: number` | How many faces divide the width. The default is 1. |
| `heightSegments?: number` | How many faces divide the height. The default is 1. |

## `RingOptions`

Interface `RingOptions`.

Options for `geometry.ring`: a flat disc with a hole. The ring lies in the XY plane, centered on its origin, and faces +Z. Angles are in radians, and segment counts are whole numbers.

| Member | Description |
| --- | --- |
| `innerRadius?: number` | The radius of the hole. The default is 0.5. |
| `outerRadius?: number` | The radius of the outer edge. The default is 1. |
| `thetaSegments?: number` | How many faces go around the ring. The default is 32, and the least is 3. |
| `phiSegments?: number` | How many faces go from the inner edge to the outer edge. The default is 1, and the least is 1. |
| `thetaStart?: number` | Where the ring starts, from the +X axis toward +Y. The default is 0. |
| `thetaLength?: number` | How far the ring goes. The default is `Math.PI * 2`, all the way. |

## `SphereOptions`

Interface `SphereOptions`.

Options for `geometry.sphere`. The sphere is centered on its origin, with its poles on the Y axis. Angles are in radians.

| Member | Description |
| --- | --- |
| `radius?: number` | The radius. The default is 1. |
| `widthSegments?: number` | How many faces go around the Y axis. The default is 32, and the least is 3. |
| `heightSegments?: number` | How many faces go from pole to pole. The default is 16, and the least is 2. |
| `phiStart?: number` | Where the sphere starts around the Y axis, from the -X axis. The default is 0. |
| `phiLength?: number` | How far the sphere goes around the Y axis. The default is `Math.PI * 2`, all the way. |
| `thetaStart?: number` | Where the sphere starts, down from the top pole. The default is 0. |
| `thetaLength?: number` | How far the sphere goes down from `thetaStart`. The default is `Math.PI`, to the bottom pole. |

## `TorusOptions`

Interface `TorusOptions`.

Options for `geometry.torus`. The torus is centered on its origin, around the Z axis. Angles are in radians, and segment counts are whole numbers of at least 1.

| Member | Description |
| --- | --- |
| `radius?: number` | The distance from the center of the torus to the center of its tube. The default is 1. |
| `tube?: number` | The radius of the tube. The default is 0.4. |
| `radialSegments?: number` | How many faces go around the tube. The default is 12. |
| `tubularSegments?: number` | How many faces go around the torus. The default is 48. |
| `arc?: number` | How far the torus goes around its center. The default is `Math.PI * 2`, all the way. |
| `thetaStart?: number` | Where the tube starts around its own center. The default is 0. |
| `thetaLength?: number` | How far the tube goes around its own center. The default is `Math.PI * 2`, all the way. |

## `VertexArray`

Interface `VertexArray`.

One attribute's numbers with a note on how its integers read, like three.js's `BufferAttribute`, whose `array` and `normalized` fields it shares. Normalized integers read as fractions: from 0 to 1 when unsigned, and from -1 to 1 when signed. Plain integers read as whole numbers.

| Member | Description |
| --- | --- |
| `array: Float32Array \| IntegerArray \| readonly number[]` | The numbers, as `MeshArrays` takes them. |
| `normalized?: boolean` | True when the integers are normalized. The default is false, as in three.js and glTF. It applies to positions and texture coordinates. The other attributes read integers one way only, so they refuse a value that says otherwise. |

## `VertexValues`

```ts
type VertexValues = Float32Array | IntegerArray | readonly number[] | VertexArray;
```

The numbers of one vertex attribute: a typed array, a plain array of numbers, or a `VertexArray` that also says whether its integers are normalized. Plain arrays hold 32-bit floats, except joints, which hold 16-bit integers.
