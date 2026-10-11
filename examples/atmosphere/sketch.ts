// Atmosphere: a day passes over a valley of ridges in a minute, under the physical sky. The air
// scatters the sun's light by Rayleigh and Mie, so the sky turns from deep blue at noon to gold and
// rose at sunset, and the earth's shadow rises in the east. The same air hazes each ridge by its
// distance, bluer and paler the farther it lies, and warm toward the sun. timeOfDay gives the sun,
// the moon and the stars, and the sky's environment lights the valley and shows in the lake. At
// night the moon lights the air and the stars come out.
import { defineSketch, type MeshArrays, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';

// Seconds per day, the share of the day at time 0, and how much dawn and dusk slow the clock (0
// for an even clock). The slower dusk puts time 0 at about 17:15.
const [DAY, START, LINGER] = [60, 16 / 24, 0.75];
/** The sun's path turned about +Y, so that the evening sun lights the ridges from the right. */
const HEADING = -2.63;
/** Quads along each side of the land, its width in metres, and the lake's height. */
const QUADS = 200;
const WIDTH = 24000;
const LAKE = 40;
/** Linear colors of the land: meadow, forest, rock and snow, three numbers each. */
const LAND = [0.2, 0.3, 0.07, 0.05, 0.11, 0.04, 0.28, 0.25, 0.22, 0.85, 0.88, 0.92];
/** Where the camera stands and looks. */
const EYE = [0, 230, 5200] as const;
const TARGET = [0, 300, 0] as const;

/** A ridge of noise: sharp crests where a wave of `x` and `z` turns, in about -1 to 1. */
const ridge = (x: number, z: number) => 1 - 2 * Math.abs(Math.sin(x) * Math.cos(z));

/** The land's height in metres: ridges of five scales, a valley along z, and the lake's basin. */
function heightAt(x: number, z: number): number {
	let h = 0;
	let amplitude = 1;
	let f = 1 / 2600;
	for (let o = 0; o < 5; o++) {
		const a = 0.6 + o * 1.3;
		const [u, v] = [x * Math.cos(a) - z * Math.sin(a), x * Math.sin(a) + z * Math.cos(a)];
		h += amplitude * ridge(u * f, v * f * 0.7);
		amplitude *= 0.48;
		f *= 2.05;
	}
	const valley = math.smoothstep(Math.abs(x), 600, 4500);
	const basin = math.smoothstep(Math.hypot(x, z - 2600), 1500, 300);
	return 120 + valley * (420 + 520 * h) - basin * 180;
}

/** The land as a grid of quads, with a color at each vertex from its height and slope. */
function land(): MeshArrays {
	const row = QUADS + 1;
	const positions = new Float32Array(row * row * 3);
	const colors = new Float32Array(row * row * 3);
	for (let v = 0; v < row * row; v++) {
		const [x, z] = [((v % row) / QUADS - 0.5) * WIDTH, (Math.floor(v / row) / QUADS - 0.5) * WIDTH];
		const y = heightAt(x, z);
		positions.set([x, y, z], v * 3);
		const steep = Math.hypot(heightAt(x + 30, z) - y, heightAt(x, z + 30) - y) / 30;
		const forest =
			math.smoothstep(math.randFloat(0, 1), 0.35, 0.65) * (1 - math.smoothstep(y, 600, 800));
		const rock = math.smoothstep(steep, 0.45, 0.7);
		const snow = math.smoothstep(y + 120 * math.randFloat(-1, 1), 900, 1050) * (1 - rock * 0.6);
		for (let c = 0; c < 3; c++) {
			const green = math.lerp(LAND[c], LAND[3 + c], forest);
			colors[v * 3 + c] = math.lerp(math.lerp(green, LAND[6 + c], rock), LAND[9 + c], snow);
		}
	}
	const indices = new Uint16Array(QUADS * QUADS * 6);
	for (let q = 0; q < QUADS * QUADS; q++) {
		const a = Math.floor(q / QUADS) * row + (q % QUADS);
		indices.set([a, a + row, a + 1, a + 1, a + row, a + row + 1], q * 6);
	}
	return { positions, colors, indices, computeNormals: true };
}

/** The hour at a sketch time: the day's share, slowed near 6 and 18 by a sine of twice the day. */
function clock(seconds: number): number {
	const share = math.euclideanModulo(START + seconds / DAY, 1);
	return 24 * (share + (LINGER * Math.sin(4 * Math.PI * share)) / (4 * Math.PI));
}

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	// The air of a clear evening: a little haze, high clouds, and twice the real air between the
	// camera and the land, so that the ridges fade in fewer kilometres.
	const air = { haze: 1.2, cloudCoverage: 0.32, cloudElevation: 0.8, aerialPerspective: 2 };
	const environment = await assets.skyEnvironment();
	scene.setEnvironment(environment);
	post.set({ bloom: { intensity: 0.2, threshold: 1 }, ao: { radius: 2 }, vignette: {} });
	const sun = scene.createDirectionalLight({ castShadows: true, shadow: { distance: 3000 } });
	const camera = scene.createPerspectiveCamera({ fov: 42, near: 2, far: 60000, position: EYE });
	camera.lookAt(...TARGET);
	scene.setActiveCamera(camera);
	// The pointer points at an upright plane across the valley: left is morning, right evening.
	const view = interact(ctx, camera, {
		target: TARGET,
		planeZ: 0,
		bounds: [-6e3, -1e4, -1, 6e3, 1e4, 1],
	});

	math.seed(11);
	const ground = materials.standard({ color: '#ffffff', roughness: 0.95 });
	scene.createMesh({ mesh: geometry.fromArrays(land()), material: ground, receiveShadows: true });
	// The lake mirrors the sky's environment, smooth and dark.
	const lake = materials.standard({ color: '#0b1a22', roughness: 0.06, metalness: 0.1 });
	const plane = geometry.plane({ width: WIDTH, height: WIDTH });
	scene.createMesh({
		mesh: plane,
		material: lake,
		position: [0, LAKE, 0],
		rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
	});

	// Pines on the gentle slopes near the camera, each a cone on the ground at a seeded place.
	const pine = geometry.cone({ radius: 5, height: 22, radialSegments: 7 });
	const needles = materials.standard({ color: '#16301a', roughness: 0.9, flatShading: true });
	const pines = scene.createInstances(pine, 2400, { material: needles, castShadows: true });
	const [places, scales] = [pines.positions, pines.scales];
	for (let k = 0; k < 2400; k++) {
		const [x, z] = [math.randFloat(-2600, 2600), math.randFloat(1800, 4800)];
		const y = heightAt(x, z);
		const size = math.randFloat(0.7, 1.4);
		places.set([x, y > LAKE + 8 ? y + 9 * size : -1e4, z], k * 3);
		scales.set([size, size, size], k * 3);
	}

	return {
		onUpdate(dt) {
			view.update(dt);
			// The pointer picks an hour from 4:00 at the left to 20:00 at the right.
			const hour = math.lerp(clock(time.now), 12 + view.point[0] * 1.3e-3, view.steering);
			const day = timeOfDay(hour, { heading: HEADING, model: 'physical' });
			scene.setBackground({ atmosphere: { ...air, ...day.atmosphere, time: time.now } });
			sun.setDirection(...day.light.direction);
			sun.setColor(day.light.color);
			sun.setIntensity(day.light.intensity);
			post.set({ exposure: day.exposure });
		},
	};
});
