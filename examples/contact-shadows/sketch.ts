// Contact shadows: a stone garden in the low evening sun, all made in code, with raked sand,
// mossy rocks, pebbles, grass and a stone lantern. The cascades give the long shadows, and contact
// shadows give each pebble, blade and stone the dark line where it meets the sand. Every 3 seconds
// they turn off and on again, so the difference shows. The sun swings slowly around the garden, or
// follows the pointer, and the sky's sun goes with it. The garden itself is in garden.ts.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';
import { garden } from './garden';

/** How far contact shadows reach toward the sun, in meters, and the seconds of each half cycle. */
const REACH = 0.4;
const CYCLE = 3;
/** What the camera looks at. */
const TARGET = [0, 0.2, 0] as const;
/** The hour of the light, a low sun before sunset, and the sun's heading around the garden. */
const HOUR = 16.8;
const HEADING = -1.6;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, time } = ctx;
	const day = timeOfDay(HOUR);
	// The sun keeps the hour's height as it turns, so the sky's colors and the light match it.
	const [x, rise, z] = day.sky.sunPosition;
	const reach = Math.hypot(x, z);
	const toSun = (heading: number, out: [number, number, number]) => {
		out[0] = Math.sin(heading) * reach;
		out[1] = rise;
		out[2] = Math.cos(heading) * reach;
		return out;
	};
	const sky = { ...day.sky, sunPosition: toSun(HEADING, [0, 0, 0]), cloudCoverage: 0.4, time: 0 };
	const [background, light] = [{ sky }, { intensity: day.skyIntensity }];
	scene.setBackground(background, light);
	scene.setEnvironment(await assets.skyEnvironment(), light);
	scene.setFog({ ...day.fog, density: 0.012 });
	post.set({
		exposure: day.exposure,
		bloom: { intensity: 0.2, threshold: 1 },
		ao: { radius: 0.4 },
	});
	const camera = scene.createPerspectiveCamera({ fov: 40, near: 0.1, far: 2000 });
	camera.setPosition(3.6, 1.9, 5);
	camera.lookAt(...TARGET);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target: TARGET, groundY: 0, bounds: [-6, 0, -6, 6, 0, 6] });
	const sun = scene.createDirectionalLight({
		...day.light,
		direction: [-sky.sunPosition[0], -rise, -sky.sunPosition[2]],
		castShadows: true,
		shadow: { distance: 30, contactDistance: REACH },
	});
	garden(ctx);

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
			// The sun swings around the garden, or turns toward the pointed point, low in the sky. The
			// sky's sun goes with it, and its clouds drift.
			const swing = HEADING + 0.5 * Math.sin(time.now * 0.15);
			const heading = math.lerp(swing, Math.atan2(view.point[0], view.point[2]), view.steering);
			const to = toSun(heading, sky.sunPosition);
			sun.setDirection(-to[0], -to[1], -to[2]);
			sky.time = time.now;
			scene.setBackground(background, light);
		},
	};
});
