// Screen-space reflections: a street at night after the rain. The asphalt is rough where it is dry
// and smooth in the puddles, from a map made in code, so the lit windows, the shop signs, the
// street lamps and a taxi streak down into the puddles, and the dark window panes, the wet curbs and
// the chrome bollards shine. Where a reflected ray finds nothing on the screen, the night sky's
// light shows instead, with no hard edge. The camera walks slowly down the street, a taxi drives up
// it, and the pointer steers the taxi.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';
import { FAR, LANE, NEAR, ROAD, street } from './street';

/** Texels along each side of the puddle map. */
const SIZE = 128;
/** How much brighter than the time of day's own scale the night sky shows, for this exposure. */
const SKY = 5;
/** The taxi's speed in meters per second, and where its loop starts. */
const SPEED = 5;
const START = 68;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, textures, post, quality, time } = ctx;
	// Phones start with the reflections off: this demo turns them on at a quarter of the size.
	const reflect = () => quality.settings.ssrScale === 0 && quality.set({ ssrScale: 0.25 });
	reflect();
	quality.onChange(reflect);
	post.set({
		ssr: { maxDistance: 120, thickness: 1.5 },
		bloom: { intensity: 0.25, threshold: 1 },
		vignette: { intensity: 0.7 },
	});
	// A navy night sky, lighter toward the horizon, which also lights what the reflections miss.
	const night = timeOfDay('night');
	scene.setBackground({ sky: night.sky }, { intensity: night.skyIntensity * SKY });
	scene.setEnvironment(await assets.skyEnvironment(), { intensity: night.skyIntensity * SKY });
	const [red, green, blue] = night.fog.color;
	scene.setFog({ color: [red * SKY, green * SKY, blue * SKY], density: 0.02 });
	const camera = scene.createPerspectiveCamera({ fov: 55, far: 400, position: [0, 1.7, 30] });
	scene.setActiveCamera(camera);
	const target: [number, number, number] = [0, 1.5, 5];
	const view = interact(ctx, camera, { target, groundY: 0 });
	scene.createAmbientLight({ color: '#4060a0', intensity: 0.15 });
	scene.createDirectionalLight({ direction: [0.3, -1, 0.4], color: '#8090c0', intensity: 0.3 });

	// Puddles: smooth near a few blobs of the seeded generator, rough between them. A band of damp
	// asphalt, darker and only a little smoother than the dry, rings each puddle, and the water
	// starts at a sharp edge inside it, so no wide band of half-rough asphalt catches the lights.
	// The metal-rough map holds the roughness in green and the metalness in blue, as glTF's do.
	math.seed(11);
	const blobs = Array.from({ length: 40 }, () => [math.randFloat(0, 1), math.randFloat(0, 1)]);
	const wrap = (d: number) => Math.min(Math.abs(d), 1 - Math.abs(d));
	const rough = new Uint8Array(SIZE * SIZE * 4).fill(255);
	const shade = new Uint8Array(SIZE * SIZE * 4).fill(255);
	for (let y = 0; y < SIZE; y++)
		for (let x = 0; x < SIZE; x++) {
			let wet = -1;
			for (const [bx, by] of blobs)
				wet = Math.max(wet, 1 - Math.hypot(wrap(x / SIZE - bx) * 1.6, wrap(y / SIZE - by)) / 0.12);
			const damp = math.smoothstep(wet, -0.25, 0.3);
			const water = math.smoothstep(wet, 0.3, 0.4);
			const at = (y * SIZE + x) * 4;
			rough[at + 1] = math.lerp(math.lerp(0.75, 0.6, damp), 0.04, water) * 255;
			rough[at + 2] = 0;
			shade.fill(math.lerp(1, 0.5, Math.max(damp, water)) * 255, at, at + 3);
		}
	const map = (data: Uint8Array, colorSpace: 'srgb' | 'linear') =>
		textures.fromData({
			width: SIZE,
			height: SIZE,
			data,
			colorSpace,
			wrap: 'repeat',
			mipmaps: true,
		});
	const length = NEAR - FAR;
	const middle = (NEAR + FAR) / 2;
	const road = scene.createMesh({
		mesh: geometry.plane({ width: ROAD * 2, height: length }),
		material: materials.standard({
			color: '#1b1d21',
			map: map(shade, 'srgb'),
			metalnessRoughnessMap: map(rough, 'linear'),
			uvTransform: { repeat: [1, length / (ROAD * 2)] },
		}),
		position: [0, 0, middle],
	});
	road.setRotationEuler(-Math.PI / 2, 0, 0);
	const { taxi, beam } = await street(ctx);

	return {
		onUpdate(dt) {
			// The camera walks down the street, swaying a little, its eyes on the far end.
			const walk = 30 - ((time.now * 1.2) % 40);
			if (!view.userCamera) {
				camera.setPosition(Math.sin(time.now * 0.3) * 0.8, 1.7, walk);
				target[2] = walk - 25;
				camera.lookAt(target[0], target[1], target[2]);
			}
			view.update(dt);
			const scripted = ((time.now * SPEED + START) % (NEAR - FAR)) + FAR;
			const z = math.lerp(scripted, view.point[2], view.steering);
			taxi.setPosition(LANE, 0, z);
			beam.setPosition(LANE, 0.9, z + 3.5);
		},
	};
});
