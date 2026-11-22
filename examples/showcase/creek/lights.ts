// The Creek's own lights beside the stage's sun and sky: the light on the falls' spray, which
// follows the air's color, and the moods' own sky lights, which only dusk, dawn and golden hour
// turn up. Each is worked
// out here from the hour's look, so a test can hold it.
import type { SketchContext } from '@null3d/engine';
import { type MoodMix, moodShare } from '../../lib/stage';

/**
 * The light on the falls' spray and mist: how much of the air's own color it keeps, its faint lilac
 * cast, its strength over the air's, the least change of the air that it follows, and the share of
 * it that the east fall takes, whose white water reads brighter than the concept's at the full light.
 */
export const SPRAY = {
	color: 0.15,
	tint: [1, 0.975, 1.02],
	gain: 5.6,
	step: 0.01,
	east: 0.4,
} as const;

/**
 * The moods' own sky lights on the land: with the sun low or gone, the garden takes most of its
 * light from the sky map, warm at dawn and golden hour and dim at dusk. Each of these moods adds a
 * light from above in its own color and from the ground in its shade, at its strength in that mood
 * and none in any other. Dusk's afterglow is a lilac grey that lifts the dark land; dawn's and golden
 * hour's are a cool grey that leaves the land some green under the warm sun and sky.
 */
export const MOOD_SKIES = {
	Dusk: { sky: [0.75, 0.7, 0.85], ground: [0.3, 0.27, 0.27], gain: 0.38 },
	Dawn: { sky: [0.6, 0.85, 0.88], ground: [0.24, 0.3, 0.26], gain: 0.55 },
	Golden: { sky: [0.6, 0.85, 0.88], ground: [0.24, 0.3, 0.26], gain: 0.55 },
} as const;

/**
 * Writes the light on the falls' spray for an air color into `out`: the air greyed toward its
 * brightness, with the faint lilac cast, at the spray's strength. The particles take a light of at
 * most one in each part, which the bright noon air passes, so a light past one is scaled down as a
 * whole, by its largest part, and keeps its hue.
 */
export function sprayLight(
	air: readonly [number, number, number],
	out: [number, number, number],
): [number, number, number] {
	const grey = 0.2126 * air[0] + 0.7152 * air[1] + 0.0722 * air[2];
	for (let c = 0; c < 3; c++)
		out[c] = (grey + (air[c] - grey) * SPRAY.color) * (SPRAY.tint[c] as number) * SPRAY.gain;
	const largest = Math.max(out[0], out[1], out[2]);
	if (largest > 1) for (let c = 0; c < 3; c++) out[c] /= largest;
	return out;
}

/** The moods' own sky lights in a scene, which follow the look that the scene shows. */
export interface MoodSkies {
	/** Sets the lights for a look: each at its full strength in its mood, eased in and out of it. */
	setLook(look: MoodMix): void;
}

/** Makes the moods' own sky lights in a scene, dark until a look turns one up. */
export function createMoodSkies(
	scene: Pick<SketchContext['scene'], 'createHemisphereLight'>,
): MoodSkies {
	const lights = Object.entries(MOOD_SKIES).map(([mood, { sky, ground, gain }]) => ({
		mood: mood as keyof typeof MOOD_SKIES,
		gain,
		light: scene.createHemisphereLight({ skyColor: sky, groundColor: ground, intensity: 0 }),
	}));
	return {
		setLook: (look) => {
			for (const { mood, gain, light } of lights) light.setIntensity(gain * moodShare(look, mood));
		},
	};
}
