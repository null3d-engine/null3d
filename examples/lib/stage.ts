// The stage of the showcase scenes: moods of four times of day under the generated sky, and a
// studio. Each outdoor mood takes its sun or moon, sky, fog and exposure from `timeOfDay`, and the
// sky's own environment lights the scene, so reflections match the sky. The studio swaps the sky
// for the built-in room's light, behind a blurred, dimmed copy of the room. A scene gives the turn
// of the sun's path and the density of its fog.
import {
	type DirectionalLight,
	type Environment,
	type SketchContext,
	type TimeOfDayPreset,
	timeOfDay,
} from '@null3d/engine';

/** The moods, as the page's buttons name them. */
export const MOODS = ['Afternoon', 'Golden', 'Blue', 'Night', 'Studio'] as const;
export type Mood = (typeof MOODS)[number];

/** The time of day of each outdoor mood. */
const TIMES: Record<Exclude<Mood, 'Studio'>, TimeOfDayPreset> = {
	Afternoon: 'afternoon',
	Golden: 'goldenHour',
	Blue: 'blueHour',
	Night: 'night',
};
/**
 * A factor of each mood's exposure. Under the moon, the preset's exposure shows the grass as green
 * as by day, so the night keeps a darker exposure.
 */
const EXPOSURE: Record<Exclude<Mood, 'Studio'>, number> = {
	Afternoon: 1,
	Golden: 1,
	Blue: 1,
	Night: 0.55,
};
/** The studio's key light, from the front left and high. */
const STUDIO_KEY = [0.45, -0.75, -0.5] as const;

/** A scene's settings of its stage. */
export interface StageOptions {
	/** The turn of the sun's path about +Y, in radians, as `timeOfDay` takes it. */
	heading: number;
	/** The density of the outdoor fog. */
	fogDensity: number;
	/** The share of the sky that clouds cover, from 0 to 1. */
	cloudCoverage: number;
}

/** True for a mood name. */
export const isMood = (name: unknown): name is Mood => MOODS.includes(name as Mood);

/** Sets the scene's light, sky, fog and exposure for each mood. */
export function createMoods(
	{ scene, post }: SketchContext,
	sun: DirectionalLight,
	sky: Environment,
	room: Environment,
	{ heading, fogDensity, cloudCoverage }: StageOptions,
): (mood: Mood) => void {
	return (mood) => {
		if (mood === 'Studio') {
			scene.setBackground(room, { blur: 0.7, intensity: 0.18 });
			scene.setEnvironment(room, { intensity: 0.55 });
			sun.setDirection(STUDIO_KEY[0], STUDIO_KEY[1], STUDIO_KEY[2]);
			sun.setColor('#fff4e6');
			sun.setIntensity(3);
			scene.setFog({ color: [0.05, 0.05, 0.055], density: 0.012 });
			post.set({ exposure: 1 });
			return;
		}
		const day = timeOfDay(TIMES[mood], { heading });
		const intensity = day.skyIntensity;
		scene.setBackground({ sky: { ...day.sky, cloudCoverage } }, { intensity });
		scene.setEnvironment(sky, { intensity });
		sun.setDirection(day.light.direction[0], day.light.direction[1], day.light.direction[2]);
		sun.setColor(day.light.color);
		sun.setIntensity(day.light.intensity);
		scene.setFog({ color: day.fog.color, density: fogDensity, sunGlow: day.fog.sunGlow });
		post.set({ exposure: day.exposure * EXPOSURE[mood] });
	};
}
