// A large world: a road on the Earth's surface, 6,378 km from the origin, with a car's camera that
// drives along it at 30 m/s at golden hour. The engine runs in large-world mode, so each position
// that a setter takes keeps a precision of 0.03 mm or better at that distance: the 15 cm lane marks
// stay sharp, and the camera moves smoothly. The low sun ahead and the sky's own light light the
// scene, and fog thickens with distance into the haze of the horizon. The asphalt, with its edge
// lines, and the grass are textures made in code. Each stretch of road has its own batches of lane
// marks, trees and hills, whose rows sit near the batch's origin, so they keep the precision of
// 32-bit floats too. From the user's first drag, scroll or pinch, the camera orbits a point on the
// road ahead that drives on, and the camera drives with it.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The Earth's radius, in meters: the road's height above the origin. */
const R = 6_378_137;
/** Each stretch of road, its count, and the trees and hills beside each one. */
const STRETCH = 256;
const STRETCHES = 16;
const TREES = 60;
const HILLS = 8;
/** The car's speed, in meters per second, and the gap between two lane marks, in meters. */
const SPEED = 30;
const MARK_GAP = 8;
/** How far ahead of the car, along its line of sight, the user's camera orbits, in meters. */
const AHEAD = 12;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	// Golden hour, with the sun low ahead of the car and to its left. The sky's light lights the
	// scene, and the fog takes the color of the horizon.
	const day = timeOfDay('goldenHour', { heading: -2.6 });
	const intensity = day.skyIntensity;
	scene.setBackground({ sky: { ...day.sky, cloudCoverage: 0.35 } }, { intensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity });
	scene.setFog({ color: day.fog.color, density: 0.0025, sunGlow: day.fog.sunGlow });
	scene.createDirectionalLight(day.light);
	post.set({
		toneMapping: 'agx',
		exposure: day.exposure * 1.2,
		bloom: { intensity: 0.15, threshold: 1 },
		vignette: {},
	});
	const camera = scene.createPerspectiveCamera({ fov: 60, near: 0.1, far: 5000 });
	scene.setActiveCamera(camera);
	// The user's camera orbits a point on the car's line of sight. A plain array keeps the point's
	// full precision, 6,378 km from the origin.
	const look = [AHEAD, R + 1.4 - (0.9 * AHEAD) / 60, -1.8];
	const view = interact(ctx, camera, { target: look, minDistance: 2, maxDistance: 200 });

	// Two textures from grain: asphalt with a white line along each edge, and grass.
	math.seed(7);
	const asphalt = new Uint8Array(64 * 64 * 4);
	const grass = new Uint8Array(64 * 64 * 4);
	for (let i = 0; i < 64 * 64; i++) {
		const [edge, grain] = [
			Math.abs((i >> 6) - 31.5) > 28 && Math.abs((i >> 6) - 31.5) < 30.5,
			math.randFloat(0.8, 1),
		];
		asphalt.set(edge ? [230, 230, 222, 255] : [70 * grain, 70 * grain, 74 * grain, 255], i * 4);
		grass.set([95 * grain, 120 * grain, 55 * grain, 255], i * 4);
	}
	const texture = (data: Uint8Array) =>
		textures.fromData({
			width: 64,
			height: 64,
			data,
			colorSpace: 'srgb',
			wrap: 'repeat',
			mipmaps: true,
			anisotropy: 16,
		});
	const box = geometry.box();
	const length = STRETCH * STRETCHES;
	scene.createMesh({
		mesh: box,
		material: materials.standard({
			map: texture(asphalt),
			roughness: 0.8,
			uvTransform: { repeat: [length / 4, 1] },
		}),
		position: [length / 2, R - 0.05, 0],
		scale: [length, 0.1, 8],
	});
	scene.createMesh({
		mesh: box,
		material: materials.standard({ map: texture(grass), uvTransform: { repeat: [2000, 2000] } }),
		position: [length / 2, R - 0.12, 0],
		scale: [8000, 0.1, 8000],
	});

	const paint = materials.standard({ color: '#f2f2ee', roughness: 0.6 });
	const trunk = geometry.cylinder({ radiusTop: 0.15, radiusBottom: 0.2, height: 2 });
	const crown = geometry.cone({ radius: 1.6, height: 5, radialSegments: 12 });
	const bark = materials.standard({ color: '#4a3528' });
	const needles = materials.standard({ color: '#2b4a2a' });
	const hill = geometry.sphere({ radius: 1, widthSegments: 24, heightSegments: 12 });
	const turf = materials.standard({ color: '#3c4a28' });
	for (let s = 0; s < STRETCHES; s++) {
		const origin = [s * STRETCH, R, 0] as const;
		const batch = (mesh: typeof box, rows: number, material: typeof paint) =>
			scene.createInstances(mesh, rows, { material, origin });
		// Lane marks 3 m long and 15 cm wide, relative to the stretch's start.
		const marks = batch(box, STRETCH / MARK_GAP, paint);
		for (let k = 0; k < marks.count; k++) {
			marks.positions.set([k * MARK_GAP, 0.005, 0], k * 3);
			marks.scales.set([3, 0.01, 0.15], k * 3);
		}
		// Trees on both sides of the road, at random places in the stretch.
		const [trunks, crowns] = [batch(trunk, TREES, bark), batch(crown, TREES, needles)];
		for (let k = 0; k < TREES; k++) {
			const [x, z] = [math.randFloat(0, STRETCH), (k % 2 === 0 ? 1 : -1) * math.randFloat(9, 80)];
			const size = math.randFloat(0.7, 1.4);
			trunks.positions.set([x, size, z], k * 3);
			crowns.positions.set([x, size * 4, z], k * 3);
			for (const rows of [trunks, crowns]) rows.scales.set([size, size, size], k * 3);
		}
		// Low hills far from the road, half buried, which the fog turns blue with distance.
		const hills = batch(hill, HILLS, turf);
		for (let k = 0; k < HILLS; k++) {
			const [x, z] = [
				math.randFloat(0, STRETCH),
				(k % 2 === 0 ? 1 : -1) * math.randFloat(250, 900),
			];
			hills.positions.set([x, -10, z], k * 3);
			hills.scales.set(
				[math.randFloat(150, 300), math.randFloat(40, 110), math.randFloat(120, 250)],
				k * 3,
			);
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
