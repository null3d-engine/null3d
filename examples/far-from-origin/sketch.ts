// Far from the origin: a tray of 2 cm keys and a spinning wheel, 1,000 km from the origin, seen from
// 40 cm by a camera that circles them. A 32-bit float steps by 6 cm at that distance, so world
// positions in 32-bit floats would pile the keys onto each other and shake the view. The engine
// keeps each object relative to its grid cell instead, and draws every position relative to the
// camera. The keys stay 1 cm apart and the view stays steady.
import { defineSketch, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The scene's place: the center of the grid cell 977 cells of 1,024 m along x. */
const SITE: [number, number, number] = [977 * 1024, 0, 0];
/** Keys along each side of the tray. */
const KEYS = 8;
/** The distance between the centers of neighboring keys: 2 cm keys with 1 cm gaps. */
const PITCH = 0.03;
/** Spokes on the wheel. */
const SPOKES = 12;
/** The camera's distance from the tray's middle, its height, and its downward tilt in radians. */
const CIRCLE = 0.4;
const HEIGHT = 0.22;
const TILT = 0.5;
/** Where the camera's view meets the tray, along the line from the middle to the camera. */
const REACH = CIRCLE - HEIGHT / Math.tan(TILT);

export default defineSketch((ctx) => {
	const { scene, geometry, materials, time } = ctx;
	scene.setBackground('#0b0f14');
	scene.createDirectionalLight({ direction: [-1, -1.5, -0.7], intensity: 3 });
	scene.createAmbientLight({ intensity: 0.4 });

	// Children take the cell of their root object, and keep their places under it to a fraction
	// of a millimeter.
	const site = scene.createGroup({ position: SITE });
	// Orbit controls need a camera whose parents do not turn, so the script circles the camera itself.
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		near: 0.005,
		far: 50,
		parent: site,
		position: [0, HEIGHT, CIRCLE],
	});
	scene.setActiveCamera(camera);
	const look = vec3.create();
	const view = interact(ctx, camera, { target: look, minDistance: 0.05, maxDistance: 3 });

	scene.createMesh({
		mesh: geometry.box({ width: 0.3, height: 0.01, depth: 0.3 }),
		material: materials.standard({ color: '#34495e' }),
		parent: site,
		position: [0, -0.005, 0],
	});
	const key = geometry.box({ width: 0.02, height: 0.01, depth: 0.02 });
	const keyColors = [
		materials.standard({ color: '#c8ccd4' }),
		materials.standard({ color: '#4a8cff' }),
	];
	for (let i = 0; i < KEYS * KEYS; i++) {
		const column = i % KEYS;
		const row = Math.floor(i / KEYS);
		scene.createMesh({
			mesh: key,
			material: keyColors[(column + row) % 2],
			parent: site,
			position: [(column - (KEYS - 1) / 2) * PITCH, 0.005, (row - (KEYS - 1) / 2) * PITCH],
		});
	}

	// A wheel of spokes 4 mm thick turns above the tray.
	const wheel = scene.createGroup({ parent: site, position: [0, 0.07, 0], dynamic: true });
	const spoke = geometry.box({ width: 0.004, height: 0.012, depth: 0.05 });
	const copper = materials.standard({ color: '#d9894a' });
	for (let k = 0; k < SPOKES; k++) {
		const angle = (k / SPOKES) * Math.PI * 2;
		const position: [number, number, number] = [Math.sin(angle) * 0.03, 0, Math.cos(angle) * 0.03];
		scene
			.createMesh({ mesh: spoke, material: copper, parent: wheel, position })
			.setRotationEuler(0, angle, 0);
	}

	return {
		onUpdate(dt) {
			// The camera circles the tray and looks down at it, at the point where the controls take over.
			const turn = time.now * 0.3;
			if (!view.userCamera) {
				camera.setPosition(Math.sin(turn) * CIRCLE, HEIGHT, Math.cos(turn) * CIRCLE);
				camera.setRotationEuler(-TILT, turn, 0, 'YXZ');
			}
			vec3.set(look, Math.sin(turn) * REACH, 0, Math.cos(turn) * REACH);
			view.update(dt);
			wheel.setRotationEuler(0, -time.now * 0.8, 0);
		},
	};
});
