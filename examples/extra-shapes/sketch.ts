// Extra shapes from @null3d/geometry: a torus knot, four polyhedra, a lathe, an extruded star with
// a bevel, a tube along a closed curve and a flat heart. Each generator returns arrays, which
// geometry.fromArrays makes into a mesh. Each shape turns back and forth.
import { defineSketch } from '@null3d/engine';
import {
	CatmullRomCurve3,
	dodecahedron,
	extrude,
	icosahedron,
	lathe,
	octahedron,
	Shape,
	shape,
	tetrahedron,
	torusKnot,
	tube,
} from '@null3d/geometry';

/** A five-pointed star, with its points `outer` from its center and its inner corners `inner`. */
function star(outer: number, inner: number): Shape {
	const outline = new Shape();
	for (let k = 0; k < 10; k++) {
		const angle = Math.PI / 2 + (k * Math.PI) / 5;
		const radius = k % 2 === 0 ? outer : inner;
		const [x, y] = [Math.cos(angle) * radius, Math.sin(angle) * radius];
		if (k === 0) outline.moveTo(x, y);
		else outline.lineTo(x, y);
	}
	return outline;
}

/** A heart from two Bézier curves, as three.js's shapes example draws one, scaled to fit. */
function heart(): Shape {
	const s = 0.07;
	return new Shape()
		.moveTo(0, -5 * s)
		.bezierCurveTo(-1 * s, -2 * s, -9 * s, 0, -9 * s, 5 * s)
		.bezierCurveTo(-9 * s, 10 * s, -2 * s, 12 * s, 0, 8 * s)
		.bezierCurveTo(2 * s, 12 * s, 9 * s, 10 * s, 9 * s, 5 * s)
		.bezierCurveTo(9 * s, 0, 1 * s, -2 * s, 0, -5 * s);
}

export default defineSketch(({ scene, geometry, materials, time }) => {
	scene.setBackground('#15191f');
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 0.8, 8.5],
		target: [0, 0, 0],
	});
	scene.setActiveCamera(camera);
	scene.createDirectionalLight({ direction: [-1, -1.5, -2], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.5 });

	const loop = new CatmullRomCurve3(
		[
			[-0.6, -0.3, 0],
			[0, 0.6, 0.3],
			[0.6, -0.3, 0],
			[0, -0.1, -0.5],
		],
		true,
	);
	// In reading order: the knot and two polyhedra, two more polyhedra and the lathe, then the
	// extruded star, the tube and the flat heart.
	const shapes = [
		torusKnot({ radius: 0.5, tube: 0.16, tubularSegments: 128, radialSegments: 12 }),
		icosahedron({ radius: 0.75 }),
		dodecahedron({ radius: 0.75 }),
		octahedron({ radius: 0.75, detail: 1 }),
		tetrahedron({ radius: 0.85 }),
		lathe({
			points: [
				[0, -0.7],
				[0.45, -0.7],
				[0.55, -0.3],
				[0.3, 0.2],
				[0.35, 0.6],
				[0.45, 0.7],
			],
			segments: 24,
		}),
		extrude({ shapes: star(0.75, 0.32), depth: 0.25, bevelThickness: 0.08, bevelSize: 0.06 }),
		tube({ path: loop, tubularSegments: 96, radius: 0.12, radialSegments: 10, closed: true }),
		shape({ shapes: heart() }),
	];
	const colors = [
		'#e8554e',
		'#f2a93b',
		'#f2c14e',
		'#5bc27a',
		'#3fb8af',
		'#4a8cff',
		'#7c6cf2',
		'#c77dff',
		'#e86fae',
	];
	const meshes = shapes.map((arrays, i) =>
		scene.createMesh({
			mesh: geometry.fromArrays(arrays),
			material: materials.standard({ color: colors[i] }),
			position: [((i % 3) - 1) * 2.6, (1 - Math.floor(i / 3)) * 2.2, 0],
			dynamic: true,
		}),
	);

	return {
		onUpdate() {
			for (let i = 0; i < meshes.length; i++)
				meshes[i].setRotationEuler(0.35, Math.sin(time.now + i * 0.7), 0);
		},
	};
});
