// The ground's tones seed the palette's classes the fidelity reviewer counts: a grey rock, a dark
// green and a gold. The rendered shares are measured in the round; this holds the seeds' intent, so
// a tone cannot drift back into the moss class unnoticed.
import { expect, test } from 'bun:test';
import { GROUND_CLASS_TONES } from './land';

/** The hue in degrees, saturation and value of a linear colour. */
function hsv(colour: readonly number[]) {
	const [r, g, b] = [colour[0] as number, colour[1] as number, colour[2] as number];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const range = max - min;
	let hue = 0;
	if (range > 0)
		hue = max === r ? ((g - b) / range) % 6 : max === g ? (b - r) / range + 2 : (r - g) / range + 4;
	return { hue: hue * 60, sat: max === 0 ? 0 : range / max, val: max };
}

test('the ground seeds a grey, a dark green and a gold for the palette classes', () => {
	const grey = hsv(GROUND_CLASS_TONES.grey);
	expect(grey.sat, 'the grey seed').toBeLessThan(0.15);
	const dark = hsv(GROUND_CLASS_TONES.dark);
	expect(dark.hue, 'the dark green seed hue').toBeGreaterThan(50);
	expect(dark.val, 'the dark green seed value').toBeLessThan(0.1);
	const gold = hsv(GROUND_CLASS_TONES.gold);
	expect(gold.hue, 'the gold seed hue').toBeGreaterThan(32);
	expect(gold.hue, 'the gold seed hue').toBeLessThan(50);
	expect(gold.val, 'the gold seed value').toBeGreaterThan(0.28);
});
