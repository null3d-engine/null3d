// A hero shadow: a launch yard in the low evening sun, with a car on the pad and a few stone
// blocks around it. The sun's cascades hold the blocks' long shadows at a few centimeters per
// texel, while the car's own shadow map fits it tightly and holds its shadow several times finer.
// Every 3 seconds the car's hero shadow turns off and on again, so the difference shows. All of it
// is made in code.
import { defineSketch, type MeshOptions, math, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';

/** The seconds of each half cycle of the hero's shadow turning off and on. */
const CYCLE = 3;
/** The hour of the light, a low sun before sunset, and the sun's heading across the yard. */
const HOUR = 17.3;
const HEADING = -2.1;
/** What the camera looks at, and where it stands on a wide screen. */
const TARGET = [0, 0.6, 0] as const;
const EYE = [4.2, 2.4, 6.4] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, geometry, materials, post, time } = ctx;
	const day = timeOfDay(HOUR);
	const [sx, rise, sz] = day.sky.sunPosition;
	const toSun = (heading: number, out: [number, number, number]) => {
		const reach = Math.hypot(sx, sz);
		out[0] = Math.sin(heading) * reach;
		out[1] = rise;
		out[2] = Math.cos(heading) * reach;
		return out;
	};
	const sky = { ...day.sky, sunPosition: toSun(HEADING, [0, 0, 0]), cloudCoverage: 0.3 };
	const light = { intensity: day.skyIntensity };
	scene.setBackground({ sky }, light);
	scene.setEnvironment(await assets.skyEnvironment(), light);
	scene.setFog({ ...day.fog, density: 0.01, sunGlow: 0.5 });
	post.set({
		exposure: day.exposure,
		bloom: { intensity: 0.15, threshold: 1 },
		ao: { radius: 0.4 },
	});

	// The camera stands a little back and low, so the car's shadow across the pad fills the view.
	const { width, height } = ctx.engine.viewport;
	const tall = width < height;
	const camera = scene.createPerspectiveCamera({ fov: tall ? 50 : 42, near: 0.05, far: 1000 });
	const target: readonly [number, number, number] = tall
		? vec3.add(vec3.create(), TARGET, [0, 0.5, 0])
		: TARGET;
	camera.setPosition(...vec3.lerp(vec3.create(), target, EYE, tall ? 1.2 : 1));
	camera.lookAt(...target);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target, groundY: 0, bounds: [-8, 0, -8, 8, 0, 8] });

	// The sun keeps the hour's height, with its heading across the yard.
	const sun = scene.createDirectionalLight({
		...day.light,
		direction: [-sky.sunPosition[0], -rise, -sky.sunPosition[2]],
		castShadows: true,
		shadow: { distance: 60 },
	});

	const yard = materials.standard({ color: '#9a958c', roughness: 0.85 });
	const paint = materials.standard({ color: '#c8452f', roughness: 0.35, metalness: 0.4 });
	const glass = materials.standard({ color: '#20262e', roughness: 0.1, metalness: 0.6 });
	const stone = materials.standard({ color: '#7d7a72', roughness: 0.9 });
	const shadowed = { castShadows: true, receiveShadows: true };

	// The yard, with a painted line that frames the pad.
	scene.createMesh({
		mesh: geometry.box({ width: 40, height: 0.2, depth: 40 }),
		material: yard,
		position: [0, -0.1, 0],
		receiveShadows: true,
	});
	for (const x of [-3, 3])
		scene.createMesh({
			mesh: geometry.box({ width: 0.12, height: 0.01, depth: 7 }),
			material: materials.standard({ color: '#e8dcc0' }),
			position: [x, 0.002, 0],
			receiveShadows: true,
		});

	// The car: a body, a glass cabin, a roof and four wheels, which cast and receive shadows together.
	const car = scene.createGroup({ position: [0, 0, 0] });
	const on = (options: MeshOptions) => scene.createMesh({ ...options, parent: car, ...shadowed });
	// The hero is the body: a light names an object whose bounds it fits, and a group carries no
	// bounds of its own. The body's sphere is widened to hold the whole car, since the box that the
	// hero's tile fits reaches from it.
	const body = on({
		mesh: geometry.box({ width: 1.8, height: 0.55, depth: 4.1 }),
		material: paint,
		position: [0, 0.62, 0],
	});
	body.setBounds([0, 0.75, 0], 2.2);
	on({
		mesh: geometry.box({ width: 1.5, height: 0.5, depth: 2.1 }),
		material: glass,
		position: [0, 1.15, -0.25],
	});
	on({
		mesh: geometry.box({ width: 1.62, height: 0.1, depth: 2.0 }),
		material: paint,
		position: [0, 1.42, -0.3],
	});
	const rubber = materials.standard({ color: '#1b1b1d', roughness: 0.8 });
	for (const [x, z] of [
		[-0.86, 1.3],
		[0.86, 1.3],
		[-0.86, -1.35],
		[0.86, -1.35],
	]) {
		const wheel = on({
			mesh: geometry.cylinder({
				radiusTop: 0.34,
				radiusBottom: 0.34,
				height: 0.24,
				radialSegments: 24,
			}),
			material: rubber,
			position: [x, 0.34, z],
		});
		// The cylinder stands on its Y axis, so a quarter turn lays it on its side.
		wheel.setRotationEuler(0, 0, Math.PI / 2);
	}

	// Stone blocks around the pad, far enough that the car's tile holds none of them. Their
	// shadows come from the cascades, which the hero's sharp one shows against.
	math.seed(11);
	for (let k = 0; k < 7; k++) {
		const angle = (k / 7) * Math.PI * 2 + 0.4;
		const distance = math.randFloat(5.5, 8);
		const size = math.randFloat(0.6, 1.3);
		const block = scene.createMesh({
			mesh: geometry.box({ width: size, height: size * 1.4, depth: size }),
			material: stone,
			position: [Math.sin(angle) * distance, size * 0.7, Math.cos(angle) * distance],
			...shadowed,
		});
		block.setRotationEuler(0, math.randFloat(0, Math.PI), 0);
	}

	// The hero shadow starts on, so the picture holds with it: the first half of each cycle draws
	// the car's own tile, and the second half turns it back to the cascades.
	let shown = true;
	sun.setShadow({ hero: body });
	return {
		onUpdate(dt) {
			view.update(dt);
			const wanted = Math.floor(time.now / CYCLE) % 2 === 0;
			if (wanted !== shown) {
				shown = wanted;
				sun.setShadow({ hero: wanted ? body : null });
			}
		},
	};
});
