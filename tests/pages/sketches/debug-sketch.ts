// Debug drawing: every shape of ctx.debug over a small lit scene. The axes of a spinning box follow
// it, and the frustum of a second camera shows what that camera sees. ?x= moves the scene, its
// cameras and every shape that many meters along x; the image tests draw it at the origin and far
// out, and the frames must match. Object positions here are exact in 32-bit floats 1,000 km out,
// and the shapes keep 64-bit positions, which the engine draws relative to the camera.
import { defineSketch } from '@null3d/engine';

/** How far along x the scene sits, from the sketch module's ?x= switch. */
const X = Number(new URL(import.meta.url).searchParams.get('x') ?? '0');

/** A position in the scene, moved along x by the ?x= switch. */
const at = (x: number, y: number, z: number): [number, number, number] => [X + x, y, z];

export default defineSketch(({ scene, materials, geometry, debug, time }) => {
	if (!Number.isFinite(X)) throw new Error('?x= must be a number of meters');
	scene.setBackground('#101418');
	const camera = scene.createPerspectiveCamera({
		fov: 55,
		near: 0.1,
		far: 200,
		position: at(0, 5, 10),
		target: at(0, 0.5, 0),
	});
	scene.setActiveCamera(camera);
	const sun = scene.createDirectionalLight({
		direction: [-1, -2, -1],
		color: '#ffd28c',
		intensity: 3,
	});
	scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });

	scene.createMesh({
		mesh: geometry.box(),
		material: materials.standard({ color: '#e8554e' }),
		position: at(-3, 0.5, 0),
	});
	scene.createMesh({
		mesh: geometry.sphere({ radius: 0.75 }),
		material: materials.standard({ color: '#4a8cff' }),
		position: at(3, 0.75, 0),
	});
	const spinner = scene.createMesh({
		mesh: geometry.box({ width: 1, height: 0.5, depth: 0.75 }),
		material: materials.standard({ color: '#f2c14e' }),
		position: at(0, 1, -2),
		dynamic: true,
	});
	const lookout = scene.createPerspectiveCamera({
		fov: 30,
		near: 0.5,
		far: 4,
		position: at(4.5, 2, -3),
		target: at(1, 1, -4),
	});

	return {
		onUpdate() {
			spinner.setRotationEuler(0.3, 1.2 * time.now, 0);
			debug.grid(10, 10, { center: at(0, 0, 0) });
			debug.box(at(-3.6, -0.1, -0.6), at(-2.4, 1.1, 0.6));
			debug.sphere(at(3, 0.75, 0), 0.95, '#5bc27a');
			debug.axes(spinner, 1.25);
			debug.axes(at(-4.5, 0, 2.5));
			debug.arrow(at(-0.5, 0.05, 2), [1, 0, -1], 2, '#ff66cc');
			debug.line(at(-5, 3, -4), at(5, 3, -4), '#ffffff');
			debug.frustum(lookout);
			debug.light(sun, { position: at(-1.5, 3.25, 1.5), size: 0.75 });
		},
	};
});
