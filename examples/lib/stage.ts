// The stage of the showcase scenes: the times of day under the physical sky, an Auto mode that moves
// the sun and the moon across the sky, and a studio. Each outdoor hour takes its sun or moon, sky,
// fog and exposure from `timeOfDay`, with the physical model, so the real sun disc lights the scene
// by day and the moon disc at night. The sky's own environment lights the scene, so reflections
// match the sky. A mood is a target: every value eases toward it over a fraction of a second, so a
// change of mood glides and Auto's sun and moon move continuously. A scene gives the turn of the
// sun's path and the density of its fog.
//
// The stage also holds the switches of the sky, the fog and the environment light. It writes the
// look every frame, so a part that the HUD turns off stays off only when the stage itself leaves it
// out: a scene turns a part off through the stage, never with its own call to the scene.
import {
	type DirectionalLight,
	type Environment,
	type SketchContext,
	timeOfDay,
} from '@null3d/engine';

/** The moods, as the HUD names them. `Auto` eases through the hours and loops. */
export const MOODS = [
	'Auto',
	'Dawn',
	'Morning',
	'Midday',
	'Afternoon',
	'Golden',
	'Dusk',
	'Night',
	'Studio',
] as const;
export type Mood = (typeof MOODS)[number];

/** A fixed outdoor mood: one with an hour of its own. */
export type FixedMood = Exclude<Mood, 'Auto' | 'Studio'>;

/** The hour of each fixed outdoor mood. Auto moves the hour itself. */
export const HOURS: Record<FixedMood, number> = {
	Dawn: 6.2,
	Morning: 9,
	Midday: 12,
	Afternoon: 15,
	Golden: 17.6,
	Dusk: 18.4,
	Night: 23,
};

/** The parts of the look that the HUD turns on and off. The environment light needs the sky too. */
export type StagePart = 'sky' | 'fog' | 'environment';

/**
 * The fixed mood whose hour is nearest to `hours`, around the clock: the mood the stage names while
 * the slider holds an hour. A scene's look blends between moods instead, through `moodMix`.
 */
export function nearestMood(hours: number): FixedMood {
	let best: FixedMood = 'Afternoon';
	let gap = Infinity;
	for (const [mood, at] of Object.entries(HOURS) as [FixedMood, number][]) {
		const around = Math.min(Math.abs(hours - at), 24 - Math.abs(hours - at));
		if (around < gap) {
			gap = around;
			best = mood;
		}
	}
	return best;
}

/** Two moods and how far a look has gone from the first to the second, from 0 to 1. */
export interface MoodMix {
	from: Mood;
	to: Mood;
	share: number;
}

/** How far under the horizon the sun stands, in degrees, once its light has left the sky. */
const NIGHT_DEPTH = 18;

/** The hour between `from` and `to` at which the sun sinks or rises past the night's depth. */
function nightEdge(from: number, to: number): number {
	const limit = Math.sin((-NIGHT_DEPTH * Math.PI) / 180);
	const dark = (hours: number) =>
		(timeOfDay(hours, { model: 'physical' }).atmosphere.sunPosition[1] as number) < limit;
	const darkFirst = dark(from);
	let a = from;
	let b = to;
	for (let k = 0; k < 30; k++) {
		const middle = (a + b) / 2;
		if (dark(middle) === darkFirst) a = middle;
		else b = middle;
	}
	return (a + b) / 2;
}

/** The hours at which the night begins, after dusk, and ends, before dawn. */
const NIGHT = { start: nightEdge(HOURS.Dusk, 24), end: nightEdge(0, HOURS.Dawn) };
/** The fixed moods of the lit hours, in the order of their hours. */
const LIT_MOODS = (Object.entries(HOURS) as [FixedMood, number][])
	.filter(([mood]) => mood !== 'Night')
	.sort((a, b) => a[1] - b[1]);

/**
 * The look of an hour, as two fixed moods and the share of the second, written into `out`. The look
 * follows the sky's light rather than the clock. Through the dark hours it holds Night, and only
 * while the sky has light does it move from each mood to the next. So the dawn's look comes in
 * through the morning twilight and is whole at Dawn's hour, and the night's comes in as the dusk
 * deepens. No hour switches a look at once.
 */
export function moodMix(hours: number, out: MoodMix = { from: 'Night', to: 'Night', share: 0 }) {
	const h = ((hours % 24) + 24) % 24;
	out.from = 'Night';
	out.to = 'Night';
	out.share = 0;
	if (h >= NIGHT.start || h <= NIGHT.end) return out;
	let at = NIGHT.end;
	for (const [mood, hour] of LIT_MOODS) {
		if (h < hour) {
			out.to = mood;
			out.share = smoothstep(at, hour, h);
			return out;
		}
		out.from = mood;
		at = hour;
	}
	out.share = smoothstep(at, NIGHT.start, h);
	return out;
}

/** The share of `mood` in a mix, from 0 to 1. */
export function moodShare(mix: MoodMix, mood: Mood): number {
	return (mix.from === mood ? 1 - mix.share : 0) + (mix.to === mood ? mix.share : 0);
}

/** The studio's key light, from the front left and high. */
const STUDIO_KEY = [0.45, -0.75, -0.5] as const;
/** The studio's fog: a near-black haze, in linear RGB. */
const STUDIO_FOG = [0.05, 0.05, 0.055] as const;
/** How thick the studio's fog is. */
const STUDIO_FOG_DENSITY = 0.012;
/** How many minutes a whole day takes in Auto, unless a scene says otherwise: 80 seconds. */
const MINUTES_PER_DAY = 4 / 3;
/** Seconds for a value to settle most of the way to its target: a fast, smooth ease. */
const EASE = 0.14;
/** How close a value must be to its target before the look counts as settled, in size. */
const STILL = 1e-4;
/** The sun's height, as the sine of its elevation, above which a town's lamps are out. */
const LAMPS_OUT = 0.26;
/** The sun's height below which a town's lamps are at full power. */
const LAMPS_FULL = -0.42;
/** The share of a town's lamps' light at the moment the sun crosses the horizon. */
const LAMPS_DUSK = 0.32;
/** How far the exposure opens up for a sun near the horizon, such as at dawn and golden hour. */
const LOW_SUN_OPEN = 0.5;

/** The value a share `t` of the way from `a` to `b`. */
function blend(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

/** Rises from 0 at `a` to 1 at `b`, smoothly, for either order of `a` and `b`. */
function smoothstep(a: number, b: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

/**
 * The share of a town's own lights at a sun height, as the sine of the sun's elevation: off while the
 * sun stands high, a little as it sinks below the horizon, and all once the moon has the sky.
 */
export function lampShare(sunHeight: number): number {
	if (sunHeight >= LAMPS_OUT) return 0;
	if (sunHeight >= 0) return LAMPS_DUSK * smoothstep(LAMPS_OUT, 0, sunHeight);
	return LAMPS_DUSK + (1 - LAMPS_DUSK) * smoothstep(0, LAMPS_FULL, sunHeight);
}

/** True when two vectors match to within a step nothing can see. */
function near(a: Vec3, b: Vec3): boolean {
	for (let k = 0; k < 3; k++)
		if (Math.abs((a[k] as number) - (b[k] as number)) > STILL) return false;
	return true;
}

/** A scene's settings of its stage. */
export interface StageOptions {
	/** The turn of the sun's path about +Y, in radians, as `timeOfDay` takes it. */
	heading: number;
	/** The density of the outdoor fog. */
	fogDensity: number;
	/** The share of the sky that clouds cover, from 0 to 1. */
	cloudCoverage: number;
	/** A factor of the fog's density in some moods, such as a haze at golden hour. */
	haze?: Partial<Record<FixedMood, number>>;
	/** The minutes a whole day takes in Auto. The default is 4/3, a day in 80 seconds. */
	minutesPerDay?: number;
	/** The plain background color, in linear RGB, that shows while the sky is off. */
	backdrop: readonly [number, number, number];
}

/** The stage of a showcase scene: the mood, the Auto driver, and what its values ease toward. */
export interface Stage {
	/** Sets the target: a fixed time, the studio, or Auto, which moves the sun and the moon. */
	set(mood: Mood): void;
	/** Holds any hour of the day, from 0 up to 24, as the slider does. Auto stops. */
	setHour(hours: number): void;
	/** The mood now. */
	readonly mood: Mood;
	/** True while Auto moves the hour. */
	readonly auto: boolean;
	/** The hour now, from 0 up to 24. */
	readonly hours: number;
	/**
	 * The share of a town's own lights, from 0 by day to 1 at night. The studio lights them fully.
	 */
	readonly lamps: number;
	/**
	 * The linear color of the air at the horizon now, which the fog takes: a scene's own haze takes
	 * it too, so it matches the sky.
	 */
	readonly airColor: readonly [number, number, number];
	/**
	 * The main light now: the unit direction toward it, and its linear color times its intensity. A
	 * scene's own haze glows toward it. The studio's key is not the sun, so it gives none.
	 */
	readonly light: {
		readonly toward: readonly [number, number, number];
		readonly color: readonly [number, number, number];
	};
	/** Eases toward the target and applies it. Call once per frame with the frame's step. */
	update(dt: number): void;
	/** Turns a part of the look on or off; every part starts on. It stays so in every later mood. */
	show(part: StagePart, on: boolean): void;
}

/** True for a mood name. */
export const isMood = (name: unknown): name is Mood => MOODS.includes(name as Mood);

type Vec3 = [number, number, number];

/** Sets the scene's light, sky, fog and exposure, eased from one mood to the next. */
export function createMoods(
	ctx: SketchContext,
	sun: DirectionalLight,
	sky: Environment,
	room: Environment,
	options: StageOptions,
): Stage {
	const { scene, post, time } = ctx;
	const { heading, fogDensity, cloudCoverage, backdrop, haze = {} } = options;
	const perDay = options.minutesPerDay ?? MINUTES_PER_DAY;
	/** The values in use, which ease toward the target's. */
	const current = {
		dir: [0, -1, 0] as Vec3,
		color: [0, 0, 0] as Vec3,
		intensity: 0,
		skyIntensity: 1,
		fog: [0, 0, 0] as Vec3,
		density: fogDensity,
		glow: 0,
		exposure: 1,
		sunPosition: [0, 0, -1] as Vec3,
		moonPosition: [0, 1, 0] as Vec3,
		sunLight: 0,
		moonLight: 0,
		stars: 0,
		clouds: cloudCoverage,
		lamps: 0,
	};
	const target = structuredClone(current);
	/** The main light that `light` gives, written in place. */
	const shining = { toward: [0, 1, 0] as Vec3, color: [0, 0, 0] as Vec3 };
	/** The two moods whose looks the target's hour lies between, written in place. */
	const mix = moodMix(HOURS.Afternoon);
	/**
	 * The exposure that midday asks for. The daylight hours hold it, so the sun's own height sets how
	 * bright the picture reads; the physical model's own exposure would even every hour out instead.
	 */
	const noonExposure = timeOfDay(12, { heading, model: 'physical' }).exposure;
	const clouds = { cloudCoverage, time: 0 };
	let mood: Mood = 'Afternoon';
	let wasAuto = false;
	let autoHours = HOURS.Afternoon;
	/** The hour that the slider holds, or null while a mood or Auto drives the hour. */
	let manualHours: number | null = null;
	/** True once the first target is in use, so the first frame does not fade in from nothing. */
	let started = false;
	/** The hours that the target was made for, so a fixed mood computes it once. */
	let targetHours = Number.NaN;
	/** The parts of the look that are on. A part that is off is written once, when it turns off. */
	const shown: Record<StagePart, boolean> = { sky: true, fog: true, environment: true };
	/** True while the scene takes its environment light from the background. */
	const lit = () => shown.sky && shown.environment;
	/**
	 * The settings that the look is written through: one object per call, written in place. The
	 * engine reads each call's values as it takes them, so a stage that builds fresh objects every
	 * frame pays for nothing.
	 */
	const look = {
		background: {
			atmosphere: {
				sunPosition: current.sunPosition,
				sunIntensity: 0,
				moonPosition: current.moonPosition,
				moonIntensity: 0,
				stars: 0,
				cloudCoverage: 0,
				time: 0,
			},
		},
		backgroundOptions: { intensity: 1 },
		roomOptions: { blur: 0.7, intensity: 0.18 },
		environment: { intensity: 1 },
		fog: { color: [0, 0, 0] as Vec3, density: fogDensity, sunGlow: 0 },
		post: { exposure: 1 },
	};
	/** False while any value still eases toward its target, so the frame writes the look again. */
	let still = false;
	/**
	 * True when the scene needs the whole look written once, whatever the eased values say. A new
	 * mood asks for it: the studio writes the scene itself, so the eased values may already sit on
	 * their target while the scene holds the studio's look.
	 */
	let needsLook = false;

	/** Works out the target from an hour, with the physical sky. */
	const aimAt = (hours: number): void => {
		const day = timeOfDay(hours, { heading, model: 'physical' });
		// The target's own arrays are written, never replaced: Auto aims again every frame.
		for (let k = 0; k < 3; k++) {
			target.dir[k] = day.light.direction[k] as number;
			target.color[k] = day.light.color[k] as number;
			target.fog[k] = day.fog.color[k] as number;
			target.sunPosition[k] = day.atmosphere.sunPosition[k] as number;
			target.moonPosition[k] = day.atmosphere.moonPosition[k] as number;
		}
		target.intensity = day.light.intensity;
		target.skyIntensity = day.skyIntensity;
		// The fog's factor follows the look of the hour, so it moves between moods with the light.
		moodMix(hours, mix);
		const factor = (mood: Mood) => haze[mood as FixedMood] ?? 1;
		target.density = fogDensity * blend(factor(mix.from), factor(mix.to), mix.share);
		target.glow = day.fog.sunGlow;
		// The exposure holds the one that midday asks for while the sun is up, so the day's own light
		// makes midday the brightest hour. It opens up a little as the sun nears the horizon, where a
		// camera would, and rises to the physical night exposure as the sun sinks, which lights the
		// moonlit scene without brightening the dusk.
		const sunHeight = day.atmosphere.sunPosition[1] as number;
		const lowSun = smoothstep(0.45, 0.08, sunHeight) * smoothstep(-0.08, 0.02, sunHeight);
		const daylight = noonExposure * (1 + LOW_SUN_OPEN * lowSun);
		target.exposure = blend(daylight, day.exposure, smoothstep(-0.05, -0.35, sunHeight));
		target.sunLight = day.atmosphere.sunIntensity;
		target.moonLight = day.atmosphere.moonIntensity;
		target.stars = day.atmosphere.stars;
		target.clouds = cloudCoverage;
		target.lamps = lampShare(day.atmosphere.sunPosition[1] as number);
		targetHours = hours;
	};

	/** Eases each value toward its target by the frame's share. */
	const ease = (dt: number): void => {
		const share = 1 - Math.exp(-dt / EASE);
		const mix = (a: number, b: number) => a + (b - a) * share;
		current.intensity = mix(current.intensity, target.intensity);
		current.skyIntensity = mix(current.skyIntensity, target.skyIntensity);
		current.density = mix(current.density, target.density);
		current.glow = mix(current.glow, target.glow);
		current.exposure = mix(current.exposure, target.exposure);
		current.sunLight = mix(current.sunLight, target.sunLight);
		current.moonLight = mix(current.moonLight, target.moonLight);
		current.stars = mix(current.stars, target.stars);
		current.clouds = mix(current.clouds, target.clouds);
		current.lamps = mix(current.lamps, target.lamps);
		for (let k = 0; k < 3; k++) {
			current.color[k] = mix(current.color[k] as number, target.color[k] as number);
			current.fog[k] = mix(current.fog[k] as number, target.fog[k] as number);
			current.dir[k] = mix(current.dir[k] as number, target.dir[k] as number);
			current.sunPosition[k] = mix(
				current.sunPosition[k] as number,
				target.sunPosition[k] as number,
			);
			current.moonPosition[k] = mix(
				current.moonPosition[k] as number,
				target.moonPosition[k] as number,
			);
		}
		// Ease the sun's direction as a vector, then normalise, so it never wraps the long way.
		const length = Math.hypot(current.dir[0], current.dir[1], current.dir[2]) || 1;
		current.dir[0] = (current.dir[0] as number) / length;
		current.dir[1] = (current.dir[1] as number) / length;
		current.dir[2] = (current.dir[2] as number) / length;
		// Once every value sits on its target, the frame leaves the look alone: the chase is over and
		// the scene already holds these values to within a step nothing can see.
		still =
			Math.abs(current.intensity - target.intensity) <= STILL &&
			Math.abs(current.skyIntensity - target.skyIntensity) <= STILL &&
			Math.abs(current.density - target.density) <= STILL * Math.max(1, target.density) &&
			Math.abs(current.glow - target.glow) <= STILL &&
			Math.abs(current.exposure - target.exposure) <= STILL &&
			Math.abs(current.sunLight - target.sunLight) <= STILL &&
			Math.abs(current.moonLight - target.moonLight) <= STILL &&
			Math.abs(current.stars - target.stars) <= STILL &&
			Math.abs(current.clouds - target.clouds) <= STILL &&
			Math.abs(current.lamps - target.lamps) <= STILL &&
			near(current.dir, target.dir) &&
			near(current.color, target.color) &&
			near(current.fog, target.fog) &&
			near(current.sunPosition, target.sunPosition) &&
			near(current.moonPosition, target.moonPosition);
	};

	/** Copies the target into the values in use, so the first frame is already right. */
	const snap = (): void => {
		current.intensity = target.intensity;
		current.skyIntensity = target.skyIntensity;
		current.density = target.density;
		current.glow = target.glow;
		current.exposure = target.exposure;
		current.sunLight = target.sunLight;
		current.moonLight = target.moonLight;
		current.stars = target.stars;
		current.clouds = target.clouds;
		current.lamps = target.lamps;
		for (let k = 0; k < 3; k++) {
			current.color[k] = target.color[k] as number;
			current.fog[k] = target.fog[k] as number;
			current.dir[k] = target.dir[k] as number;
			current.sunPosition[k] = target.sunPosition[k] as number;
			current.moonPosition[k] = target.moonPosition[k] as number;
		}
		started = true;
		apply();
	};

	/** Writes the eased values into the scene, leaving out each part that is off. */
	const apply = (): void => {
		clouds.time = time.now;
		const air = look.background.atmosphere;
		air.sunIntensity = current.sunLight;
		air.moonIntensity = current.moonLight;
		air.stars = current.stars;
		air.cloudCoverage = current.clouds;
		air.time = clouds.time;
		// The sky keeps its own call in every frame: its clouds drift with the time.
		if (shown.sky) scene.setBackground(look.background, look.backgroundOptions);
		// A settled look writes nothing else: every value already sits on its target in the scene.
		const full = needsLook || !still;
		needsLook = false;
		if (!full) return;
		if (lit()) {
			look.environment.intensity = current.skyIntensity;
			scene.setEnvironment(sky, look.environment);
		}
		sun.setDirection(current.dir[0] as number, current.dir[1] as number, current.dir[2] as number);
		sun.setColor(current.color);
		sun.setIntensity(current.intensity);
		if (shown.fog) {
			// The fog's color is kept apart from the eased one, since the studio writes its own.
			const fog = look.fog.color;
			fog[0] = current.fog[0] as number;
			fog[1] = current.fog[1] as number;
			fog[2] = current.fog[2] as number;
			look.fog.density = current.density;
			look.fog.sunGlow = current.glow;
			scene.setFog(look.fog);
		}
		look.post.exposure = current.exposure;
		post.set(look.post);
	};

	/**
	 * Puts the studio's own values in place at once: it is a different background, not an hour. Each
	 * part that is off is left out.
	 */
	const toStudio = (): void => {
		if (shown.sky) scene.setBackground(room, look.roomOptions);
		if (lit()) {
			look.environment.intensity = 0.55;
			scene.setEnvironment(room, look.environment);
		}
		sun.setDirection(STUDIO_KEY[0], STUDIO_KEY[1], STUDIO_KEY[2]);
		sun.setColor('#fff4e6');
		sun.setIntensity(3);
		if (shown.fog) {
			look.fog.density = STUDIO_FOG_DENSITY;
			look.fog.color[0] = STUDIO_FOG[0];
			look.fog.color[1] = STUDIO_FOG[1];
			look.fog.color[2] = STUDIO_FOG[2];
			scene.setFog(look.fog);
		}
		look.post.exposure = 1;
		post.set(look.post);
	};

	const stage: Stage = {
		get mood() {
			return mood;
		},
		get auto() {
			return wasAuto;
		},
		get hours() {
			if (manualHours !== null) return manualHours;
			if (wasAuto) return autoHours;
			return mood === 'Studio' ? 12 : mood === 'Auto' ? autoHours : HOURS[mood];
		},
		get lamps() {
			return mood === 'Studio' ? 1 : current.lamps;
		},
		get airColor() {
			return current.fog;
		},
		get light() {
			const length = Math.hypot(...current.dir) || 1;
			const strength = mood === 'Studio' ? 0 : current.intensity;
			for (let k = 0; k < 3; k++) {
				shining.toward[k] = -(current.dir[k] as number) / length;
				shining.color[k] = (current.color[k] as number) * strength;
			}
			return shining;
		},
		set(next) {
			// Auto carries on from the hour on show, so turning it on never jumps the sky; from the
			// studio it carries on from where it last stood.
			if (next === 'Auto' && mood !== 'Studio' && mood !== 'Auto')
				autoHours = manualHours ?? HOURS[mood as FixedMood];
			mood = next;
			manualHours = null;
			wasAuto = next === 'Auto';
			// A mood change writes the whole look, whatever the eased values say.
			needsLook = true;
			still = false;
			if (next === 'Studio') {
				targetHours = Number.NaN;
				toStudio();
				return;
			}
			aimAt(next === 'Auto' ? autoHours : HOURS[next]);
			if (!started) snap();
		},
		setHour(hours) {
			// A slider always posts a number; a stray value is ignored rather than poisoning the hour.
			if (!Number.isFinite(hours)) return;
			manualHours = Math.min(24, Math.max(0, hours));
			wasAuto = false;
			mood = nearestMood(manualHours);
			needsLook = true;
			still = false;
			targetHours = Number.NaN;
			aimAt(manualHours);
			if (!started) snap();
		},
		update(dt) {
			if (mood === 'Studio') return;
			if (manualHours !== null) {
				if (targetHours !== manualHours) aimAt(manualHours);
			} else if (wasAuto) {
				autoHours = (autoHours + (dt * 24) / (perDay * 60)) % 24;
				aimAt(autoHours);
			} else if (mood !== 'Auto') {
				const hours = HOURS[mood];
				if (targetHours !== hours) aimAt(hours);
			}
			ease(dt);
			apply();
		},
		show(part, on) {
			shown[part] = on;
			// A part that is off is written once here, since the frame's writes leave it out.
			if (!shown.sky) scene.setBackground(backdrop);
			if (!lit()) scene.setEnvironment(null);
			if (!shown.fog) scene.setFog(null);
			// A part that comes back is written with the rest, settled or not.
			needsLook = true;
			still = false;
			if (mood === 'Studio') toStudio();
			else apply();
		},
	};
	return stage;
}
