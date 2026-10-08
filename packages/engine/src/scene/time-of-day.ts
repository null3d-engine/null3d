// The time-of-day helper: one hour value, or a named preset, gives the settings that a lit outdoor
// scene changes together through the day. They are the sky's sun and air, the main light (the sun
// by day, the moon by night), the fog's color and glow, an ambient light, the sky's intensity and
// the exposure. The sky's light comes from three.js's sky model, the one that the sky background
// draws, so the fog's color matches the sky's horizon and the ambient light matches the sky's
// average. The helper only works out values: the sketch applies them to its own light, fog and
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
	/** The sky's settings for `scene.setBackground({ sky })`: its sun and its air. */
	sky: {
		sunPosition: [number, number, number];
		turbidity: number;
		rayleigh: number;
		mieCoefficient: number;
		mieDirectionalG: number;
	};
	/**
	 * The factor of the sky's light for the background's and the environment's `intensity`. It
	 * dims the sky after sunset, as the sky model alone keeps a glow.
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
 * How low the sky's own sun sinks, in degrees: at dusk, and once night has fallen. three.js's sky
 * goes dark once its sun is about 2 degrees under the horizon. So at dusk the sky keeps its sun
 * just above that, which keeps the sunset's glow, and `skyIntensity` sets how bright it shows. As
 * night falls the sun sinks past it, and the sky turns an even dark blue.
 */
const DUSK_SUN = -1.2;
const NIGHT_SUN = -3;

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
 * follows this table instead: a deep blue sky at blue hour, and a dim one at night.
 */
const DUSK: readonly (readonly [number, number])[] = [
	[8, 0],
	[0, 0.03],
	[-6, 0.008],
	[-12, 0.0015],
];

/** The sun's light intensity high in a clear sky, in lux of three.js's scale. */
const SUN_INTENSITY = 3.2;
/** The moon's light: its linear color, its intensity, and its lowest elevation in degrees. */
const MOON_COLOR: Vec3 = [0.55, 0.68, 1];
const MOON_INTENSITY = 0.4;
const MOON_FLOOR = 25;

/** The exposure as the sun sinks: sun heights in degrees and exposures, linear between them. */
const EXPOSURE: readonly (readonly [number, number])[] = [
	[15, 1],
	[0, 2],
	[-6, 3],
	[-12, 3.5],
];

/**
 * Works out the settings of a time of day: an hour from 0 to 24, or a named preset. The sun rises
 * at 6, stands highest at 12 and sets at 18. After sunset the sky dims to a deep blue and then to
 * night, and the moon takes over as the main light. Each value comes from three.js's sky model, the
 * one that the sky background draws, so the fog fades into the sky's horizon. Each call returns a
 * new object, so call it when the time changes. Throws a `RangeError` for an hour that is not a
 * finite number, or an unknown preset.
 *
 * ```ts
 * const day = timeOfDay('goldenHour');
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
): TimeOfDay {
	const hours = typeof time === 'number' ? time : PRESET_HOURS[time];
	if (hours === undefined || !Number.isFinite(hours))
		throw new RangeError(
			`timeOfDay() got ${String(time)}, which takes an hour from 0 to 24 or 'afternoon', 'goldenHour', 'blueHour' or 'night'.`,
		);
	const { heading = 0, noonElevation = Math.PI / 3 } = options;
	const hour = ((hours % 24) + 24) % 24;
	// The sun's path: a tilted circle that rises toward +X at 6 and stands toward -Z at noon.
	const angle = ((hour - 6) / 12) * Math.PI;
	const up = Math.sin(angle);
	const sun = turn(
		[Math.cos(angle), up * Math.sin(noonElevation), -up * Math.cos(noonElevation)],
		heading,
	);
	const elevation = Math.asin(sun[1]) / DEGREE;
	const floor = mix(DUSK_SUN, NIGHT_SUN, smoothstep(-6, -12, elevation));
	const skySun = elevation < floor ? atElevation(sun, floor) : sun;
	// Haze and scattering grow toward the horizon, which warms a low sun.
	const air = smoothstep(2, 15, elevation);
	const sky = {
		sunPosition: skySun,
		turbidity: mix(4, 2.5, air),
		rayleigh: mix(2, 1.2, air),
		mieCoefficient: 0.005,
		mieDirectionalG: 0.8,
	};
	const model = skyModel(skySun, sky.turbidity, sky.rayleigh, sky.mieCoefficient);

	// By day the sky keeps the model's own light. From late afternoon it follows the dusk table.
	let skyIntensity = DAY_SKY;
	const [top] = DUSK[0] as readonly [number, number];
	if (elevation < top) {
		const air = { turbidity: sky.turbidity, rayleigh: sky.rayleigh, mie: sky.mieCoefficient };
		const high = skyModel(atElevation(sun, top), air.turbidity, air.rayleigh, air.mie);
		const target = between(DUSK, elevation, DAY_SKY * luminance(high.average()), true);
		skyIntensity = target / Math.max(luminance(model.average()), 1e-9);
	}

	let light: TimeOfDay['light'];
	if (elevation > 0) {
		// The sun's light, reddened by the air it crosses, and fading as it nears the horizon.
		const fex = model.extinction(skySun);
		const peak = Math.max(...fex);
		light = {
			direction: [-sun[0], -sun[1], -sun[2]],
			color: scale(fex, 1 / peak),
			intensity: SUN_INTENSITY * peak * smoothstep(-1, 6, elevation),
		};
	} else {
		// The moon: opposite the sun, never lower than its floor, brightening as the dusk deepens.
		const moon = atElevation([-sun[0], -sun[1], -sun[2]], Math.max(-elevation, MOON_FLOOR));
		light = {
			direction: [-moon[0], -moon[1], -moon[2]],
			color: [...MOON_COLOR],
			intensity: MOON_INTENSITY * smoothstep(0, 6, -elevation),
		};
	}

	// The fog takes the sky's color along the horizon, and turns to its average color at dusk,
	// when only the side of the sunset glows. The ambient light takes the sky's average.
	const dusk = smoothstep(0, -6, elevation);
	const horizon = model.horizon();
	const average = model.average();
	let fogColor = scale(
		[0, 1, 2].map((c) => mix(horizon[c] as number, average[c] as number, dusk)) as Vec3,
		skyIntensity,
	);
	const fogPeak = Math.max(...fogColor);
	if (fogPeak > 1) fogColor = scale(fogColor, 1 / fogPeak);
	// An ambient light of intensity 1 and color L lights a surface as a whole sky of light L / π.
	const ambient = scale(average, skyIntensity);
	const brightest = Math.max(...ambient, 1e-9);
	return {
		hours: hour,
		sky,
		skyIntensity,
		light,
		fog: { color: fogColor, sunGlow: elevation > 0 ? mix(1.5, 0.5, air) : 0.3 },
		ambient: { color: scale(ambient, 1 / brightest), intensity: Math.PI * brightest },
		exposure: between(EXPOSURE, elevation, 1, false),
	};
}

type Vec3 = [number, number, number];

/** `v` turned about +Y by `angle` radians. */
function turn(v: Vec3, angle: number): Vec3 {
	const c = Math.cos(angle);
	const s = Math.sin(angle);
	return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

/** The unit direction with the heading of `v` about +Y and `degrees` of elevation. */
function atElevation(v: Vec3, degrees: number): Vec3 {
	const flat = Math.hypot(v[0], v[2]) || 1;
	const e = degrees * DEGREE;
	return [(Math.cos(e) * v[0]) / flat, Math.sin(e), (Math.cos(e) * v[2]) / flat];
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
	const value = (k: number) => {
		const v = (table[k] as readonly [number, number])[1];
		return k === 0 && v === 0 ? first : v;
	};
	if (x >= (table[0] as readonly [number, number])[0]) return value(0);
	for (let k = 1; k < table.length; k++) {
		const [high] = table[k - 1] as readonly [number, number];
		const [low] = table[k] as readonly [number, number];
		if (x < low) continue;
		const t = (high - x) / (high - low);
		const [a, b] = [value(k - 1), value(k)];
		return log ? Math.exp(mix(Math.log(a), Math.log(b), t)) : mix(a, b, t);
	}
	return value(table.length - 1);
}

function scale(v: Vec3, factor: number): Vec3 {
	return [v[0] * factor, v[1] * factor, v[2] * factor];
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

/** three.js's sky without its clouds, as null3d::atmosphere draws it, with its sun's disc left out. */
interface SkyModel {
	/** The share of each primary that the air passes along a unit direction. */
	extinction(d: Vec3): Vec3;
	/** The sky's light in a unit direction. */
	light(d: Vec3): Vec3;
	/** The sky's light along the horizon, averaged all around. */
	horizon(): Vec3;
	/** The sky's light 35 degrees up, averaged all around: about its average over the sky. */
	average(): Vec3;
}

const TOTAL_RAYLEIGH: Vec3 = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST: Vec3 = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
const CUTOFF_ANGLE = 1.6110731556870734;
/** The directions around the sky that `horizon` and `average` take. */
const AROUND = 8;

/** The sky model of a sun in the unit direction `sun`, with the sky's air. */
function skyModel(sun: Vec3, turbidity: number, rayleigh: number, mie: number): SkyModel {
	const sunE = 1000 * Math.max(0, 1 - Math.exp(-(CUTOFF_ANGLE - Math.acos(sun[1])) / 1.5));
	const lowSun = Math.min(Math.max((1 - sun[1]) ** 5, 0), 1);
	const betaR = scale(TOTAL_RAYLEIGH, rayleigh);
	// Preetham's 0.434 times the 0.2 of three.js's turbidity term.
	const betaM = scale(MIE_CONST, 0.0868 * turbidity * 10e-18 * mie);
	const g = 0.8;
	const extinction = (d: Vec3): Vec3 => {
		const zenith = Math.max(0, d[1]);
		const angle = Math.acos(zenith);
		const inverse = 1 / (zenith + 0.15 * (93.885 - (angle * 180) / Math.PI) ** -1.253);
		const at = (c: number) =>
			Math.exp(-((betaR[c] as number) * 8.4e3 + (betaM[c] as number) * 1.25e3) * inverse);
		return [at(0), at(1), at(2)];
	};
	const light = (d: Vec3): Vec3 => {
		const fex = extinction(d);
		const cos = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
		const rPhase = (3 / (16 * Math.PI)) * (1 + (cos * 0.5 + 0.5) ** 2);
		const base = 1 - 2 * g * cos + g * g;
		const mPhase = (1 / (4 * Math.PI)) * ((1 - g * g) / (base * Math.sqrt(base)));
		const tint: Vec3 = [0, 0.0003, 0.00075];
		const at = (c: number) => {
			const r = betaR[c] as number;
			const m = betaM[c] as number;
			const f = fex[c] as number;
			const scattered = (sunE * (r * rPhase + m * mPhase)) / (r + m);
			const lin = (scattered * (1 - f)) ** 1.5 * mix(1, Math.sqrt(scattered * f), lowSun);
			return (lin + 0.1 * f) * 0.04 + (tint[c] as number);
		};
		return [at(0), at(1), at(2)];
	};
	const around = (degrees: number): Vec3 => {
		const sum: Vec3 = [0, 0, 0];
		for (let k = 0; k < AROUND; k++) {
			const a = (k / AROUND) * 2 * Math.PI;
			const l = light(atElevation([Math.cos(a), 0, Math.sin(a)], degrees));
			for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + (l[c] as number) / AROUND;
		}
		return sum;
	};
	return { extinction, light, horizon: () => around(3), average: () => around(35) };
}
