// The stage of the showcase scenes: the times of day under the physical sky, an Auto mode that moves
// the sun and the moon across the sky, and a studio. Each outdoor hour takes its sun or moon, sky,
// fog and exposure from `timeOfDay`, with the physical model, so the real sun disc lights the scene
// by day and the moon disc at night. The sky's own environment lights the scene, so reflections
// match the sky. A mood is a target: every value eases toward it over a fraction of a second, so a
// change of mood glides and Auto's sun and moon move continuously. A scene gives the turn of the
// sun's path and the density of its fog.
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

/** The hour of each fixed outdoor mood. Auto moves the hour itself. */
export const HOURS: Record<Exclude<Mood, 'Auto' | 'Studio'>, number> = {
	Dawn: 6.2,
	Morning: 9,
	Midday: 12,
	Afternoon: 15,
	Golden: 17.6,
	Dusk: 18.4,
	Night: 23,
};

/** The studio's key light, from the front left and high. */
const STUDIO_KEY = [0.45, -0.75, -0.5] as const;
/** How many minutes a whole day takes in Auto, unless a scene says otherwise. */
const MINUTES_PER_DAY = 4;
/** Seconds for a value to settle most of the way to its target: a fast, smooth ease. */
const EASE = 0.14;

/** A scene's settings of its stage. */
export interface StageOptions {
	/** The turn of the sun's path about +Y, in radians, as `timeOfDay` takes it. */
	heading: number;
	/** The density of the outdoor fog. */
	fogDensity: number;
	/** The share of the sky that clouds cover, from 0 to 1. */
	cloudCoverage: number;
	/** A factor of the fog's density in some moods, such as a haze at golden hour. */
	haze?: Partial<Record<Exclude<Mood, 'Auto' | 'Studio'>, number>>;
	/** The minutes a whole day takes in Auto. The default is 4. */
	minutesPerDay?: number;
}

/** The stage of a showcase scene: the mood, the Auto driver, and what its values ease toward. */
export interface Stage {
	/** Sets the target: a fixed time, the studio, or Auto, which moves the sun and the moon. */
	set(mood: Mood): void;
	/** The mood now. */
	readonly mood: Mood;
	/** True while Auto moves the hour. */
	readonly auto: boolean;
	/** The hour now, from 0 up to 24. */
	readonly hours: number;
	/** Eases toward the target and applies it. Call once per frame with the frame's step. */
	update(dt: number): void;
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
	const { heading, fogDensity, cloudCoverage, haze = {} } = options;
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
	};
	const target = structuredClone(current);
	const clouds = { cloudCoverage, time: 0 };
	let mood: Mood = 'Afternoon';
	let wasAuto = false;
	let autoHours = HOURS.Afternoon;
	/** True once the first target is in use, so the first frame does not fade in from nothing. */
	let started = false;
	/** The hours that the target was made for, so a fixed mood computes it once. */
	let targetHours = Number.NaN;

	/** Works out the target from an hour, with the physical sky. */
	const aimAt = (hours: number, at: Mood): void => {
		const day = timeOfDay(hours, { heading, model: 'physical' });
		target.dir = [-day.light.direction[0], -day.light.direction[1], -day.light.direction[2]];
		target.color = [...day.light.color];
		target.intensity = day.light.intensity;
		target.skyIntensity = day.skyIntensity;
		target.fog = [...day.fog.color];
		target.density = fogDensity * (haze[at as Exclude<Mood, 'Auto' | 'Studio'>] ?? 1);
		target.glow = day.fog.sunGlow;
		target.exposure = day.exposure;
		target.sunPosition = [...day.atmosphere.sunPosition];
		target.moonPosition = [...day.atmosphere.moonPosition];
		target.sunLight = day.atmosphere.sunIntensity;
		target.moonLight = day.atmosphere.moonIntensity;
		target.stars = day.atmosphere.stars;
		target.clouds = cloudCoverage;
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

	/** Writes the eased values into the scene. */
	const apply = (): void => {
		clouds.time = time.now;
		scene.setBackground(
			{
				atmosphere: {
					sunPosition: current.sunPosition,
					sunIntensity: current.sunLight,
					moonPosition: current.moonPosition,
					moonIntensity: current.moonLight,
					stars: current.stars,
					cloudCoverage: current.clouds,
					time: clouds.time,
				},
			},
			{ intensity: 1 },
		);
		scene.setEnvironment(sky, { intensity: current.skyIntensity });
		sun.setDirection(current.dir[0] as number, current.dir[1] as number, current.dir[2] as number);
		sun.setColor(current.color);
		sun.setIntensity(current.intensity);
		scene.setFog({ color: current.fog, density: current.density, sunGlow: current.glow });
		post.set({ exposure: current.exposure });
	};

	/** Puts the studio's own values in place at once: it is a different background, not an hour. */
	const toStudio = (): void => {
		scene.setBackground(room, { blur: 0.7, intensity: 0.18 });
		scene.setEnvironment(room, { intensity: 0.55 });
		sun.setDirection(STUDIO_KEY[0], STUDIO_KEY[1], STUDIO_KEY[2]);
		sun.setColor('#fff4e6');
		sun.setIntensity(3);
		scene.setFog({ color: [0.05, 0.05, 0.055], density: 0.012 });
		post.set({ exposure: 1 });
	};

	const stage: Stage = {
		get mood() {
			return mood;
		},
		get auto() {
			return wasAuto;
		},
		get hours() {
			if (wasAuto) return autoHours;
			return mood === 'Studio' ? 12 : mood === 'Auto' ? autoHours : HOURS[mood];
		},
		set(next) {
			mood = next;
			wasAuto = next === 'Auto';
			if (next === 'Studio') {
				targetHours = Number.NaN;
				toStudio();
				return;
			}
			aimAt(next === 'Auto' ? autoHours : HOURS[next], next);
			if (!started) snap();
		},
		update(dt) {
			if (mood === 'Studio') return;
			if (wasAuto) {
				autoHours = (autoHours + (dt * 24) / (perDay * 60)) % 24;
				aimAt(autoHours, 'Auto');
			} else if (mood !== 'Auto') {
				const hours = HOURS[mood];
				if (targetHours !== hours) aimAt(hours, mood);
			}
			ease(dt);
			apply();
		},
	};
	return stage;
}
