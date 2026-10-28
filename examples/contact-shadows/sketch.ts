// Contact shadows: a stone garden in the low evening sun, all made in code, with raked sand,
// mossy rocks, pebbles, grass and a stone lantern. The cascades give the long shadows, and contact
// shadows give each pebble, blade and stone the dark line where it meets the sand. Every 3 seconds
// they turn off and on again, so the difference shows. The sun swings slowly around the garden
// until the pointer takes it, and the sky's sun goes with it. The garden itself is in garden.ts.
import { defineSketch, math, timeOfDay, vec3 } from '@null3d/engine';
import { interact } from '../lib/interact';
import { garden } from './garden';

/** How far contact shadows reach toward the sun, in meters, and the seconds of each half cycle. */
const REACH = 0.4;
const CYCLE = 3;
/** What the camera looks at: a stepping stone by a rock, in its drift of pebbles. */
const TARGET = [0.6, 0.1, 1.1] as const;
/** Where the camera stands on a wide screen. */
const EYE = [2.4, 0.75, 3.5] as const;
/** The hour of the light, a low sun before sunset, and the sun's heading around the garden. */
const HOUR = 17.2;
const HEADING = -1.6;
/** How fast the sun turns toward the pointed direction, and the steering that takes it over. */
const TURN = 6;
const STEERED = 0.05;
/** The turn from one heading to another, the short way round, in radians from minus pi to pi. */
const shortest = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

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
	const sky = { ...day.sky, sunPosition: toSun(HEADING, [0, 0, 0]), cloudCoverage: 0.4 };
	const [background, light] = [{ sky }, { intensity: day.skyIntensity }];
	scene.setBackground(background, light);
	scene.setEnvironment(await assets.skyEnvironment(), light);
	// Thin fog with a faint glow, so the pines keep their greens against the low sun.
	scene.setFog({ ...day.fog, density: 0.006, sunGlow: 0.4 });
	post.set({
		exposure: day.exposure,
		bloom: { intensity: 0.2, threshold: 1 },
		ao: { radius: 0.4 },
	});
	// A tall screen sees less of the garden's width, so there the camera stands farther back with
	// a wider view.
	const { width, height } = ctx.engine.viewport;
	const tall = width < height;
	const camera = scene.createPerspectiveCamera({ fov: tall ? 50 : 40, near: 0.1, far: 2000 });
	// There it also looks over the stones, so they sit low and the wall and trees show above.
	const target: readonly [number, number, number] = tall
		? vec3.add(vec3.create(), TARGET, [0, 0.6, 0])
		: TARGET;
	camera.setPosition(...vec3.lerp(vec3.create(), target, EYE, tall ? 1.15 : 1));
	camera.lookAt(...target);
	scene.setActiveCamera(camera);
	const view = interact(ctx, camera, { target, groundY: 0, bounds: [-6, 0, -6, 6, 0, 6] });
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
	// The sun's heading. Until the pointer first moves, it is the scripted swing. After that, the
	// pointer drives it, and it holds where the pointer leaves it, so a still pointer never turns
	// the low sun and never snaps the scene's light.
	let heading = HEADING;
	let steered = false;
	return {
		onUpdate(dt) {
			view.update(dt);
			// Contact shadows on for one half of each cycle, off for the other.
			const half = Math.floor(time.now / CYCLE) % 2;
			if (half !== shown) {
				shown = half;
				sun.setShadow(lit[half]);
			}
			// The sun swings slowly around the garden, until the pointer takes it. The sky's sun goes
			// with it. The sky's environment follows the sky, so the clouds stand still.
			const swing = HEADING + 0.5 * Math.sin(time.now * 0.15);
			if (!steered) heading = swing;
			if (view.steering > STEERED) {
				steered = true;
				const pointed = Math.atan2(view.point[0], view.point[2]);
				// Ease the short way round, so a move across the garden's middle cannot swing the sun
				// the long way about.
				const want = heading + shortest(pointed - heading);
				heading = shortest(math.damp(heading, want, TURN, dt));
			}
			const to = toSun(heading, sky.sunPosition);
			sun.setDirection(-to[0], -to[1], -to[2]);
			scene.setBackground(background, light);
		},
	};
});
