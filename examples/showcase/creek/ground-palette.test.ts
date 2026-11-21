// The ground's cover seeds the palette's classes the fidelity reviewer counts: a grey rock, a dark
// green and a gold, and the zones that carry them over most of its top. The rendered shares are
// measured in the round; this holds the seed tones and the zones' areas, so the ground cannot drift
// back into a moss carpet unnoticed.
import { expect, test } from 'bun:test';
import { GROUND_CLASS_TONES, type GroundZones, groundZones, onTop } from './land';

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

test('the ground zones most of its top into shelves, mats and lichen', () => {
	const zones: GroundZones = { shelf: 0, mats: 0, lichen: 0 };
	let sites = 0;
	let shelf = 0;
	let mats = 0;
	let lichen = 0;
	for (let x = -25; x <= 25; x += 0.5) {
		for (let z = -25; z <= 25; z += 0.5) {
			if (!onTop(x, z)) continue;
			groundZones(x, z, 2, zones);
			sites++;
			shelf += zones.shelf;
			mats += zones.mats;
			lichen += zones.lichen;
		}
	}
	expect(sites).toBeGreaterThan(5000);
	expect(shelf / sites, 'the rock shelves').toBeGreaterThan(0.15);
	expect(mats / sites, 'the moss mats').toBeGreaterThan(0.1);
	expect(lichen / sites, 'the gold lichen').toBeGreaterThan(0.01);
});
