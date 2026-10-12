// Contact shadows: a stone garden at golden hour, all made in code, with raked sand, mossy rocks,
// pebbles, grass and a stone lantern. The cascades give the long shadows, and contact shadows give
// each pebble, blade and stone the dark line where it meets the sand. Every 3 seconds they turn off
// and on again, so the difference shows. The sun swings slowly around the garden, or follows the
// pointer. The garden itself is in garden.ts.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';
import { garden } from './garden';

/** How far contact shadows reach toward the sun, in meters, and the seconds of each half cycle. */
const REACH = 0.4;
const CYCLE = 3;
/** What the camera looks at. */
const TARGET = [0, 0.2, 0] as const;

export default defineSketch(async (ctx) => {
	const { scene, assets, post, time } = ctx;
	const day = timeOfDay('goldenHour', { heading: -0.6 });
	const sky = { ...day.sky, cloudCoverage: 0.4, time: 0 };
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
		castShadows: true,
		shadow: { distance: 30, contactDistance: REACH },
	});
	scene.createAmbientLight(day.ambient);
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
			const swing = -0.6 + 0.5 * Math.sin(time.now * 0.15);
			const heading = math.lerp(swing, Math.atan2(view.point[0], view.point[2]), view.steering);
			const to = sky.sunPosition;
			to[0] = Math.sin(heading) * 0.85;
			to[1] = 0.45;
			to[2] = Math.cos(heading) * 0.85;
			sun.setDirection(-to[0], -to[1], -to[2]);
			sky.time = time.now;
			scene.setBackground(background, light);
		},
	};
});
