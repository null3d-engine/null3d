// The time-of-day helper: one hour value, or a named preset, gives the settings that a lit outdoor
// scene changes together through the day. They are the sky's sun and air, the main light (the sun
// by day, the moon by night), the fog's color and glow, an ambient light, the sky's intensity and
// the exposure. By default the sky's light comes from three.js's sky model, the one that the sky
// background draws, so the fog's color matches the sky's horizon and the ambient light matches the
// sky's average. With the physical model, the values come from a table of the physical sky's light
// (D-143). The helper only works out values: the sketch applies them to its own light, fog and
// post settings (D-118).

/**
 * The named times of `timeOfDay`: `'afternoon'` (15:00), `'goldenHour'` (17:36, the sun 5 degrees
 * up), `'blueHour'` (18:24, the sun 5 degrees down) and `'night'` (23:00, under the moon).
 *
 * @category api/scene
 */
export type TimeOfDayPreset = 'afternoon' | 'goldenHour' | 'blueHour' | 'night';

/**
 * The options of `timeOfDay`. An option left out takes its default.
 *
 * @category api/scene
 */
export interface TimeOfDayOptions {
	/**
	 * The turn of the sun's path about +Y, in radians. At 0 the sun rises toward +X, stands toward
	 * -Z at noon and sets toward -X. The default is 0.
	 */
	heading?: number;
	/**
	 * How high the noon sun stands above the horizon, in radians, from above 0 to π/2. The default
	 * is π/3, 60 degrees.
	 */
	noonElevation?: number;
	/**
	 * The sky that the light, the fog, the ambient light and the exposure match: `'analytic'`,
	 * three.js's sky of `scene.setBackground({ sky })`, or `'physical'`, the physical sky of
	 * `scene.setBackground({ atmosphere })`. The default is `'analytic'`.
	 */
	model?: 'analytic' | 'physical';
}

/**
 * The physical sky's settings that a time of day gives, in the form that `timeOfDay` writes them:
 * a call fills the arrays in place, so they are not read-only.
 *
 * @category api/scene
 */
export interface TimeOfDayAtmosphere {
	/** The sun's place, in a unit direction, as `scene.setBackground({ atmosphere })` takes it. */
	sunPosition: [number, number, number];
	/** The sun's own light, in the units of the physical sky. */
	sunIntensity: number;
	/** The moon's place, opposite the sun and never below the height that lights the sky. */
	moonPosition: [number, number, number];
	/** The moon's light on the air, 0 while the sun is up. */
	moonIntensity: number;
	/** The stars' brightness, rising from 0 as night falls. */
	stars: number;
}

/**
 * The settings of one time of day, which `timeOfDay` works out. Apply them to the sky
 * background, the sky's environment, the main directional light, the fog and the exposure.
 *
 * @category api/scene
 */
export interface TimeOfDay {
	/** The hour, from 0 up to 24. */
	hours: number;
	/**
	 * The sky's settings for `scene.setBackground({ sky })`: its sun and its air. At night the
	 * sky's sun stands at the moon's place, so the sky is lit from there and its disc is the moon.
	 * As night falls the second sky, the moon's, fades in over the sunset's sky; at other times
	 * its weight is 0.
	 */
	sky: {
		sunPosition: [number, number, number];
		turbidity: number;
		rayleigh: number;
		mieCoefficient: number;
		mieDirectionalG: number;
		secondSunPosition: [number, number, number];
		secondSkyWeight: number;
	};
	/**
	 * The physical sky's settings for `scene.setBackground({ atmosphere })`: the real sun and its
	 * light, and at night the moon, which lights the air too, and the stars. Spread it into the
	 * scene's own settings, such as its clouds and `aerialPerspective`.
	 */
	atmosphere: TimeOfDayAtmosphere;
	/**
	 * The factor of the sky's light for the background's and the environment's `intensity`. It
	 * dims the analytic sky after sunset, as its model alone keeps a glow. The physical sky dims by
	 * itself, so with the physical model it is 1.
	 */
	skyIntensity: number;
	/**
	 * The main directional light: the sun while it is up, and the moon at night. `direction`
	 * points from the light into the scene, as `setDirection` takes it. `color` is linear.
	 */
	light: {
		direction: [number, number, number];
		color: [number, number, number];
		intensity: number;
	};
	/**
	 * The fog's linear color, the sky's color along the horizon, and the glow toward the main
	 * light, for `scene.setFog`.
	 */
	fog: { color: [number, number, number]; sunGlow: number };
	/**
	 * A linear ambient color and intensity of the sky's average light, for a scene that has no
	 * environment. A scene lit by the sky's environment needs no ambient light.
	 */
	ambient: { color: [number, number, number]; intensity: number };
	/** The exposure for `post.set({ exposure })`, higher as the light dims. */
	exposure: number;
}

/** The hour of each preset. */
const PRESET_HOURS: Readonly<Record<TimeOfDayPreset, number>> = {
	afternoon: 15,
	goldenHour: 17.6,
	blueHour: 18.4,
	night: 23,
};

const DEGREE = Math.PI / 180;

/**
 * How low the sky's own sun sinks after sunset, in degrees. three.js's sky gives no sun light once
 * its sun is about 2.3 degrees under the horizon, which leaves only a flat grey that the tone curve
 * maps to black. So after sunset the sky keeps its sun just above that, which keeps the sunset's
 * glow, and `skyIntensity` sets how bright it shows.
 */
const DUSK_SUN = -1.2;

/**
 * The sun heights, in degrees, between which night falls. The sunset's sky fades straight into the
 * moon's sky, each scaled to the dusk table, so no frame goes dark and no glow rises at the moon's
 * horizon. The moon's sky is lit as by day from the moon's place and dimmed by `skyIntensity`, the
 * "day for night" sky of film: a navy sky with a lighter horizon, a faint glow around the moon,
 * and the sun's disc drawn as the moon.
 */
const NIGHTFALL = [-6, -12] as const;

/**
 * The sky's intensity by day. three.js's sky is about 5 at the horizon. Lights and fog take
 * colors from 0 to 1, and a sun of about 3. This scale brings the sky to the lights' range, so the
 * fog's color can match the horizon and the sun outshines the sky.
 */
const DAY_SKY = 0.15;
/**
 * The luminance of the sky's average light, after `skyIntensity`, as the sun sinks: sun heights
 * in degrees and luminances. Above the first height the sky keeps the model's own light. three.js's
 * sky dims a hundredfold as its sun reaches the horizon, and goes dark 2 degrees below it, so dusk
 * follows this table instead: a deep blue sky at blue hour, and a dim navy one at night.
 */
const DUSK: readonly (readonly [number, number])[] = [
	[8, 0],
	[0, 0.03],
	[-6, 0.008],
	[-12, 0.003],
];

/** The sun's light intensity high in a clear sky, in lux of three.js's scale. */
const SUN_INTENSITY = 3.2;
/** The moon's light: its linear color, its intensity, and its lowest elevation in degrees. */
const MOON_COLOR: Vec3 = [0.55, 0.68, 1];
const MOON_INTENSITY = 0.4;
/**
 * The moon's lowest height, in degrees. The analytic sky and its main light keep the moon at least
 * this high, so the night sky's horizon does not glow. The physical model's main light instead
 * meets the moon on the horizon (see `physicalDay`), so the two sources never jump apart.
 */
const MOON_FLOOR = 25;
/**
 * The sun heights, in degrees, over which the main light hands over from the sun to the moon: the
 * moon takes no part above the first, and all of it below the second. The sun is down by the first,
 * so the moon never lights the scene while the sun stands up.
 */
const MOON_LIGHT = [-5, -18] as const;
/**
 * The sun heights, in degrees, over which the sun's own light fades after it sets: full at the
 * horizon, and gone below the second. The twilight keeps a low warm light until the moon rises.
 */
const SUN_TWILIGHT = [0, -18] as const;

/** The exposure as the sun sinks: sun heights in degrees and exposures, linear between them. */
const EXPOSURE: readonly (readonly [number, number])[] = [
	[15, 1],
	[0, 2],
	[-6, 3],
	[-12, 3.5],
];

/**
 * Works out the settings of a time of day: an hour from 0 to 24, or a named preset. The sun rises
 * at 6, stands highest at 12 and sets at 18. After sunset the sky dims to a deep blue, and then to
 * a navy night sky lit from the moon's place, and the moon takes over as the main light. Each value
 * comes from three.js's sky model, the one that the sky background draws, so the fog fades into
 * the sky's horizon. Throws a `RangeError` for an hour that is not a finite number, or an unknown
 * preset.
 *
 * Give it `out`, an object of a previous call, and it writes the new settings into that object: a
 * day cycle then allocates nothing, so a sketch can move the time in every frame. `bun run
 * bench:allocation --time-of-day` checks that. Without it the call makes a new object.
 * `emptyTimeOfDay()` makes the first one to pass.
 *
 * ```ts
 * const day = emptyTimeOfDay();
 * timeOfDay('goldenHour', {}, day);
 * scene.setBackground({ sky: day.sky }, { intensity: day.skyIntensity });
 * scene.setEnvironment(skyLight, { intensity: day.skyIntensity });
 * sun.setDirection(...day.light.direction);
 * sun.setColor(day.light.color);
 * sun.setIntensity(day.light.intensity);
 * scene.setFog({ color: day.fog.color, density: 0.01, sunGlow: day.fog.sunGlow });
 * post.set({ exposure: day.exposure });
 * ```
 *
 * @category api/scene
 */
export function timeOfDay(
	time: number | TimeOfDayPreset,
	options: TimeOfDayOptions = {},
	out: TimeOfDay = emptyTimeOfDay(),
): TimeOfDay {
	const hours = typeof time === 'number' ? time : PRESET_HOURS[time];
	if (hours === undefined || !Number.isFinite(hours))
		throw new RangeError(
			`timeOfDay() got ${String(time)}, which takes an hour from 0 to 24 or 'afternoon', 'goldenHour', 'blueHour' or 'night'.`,
		);
	const { heading = 0, noonElevation = Math.PI / 3, model: skyModelName = 'analytic' } = options;
	const hour = ((hours % 24) + 24) % 24;
	// The sun's path: a tilted circle that rises toward +X at 6 and stands toward -Z at noon.
	const angle = ((hour - 6) / 12) * Math.PI;
	const up = Math.sin(angle);
	SUN[0] = Math.cos(angle);
	SUN[1] = up * Math.sin(noonElevation);
	SUN[2] = -up * Math.cos(noonElevation);
	turn(SUN, SUN, heading);
	const elevation = Math.asin(SUN[1]) / DEGREE;
	// The moon: opposite the sun, never lower than its floor.
	scale(OPPOSITE, SUN, -1);
	atElevation(MOON, OPPOSITE, Math.max(-elevation, MOON_FLOOR));
	// After sunset the sky keeps its sun just under the horizon. As night falls the moon's sky
	// fades in over it as a second sky, and once night has fallen the sky's sun is the moon.
	const nightfall = smoothstep(NIGHTFALL[0], NIGHTFALL[1], elevation);
	if (nightfall === 1) copyVec(SKY_SUN, MOON);
	else if (elevation < DUSK_SUN) atElevation(SKY_SUN, SUN, DUSK_SUN);
	else copyVec(SKY_SUN, SUN);
	// Haze and scattering grow as the sky's sun nears the horizon, which warms a low sun. The moon's
	// sky, whose sun stands high, has clear air, and the air clears as it fades in.
	const haze = mix(smoothstep(2, 15, Math.asin(SKY_SUN[1]) / DEGREE), 1, nightfall);
	const sky = out.sky;
	copyVec(sky.sunPosition, SKY_SUN);
	sky.turbidity = mix(4, 2.5, haze);
	sky.rayleigh = mix(2, 1.2, haze);
	sky.mieCoefficient = 0.005;
	sky.mieDirectionalG = 0.8;
	copyVec(sky.secondSunPosition, MOON);
	sky.secondSkyWeight = 0;
	const atmosphere = out.atmosphere;
	copyVec(atmosphere.sunPosition, SUN);
	atmosphere.sunIntensity = SUN_ABOVE_AIR;
	copyVec(atmosphere.moonPosition, MOON);
	atmosphere.moonIntensity = MOON_SKY_LIGHT * nightfall;
	atmosphere.stars = nightfall;
	if (skyModelName === 'physical') return physicalDay(hour, atmosphere, elevation, out);
	fillAir(AIR_DAY, SKY_SUN, sky.turbidity, sky.rayleigh, sky.mieCoefficient);
	const moonSky = nightfall > 0 && nightfall < 1;
	if (moonSky) fillAir(AIR_MOON, MOON, sky.turbidity, sky.rayleigh, sky.mieCoefficient);

	// By day the sky keeps the model's own light. From late afternoon it follows the dusk table.
	// While night falls the two skies share the table's luminance by the nightfall's progress.
	let skyIntensity = DAY_SKY;
	let moonSkyIntensity = 0;
	const [top] = DUSK[0] as readonly [number, number];
	if (elevation < top) {
		atElevation(HIGH_SUN, SUN, top);
		fillAir(AIR_HIGH, HIGH_SUN, sky.turbidity, sky.rayleigh, sky.mieCoefficient);
		airAround(HIGH_AVERAGE, AIR_HIGH, 35, AROUND_DIR, AROUND_LIGHT, FEX);
		const target = between(DUSK, elevation, DAY_SKY * luminance(HIGH_AVERAGE), true);
		const share = moonSky ? nightfall : 0;
		airAround(DAY_AVERAGE, AIR_DAY, 35, AROUND_DIR, AROUND_LIGHT, FEX);
		skyIntensity = ((1 - share) * target) / Math.max(luminance(DAY_AVERAGE), 1e-9);
		if (moonSky) {
			airAround(MOON_SKY_AVERAGE, AIR_MOON, 35, AROUND_DIR, AROUND_LIGHT, FEX);
			moonSkyIntensity = (share * target) / luminance(MOON_SKY_AVERAGE);
			sky.secondSkyWeight = moonSkyIntensity / skyIntensity;
		}
	}

	const light = out.light;
	if (elevation > 0) {
		// The sun's light, reddened by the air it crosses, and fading as it nears the horizon.
		airExtinction(FEX, AIR_DAY, SKY_SUN);
		const peak = Math.max(FEX[0], FEX[1], FEX[2]);
		light.direction[0] = -SUN[0];
		light.direction[1] = -SUN[1];
		light.direction[2] = -SUN[2];
		scale(light.color, FEX, 1 / peak);
		light.intensity = SUN_INTENSITY * peak * smoothstep(-1, 6, elevation);
	} else {
		// The moon, brightening as the dusk deepens.
		light.direction[0] = -MOON[0];
		light.direction[1] = -MOON[1];
		light.direction[2] = -MOON[2];
		copyVec(light.color, MOON_COLOR);
		light.intensity = MOON_INTENSITY * smoothstep(0, 6, -elevation);
	}

	// The fog takes the sky's color along the horizon, and turns to its average color at dusk,
	// when only the side of the sunset glows. The ambient light takes the sky's average.
	const dusk = smoothstep(0, -6, elevation);
	const fogColor = out.fog.color;
	const ambient = out.ambient.color;
	airAround(DAY_AVERAGE, AIR_DAY, 35, AROUND_DIR, AROUND_LIGHT, FEX);
	airAround(DAY_HORIZON, AIR_DAY, 3, AROUND_DIR, AROUND_LIGHT, FEX);
	for (let c = 0; c < 3; c++) {
		fogColor[c] = mix(DAY_HORIZON[c] as number, DAY_AVERAGE[c] as number, dusk) * skyIntensity;
		ambient[c] = (DAY_AVERAGE[c] as number) * skyIntensity;
	}
	if (moonSky) {
		airAround(MOON_SKY_AVERAGE, AIR_MOON, 35, AROUND_DIR, AROUND_LIGHT, FEX);
		airAround(MOON_SKY_HORIZON, AIR_MOON, 3, AROUND_DIR, AROUND_LIGHT, FEX);
		for (let c = 0; c < 3; c++) {
			fogColor[c] =
				(fogColor[c] as number) +
				mix(MOON_SKY_HORIZON[c] as number, MOON_SKY_AVERAGE[c] as number, dusk) * moonSkyIntensity;
			ambient[c] = (ambient[c] as number) + (MOON_SKY_AVERAGE[c] as number) * moonSkyIntensity;
		}
	}
	const fogPeak = Math.max(fogColor[0], fogColor[1], fogColor[2]);
	if (fogPeak > 1) scale(fogColor, fogColor, 1 / fogPeak);
	// An ambient light of intensity 1 and color L lights a surface as a whole sky of light L / π.
	const brightest = Math.max(ambient[0], ambient[1], ambient[2], 1e-9);
	scale(ambient, ambient, 1 / brightest);
	out.hours = hour;
	out.skyIntensity = skyIntensity;
	out.fog.sunGlow = elevation > 0 ? mix(1.5, 0.5, haze) : 0.3;
	out.ambient.intensity = Math.PI * brightest;
	out.exposure = between(EXPOSURE, elevation, 1, false);
	return out;
}

type Vec3 = [number, number, number];

/** Copies a direction or a color into another of the same length. */
function copyVec(out: Vec3, v: Vec3): void {
	for (let c = 0; c < 3; c++) out[c] = v[c] as number;
}

/**
 * The values that `timeOfDay` works in, made once: a day cycle calls it in every frame, and a value
 * made per call would be a garbage collection in every frame. A call fills them in the order that
 * its steps read them, so a step's result is used before the next step that writes the same array.
 */
const SUN: Vec3 = [0, 0, 0];
const MOON: Vec3 = [0, 0, 0];
const SKY_SUN: Vec3 = [0, 0, 0];
const HIGH_SUN: Vec3 = [0, 0, 0];
const FEX: Vec3 = [0, 0, 0];
const AROUND_DIR: Vec3 = [0, 0, 0];
const AROUND_LIGHT: Vec3 = [0, 0, 0];
const HIGH_AVERAGE: Vec3 = [0, 0, 0];
const DAY_AVERAGE: Vec3 = [0, 0, 0];
const DAY_HORIZON: Vec3 = [0, 0, 0];
const MOON_SKY_AVERAGE: Vec3 = [0, 0, 0];
const MOON_SKY_HORIZON: Vec3 = [0, 0, 0];
const MEAN: Vec3 = [0, 0, 0];
const SET_THROUGH: Vec3 = [0, 0, 0];
const SET_MEAN: Vec3 = [0, 0, 0];
const SET_HORIZON: Vec3 = [0, 0, 0];
const MOON_MEAN: Vec3 = [0, 0, 0];
const MOON_HORIZON: Vec3 = [0, 0, 0];
const DAY_MEAN: Vec3 = [0, 0, 0];
const SUN_COLOR: Vec3 = [0, 0, 0];
const SKY_MEAN: Vec3 = [0, 0, 0];
const AMBIENT: Vec3 = [0, 0, 0];
const OPPOSITE: Vec3 = [0, 0, 0];
const JUNK_A: Vec3 = [0, 0, 0];
const JUNK_B: Vec3 = [0, 0, 0];

/** The three airs that one call works with, made once. */
const AIR_DAY: Air = { sun: [0, 0, 0], betaR: [0, 0, 0], betaM: [0, 0, 0], sunE: 0, lowSun: 0 };
const AIR_MOON: Air = { sun: [0, 0, 0], betaR: [0, 0, 0], betaM: [0, 0, 0], sunE: 0, lowSun: 0 };
const AIR_HIGH: Air = { sun: [0, 0, 0], betaR: [0, 0, 0], betaM: [0, 0, 0], sunE: 0, lowSun: 0 };

/**
 * The settings of a time of day with every array empty, for a call that is given no object.
 *
 * @category api/scene
 */
export function emptyTimeOfDay(): TimeOfDay {
	return {
		hours: 0,
		sky: {
			sunPosition: [0, 0, 0],
			turbidity: 0,
			rayleigh: 0,
			mieCoefficient: 0,
			mieDirectionalG: 0,
			secondSunPosition: [0, 0, 0],
			secondSkyWeight: 0,
		},
		atmosphere: {
			sunPosition: [0, 0, 0],
			sunIntensity: 0,
			moonPosition: [0, 0, 0],
			moonIntensity: 0,
			stars: 0,
		},
		skyIntensity: 0,
		light: { direction: [0, 0, 0], color: [0, 0, 0], intensity: 0 },
		fog: { color: [0, 0, 0], sunGlow: 0 },
		ambient: { color: [0, 0, 0], intensity: 0 },
		exposure: 1,
	};
}

/**
 * The sun's light above the physical sky's air. Through the air of a sun 60 degrees up, it gives
 * the main light's intensity by day, 3.2.
 */
const SUN_ABOVE_AIR = 3.6;

/**
 * The lowest height, in degrees, of the physical model's main light. The sun's place sinks below
 * the horizon while its light is still on, so the light is held here as it sets: it sweeps the
 * horizon instead of rising from under the ground.
 */
const LIGHT_FLOOR = 1;

/**
 * The physical sky's light for a light of 1 above the earth's default air, by the light's height
 * in degrees, falling: the share of each primary that reaches the ground from it, the sky's mean
 * light over the whole sphere, and the sky's light 3 degrees up, averaged all around. It comes
 * from the core's model of the physical sky (D-143), the one that draws it.
 */
const PHYSICAL_SKY: readonly (readonly [number, Vec3, Vec3, Vec3])[] = [
	[90, [0.942, 0.8694, 0.7651], [0.05481, 0.0602, 0.07149], [0.05739, 0.08924, 0.1158]],
	[60, [0.9334, 0.8508, 0.7342], [0.04817, 0.05316, 0.06343], [0.0572, 0.08794, 0.1115]],
	[40, [0.9114, 0.8048, 0.6598], [0.0371, 0.04126, 0.04956], [0.05613, 0.08354, 0.1006]],
	[30, [0.8878, 0.7571, 0.5865], [0.02999, 0.03346, 0.04026], [0.05526, 0.07905, 0.09019]],
	[20, [0.8414, 0.668, 0.4601], [0.02207, 0.02454, 0.02927], [0.05449, 0.07167, 0.07358]],
	[15, [0.7974, 0.5899, 0.3609], [0.01781, 0.01958, 0.02292], [0.05379, 0.06546, 0.06084]],
	[10, [0.7185, 0.4638, 0.2251], [0.01327, 0.0141, 0.01586], [0.05129, 0.05496, 0.04314]],
	[6, [0.5959, 0.3034, 0.09522], [0.009301, 0.009196, 0.009614], [0.04539, 0.0403, 0.0244]],
	[3, [0.4208, 0.1411, 0.01863], [0.006084, 0.005313, 0.005226], [0.03588, 0.02432, 0.01081]],
	[1, [0.228, 0.03971, 0.001132], [0.003863, 0.002923, 0.003051], [0.02509, 0.01267, 0.005547]],
	[0, [0.06505, 0.005927, 3.382e-5], [0.002763, 0.001921, 0.002209], [0.01781, 0.007724, 0.004026]],
	[-1, [0, 0, 0], [0.001704, 0.001151, 0.001509], [0.009094, 0.004282, 0.002885]],
	[-2, [0, 0, 0], [0.0009075, 0.000636, 0.000934], [0.004629, 0.002437, 0.001894]],
	[-3, [0, 0, 0], [0.0004261, 0.0002956, 0.0004675], [0.002404, 0.001237, 0.0009745]],
	[-4, [0, 0, 0], [0.0001718, 9.231e-5, 0.0001378], [0.001176, 0.0004513, 0.000264]],
	[-6, [0, 0, 0], [3.511e-5, 2.286e-5, 4.965e-5], [0.000332, 0.0001357, 0.0001316]],
	[-8, [0, 0, 0], [1.091e-5, 9.469e-6, 2.609e-5], [0.000104, 5.607e-5, 7.604e-5]],
	[-10, [0, 0, 0], [3.789e-6, 3.686e-6, 1.094e-5], [3.188e-5, 2.063e-5, 3.195e-5]],
	[-12, [0, 0, 0], [1.172e-7, 7.163e-8, 1.009e-7], [2.906e-6, 1.296e-6, 7.902e-7]],
	[-15, [0, 0, 0], [4.239e-9, 2.605e-9, 7.177e-9], [7.996e-8, 3.029e-8, 2.33e-8]],
	[-18, [0, 0, 0], [1.353e-9, 8.175e-10, 2.312e-9], [6.9e-9, 3.564e-9, 4.966e-9]],
];

/**
 * The moon's light above the physical sky's air. It lights the night sky to about the analytic
 * night sky's navy blue at the night exposure.
 */
const MOON_SKY_LIGHT = 0.12;
/**
 * The moon's lowest height, in degrees, for the physical ambient light and fog. A moon near the
 * horizon lights little, so the twilight's fill is kept at the light of a moon this high instead of
 * falling away before the moon rises.
 */
const MOON_SKY_FLOOR = 40;
/**
 * The sun height, in degrees, at which the sun's own sky light stops falling as it sets. The
 * physical sky's mean drops away fast below the horizon, so its light is held here and then hands
 * over to the moon's, which keeps the twilight's fill from going out between the two skies.
 */
const SUN_SKY_HOLD = 5;
/** The highest exposure of the physical model, at the darkest dusk before the moon's sky. */
const PHYSICAL_EXPOSURE_LIMIT = 4;
/**
 * How far the physical model's exposure makes up for the sun's sky dimming: 1 would show every sky
 * at the same brightness, as an eye that adapts fully. Less keeps dusk darker than day. At 0.6 the
 * day's brighter physical sky is brought down to the analytic model's, so the day keeps contrast,
 * and the sun on the horizon gives about 3, as the analytic model's EXPOSURE table does.
 */
const PHYSICAL_ADAPTATION = 0.6;
/** The physical model's moon light, below the analytic model's 0.4: the physical night is brighter otherwise. */
const PHYSICAL_MOON = 0.3;
/**
 * The moon height, in degrees, over which the physical exposure moves from the dusk's to the
 * night's. It holds the dusk's exposure while the moon is low, so the light does not dip before the
 * moon has risen to light the scene.
 */
const MOON_EXPOSURE_RISE = 58;
/**
 * The physical model's exposure once night has fallen. It is below the analytic model's 3.5: the
 * physical night sky is brighter, and the moon's own light rises through the night, so a lower
 * exposure keeps dusk at or above the night.
 */
const NIGHT_EXPOSURE = 1.1;

/** The physical table's light at a light's height in `degrees`, into `through`, `mean` and `horizon`. */
function physicalAt(through: Vec3, mean: Vec3, horizon: Vec3, degrees: number): void {
	const rows = PHYSICAL_SKY;
	const first = rows[0] as (typeof rows)[number];
	const last = rows[rows.length - 1] as (typeof rows)[number];
	if (degrees >= first[0]) {
		copyVec(through, first[1]);
		copyVec(mean, first[2]);
		copyVec(horizon, first[3]);
		return;
	}
	if (degrees <= last[0]) {
		copyVec(through, last[1]);
		copyVec(mean, last[2]);
		copyVec(horizon, last[3]);
		return;
	}
	for (let k = 1; k < rows.length; k++) {
		const low = rows[k] as (typeof rows)[number];
		if (degrees < low[0]) continue;
		const high = rows[k - 1] as (typeof rows)[number];
		const t = (high[0] - degrees) / (high[0] - low[0]);
		for (let c = 0; c < 3; c++) {
			through[c] = mix(high[1][c] as number, low[1][c] as number, t);
			// The light spans many powers of ten through dusk, so it blends in log space.
			mean[c] = Math.exp(
				mix(Math.log((high[2][c] as number) + 1e-12), Math.log((low[2][c] as number) + 1e-12), t),
			);
			horizon[c] = Math.exp(
				mix(Math.log((high[3][c] as number) + 1e-12), Math.log((low[3][c] as number) + 1e-12), t),
			);
		}
		return;
	}
	copyVec(through, last[1]);
	copyVec(mean, last[2]);
	copyVec(horizon, last[3]);
}

/**
 * The settings of a time of day with the physical model: the main light through the physical air,
 * the fog and the ambient light of its sky, and an exposure that follows the sky's mean light, as
 * an eye adapts.
 */
function physicalDay(
	hours: number,
	atmosphere: TimeOfDay['atmosphere'],
	elevation: number,
	out: TimeOfDay,
): TimeOfDay {
	const sun = atmosphere.sunPosition;
	physicalAt(JUNK_A, MEAN, JUNK_B, elevation);
	// The main light meets the moon on the horizon as the sun sets, and the moon rises as the night
	// deepens, so no light jumps to a moon already high. The physical sky shows the same moon.
	const moonHeight = Math.max(-elevation, 0);
	scale(OPPOSITE, sun, -1);
	atElevation(atmosphere.moonPosition, OPPOSITE, moonHeight);
	const sunLight = atmosphere.sunIntensity;
	// The main light is the sun while it stands up, and the moon as night falls. The sun's own
	// light fades over the twilight once it sets, and the moon's rises over the same stretch. The
	// two stand opposite, so the direction sweeps about the horizon and its height passes between
	// them, and neither the direction nor the light jumps or falls to zero.
	const handover = 1 - smoothstep(MOON_LIGHT[1], MOON_LIGHT[0], elevation);
	physicalAt(SET_THROUGH, JUNK_A, JUNK_B, Math.max(elevation, 0));
	const sunPeak = Math.max(SET_THROUGH[0], SET_THROUGH[1], SET_THROUGH[2]);
	const sunIntensity = sunLight * sunPeak * smoothstep(SUN_TWILIGHT[1], SUN_TWILIGHT[0], elevation);
	const moonIntensity = PHYSICAL_MOON * handover;
	scale(SUN_COLOR, SET_THROUGH, 1 / Math.max(sunPeak, 1e-9));
	const bearing = Math.atan2(sun[2] as number, sun[0] as number) + Math.PI * handover;
	// The main light's height, which the sun's own place and the moon's blend between. The sun's
	// own place is held just above the horizon once it sinks to it, so the light grazes the ground
	// instead of shining up from under it through the handover.
	const sunHeight = Math.max(elevation, LIGHT_FLOOR) * DEGREE;
	const height = mix(sunHeight, moonHeight * DEGREE, handover);
	const across = Math.cos(height);
	const light = out.light;
	light.direction[0] = -across * Math.cos(bearing);
	light.direction[1] = -Math.sin(height);
	light.direction[2] = -across * Math.sin(bearing);
	for (let c = 0; c < 3; c++)
		light.color[c] = mix(SUN_COLOR[c] as number, MOON_COLOR[c] as number, handover);
	light.intensity = sunIntensity + moonIntensity;
	physicalAt(JUNK_A, SET_MEAN, SET_HORIZON, Math.max(elevation, SUN_SKY_HOLD));
	physicalAt(JUNK_A, MOON_MEAN, MOON_HORIZON, Math.max(moonHeight, MOON_SKY_FLOOR));
	// The sky's horizon and mean light, where the sun's sky cross-fades to the moon's night sky, so
	// the twilight's fill does not fall away between the two.
	const sunShare = sunLight * (1 - handover);
	const moonShare = MOON_SKY_LIGHT * handover;
	// By day the fog takes the sky's light along the horizon. As the sun drops, only its own side of
	// the sky glows, and a fog of that glow hides the shaded ground, so the fog turns to the sky's
	// mean light, as the analytic model's does. It turns over the last degrees of the sun's height,
	// where the exposure rises fastest, so no evening hour carries a brighter fog than the sky.
	const dusk = smoothstep(5, -5, elevation);
	const fogColor = out.fog.color;
	for (let c = 0; c < 3; c++)
		fogColor[c] = mix(SET_HORIZON[c] as number, SET_MEAN[c] as number, dusk) * sunShare;
	add(fogColor, fogColor, scale(MOON_HORIZON, MOON_HORIZON, moonShare));
	const fogPeak = Math.max(fogColor[0], fogColor[1], fogColor[2]);
	if (fogPeak > 1) scale(fogColor, fogColor, 1 / fogPeak);
	// The mean over the sphere takes the dark ground below the horizon, so the sky above holds
	// about twice it. An ambient light of intensity 1 and color L lights as a whole sky of L / π.
	scale(SKY_MEAN, SET_MEAN, sunShare);
	add(SKY_MEAN, SKY_MEAN, scale(MOON_MEAN, MOON_MEAN, moonShare));
	scale(AMBIENT, SKY_MEAN, 2);
	const brightest = Math.max(AMBIENT[0], AMBIENT[1], AMBIENT[2], 1e-9);
	// The exposure makes up for the sun's sky as it dims, as an eye adapts, then moves to the night
	// exposure as the moon rises. It holds the dusk's exposure while the moon is low, so the key
	// it cannot yet give is not paid for with a dark moment before the moon is up.
	physicalAt(JUNK_A, DAY_MEAN, JUNK_B, 15);
	const ratio = luminance(DAY_MEAN) / Math.max(luminance(MEAN), 1e-12);
	const adapted = Math.min(ratio ** PHYSICAL_ADAPTATION, PHYSICAL_EXPOSURE_LIMIT);
	const nightShare = smoothstep(0, MOON_EXPOSURE_RISE, moonHeight);
	const exposure = Math.exp(mix(Math.log(adapted), Math.log(NIGHT_EXPOSURE), nightShare));
	scale(out.ambient.color, AMBIENT, 1 / brightest);
	out.hours = hours;
	out.skyIntensity = 1;
	out.fog.sunGlow = 0;
	out.ambient.intensity = Math.PI * brightest;
	out.exposure = exposure;
	return out;
}

/** `v` turned about +Y by `angle` radians, into `out`. `out` may be `v`. */
function turn(out: Vec3, v: Vec3, angle: number): Vec3 {
	const x = v[0];
	const z = v[2];
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	out[0] = c * x + s * z;
	out[1] = v[1];
	out[2] = -s * x + c * z;
	return out;
}

/** The unit direction with the heading of `v` about +Y and `degrees` of elevation, into `out`. */
function atElevation(out: Vec3, v: Vec3, degrees: number): Vec3 {
	const x = v[0];
	const z = v[2];
	const flat = Math.hypot(x, z) || 1;
	const e = degrees * DEGREE;
	out[0] = (Math.cos(e) * x) / flat;
	out[1] = Math.sin(e);
	out[2] = (Math.cos(e) * z) / flat;
	return out;
}

/**
 * The value of `table` at sun height `x`, from its pairs of heights, falling, and values, between
 * them in log space or linearly. Above the first height it gives the first pair's value, or `first`
 * where that is 0, which also stands for the first value between the first two heights.
 */
function between(
	table: readonly (readonly [number, number])[],
	x: number,
	first: number,
	log: boolean,
): number {
	// A value read here and not through a helper: a day cycle calls this in every frame, and a
	// closure made per call is an object of its own.
	const first0 = (table[0] as readonly [number, number])[1];
	if (x >= (table[0] as readonly [number, number])[0]) return first0 === 0 ? first : first0;
	for (let k = 1; k < table.length; k++) {
		const high = (table[k - 1] as readonly [number, number])[0];
		const low = (table[k] as readonly [number, number])[0];
		if (x < low) continue;
		const t = (high - x) / (high - low);
		const a =
			k === 1 && (table[0] as readonly [number, number])[1] === 0
				? first
				: (table[k - 1] as readonly [number, number])[1];
		const b = (table[k] as readonly [number, number])[1];
		return log ? Math.exp(mix(Math.log(a), Math.log(b), t)) : mix(a, b, t);
	}
	const last = (table[table.length - 1] as readonly [number, number])[1];
	return table.length === 1 && last === 0 ? first : last;
}

/** `v` scaled by `factor`, into `out`. `out` may be `v`. */
function scale(out: Vec3, v: Vec3, factor: number): Vec3 {
	for (let c = 0; c < 3; c++) out[c] = (v[c] as number) * factor;
	return out;
}

/** The sum of `a` and `b`, into `out`. `out` may be `a` or `b`. */
function add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
	for (let c = 0; c < 3; c++) out[c] = (a[c] as number) + (b[c] as number);
	return out;
}

function luminance(v: Vec3): number {
	return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function mix(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
	return t * t * (3 - 2 * t);
}

const TOTAL_RAYLEIGH: Vec3 = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST: Vec3 = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF_ANGLE = 1.6110731556870734;
/** The directions around the sky that the horizon and the average take. */
const AROUND = 8;
/** The sky model's own tint, which its sun's disc leaves out. */
const TINT: Vec3 = [0, 0.0003, 0.00075];
/** The air's asymmetry, as three.js's sky takes it. */
const G = 0.8;

/**
 * One air of the sky model, three.js's sky without its clouds, as null3d::atmosphere draws it with
 * its sun's disc left out: the sun's direction and the heights that scale its light, and the air's
 * Rayleigh and Mie coefficients. Its values live in arrays made once, because a day cycle calls
 * `timeOfDay` in every frame.
 */
interface Air {
	/** The model's sun, in a unit direction. */
	readonly sun: Vec3;
	readonly betaR: Vec3;
	readonly betaM: Vec3;
	/** The sun's light before the air, and how near the horizon it stands. */
	sunE: number;
	lowSun: number;
}

/** Fills `air` with the sky model's values for a sun in the unit direction `sun`. */
function fillAir(air: Air, sun: Vec3, turbidity: number, rayleigh: number, mie: number): void {
	air.sunE = 1000 * Math.max(0, 1 - Math.exp(-(CUTOFF_ANGLE - Math.acos(sun[1])) / 1.5));
	air.lowSun = Math.min(Math.max((1 - sun[1]) ** 5, 0), 1);
	// Preetham's 0.434 times the 0.2 of three.js's turbidity term.
	const mieFactor = 0.0868 * turbidity * 10e-18 * mie;
	for (let c = 0; c < 3; c++) {
		air.sun[c] = sun[c] as number;
		air.betaR[c] = (TOTAL_RAYLEIGH[c] as number) * rayleigh;
		air.betaM[c] = (MIE_CONST[c] as number) * mieFactor;
	}
}

/** The share of each primary that `air` passes along the unit direction `d`, into `out`. */
function airExtinction(out: Vec3, air: Air, d: Vec3): void {
	const zenith = Math.max(0, d[1] as number);
	const angle = Math.acos(zenith);
	const inverse = 1 / (zenith + 0.15 * (93.885 - (angle * 180) / Math.PI) ** -1.253);
	for (let c = 0; c < 3; c++)
		out[c] = Math.exp(
			-(((air.betaR[c] as number) * 8.4e3 + (air.betaM[c] as number) * 1.25e3) * inverse),
		);
}

/** The sky's light in the unit direction `d`, into `out`. `scratch` holds the air's share of it. */
function airLight(out: Vec3, air: Air, d: Vec3, scratch: Vec3): void {
	airExtinction(scratch, air, d);
	const sun = air.sun;
	const cos =
		(d[0] as number) * (sun[0] as number) +
		(d[1] as number) * (sun[1] as number) +
		(d[2] as number) * (sun[2] as number);
	const rPhase = (3 / (16 * Math.PI)) * (1 + (cos * 0.5 + 0.5) ** 2);
	const base = 1 - 2 * G * cos + G * G;
	const mPhase = (1 / (4 * Math.PI)) * ((1 - G * G) / (base * Math.sqrt(base)));
	for (let c = 0; c < 3; c++) {
		const r = air.betaR[c] as number;
		const m = air.betaM[c] as number;
		const f = scratch[c] as number;
		const scattered = (air.sunE * (r * rPhase + m * mPhase)) / (r + m);
		const lin = (scattered * (1 - f)) ** 1.5 * mix(1, Math.sqrt(scattered * f), air.lowSun);
		out[c] = (lin + 0.1 * f) * 0.04 + (TINT[c] as number);
	}
}

/**
 * The sky's light `degrees` up, averaged all around the horizon, into `out`. `scratch` holds the
 * direction it reads and the light in it, and must not be `out`.
 */
function airAround(
	out: Vec3,
	air: Air,
	degrees: number,
	direction: Vec3,
	light: Vec3,
	fex: Vec3,
): void {
	for (let c = 0; c < 3; c++) out[c] = 0;
	for (let k = 0; k < AROUND; k++) {
		const a = (k / AROUND) * 2 * Math.PI;
		direction[0] = Math.cos(a);
		direction[1] = 0;
		direction[2] = Math.sin(a);
		atElevation(direction, direction, degrees);
		airLight(light, air, direction, fex);
		for (let c = 0; c < 3; c++) out[c] = (out[c] as number) + (light[c] as number) / AROUND;
	}
}
