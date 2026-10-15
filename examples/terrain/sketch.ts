// Terrain: a 1.2 km valley drawn by the terrain add-on. The height field is a function of the
// place, and the ground near the camera draws at about a meter of detail while the hills far away
// draw coarser blocks, each with a skirt that hides the seam where two levels meet. Four tiled
// layers, grass, soil, rock and snow, blend by a splat map that the add-on fills from the height
// and the slope. Boulders made in code stand on the ground, placed with `terrain.heightAt`, and the
// camera flies a slow circle over the valley. The terrain carries no collision of its own.
import { defineSketch, math, timeOfDay, vec3 } from '@null3d/engine';
import { createTerrain, terrainTextures } from '@null3d/terrain';
import { interact } from '../lib/interact';

/** The ground's width and depth, in meters, and how many boulders stand on it. */
const SIZE = 1200;
const BOULDERS = 900;

const hash = (x: number, y: number) => {
	let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
	h = Math.imul(h ^ (h >>> 13), 1274126177);
	return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Value noise, from -1 to 1. */
function noise(x: number, y: number): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const u = smooth(x - xi);
	const v = smooth(y - yi);
	return (
		math.lerp(
			math.lerp(hash(xi, yi), hash(xi + 1, yi), u),
			math.lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u),
			v,
		) *
			2 -
		1
	);
}

/** Octaves of noise, each twice as fine and half as strong. */
function fbm(x: number, y: number, octaves: number): number {
	let sum = 0;
	let amplitude = 0.5;
	let scale = 1;
	for (let o = 0; o < octaves; o++) {
		sum += amplitude * noise(x * scale, y * scale);
		amplitude *= 0.5;
		scale *= 2;
	}
	return sum;
}

/** The height of the ground at a point: rolling hills with a valley that runs along z. */
function ground(x: number, z: number): number {
	const hills = 62 * fbm(x * 0.0021, z * 0.0021, 5) + 7 * fbm(x * 0.014 + 3, z * 0.014, 3);
	const valley = -34 * Math.exp(-(z * z) / (2 * 260 * 260));
	return hills + valley + 12;
}

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	const day = timeOfDay('goldenHour', { heading: -2.3 });
	scene.setBackground(
		{ sky: { ...day.sky, cloudCoverage: 0.25 } },
		{ intensity: day.skyIntensity },
	);
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity * 0.8 });
	scene.setFog({ color: [0.55, 0.42, 0.35], density: 0.0005, sunGlow: day.fog.sunGlow });
	post.set({
		exposure: day.exposure,
		bloom: { intensity: 0.12, threshold: 1 },
		vignette: {},
	});
	scene.createDirectionalLight({ ...day.light, castShadows: true, shadow: { distance: 320 } });
	scene.createAmbientLight(day.ambient);
	const camera = scene.createPerspectiveCamera({ fov: 52, near: 0.5, far: 4000 });
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: [0, 12, 0], groundY: 0 });

	// The ground: four layers made in code, with the height and slope choosing which shows.
	const layers = terrainTextures(ctx.textures, { size: 128, seed: 7 });
	const terrain = createTerrain(ctx, {
		size: SIZE,
		height: ground,
		resolution: 256,
		layers: [
			{ map: layers.grass, tile: 6, roughness: 1 },
			{ map: layers.soil, tile: 11, roughness: 1 },
			{ map: layers.rock, tile: 7, roughness: 0.85 },
			{ map: layers.snow, tile: 14, roughness: 0.7 },
		],
		maxLevel: 6,
		split: 2,
	});

	// Boulders seated on the ground, each where the height field says the ground is.
	const rock = geometry.sphere({ radius: 1, widthSegments: 8, heightSegments: 5 });
	const stone = materials.standard({ color: '#6d6559', roughness: 0.95, flatShading: true });
	const boulders = scene.createInstances(rock, BOULDERS, {
		material: stone,
		castShadows: true,
		receiveShadows: true,
	});
	const size = [1, 1, 1];
	math.seed(5);
	for (let k = 0; k < BOULDERS; k++) {
		const x = math.randFloat(-SIZE / 2, SIZE / 2);
		const z = math.randFloat(-SIZE / 2, SIZE / 2);
		size[0] = math.randFloat(0.5, 3) * math.randFloat(0.7, 1.4);
		size[1] = math.randFloat(0.5, 3) * math.randFloat(0.6, 1.1);
		size[2] = math.randFloat(0.5, 3) * math.randFloat(0.7, 1.4);
		boulders.positions.set([x, ground(x, z) + (size[1] as number) * 0.5, z], k * 3);
		boulders.scales.set(size, k * 3);
	}
	boulders.markDirty();

	const eye = vec3.create();
	return {
		onUpdate(dt) {
			// A slow circle over the valley, looking down its length toward the low sun.
			if (!view.userCamera) {
				const t = time.now * 0.05;
				const [x, z] = [Math.sin(t) * 230, Math.cos(t) * 230];
				const [ax, az] = [Math.sin(t + 0.55) * 330, Math.cos(t + 0.55) * 330];
				camera.setPosition(x, ground(x, z) + 32, z);
				camera.lookAt(ax, ground(ax, az) + 3, az);
			}
			camera.getWorldPosition(eye);
			terrain.update(eye[0] as number, eye[2] as number);
			view.update(dt);
		},
	};
});
