// Atmosphere: a day passes over a valley of ridges in a minute, under the physical sky. The air
// scatters the sun's light by Rayleigh and Mie, so the sky turns from deep blue at noon to gold and
// rose at sunset, and the earth's shadow rises in the east. The same air hazes each ridge by its
// distance, bluer and paler the farther it lies, and warm toward the sun. timeOfDay gives the sun,
// the moon and the stars, and the sky's environment lights the valley and shows in the lake. Pines
// made in code at four levels of detail stand in groves on the valley's floor. At night the moon
// lights the air and the stars come out.
import { defineSketch, math, timeOfDay } from '@null3d/engine';
import { interact } from '../lib/interact';
import { valley } from './valley';

// Seconds per day, the share of the day at time 0, and how much dawn and dusk slow the clock (0
// for an even clock). The slower dusk puts time 0 at about 17:15.
const [DAY, START, LINGER] = [60, 16 / 24, 0.75];
/** The sun's path turned about +Y, so that the evening sun lights the ridges from the right. */
const HEADING = -2.63;
/** Where the camera stands and looks. */
const EYE = [0, 230, 5200] as const;
const TARGET = [0, 300, 0] as const;

/** The hour at a sketch time: the day's share, slowed near 6 and 18 by a sine of twice the day. */
function clock(seconds: number): number {
	const share = math.euclideanModulo(START + seconds / DAY, 1);
	return 24 * (share + (LINGER * Math.sin(4 * Math.PI * share)) / (4 * Math.PI));
}

export default defineSketch(async (ctx) => {
	const { scene, assets, post, time } = ctx;
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

	valley(ctx);

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
