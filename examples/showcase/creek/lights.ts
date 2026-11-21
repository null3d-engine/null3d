// The Creek's own lights beside the stage's sun and sky: the light on the falls' spray, which
// follows the air's color, and the dusk's own sky light, which only Dusk turns up. Each is worked
// out here from the hour's look, so a test can hold it.
import { type MoodMix, moodShare } from '../../lib/stage';

/**
 * The light on the falls' spray and mist: how much of the air's own color it keeps, its faint lilac
 * cast, its strength over the air's, and the least change of the air that it follows.
 */
export const SPRAY = { color: 0.15, tint: [1, 0.975, 1.02], gain: 5.6, step: 0.01 } as const;

/**
 * The dusk's own sky light: with the sun down, the garden takes only the sky map's dim light and
 * reads as one dark shape against the brighter cloud, so the afterglow lights it from above in a
 * lilac grey and from the ground in its shade, at this strength in Dusk alone and none in any other
 * mood.
 */
export const DUSK_SKY = { sky: [0.75, 0.7, 0.85], ground: [0.3, 0.27, 0.27], gain: 0.26 } as const;

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

/** The dusk sky light's strength in a look: its full strength in Dusk, eased in and out of it. */
export function duskSkyStrength(look: MoodMix): number {
	return DUSK_SKY.gain * moodShare(look, 'Dusk');
}
