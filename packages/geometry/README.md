# Geometry for null3D

`@null3d/geometry` makes shapes that the engine's own generators do not have, for a
[null3D](https://github.com/null3d-engine/null3d) scene: torus knots, polyhedra, lathes, flat
shapes, extrusions and tubes. It also has the curves and outlines that build them. Each function
returns plain arrays, and `geometry.fromArrays` makes a mesh from them. The functions keep
three.js's option names and give the numbers that three.js's geometry holds, which helps when you
port a scene.

## Install

```sh
bun add @null3d/geometry @null3d/engine
```

## Use

```ts
import { defineSketch } from '@null3d/engine';
import { torusKnot } from '@null3d/geometry';

export default defineSketch((ctx) => {
  const { scene, geometry, materials, time } = ctx;
  const camera = scene.createPerspectiveCamera({ position: [0, 1, 5], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });

  const arrays = torusKnot({ radius: 1, tube: 0.3, tubularSegments: 128, radialSegments: 12 });
  const knot = scene.createMesh({
    mesh: geometry.fromArrays(arrays),
    material: materials.standard({ color: '#4a8cff', roughness: 0.4 }),
    dynamic: true,
  });

  return {
    onUpdate() {
      knot.setRotationEuler(0, time.now, 0);
    },
  };
});
```

Each function takes named options, and an option that you leave out takes its default. The arrays
hold a position, a normal and texture coordinates for each vertex, and indices for some shapes. The
engine copies them, so you can change or drop them after the call.

## The shapes

- `torusKnot`: a tube that winds around a torus.
- `tetrahedron`, `octahedron`, `icosahedron` and `dodecahedron`: a polyhedron. Its `detail` option
  splits its faces toward a sphere.
- `polyhedron`: a polyhedron from your own corners and faces.
- `lathe`: a profile of points turned around the Y axis, such as a vase.
- `shape`: a flat shape from outlines, with holes, in the XY plane.
- `extrude`: a shape pushed along +Z or along a curve, with an optional bevel.
- `tube`: a tube along a 3D curve.

## Curves and outlines

`Shape` and `Path` draw an outline with `moveTo`, `lineTo`, `bezierCurveTo` and the other commands
of a 2D canvas. A `Shape` can hold holes. The 2D and 3D curves, such as `CatmullRomCurve3`, give
the path that `tube` and `extrude` follow. `ShapeUtils` measures and triangulates outlines. Points
are arrays of numbers, `[x, y]` or `[x, y, z]`.

```ts
import { extrude, Shape } from '@null3d/geometry';

const outline = new Shape().moveTo(0, 0).lineTo(1, 0).lineTo(0.5, 1).lineTo(0, 0);
const wedge = geometry.fromArrays(extrude({ shapes: outline, depth: 0.4, bevelEnabled: false }));
```

## Costs and limits

- The arrays hold floats, in the vertex format of the engine's own generators. Meshes of one format
  share GPU buffers, so these shapes draw beside the built-in ones with few changes of GPU state.
- A mesh from the arrays plans its levels of detail as any mesh made in code does. It plans them at
  its first draw when it holds 4,096 triangles or more, or when its copies hold 65,536 together.
- A mesh has one material, and an extrusion's caps and sides form one mesh. To give the caps a
  material of their own, make them as a second mesh with `shape`.

## Docs

The [geometry docs page](https://github.com/null3d-engine/null3d/blob/generated/docs/api/geometry.md#extra-shapes)
shows the package beside the engine's own generators. Its
[API reference](https://github.com/null3d-engine/null3d/blob/generated/docs/api/reference/geometry.md)
lists every option and its default.

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
