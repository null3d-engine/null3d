// Water: a river that winds down a grassy valley and opens into a lake, drawn by @null3d/water. One
// description gives both bodies, and the add-on draws them with waves the current carries, caustics
// on the bed, foam around the boulders, a mirror of the banks and the sky, and shores that fade
// where the bed rises to meet the surface. The camera's tour drifts down the river, dips under the
// lake, where the add-on's underwater view takes over, and circles the valley back to its start.
import { defineSketch, timeOfDay } from '@null3d/engine';
import { createTerrain, terrainTextures } from '@null3d/terrain';
import { createUnderwater, createWater, foamMap, type WaterShape } from '@null3d/water';
import { routePosition, routeTimeline } from '../lib/cinematic';
import { interact } from '../lib/interact';
import {
	FROM,
	ground,
	halfWidth,
	LAKE,
	middleZ,
	OUT_FROM,
	OUT_TO,
	ROCKS_FROM,
	SHOTS,
	STONES,
	TO,
} from './valley';

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
		// The tour's first shot: the held frame shows it, and the loop starts and ends there.
		position: [...SHOTS[0].position],
		target: [...SHOTS[0].target],
	});
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [...SHOTS[0].target];
	const view = interact(ctx, camera, { target });

	const layers = terrainTextures(textures, { seed: 5 });
	const terrain = createTerrain(ctx, {
		size: 520,
		height: ground,
		layers: [
			{ map: layers.grass, tile: 6, roughness: 1, heightFrom: 'alpha' },
			{ map: layers.soil, tile: 9, roughness: 1, heightFrom: 'alpha' },
			{ map: layers.rock, tile: 7, roughness: 0.9, heightFrom: 'alpha' },
			{ map: layers.snow, tile: 14, roughness: 0.8, heightFrom: 'alpha' },
		],
		maxLevel: 6,
		camera,
	});

	// Boulders along the river's banks. They break the water, and the add-on's foam map draws the
	// rings and the trails that the current tears off them.
	for (const stone of STONES) {
		const rock = scene.createMesh({
			mesh: geometry.sphere({ radius: stone.r * 1.5, widthSegments: 7, heightSegments: 5 }),
			material: materials.standard({ color: '#6b675e', roughness: 0.9 }),
			position: [stone.x, -stone.r * 0.35, stone.z],
		});
		rock.setRotationEuler(stone.x * 0.7, stone.z * 1.3, 0);
	}

	// A stream along the valley's channel, flowing east from `from` to `to`.
	const stream = (from: number, to: number): WaterShape => {
		const middle: [number, number][] = [];
		for (let x = from; x <= to; x += 4) middle.push([x, middleZ(x)]);
		const widths = middle.map(([x]) => halfWidth(x));
		const depth = (x: number, z: number) => Math.max(0, -ground(x, z));
		return { kind: 'river', middle, halfWidth: widths, depth, speed: 0.6 };
	};
	const shore = Array.from({ length: 72 }, (_, i) => {
		const angle = (i / 72) * Math.PI * 2;
		return [LAKE.x + Math.cos(angle) * LAKE.rx, Math.sin(angle) * LAKE.rz] as [number, number];
	});
	// The river runs into the lake, and a stream runs out of its far side, so the channel holds water
	// along the whole valley.
	const shapes: WaterShape[] = [
		stream(FROM, TO),
		{ kind: 'lake', shore, depth: 3.8, shoreWidth: 6 },
		stream(OUT_FROM, OUT_TO),
	];
	const water = createWater(ctx, {
		shapes,
		foam: foamMap(ctx, STONES, {
			origin: [ROCKS_FROM, -12],
			size: [TO - ROCKS_FROM + 40, 24],
			width: 2048,
			height: 256,
		}),
	});
	const underwater = createUnderwater(ctx, camera, water);
	const caustics: [number, number, number] = [0.55, 0.5, 0.38];
	water.setCaustics(caustics);
	const air: [number, number, number] = [0.72, 0.84, 1];
	const at = [0, 0, 0] as [number, number, number];
	const route = routeTimeline(SHOTS);
	const pose = new Float32Array(6);

	return {
		onUpdate(dt) {
			const t = time.now;
			// The tour is one loop with no cut, as a function of the time, until the user takes over.
			if (!view.userCamera) {
				routePosition(route, t, pose);
				target[0] = pose[3] as number;
				target[1] = pose[4] as number;
				target[2] = pose[5] as number;
				camera.setPosition(pose[0] as number, pose[1] as number, pose[2] as number);
				camera.lookAt(target[0], target[1], target[2]);
			}
			view.update(dt);
			camera.getPosition(at);
			underwater.update(t, air, caustics);
			terrain.update(at);
			water.update();
		},
	};
});
