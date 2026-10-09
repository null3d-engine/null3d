// A large world: a road on the Earth's surface, 6,378 km from the origin, with a car's camera that
// drives along it at 30 m/s under a sky with fog. The engine runs in large-world mode, so each
// position that a setter takes keeps a precision of 0.03 mm or better at that distance: the 15 cm
// lane marks stay sharp, and the camera moves smoothly. Each stretch of road has its own batches of
// lane marks and trees, whose rows sit near the batch's origin, so they keep the precision of
// 32-bit floats too. From the user's first drag, scroll or pinch, the camera orbits a point on the
// road ahead that drives on, and the camera drives with it.
import { defineSketch, math } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The Earth's radius, in meters: the road's height above the origin. */
const R = 6_378_137;
/** Each stretch of road, its count, and the trees beside each one. */
const STRETCH = 256;
const STRETCHES = 16;
const TREES = 60;
/** The car's speed, in meters per second, and the gap between two lane marks, in meters. */
const SPEED = 30;
const MARK_GAP = 8;
/** How far ahead of the car, along its line of sight, the user's camera orbits, in meters. */
const AHEAD = 12;

export default defineSketch((ctx) => {
	const { scene, geometry, materials, time } = ctx;
	scene.setBackground({
		sky: { sunPosition: [-0.5, 0.25, -0.8], turbidity: 4, cloudCoverage: 0.3 },
	});
	scene.setFog({ color: '#b9c6d4', density: 0.004 });
	scene.createDirectionalLight({ direction: [0.5, -0.4, 0.8], color: '#fff1dc', intensity: 3 });
	scene.createAmbientLight({ color: '#cfe0f5', intensity: 0.8 });
	const camera = scene.createPerspectiveCamera({ fov: 60, near: 0.1, far: 2000 });
	scene.setActiveCamera(camera);
	// The user's camera orbits a point on the car's line of sight. A plain array keeps the point's
	// full precision, 6,378 km from the origin.
	const look = [AHEAD, R + 1.4 - (0.9 * AHEAD) / 60, -1.8];
	const view = interact(ctx, camera, { target: look, minDistance: 2, maxDistance: 200 });

	const box = geometry.box();
	const asphalt = materials.standard({ color: '#3b3d42', roughness: 0.9 });
	const grass = materials.standard({ color: '#5f7d3a' });
	const paint = materials.standard({ color: '#f2f2ee' });
	const trunk = geometry.cylinder({ radiusTop: 0.15, radiusBottom: 0.2, height: 2 });
	const crown = geometry.cone({ radius: 1.6, height: 5, radialSegments: 12 });
	const bark = materials.standard({ color: '#5a4030' });
	const needles = materials.standard({ color: '#2f5a32' });
	math.seed(7);

	for (let s = 0; s < STRETCHES; s++) {
		const start = s * STRETCH;
		scene.createMesh({
			mesh: box,
			material: asphalt,
			position: [start + STRETCH / 2, R - 0.05, 0],
			scale: [STRETCH, 0.1, 8],
		});
		scene.createMesh({
			mesh: box,
			material: grass,
			position: [start + STRETCH / 2, R - 0.12, 0],
			scale: [STRETCH, 0.1, 400],
		});
		// Lane marks 3 m long and 15 cm wide, relative to the stretch's start.
		const marks = scene.createInstances(box, STRETCH / MARK_GAP, {
			material: paint,
			origin: [start, R, 0],
		});
		for (let k = 0; k < marks.count; k++) {
			marks.positions.set([k * MARK_GAP, 0.005, 0], k * 3);
			marks.scales.set([3, 0.01, 0.15], k * 3);
		}
		// Trees on both sides of the road, at random places in the stretch.
		const trunks = scene.createInstances(trunk, TREES, { material: bark, origin: [start, R, 0] });
		const crowns = scene.createInstances(crown, TREES, {
			material: needles,
			origin: [start, R, 0],
		});
		for (let k = 0; k < TREES; k++) {
			const side = k % 2 === 0 ? 1 : -1;
			const x = math.randFloat(0, STRETCH);
			const z = side * math.randFloat(9, 80);
			const size = math.randFloat(0.7, 1.4);
			trunks.positions.set([x, size, z], k * 3);
			trunks.scales.set([size, size, size], k * 3);
			crowns.positions.set([x, size * 4, z], k * 3);
			crowns.scales.set([size, size, size], k * 3);
		}
	}

	/** How far the camera drives before it starts the road again. */
	const loop = STRETCH * (STRETCHES - 2);
	return {
		onUpdate(dt) {
			const x = (time.now * SPEED) % loop;
			if (!view.userCamera) {
				camera.setPosition(x, R + 1.4, -1.8);
				camera.lookAt(x + 60, R + 0.5, -1.8);
			}
			// The user's camera drives on with its target, and starts the road again with the car.
			view.shift(x + AHEAD - look[0], 0, 0);
			look[0] = x + AHEAD;
			view.update(dt);
		},
	};
});
