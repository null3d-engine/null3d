---
id: api/reference/geometry
title: "Geometry: API reference"
status: generated
since: "0.1"
summary: "Every export of the Geometry API, from the engine's doc comments."
---

# Geometry: API reference

> [Geometry](../geometry.md) explains these exports. The engine's doc comments make this page.

## `ArcCurve`

Class `ArcCurve`, which extends `EllipseCurve`.

A 2D circle or part of one, like three.js's `ArcCurve`: an `EllipseCurve` with one radius.

## `BoxOptions`

Interface `BoxOptions`, which extends `ShapeLevels`.

Options for `geometry.box`. The box is centered on its origin. Segment counts are whole numbers of at least 1.

| Member | Description |
| --- | --- |
| `width?: number` | The size along the X axis. The default is 1. |
| `height?: number` | The size along the Y axis. The default is 1. |
| `depth?: number` | The size along the Z axis. The default is 1. |
| `widthSegments?: number` | How many faces divide each side along the width. The default is 1. |
| `heightSegments?: number` | How many faces divide each side along the height. The default is 1. |
| `depthSegments?: number` | How many faces divide each side along the depth. The default is 1. |

## `BuildLevelsOptions`

Interface `BuildLevelsOptions`.

Options for `mesh.buildLevels`, and for the levels that a mesh made in code plans on its own.

| Member | Description |
| --- | --- |
| `cards?: boolean` | True to plan a mesh whose every separate piece is a quad, or a quad folded along its middle, as leaf cards: each level keeps every second card and grows it about its middle, so a crown keeps its cover. The default is false, because separate quads also build walls and floors, which would get holes: such a mesh then simplifies as any other, and its levels drop only whole small pieces. A mesh whose positions are integers plans no card levels. |

## `CapsuleOptions`

Interface `CapsuleOptions`, which extends `ShapeLevels`.

Options for `geometry.capsule`: a cylinder with a half sphere on each end. The capsule stands on the Y axis, centered on its origin, and its full height is `height` plus twice the radius. Segment counts are whole numbers.

| Member | Description |
| --- | --- |
| `radius?: number` | The radius of the capsule and of its half spheres. The default is 1. |
| `height?: number` | The height of the middle part, between the half spheres. The default is 1. |
| `capSegments?: number` | How many rows of faces go along each half sphere. The default is 4, and the least is 1. |
| `radialSegments?: number` | How many faces go around the capsule. The default is 8, and the least is 3. |
| `heightSegments?: number` | How many rows of faces go along the middle part. The default is 1, and the least is 1. |

## `CatmullRomCurve3`

Class `CatmullRomCurve3`, which extends `Curve`.

A smooth 3D curve through a list of points, like three.js's `CatmullRomCurve3`.

| Member | Description |
| --- | --- |
| `points: Vec3Like[]` | The points the curve passes through, in order. |
| `closed: boolean` | True joins the last point back to the first. |
| `curveType: CatmullRomCurveType` | How the spline spaces itself between points. |
| `tension: number` | How tight the curve is, from 0 to 1, when `curveType` is `'catmullrom'`. |
| `getPoint(t: number, out?: [number, number, number]): [number, number, number]` | The point at `t`. |

## `CatmullRomCurveType`

```ts
type CatmullRomCurveType = 'centripetal' | 'chordal' | 'catmullrom';
```

How a `CatmullRomCurve3` spaces its spline between points. `'centripetal'` uses the fourth root of the distance, `'chordal'` the square root, and `'catmullrom'` even steps with a tension.

## `CircleOptions`

Interface `CircleOptions`, which extends `ShapeLevels`.

Options for `geometry.circle`: a flat disc of triangles around its center. The circle lies in the XY plane, centered on its origin, and faces +Z. Angles are in radians.

| Member | Description |
| --- | --- |
| `radius?: number` | The radius. The default is 1. |
| `segments?: number` | How many triangles make the circle: a whole number. The default is 32, and the least is 3. |
| `thetaStart?: number` | Where the circle starts, from the +X axis toward +Y. The default is 0. |
| `thetaLength?: number` | How far the circle goes. The default is `Math.PI * 2`. Less makes a slice of the circle. |

## `ConeOptions`

Interface `ConeOptions`, which extends `ShapeLevels`.

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

## `CubicBezierCurve`

Class `CubicBezierCurve`, which extends `Curve`.

A 2D cubic Bézier curve from `v0` to `v3`, shaped by the control points `v1` and `v2`, like three.js's `CubicBezierCurve`.

| Member | Description |
| --- | --- |
| `v0: Vec2Like` | The start point. |
| `v1: Vec2Like` | The first control point. |
| `v2: Vec2Like` | The second control point. |
| `v3: Vec2Like` | The end point. |
| `getPoint(t: number, out?: [number, number]): [number, number]` | The point at `t`. |

## `CubicBezierCurve3`

Class `CubicBezierCurve3`, which extends `Curve`.

A 3D cubic Bézier curve from `v0` to `v3`, shaped by the control points `v1` and `v2`, like three.js's `CubicBezierCurve3`.

| Member | Description |
| --- | --- |
| `v0: Vec3Like` | The start point. |
| `v1: Vec3Like` | The first control point. |
| `v2: Vec3Like` | The second control point. |
| `v3: Vec3Like` | The end point. |
| `getPoint(t: number, out?: [number, number, number]): [number, number, number]` | The point at `t`. |

## `Curve`

Class `Curve`.

The base class of all curves, like three.js's `Curve`. A subclass gives `getPoint`. The class adds sampling by arc length, tangents and, for 3D curves, Frenet frames. `Point` is the type of the curve's points. It is `[number, number]` for a 2D curve and `[number, number, number]` for a 3D curve.

| Member | Description |
| --- | --- |
| `arcLengthDivisions: number` | How many samples `getLengths` takes to measure the curve. The default is 200. |
| `needsUpdate: boolean` | True makes the next `getLengths` measure the curve again. |
| `cacheArcLengths: number[] \| null` | The lengths that `getLengths` measured last, or null before the first call. |
| `getPoint(t: number, out?: Point): Point` | The point at `t`, from 0 at the start to 1 at the end. Equal steps of `t` need not give equal steps along the curve. Writes into `out` when given, else returns a new tuple. |
| `getPointAt(u: number, out?: Point): Point` | The point at `u`, a fraction of the curve's length from 0 to 1. Equal steps of `u` give equal steps along the curve. Writes into `out` when given. |
| `getPoints(divisions = 5): Point[]` | `divisions + 1` points at equal steps of `t`. The default is 5 divisions. |
| `getSpacedPoints(divisions = 5): Point[]` | `divisions + 1` points at equal steps along the curve. The default is 5 divisions. |
| `getLength(): number` | The curve's length, measured over `arcLengthDivisions` straight steps. |
| `getLengths(divisions: number = this.arcLengthDivisions): number[]` | The length from the start to each of `divisions + 1` points at equal steps of `t`. The curve keeps the list and returns it again until `needsUpdate` is set or `divisions` changes. |
| `updateArcLengths(): void` | Measures the curve again. Call it after the curve's points change. |
| `getUtoTmapping(u: number, distance: number \| null = null): number` | The `t` that lies at the fraction `u` of the curve's length. A truthy `distance` gives the length from the start in place of `u`. |
| `getTangent(t: number, out?: Point): Point` | The unit direction of the curve at `t`, from two points a small step apart. Writes into `out` when given. |
| `getTangentAt(u: number, out?: Point): Point` | The unit direction at the fraction `u` of the curve's length. Writes into `out` when given. |
| `computeFrenetFrames(segments: number, closed = false): FrenetFrames` | The Frenet frames of a 3D curve at `segments + 1` points spaced along its length, as three.js computes them for tubes and extrusions. A closed curve gets a twist spread over its length, so the last frame matches the first. |

## `CurvePath`

Class `CurvePath`, which extends `Curve`.

A list of curves joined end to end and treated as one curve, like three.js's `CurvePath`. Its `t` runs over the whole path by length.

| Member | Description |
| --- | --- |
| `curves: Curve<Point>[]` | The curves, in order. |
| `autoClose: boolean` | True makes `getPoints` and `getSpacedPoints` repeat the first point at the end. |
| `cacheLengths: number[] \| null` | The lengths that `getCurveLengths` measured last, or null before the first call. |
| `add(curve: Curve<Point>): void` | Adds a curve to the end of the path. |
| `closePath(): this` | Adds a straight line from the path's end to its start, when they differ. |
| `getPoint(t: number, out?: Point): Point` | The point at `t` over the whole path by length. Writes into `out` when given. Throws a `RangeError` when `t` is above 1 or the path is empty, where three.js returns null. |
| `getLength(): number` | The path's length: the sum of its curves' lengths. |
| `updateArcLengths(): void` | Measures the path again. Call it after a curve's points change. |
| `getCurveLengths(): number[]` | The length from the start of the path to the end of each curve. The path keeps the list while the number of curves stays the same. |
| `getSpacedPoints(divisions = 40): Point[]` | `divisions + 1` points at equal steps along the path. The default is 40 divisions. |
| `getPoints(divisions = 12): Point[]` | Points along each curve in turn, with no point twice in a row. A line gives its two ends, an ellipse `divisions * 2` steps, a spline `divisions` steps per point and any other curve `divisions` steps. The default is 12 divisions. |

## `CylinderOptions`

Interface `CylinderOptions`, which extends `ShapeLevels`.

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

## `dodecahedron`

```ts
function dodecahedron(options: PolyhedronShapeOptions = {}): GeneratedArrays
```

The arrays of a dodecahedron, like three.js's `DodecahedronGeometry`. The mesh has no indices.

## `EllipseCurve`

Class `EllipseCurve`, which extends `Curve`.

A 2D ellipse or part of one, like three.js's `EllipseCurve`. Angles are in radians, measured from the positive x axis.

| Member | Description |
| --- | --- |
| `aX: number` | The x of the center. |
| `aY: number` | The y of the center. |
| `xRadius: number` | The radius along x. |
| `yRadius: number` | The radius along y. |
| `aStartAngle: number` | The angle at which the curve starts. |
| `aEndAngle: number` | The angle at which the curve ends. |
| `aClockwise: boolean` | True draws the curve clockwise. |
| `aRotation: number` | How far the ellipse turns about its center, counterclockwise from the x axis. |
| `getPoint(t: number, out?: [number, number]): [number, number]` | The point at `t`. |

## `extrude`

```ts
function extrude(options: ExtrudeOptions = {}): GeneratedArrays
```

The arrays of an extruded shape, like three.js's `ExtrudeGeometry`. The mesh has no indices: each three vertices in a row make a triangle. Its normals are flat, one per face. three.js puts the caps in one group and the side walls in another, so each can take its own material. Here they form one mesh, caps first. A material per group needs two meshes.

## `ExtrudeOptions`

Interface `ExtrudeOptions`.

Options for `extrude`, with the names and defaults of three.js's `ExtrudeGeometry`.

| Member | Description |
| --- | --- |
| `shapes?: Shape \| readonly Shape[]` | One shape or a list of shapes. The default is three.js's square with corners at x and y of 0.5 and -0.5. |
| `curveSegments?: number` | The number of points along each curve of a shape. The default is 12. |
| `steps?: number` | The number of steps along the depth or the path. The default is 1. |
| `depth?: number` | How far the shape moves along +Z. The default is 1. A path sets the length instead. |
| `bevelEnabled?: boolean` | True adds a bevel around each cap. The default is true. A path turns it off. |
| `bevelThickness?: number` | How far the bevel reaches out from each cap, along Z. The default is 0.2. |
| `bevelSize?: number` | How far the bevel reaches out from the outline. The default is `bevelThickness` less 0.1. |
| `bevelOffset?: number` | How far the bevel starts from the outline. The default is 0. |
| `bevelSegments?: number` | The number of layers in each bevel. The default is 3. |
| `extrudePath?: Curve<[number, number, number]>` | A 3D curve to extrude along in place of +Z. The shape's x follows the curve's normals and its y the binormals. A closed `CatmullRomCurve3` gives closed frames. |
| `UVGenerator?: UVGenerator` | Makes the texture coordinates. The default is `WorldUVGenerator`. |

## `FrenetFrames`

Interface `FrenetFrames`.

The frames along a 3D curve that `computeFrenetFrames` returns: one tangent, normal and binormal per sample, each a unit vector.

| Member | Description |
| --- | --- |
| `tangents: [number, number, number][]` | The direction of the curve at each sample. |
| `normals: [number, number, number][]` | A direction at right angles to the tangent at each sample, which turns slowly along the curve. |
| `binormals: [number, number, number][]` | The cross product of the tangent and the normal at each sample. |

## `GeneratedArrays`

Interface `GeneratedArrays`.

The arrays that a generator returns, ready for `geometry.fromArrays`. Each array holds the values of vertex 0, then vertex 1, and so on, as three.js's `BufferGeometry` keeps its attributes.

| Member | Description |
| --- | --- |
| `positions: Float32Array` | Three numbers per vertex: x, y and z. Like three.js's `position` attribute. |
| `normals: Float32Array` | Three numbers per vertex: the unit normal. Like three.js's `normal` attribute. |
| `uvs: Float32Array` | Two numbers per vertex: u and v. Like three.js's `uv` attribute. |
| `indices?: Uint16Array \| Uint32Array` | Three vertex indices per triangle. The array holds 32-bit indices when an index reaches 65535, as three.js's `setIndex` chooses, and 16-bit indices otherwise. Absent when each three vertices in a row make a triangle. |

## `Geometry`

Class `Geometry`.

Mesh generators with the parameters and defaults of three.js's geometry classes, and meshes from arrays.

| Member | Description |
| --- | --- |
| `readonly memoryBytes: number` | The GPU bytes that every mesh holds: the shared vertex and index buffers, which keep room to grow, and the texture of morph target deltas. It counts what the frames made so far, so it grows once a frame draws a new mesh. Destroyed meshes give their room to later ones, so a scene that loads and destroys the same models keeps the same figure. |
| `readonly automaticLevelTriangles: number` | The triangles from which a mesh made in code plans its levels of detail, the first time the scene draws it, unless its options say `levels: false`. A smaller mesh drawn a few times costs little at any distance, and each level adds draw work to every pipeline that draws it. |
| `readonly automaticDrawnTriangles: number` | The triangles of the copies that the scene draws, together, from which a smaller mesh of at least `automaticCopyTriangles` triangles plans its levels too, as a batch of pebbles does. |
| `readonly automaticCopyTriangles: number` | The fewest triangles of a mesh that plans its levels because of its copies. |
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

## `icosahedron`

```ts
function icosahedron(options: PolyhedronShapeOptions = {}): GeneratedArrays
```

The arrays of an icosahedron, like three.js's `IcosahedronGeometry`. The mesh has no indices.

## `IntegerArray`

```ts
type IntegerArray = Int8Array | Uint8Array | Int16Array | Uint16Array;
```

The integer typed arrays that vertex attributes take: 8-bit and 16-bit, signed and unsigned.

## `lathe`

```ts
function lathe(options: LatheOptions = {}): GeneratedArrays
```

The arrays of a lathe, like three.js's `LatheGeometry`. The mesh has indices.

## `LatheOptions`

Interface `LatheOptions`.

Options for `lathe`, with the names and defaults of three.js's `LatheGeometry`.

| Member | Description |
| --- | --- |
| `points?: readonly Vec2Like[]` | The profile: points (x, y), where x is the distance from the Y axis and must be 0 or more. The default is three.js's diamond: (0, -0.5), (0.5, 0) and (0, 0.5). |
| `segments?: number` | The number of segments around the axis, rounded down. The default is 12. |
| `phiStart?: number` | The start angle in radians. The default is 0. |
| `phiLength?: number` | The angle the lathe turns through, in radians, clamped to 0 to 2π. The default is 2π. |

## `LevelsOption`

```ts
type LevelsOption = boolean | BuildLevelsOptions | 'pieces';
```

The levels of detail that a mesh made in code plans on its own. By default it plans them the first time the scene draws it, when it holds `geometry.automaticLevelTriangles` triangles or more, or when it holds at least `geometry.automaticCopyTriangles` triangles and its copies hold `geometry.automaticDrawnTriangles` together; `false` plans none, and `true` or options plan them when the mesh is made, at any size. `'pieces'` plans no lower levels, and sorts a mesh of 32,768 triangles or more into pieces by space at its first draw, as a merged far cell or a large ground whose levels come from elsewhere gains from.

## `LineCurve`

Class `LineCurve`, which extends `Curve`.

A straight 2D line from `v1` to `v2`, like three.js's `LineCurve`.

| Member | Description |
| --- | --- |
| `v1: Vec2Like` | The start point. |
| `v2: Vec2Like` | The end point. |
| `getPoint(t: number, out?: [number, number]): [number, number]` | The point at `t` along the line. |
| `getPointAt(u: number, out?: [number, number]): [number, number]` | The point at `u`. A line's length grows evenly with `t`, so this equals `getPoint`. |
| `getTangent(_t: number, out?: [number, number]): [number, number]` | The line's unit direction, the same at every `t`. |
| `getTangentAt(u: number, out?: [number, number]): [number, number]` | The line's unit direction, the same at every `u`. |

## `LineCurve3`

Class `LineCurve3`, which extends `Curve`.

A straight 3D line from `v1` to `v2`, like three.js's `LineCurve3`.

| Member | Description |
| --- | --- |
| `v1: Vec3Like` | The start point. |
| `v2: Vec3Like` | The end point. |
| `getPoint(t: number, out?: [number, number, number]): [number, number, number]` | The point at `t` along the line. |
| `getPointAt(u: number, out?: [number, number, number]): [number, number, number]` | The point at `u`. A line's length grows evenly with `t`, so this equals `getPoint`. |
| `getTangent(_t: number, out?: [number, number, number]): [number, number, number]` | The line's unit direction, the same at every `t`. |
| `getTangentAt(u: number, out?: [number, number, number]): [number, number, number]` | The line's unit direction, the same at every `u`. |

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
| `targets?: VertexValues` | Four numbers per vertex for a shape that a custom material moves between levels of detail: the position that the vertex takes at the next coarser level, and that level's error in meters. The material's `vertexOffset` reads them as `input.vertexRecord`. Takes floats. The vertex record also holds a morphed mesh's morph data, so a mesh takes `targets` or `morphTargets`, never both. |
| `indices?: Uint16Array \| Uint32Array \| readonly number[]` | Three vertex indices per triangle, counter-clockwise when you look at its front. 16-bit and 32-bit indices both work. Without indices, each three vertices in a row make a triangle. Like three.js's `setIndex`. |
| `computeNormals?: boolean` | Computes the normals from the triangles, as three.js's `computeVertexNormals` does: each vertex gets the average of its triangles' normals, weighted by their areas. |
| `computeTangents?: boolean` | Computes the tangents from the positions, the normals and `uvs`, as three.js's `computeTangents` does, on the job workers. |
| `morphTargets?: MorphTargets` | The mesh's morph targets: shapes that each object of the mesh blends in by its own weights. The engine keeps, for each vertex, only the targets that move it. |
| `levels?: LevelsOption` | The levels of detail that the mesh plans on its own, on the job workers, as `mesh.buildLevels` plans them. By default it plans them the first time the scene draws it, when it holds `geometry.automaticLevelTriangles` triangles or more, or when it holds at least `geometry.automaticCopyTriangles` triangles and its copies hold `geometry.automaticDrawnTriangles` together. A mesh with joints, morph targets or `targets` plans none, and neither does one that lies flat or that a material with moving vertices draws. `false` plans none: give it to a mesh whose shape a shader moves, or whose levels you set by hand. `true` plans them when the mesh is made, at any size, and options such as `{ cards: true }` plan them with those options. `'pieces'` plans no levels, and sorts a mesh of 32,768 triangles or more into pieces by space at its first draw. |

## `MeshGeometry`

Class `MeshGeometry`.

A mesh the engine can draw: its id in the engine core, its bounding radius, and its morph targets.

| Member | Description |
| --- | --- |
| `readonly radius: number` | The distance from the mesh's bounding center (`center`) to its farthest vertex, at rest. |
| `readonly morphTargets: number` | How many morph targets the mesh has. 0 for a mesh without any. |
| `readonly morphTargetNames: readonly string[]` | The morph targets' names, by target, or none when the mesh's arrays named none. Like three.js's `morphTargetDictionary`, turned around. `mesh.setMorphWeight` takes a name too. |
| `readonly center: readonly [number, number, number]` | The center of the box around the mesh's vertices at rest, in the mesh's own space. The mesh's bounding sphere lies around it with `radius`, and culling tests that sphere. A mesh whose positions start at a corner, as quantized glTF files store them, has its center away from the origin. |
| `destroy(): void` | Destroys the mesh, like three.js's `geometry.dispose()`. The engine frees its GPU memory and its other data at once, and later meshes take its room. Destroy the objects and instance batches that use it first, in the same frame or before. Its lower levels go with it, since a level draws its base's vertices. Throws E1111 while one still uses it, and E1101 for a mesh that is destroyed already. Later calls that pass the mesh throw E1101. |
| `updateVertices(name: UpdatableAttribute, values: Float32Array \| IntegerArray \| readonly number[], start = 0, count?: number): void` | Writes new values into one attribute of the mesh's vertices, like setting three.js's `attribute.needsUpdate` after a change. `values` holds the attribute's values of every vertex, in the array type the mesh was made with, as `geometry.fromArrays` takes them. Only vertices `start` to `start + count - 1` change, which the next frame uploads. The defaults update every vertex. Colors take three or four values per vertex: three keep each vertex's alpha. The mesh keeps the bounding sphere it was made with, so give objects that draw vertices outside it bounds with `setBounds`. The four-number vertex record takes updates as `targets`. Joints, weights, and a mesh with joints or morph targets take no updates. A level that draws its base mesh's vertices writes them, so the base and every level of it draw the new values. The levels that `buildLevels` or the automatic default planned measured the old shape, so the first update takes them away, and the mesh plans no automatic levels again; `buildLevels` plans them for the new shape. Throws E1206 for values that do not fit the mesh, and E1101 for a destroyed mesh. Allocates nothing, so a call in every frame makes no garbage. |
| `readonly levels: readonly MeshLevel[]` | The mesh's lower levels of detail, from the most detailed down, as `setLevels` gave them. A destroyed level takes every level away, as the engine does. |
| `setLevels(levels: readonly MeshLevel[], options: MeshLevelOptions = {}): void` | Gives the mesh lower levels of detail, from the most detailed down, like three.js's `LOD.addLevel`. A mesh takes at most 15 lower levels. Every object and instance batch that draws the mesh then picks one level per frame. It draws the coarsest level whose error covers fewer pixels on the screen than the `lodThreshold` quality setting. A level may name a material of its own, so a far level shades more cheaply; a level without one draws with the level before's material. A bound that covers fewer pixels than the threshold draws nothing, so the mesh's last level holds no geometry. The shadow maps pick their own levels, by each map's texel size, so a caster's shadow shows the detail that the map can hold. An empty list takes the levels away. Morphed objects, and materials that blend or let light through, draw the base mesh. A skinned object draws a level while the level names the base mesh's own vertices. Destroying a level's mesh takes every level away. Levels set here win over the ones that `buildLevels` or the automatic default plans: a plan that runs ends, and the planned levels go. Throws E1221 for levels the mesh cannot take, and E1101 for a destroyed mesh. |
| `buildLevels(options: BuildLevelsOptions = {}): Promise<readonly MeshLevel[]>` | Plans the mesh's levels of detail on the job workers, as the asset tool's `--lod` plans a file's, and gives them to the mesh when they arrive, between two frames. Each level about halves the triangles of the level above, down to a few dozen, and stores the largest distance between its surface and the mesh's as its error, so it switches in at once where that distance covers less than the `lodThreshold` setting's pixels. The levels name the mesh's own vertices, in their own order, so they cost indices alone: the mesh keeps its vertices and triangles as they are. A mesh that the engine split into parts, past 65,535 vertices, shares them part by part, and copies only the vertices of the triangles that cross from one part to another. A large mesh spreads the work over frames. The engine reads one part of it in each frame for the plan. It makes one level in each frame when the plan is done, and gives the scene the whole set once, so the scene's draw tables rebuild once. The mesh draws its full shape until the levels arrive, and every object and instance batch that draws it then picks its level. The mesh and each level of 32,768 triangles or more also get 8 to 16 pieces, which each copy skips where they lie outside the view or face away. A smaller list that many copies draw gets a piece for each way it faces where its triangles face a few ways, as a building's walls do. A mesh that one object draws, or a smaller mesh, gets its own pieces over a sorted copy of its indices, in the frame after the last level; copies of a large mesh keep their levels' pieces alone. A mesh made in code plans its levels on its own the first time the scene draws it, when it holds `geometry.automaticLevelTriangles` triangles or more, or when it holds at least `geometry.automaticCopyTriangles` triangles and its copies hold `geometry.automaticDrawnTriangles` together. Call this to plan another mesh's, to plan again after `updateVertices`, or to await the levels of a plan that runs: a call while a plan with the same options runs returns that plan's promise. `setLevels` wins over a plan, and `updateVertices` takes the planned levels away. The promise resolves with the mesh's levels, which stay as they were when the planner finds no level worth making, and when `setLevels`, `updateVertices` or `destroy` ends the plan first. It rejects with E1221 for a mesh with joints, morph targets or a vertex record, whose shape poses or moves, and with E1406 when the planner does not download. The planner downloads with the first mesh that plans: meshoptimizer's simplifier, about 23 KB. Throws E1101 for a destroyed mesh. |

## `MeshLevel`

Interface `MeshLevel`.

A lower level of detail of a mesh: a simpler mesh that draws in the base mesh's place. Give its `error`, the `distance` at which it switches in, or the screen `coverage` under which it draws. A level with a measured error, which the asset tool writes, changes the picture by under a pixel at a small threshold and switches at once. When the governor raises the threshold above about one and a half pixels, that switch shows, and such a level then fades too. A level given by a distance, by a coverage or by a hand-set error fades over a short band, so its switch does not pop.

| Member | Description |
| --- | --- |
| `mesh: MeshGeometry` | The simpler mesh. It has the base mesh's vertex attributes, and draws with the object's material or the level's own. |
| `error?: number` | The level's error: the largest distance between its surface and the base mesh's, in the units of the base mesh's positions. An object's scale multiplies it. The asset tool stores it for each level that `--lod` makes. |
| `distance?: number` | The distance from the camera to the nearest point of the object's bounds at which the level switches in, for an object of scale 1. The switch stays there on every screen height and at every render scale. |
| `coverage?: number` | The share of the render's height that the object's bounds cover where the level switches in, from 0 to 1: it draws while they cover less. This is `MSFT_screencoverage` in a glTF file. It stays the same on every screen height. |
| `fade?: boolean` | True to hand over between two levels in a short band past each switch distance, where a dither pattern shares the pixels between them, so a switch does not pop. False to switch at once. The default is `fade` in the options. A level with a measured error changes the picture by under a pixel while the governed threshold stays small, so its band only costs then; the engine fades such a level once the governor raises the threshold above about one and a half pixels. The glTF reader switches a file's measured error at once and fades an error that comes alone, which its author set by hand. |
| `material?: Material` | The material that the level's surface draws with, where it shades more cheaply than the base mesh's. A level without one draws with the material of the level before it, and the base level draws with the object's or the batch's own material. Give a far level a material without a normal map, or with an opaque mask in place of an alpha-tested one. |

## `MeshLevelOptions`

Interface `MeshLevelOptions`.

Options for `mesh.setLevels`.

| Member | Description |
| --- | --- |
| `fade?: boolean` | True to hand over between two levels in a short band past each switch distance, where a dither pattern shares the pixels between them, so a switch does not pop. False to switch at once. The default is true. A level's own `fade` overrides it. A level with a measured error fades too once the governor raises the threshold above about one and a half pixels, where its switch shows. |
| `fov?: number` | The vertical field of view, in degrees, that checks the order of the levels when the mesh takes them. Each frame compares a level's error or coverage with the field of view of the view that draws it, so this option moves no switch. The default is 50, three.js's default for a perspective camera. |

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

## `octahedron`

```ts
function octahedron(options: PolyhedronShapeOptions = {}): GeneratedArrays
```

The arrays of an octahedron, like three.js's `OctahedronGeometry`. The mesh has no indices.

## `Path`

Class `Path`, which extends `CurvePath`.

A 2D path drawn with commands like a canvas's, such as `moveTo`, `lineTo` and `bezierCurveTo`, like three.js's `Path`. Each command adds a curve that starts at the current point.

| Member | Description |
| --- | --- |
| `currentPoint: [number, number]` | Where the next command starts. |
| `setFromPoints(points: readonly Vec2Like[]): this` | Moves to the first point, then adds straight lines through the others. |
| `moveTo(x: number, y: number): this` | Sets the current point without adding a curve. |
| `lineTo(x: number, y: number): this` | Adds a straight line to (x, y). |
| `quadraticCurveTo(aCPx: number, aCPy: number, aX: number, aY: number): this` | Adds a quadratic Bézier curve to (aX, aY) with the control point (aCPx, aCPy). |
| `bezierCurveTo(aCP1x: number, aCP1y: number, aCP2x: number, aCP2y: number, aX: number, aY: number): this` | Adds a cubic Bézier curve to (aX, aY) with two control points. |
| `splineThru(pts: readonly Vec2Like[]): this` | Adds a spline from the current point through `pts`. |
| `arc(aX: number, aY: number, aRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean): this` | Adds an arc whose center lies at (aX, aY) from the current point. |
| `absarc(aX: number, aY: number, aRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean): this` | Adds an arc whose center lies at (aX, aY). |
| `ellipse(aX: number, aY: number, xRadius: number, yRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean, aRotation?: number): this` | Adds an ellipse whose center lies at (aX, aY) from the current point. |
| `absellipse(aX: number, aY: number, xRadius: number, yRadius: number, aStartAngle: number, aEndAngle: number, aClockwise?: boolean, aRotation?: number): this` | Adds an ellipse whose center lies at (aX, aY). When the path already has curves and the ellipse starts away from the current point, a straight line joins them first. |

## `PlaneOptions`

Interface `PlaneOptions`, which extends `ShapeLevels`.

Options for `geometry.plane`. The plane lies in the XY plane, centered on its origin, and faces +Z. Segment counts are whole numbers of at least 1.

| Member | Description |
| --- | --- |
| `width?: number` | The size along the X axis. The default is 1. |
| `height?: number` | The size along the Y axis. The default is 1. |
| `widthSegments?: number` | How many faces divide the width. The default is 1. |
| `heightSegments?: number` | How many faces divide the height. The default is 1. |

## `polyhedron`

```ts
function polyhedron(options: PolyhedronOptions = {}): GeneratedArrays
```

The arrays of a polyhedron, like three.js's `PolyhedronGeometry`. The mesh has no indices: each three vertices in a row make a triangle.

## `PolyhedronOptions`

Interface `PolyhedronOptions`.

Options for `polyhedron`, with the names and defaults of three.js's `PolyhedronGeometry`.

| Member | Description |
| --- | --- |
| `vertices?: readonly number[]` | The corner positions, three numbers per corner. The default is none. |
| `indices?: readonly number[]` | The faces, three corner indices per triangle. The default is none. |
| `radius?: number` | The radius of the sphere that the vertices lie on. The default is 1. |
| `detail?: number` | How many times each face splits. With detail n, each edge splits into n + 1 parts. The default is 0. |

## `PolyhedronShapeOptions`

Interface `PolyhedronShapeOptions`.

Options for the named polyhedra, such as `icosahedron`, with three.js's names and defaults.

| Member | Description |
| --- | --- |
| `radius?: number` | The radius of the sphere that the vertices lie on. The default is 1. |
| `detail?: number` | How many times each face splits. The default is 0. Above 1, an icosahedron is close to a sphere. |

## `QuadraticBezierCurve`

Class `QuadraticBezierCurve`, which extends `Curve`.

A 2D quadratic Bézier curve from `v0` to `v2`, pulled toward the control point `v1`, like three.js's `QuadraticBezierCurve`.

| Member | Description |
| --- | --- |
| `v0: Vec2Like` | The start point. |
| `v1: Vec2Like` | The control point. |
| `v2: Vec2Like` | The end point. |
| `getPoint(t: number, out?: [number, number]): [number, number]` | The point at `t`. |

## `QuadraticBezierCurve3`

Class `QuadraticBezierCurve3`, which extends `Curve`.

A 3D quadratic Bézier curve from `v0` to `v2`, pulled toward the control point `v1`, like three.js's `QuadraticBezierCurve3`.

| Member | Description |
| --- | --- |
| `v0: Vec3Like` | The start point. |
| `v1: Vec3Like` | The control point. |
| `v2: Vec3Like` | The end point. |
| `getPoint(t: number, out?: [number, number, number]): [number, number, number]` | The point at `t`. |

## `RingOptions`

Interface `RingOptions`, which extends `ShapeLevels`.

Options for `geometry.ring`: a flat disc with a hole. The ring lies in the XY plane, centered on its origin, and faces +Z. Angles are in radians, and segment counts are whole numbers.

| Member | Description |
| --- | --- |
| `innerRadius?: number` | The radius of the hole. The default is 0.5. |
| `outerRadius?: number` | The radius of the outer edge. The default is 1. |
| `thetaSegments?: number` | How many faces go around the ring. The default is 32, and the least is 3. |
| `phiSegments?: number` | How many faces go from the inner edge to the outer edge. The default is 1, and the least is 1. |
| `thetaStart?: number` | Where the ring starts, from the +X axis toward +Y. The default is 0. |
| `thetaLength?: number` | How far the ring goes. The default is `Math.PI * 2`, all the way. |

## `shape`

```ts
function shape(options: ShapeOptions = {}): GeneratedArrays
```

The arrays of flat shapes, like three.js's `ShapeGeometry`. The mesh has indices, and all its normals point along +Z. three.js gives each shape of a list a group of its own. Here the shapes form one mesh, so a material per shape needs one `shape` call per shape.

## `Shape`

Class `Shape`, which extends `Path`.

A closed 2D outline with optional holes, like three.js's `Shape`. The `shape` and `extrude` generators fill it.

| Member | Description |
| --- | --- |
| `holes: Path[]` | The holes, each a path inside the outline. |
| `getPointsHoles(divisions?: number): [number, number][][]` | The points of each hole, as `getPoints(divisions)` gives them. |
| `extractPoints(divisions?: number): { shape: [number, number][]; holes: [number, number][][]; }` | The points of the outline and of each hole, as `getPoints(divisions)` gives them. |

## `ShapeLevels`

Interface `ShapeLevels`.

The levels of detail that a generator's mesh plans on its own, as `MeshArrays.levels` says.

| Member | Description |
| --- | --- |
| `levels?: LevelsOption` | The levels of detail that the mesh plans on its own. By default it plans them the first time the scene draws it, when it holds `geometry.automaticLevelTriangles` triangles or more, or when it holds at least `geometry.automaticCopyTriangles` triangles and its copies hold `geometry.automaticDrawnTriangles` together; `false` plans none, and `true` or options plan them when the mesh is made, at any size. |

## `ShapeOptions`

Interface `ShapeOptions`.

Options for `shape`, with the names and defaults of three.js's `ShapeGeometry`.

| Member | Description |
| --- | --- |
| `shapes?: Shape \| readonly Shape[]` | One shape or a list of shapes. The default is three.js's triangle with corners (0, 0.5), (-0.5, -0.5) and (0.5, -0.5). |
| `curveSegments?: number` | The number of points along each curve of a shape. The default is 12. |

## `ShapeUtils`

Namespace `ShapeUtils`.

Helpers for 2D outlines, like three.js's `ShapeUtils`: `ShapeUtils.area`, `ShapeUtils.isClockWise` and `ShapeUtils.triangulateShape`.

| Member | Description |
| --- | --- |
| `area(contour: readonly Vec2Like[]): number` | The signed area of a closed outline. It is negative when the points run clockwise. |
| `isClockWise(pts: readonly Vec2Like[]): boolean` | True when the points of a closed outline run clockwise. |
| `triangulateShape(contour: Vec2Like[], holes: Vec2Like[][]): [number, number, number][]` | Cuts an outline with holes into triangles. It returns three point indices per triangle. The outline's points come first, then each hole's in turn. When the last point of a list repeats its first, it removes that last point, as three.js does. So the lists it takes can shrink. |

## `SphereOptions`

Interface `SphereOptions`, which extends `ShapeLevels`.

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

## `SplineCurve`

Class `SplineCurve`, which extends `Curve`.

A smooth 2D curve through a list of points, like three.js's `SplineCurve`. It uses Catmull-Rom interpolation.

| Member | Description |
| --- | --- |
| `points: Vec2Like[]` | The points the curve passes through, in order. |
| `getPoint(t: number, out?: [number, number]): [number, number]` | The point at `t`. |

## `tetrahedron`

```ts
function tetrahedron(options: PolyhedronShapeOptions = {}): GeneratedArrays
```

The arrays of a tetrahedron, like three.js's `TetrahedronGeometry`. The mesh has no indices.

## `torusKnot`

```ts
function torusKnot(options: TorusKnotOptions = {}): GeneratedArrays
```

The arrays of a torus knot, like three.js's `TorusKnotGeometry`. The mesh has indices.

## `TorusKnotOptions`

Interface `TorusKnotOptions`.

Options for `torusKnot`, with the names and defaults of three.js's `TorusKnotGeometry`.

| Member | Description |
| --- | --- |
| `radius?: number` | The radius of the torus that the knot winds around. The default is 1. |
| `tube?: number` | The radius of the tube. The default is 0.4. |
| `tubularSegments?: number` | The number of segments along the knot, rounded down. The default is 64. |
| `radialSegments?: number` | The number of segments around the tube, rounded down. The default is 8. |
| `p?: number` | How many times the knot winds around the torus's axis of symmetry. The default is 2. |
| `q?: number` | How many times the knot winds around a circle inside the torus. The default is 3. |

## `TorusOptions`

Interface `TorusOptions`, which extends `ShapeLevels`.

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

## `tube`

```ts
function tube(options: TubeOptions = {}): GeneratedArrays
```

The arrays of a tube, like three.js's `TubeGeometry`. The mesh has indices.

## `TubeOptions`

Interface `TubeOptions`.

Options for `tube`, with the names and defaults of three.js's `TubeGeometry`.

| Member | Description |
| --- | --- |
| `path?: Curve<[number, number, number]>` | The 3D curve that the tube follows. The default is three.js's quadratic Bézier curve from (-1, -1, 0) through the control point (-1, 1, 0) to (1, 1, 0). |
| `tubularSegments?: number` | The number of segments along the curve. The default is 64. |
| `radius?: number` | The radius of the tube. The default is 1. |
| `radialSegments?: number` | The number of segments around the tube. The default is 8. |
| `closed?: boolean` | True joins the tube's end to its start, for a closed curve. The default is false. |

## `UpdatableAttribute`

```ts
type UpdatableAttribute =
	| 'positions'
	| 'normals'
	| 'uvs'
	| 'uvs1'
	| 'colors'
	| 'tangents'
	| 'targets';
```

The vertex attributes that `mesh.updateVertices` writes, by their names in `MeshArrays`.

## `UVGenerator`

Interface `UVGenerator`.

Makes the texture coordinates of an extrusion's triangles, like the `UVGenerator` option of three.js's `ExtrudeGeometry`. Each method gets the positions made so far, three numbers per vertex, and the vertex numbers of one triangle or one side quad. three.js's methods also take the geometry first. These do not, as there is no geometry object.

| Member | Description |
| --- | --- |
| `generateTopUV(vertices: readonly number[], indexA: number, indexB: number, indexC: number): readonly Vec2Like[]` | The texture coordinates of the three vertices of a cap triangle. |
| `generateSideWallUV(vertices: readonly number[], indexA: number, indexB: number, indexC: number, indexD: number): readonly Vec2Like[]` | The texture coordinates of the four corners of a side quad, in order. |

## `Vec2Like`

```ts
type Vec2Like = { [index: number]: number; };
```

A 2D vector (x, y) in an array: a tuple such as `[0, 1]`, a plain array or a typed array. Where three.js takes a `Vector2`, this package takes one of these and reads its first two elements.

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

## `WorldUVGenerator`

```ts
const WorldUVGenerator: UVGenerator
```

three.js's default texture coordinates for an extrusion. A cap vertex takes its x and y. A side wall vertex takes its x or its y, whichever changes more along the wall, and 1 minus its z.
