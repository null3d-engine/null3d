// Vertex updates: a stone pool at golden hour. A glowing float, which the pointer leads, leaves rings
// on a slow swell. Each update rewrites one array of positions and one of normals, and hands them to
// mesh.updateVertices, which allocates nothing. The engine uploads only the vertices that changed.
// The mesh keeps its first bounds, so the water gets bounds that hold the highest waves.
import { defineSketch, timeOfDay, type Vec3, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** Quads along each side of the water, and the water's width and depth. */
const SIDE = 96;
const SIZE = 12;
/** The run between the two neighbors that a normal's slopes span. */
const STEP = (2 * SIZE) / SIDE;
/** The highest that the swell and the rings rise together. */
const HEIGHT = 0.2;
/** How many rings move at once, the seconds between two of them, and their speed in m/s. */
const RINGS = 12;
const EVERY = 0.35;
const SPEED = 1.6;
/** The box that keeps the float inside the pool's rim. */
const BOUNDS = [-5, 0, -5, 5, 0, 5] as const;

/** The float's own path while the pointer does not lead it: a slow loop over the pool. */
const drift = (t: number, out: Vec3) =>
	vec3.set(out, 3.2 * Math.sin(t * 0.45), 0, 2.4 * Math.sin(t * 0.9 + 0.6));

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	const day = timeOfDay(17.8, { heading: -1.45 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.01, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, ao: {}, vignette: {} });
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 30 } });
	const camera = scene.createPerspectiveCamera({
		fov: 45,
		position: [0, 3.2, 10.5],
		target: [0, 0, -1],
	});
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 0, -1], groundY: 0, bounds: BOUNDS });

	// The pool's rim and the deck around it, in warm stone.
	const stone = materials.standard({ color: '#d8c6ab', roughness: 0.8 });
	const deck = materials.standard({ color: '#a39079', roughness: 0.9 });
	const rim = SIZE / 2 + 0.3;
	for (const [x, z, w, d] of [
		[0, -rim, SIZE + 1.2, 0.6],
		[0, rim, SIZE + 1.2, 0.6],
		[-rim, 0, 0.6, SIZE],
		[rim, 0, 0.6, SIZE],
	])
		scene.createMesh({
			mesh: geometry.box({ width: w, height: 0.5, depth: d }),
			material: stone,
			position: [x, 0.05, z],
			castShadows: true,
			receiveShadows: true,
		});
	scene.createMesh({
		mesh: geometry.plane({ width: 400, height: 400 }),
		material: deck,
		position: [0, -0.2, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
		receiveShadows: true,
	});

	// The water: a grid whose heights the update writes, with normals from the heights around each.
	const row = SIDE + 1;
	const positions = new Float32Array(row * row * 3);
	const normals = new Float32Array(row * row * 3);
	const indices = new Uint16Array(SIDE * SIDE * 6);
	for (let v = 0; v < row * row; v++) {
		positions[v * 3] = ((v % row) / SIDE - 0.5) * SIZE;
		positions[v * 3 + 2] = (Math.floor(v / row) / SIDE - 0.5) * SIZE;
		normals[v * 3 + 1] = 1;
	}
	for (let q = 0; q < SIDE * SIDE; q++) {
		const a = Math.floor(q / SIDE) * row + (q % SIDE);
		indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], q * 6);
	}
	const sheet = geometry.fromArrays({ positions, normals, indices });
	const water = scene.createMesh({
		mesh: sheet,
		material: materials.standard({ color: '#06303c', roughness: 0.03 }),
		receiveShadows: true,
	});
	// The corners reach past the flat water's sphere as the waves rise.
	water.setBounds([0, 0, 0], Math.hypot(SIZE / 2, HEIGHT, SIZE / 2));

	// The float: a warm lamp that bloom spreads into a glow, with a light that the water reflects.
	const float = scene.createMesh({
		mesh: geometry.sphere({ radius: 0.22 }),
		material: materials.standard({ color: '#000000', emissive: '#ffb35c', emissiveIntensity: 6 }),
		dynamic: true,
	});
	scene.createPointLight({ parent: float, color: '#ffb35c', intensity: 20, range: 6 });

	// Where each ring started, three numbers each, and when. Slots never used start long ago.
	const rings = new Float32Array(RINGS * 3);
	const starts = new Float32Array(RINGS).fill(-1e3);
	const [here, past] = [vec3.create(), vec3.create()];
	let next = 0;

	return {
		onUpdate(dt) {
			const t = time.now;
			view.update(dt);
			// The float follows its path, or the pointer. A ring starts under it at each tick.
			view.steer(drift(t, here));
			for (; next <= t / EVERY; next++) {
				view.steer(drift(next * EVERY, past));
				rings.set(past, (next % RINGS) * 3);
				starts[next % RINGS] = next * EVERY;
			}
			float.setPosition(here[0], 0.15 + 0.05 * Math.sin(t * 3), here[2]);

			// Heights: a slow swell, plus each ring's crest, which fades as it spreads.
			for (let v = 0; v < row * row; v++) {
				const x = positions[v * 3];
				const z = positions[v * 3 + 2];
				let y = 0.06 * Math.sin(x * 0.8 + t * 1.2) * Math.cos(z * 0.6 + t * 0.9);
				for (let k = 0; k < RINGS; k++) {
					const age = t - starts[k];
					if (age < 0 || age > 4) continue;
					const r = Math.hypot(x - rings[k * 3], z - rings[k * 3 + 2]) - SPEED * age;
					y += 0.08 * Math.exp(-1.2 * age - 5 * r * r) * Math.cos(r * 12);
				}
				positions[v * 3 + 1] = y;
			}
			// Normals from the slopes between each vertex's neighbors.
			for (let v = 0; v < row * row; v++) {
				const i = v % row;
				const j = (v - i) / row;
				const dx =
					positions[(v + (i < SIDE ? 1 : 0)) * 3 + 1] - positions[(v - (i > 0 ? 1 : 0)) * 3 + 1];
				const dz =
					positions[(v + (j < SIDE ? row : 0)) * 3 + 1] -
					positions[(v - (j > 0 ? row : 0)) * 3 + 1];
				const length = Math.hypot(dx, STEP, dz);
				normals[v * 3] = -dx / length;
				normals[v * 3 + 1] = STEP / length;
				normals[v * 3 + 2] = -dz / length;
			}
			sheet.updateVertices('positions', positions);
			sheet.updateVertices('normals', normals);
		},
	};
});
