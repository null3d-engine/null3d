// Water: a river that winds down a grassy valley and opens into a lake, drawn by @null3d/water. One
// description gives both bodies, and the add-on draws them with waves the current carries, caustics
// on the bed, foam around the boulders, a mirror of the banks and the sky, and shores that fade
// where the bed rises to meet the surface. The camera drifts downstream above the water, then dips
// under it, where the add-on's underwater view takes over.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { createTerrain, terrainTextures } from '@null3d/terrain';
import { createUnderwater, createWater, foamMap, type WaterShape } from '@null3d/water';
import { interact } from '../lib/interact';

/** The lake's middle and its two radii, in meters. */
const LAKE = { x: 54, z: 0, rx: 34, rz: 24 } as const;
/** Where the river starts and where it meets the lake. */
const FROM = -150;
const TO = LAKE.x - LAKE.rx + 3;

/** The z of the river's middle at x, and the half width of its water there. */
const middleZ = (x: number) => 1.8 * Math.sin(x * 0.07 + 0.4) + 0.6 * Math.sin(x * 0.17);
const halfWidth = (x: number) => 2.6 + 0.4 * Math.sin(x * 0.11 + 1.2);
/** How far a point lies from the lake's middle, in radii: 1 at its shore. */
const fromLake = (x: number, z: number) => Math.hypot((x - LAKE.x) / LAKE.rx, z / LAKE.rz);

/** The height of the ground at a point: a river channel that deepens into a lake basin. */
function ground(x: number, z: number): number {
	const across = Math.abs(z - middleZ(x)) / halfWidth(x);
	const river = 1 - math.smoothstep(across, 0.9, 1.5);
	const lake = 1 - math.smoothstep(fromLake(x, z), 0.9, 1.1);
	const basin = Math.max(river, lake);
	const bed = -1.2 - 2.6 * lake;
	const bank =
		0.5 +
		0.4 * Math.sin(x * 0.045 + 1) * Math.sin(z * 0.05) +
		0.03 * Math.max(0, Math.abs(z) - 24) ** 1.4;
	return bed + (bank - bed) * math.smoothstep(basin, 0, 1);
}

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time, textures } = ctx;
	const day = timeOfDay(16.2, { heading: -2.1 });
	scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: day.skyIntensity });
	scene.setFog({ color: day.fog.color, density: 0.006, sunGlow: day.fog.sunGlow });
	post.set({ exposure: day.exposure, bloom: { threshold: 1 }, ao: {}, vignette: {} });
	scene.createDirectionalLight({
		...day.light,
		castShadows: true,
		shadow: { distance: 60, normalBias: 0.04, cascades: 2 },
	});

	const camera = scene.createPerspectiveCamera({
		fov: 48,
		near: 0.05,
		far: 1200,
		position: [-42, 2.4, 12],
		target: [-12, 0, 1],
	});
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [-12, 0, 1];
	interact(ctx, camera, { target });

	const layers = terrainTextures(textures, { seed: 5 });
	const terrain = createTerrain(ctx, {
		size: 520,
		height: ground,
		layers: [
			{ map: layers.grass, tile: 6, roughness: 1 },
			{ map: layers.soil, tile: 9, roughness: 1 },
			{ map: layers.rock, tile: 7, roughness: 0.9 },
			{ map: layers.snow, tile: 14, roughness: 0.8 },
		],
		maxLevel: 6,
	});

	// Boulders along the river's banks. They break the water, and the add-on's foam map draws the
	// rings and the trails that the current tears off them.
	const stones = Array.from({ length: 18 }, (_, i) => {
		const x = FROM + 12 + (i / 18) * (TO - FROM - 16);
		const side = i % 2 === 0 ? 1 : -1;
		return { x, z: middleZ(x) + side * (halfWidth(x) - 0.5), r: 0.55 + (i % 3) * 0.18 };
	});
	for (const stone of stones) {
		const rock = scene.createMesh({
			mesh: geometry.sphere({ radius: stone.r * 1.5, widthSegments: 7, heightSegments: 5 }),
			material: materials.standard({ color: '#6b675e', roughness: 0.9 }),
			position: [stone.x, -stone.r * 0.35, stone.z],
		});
		rock.setRotationEuler(stone.x * 0.7, stone.z * 1.3, 0);
	}

	const middle: [number, number][] = [];
	for (let x = FROM; x <= TO; x += 4) middle.push([x, middleZ(x)]);
	const shore = Array.from({ length: 72 }, (_, i) => {
		const angle = (i / 72) * Math.PI * 2;
		return [LAKE.x + Math.cos(angle) * LAKE.rx, Math.sin(angle) * LAKE.rz] as [number, number];
	});
	const shapes: WaterShape[] = [
		{
			kind: 'river',
			middle,
			halfWidth: middle.map(([x]) => halfWidth(x)),
			depth: (x, z) => -ground(x, z),
			speed: 0.6,
		},
		{ kind: 'lake', shore, depth: 3.8, shoreWidth: 6 },
	];
	const water = createWater(ctx, {
		shapes,
		foam: foamMap(ctx, stones, {
			origin: [FROM, -12],
			size: [TO - FROM + 40, 24],
			width: 2048,
			height: 256,
		}),
	});
	const underwater = createUnderwater(ctx, camera, water);
	const caustics: [number, number, number] = [0.55, 0.5, 0.38];
	water.setCaustics(caustics);
	const air: [number, number, number] = [0.72, 0.84, 1];
	const at = [0, 0, 0] as [number, number, number];
	let travel = 0;

	return {
		onUpdate(dt) {
			const t = time.now;
			// The camera drifts downstream above the water, then dips under the surface and rises.
			travel += dt * 0.9;
			if (travel > TO + 40) travel = FROM + 20;
			const x = travel;
			const z = middleZ(x) + 2.2 * Math.sin(t * 0.11);
			camera.setPosition(x - 26, 1.5 + 1.6 * Math.sin(t * 0.15), z + 9);
			target[0] = x;
			target[2] = middleZ(x);
			camera.lookAt(target[0], target[1], target[2]);
			camera.getPosition(at);
			underwater.update(t, air, caustics);
			terrain.update(at);
			water.update();
		},
	};
});
