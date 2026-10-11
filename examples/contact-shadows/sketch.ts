// Contact shadows: a stone garden at golden hour. Raked sand made in code, a few large rocks, a
// path of stepping stones and 600 pebbles in one instance batch. The cascades give the rocks their
// long shadows, and contact shadows give every pebble and stone the dark line where it meets the
// sand. Every 3 seconds they turn off and on again, so the difference shows. The sun swings slowly
// around the garden, or follows the pointer.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';

/** How far contact shadows reach toward the sun, in meters, and the seconds of each half cycle. */
const REACH = 0.4;
const CYCLE = 3;
/** The pebbles, and the texels along each side of the sand texture. */
const PEBBLES = 600;
const SIZE = 128;
/** The large rocks: place on the sand, radius, and how tall each is against its width. */
const ROCKS = [
	[-1.6, -0.8, 0.9, 0.7],
	[1.2, -1.6, 0.6, 0.9],
	[0.4, 1.4, 0.45, 0.6],
	[2.4, 0.8, 0.35, 1.1],
] as const;
/** What the camera looks at. */
const TARGET = [0, 0.2, 0] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, time } = ctx;
	const day = timeOfDay('goldenHour', { heading: -0.6 });
	scene.setBackground(
		{ sky: { ...day.sky, cloudCoverage: 0.25 } },
		{ intensity: day.skyIntensity },
	);
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ ...day.fog, density: 0.01 });
	post.set({ exposure: day.exposure, bloom: { intensity: 0.15, threshold: 1 }, vignette: {} });
	const camera = scene.createPerspectiveCamera({ fov: 40, near: 0.1, far: 2000 });
	camera.setPosition(3.8, 2.1, 5.2);
	camera.lookAt(...TARGET);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: TARGET, groundY: 0, bounds: [-6, 0, -6, 6, 0, 6] });
	const sun = scene.createDirectionalLight({
		...day.light,
		castShadows: true,
		shadow: { distance: 30, contactDistance: REACH },
	});
	scene.createAmbientLight(day.ambient);

	// Raked sand: furrows along x, each texel with a little grain.
	math.seed(5);
	const data = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			const furrow = 0.8 + 0.2 * Math.sin((y / SIZE) * Math.PI * 16);
			const shade = furrow * math.randFloat(0.92, 1) * 255;
			data.fill(shade, (y * SIZE + x) * 4, (y * SIZE + x) * 4 + 3);
		}
	const look = { colorSpace: 'srgb', wrap: 'repeat', mipmaps: true, anisotropy: 8 } as const;
	scene.createMesh({
		mesh: geometry.box({ width: 400, height: 0.2, depth: 400 }),
		material: materials.standard({
			map: textures.fromData({ width: SIZE, height: SIZE, data, ...look }),
			color: '#e6d3b3',
			roughness: 0.95,
			uvTransform: { repeat: [200, 200] },
		}),
		position: [0, -0.1, 0],
		receiveShadows: true,
	});

	const solid = { castShadows: true, receiveShadows: true } as const;
	const stone = materials.standard({ color: '#7d776f', roughness: 0.85, flatShading: true });
	const rock = geometry.sphere({ radius: 1, widthSegments: 9, heightSegments: 6 });
	for (const [x, z, radius, height] of ROCKS)
		scene.createMesh({
			mesh: rock,
			material: stone,
			position: [x, radius * height * 0.55, z],
			scale: [radius, radius * height, radius * 0.85],
			rotation: [0, Math.sin(x), 0, Math.cos(x)],
			...solid,
		});
	// Stepping stones along a curve across the garden.
	const slab = geometry.cylinder({ radiusTop: 0.3, radiusBottom: 0.32, height: 0.08 });
	const paving = materials.standard({ color: '#9a948a', roughness: 0.8 });
	for (let i = 0; i < 7; i++) {
		const t = i / 6 - 0.5;
		scene.createMesh({
			mesh: slab,
			material: paving,
			position: [t * 5, 0.04, 1.2 * Math.sin(t * 3) + 0.3],
			...solid,
		});
	}
	// Pebbles in drifts around the rocks: flattened, turned and shaded apart.
	const pebbles = scene.createInstances(geometry.sphere({ radius: 1 }), PEBBLES, {
		material: materials.standard({ color: '#ffffff', roughness: 0.6 }),
		colors: true,
		...solid,
	});
	for (let i = 0; i < PEBBLES; i++) {
		const [x, z, radius] = ROCKS[i % ROCKS.length];
		const angle = math.randFloat(0, Math.PI * 2);
		const out = radius * math.randFloat(0.95, 2.4);
		const size = math.randFloat(0.025, 0.07);
		const flat = math.randFloat(0.35, 0.6);
		pebbles.positions.set(
			[x + Math.cos(angle) * out, size * flat * 0.7, z + Math.sin(angle) * out],
			i * 3,
		);
		pebbles.scales.set([size * math.randFloat(1, 1.5), size * flat, size], i * 3);
		pebbles.rotations.set([0, Math.sin(angle), 0, Math.cos(angle)], i * 4);
		const grey = math.randFloat(0.25, 0.75);
		pebbles.colors?.set([grey, grey * 0.95, grey * 0.9, 1], i * 4);
	}
	pebbles.markDirty();

	// The two settings of the light's contact shadows, which the cycle swaps between.
	const lit = [{ contactDistance: REACH }, { contactDistance: 0 }] as const;
	let shown = 0;
	return {
		onUpdate(dt) {
			view.update(dt);
			// Contact shadows on for one half of each cycle, off for the other.
			const half = Math.floor(time.now / CYCLE) % 2;
			if (half !== shown) {
				shown = half;
				sun.setShadow(lit[half]);
			}
			// The sun swings around the garden, or turns toward the pointed point, low in the sky.
			const swing = -0.6 + 0.5 * Math.sin(time.now * 0.15);
			const heading = math.lerp(swing, Math.atan2(view.point[0], view.point[2]), view.steering);
			sun.setDirection(-Math.sin(heading) * 0.85, -0.45, -Math.cos(heading) * 0.85);
		},
	};
});
