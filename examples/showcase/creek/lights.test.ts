// The Creek's own lights: the dusk's sky light stands in Dusk alone, and the falls' spray light
// keeps within what the particles take, with its hue, at the bright noon air.
import { expect, test } from 'bun:test';
import { MOODS } from '../../lib/stage';
import { createDuskSky, DUSK_SKY, sprayLight } from './lights';

test('the dusk sky light shines in Dusk alone, eased in and out of it', () => {
	const made: { skyColor: unknown; groundColor: unknown; intensity: number }[] = [];
	let strength = Number.NaN;
	const scene = {
		createHemisphereLight: (options: (typeof made)[number]) => {
			made.push(options);
			return { setIntensity: (value: number) => (strength = value) };
		},
	};
	const sky = createDuskSky(scene as never);
	expect(made).toHaveLength(1);
	expect(made[0]?.skyColor).toEqual(DUSK_SKY.sky);
	expect(made[0]?.groundColor).toEqual(DUSK_SKY.ground);
	expect(made[0]?.intensity, 'dark until a look turns it up').toBe(0);
	expect(DUSK_SKY.gain).toBeGreaterThan(0);
	for (const mood of MOODS) {
		sky.setLook({ from: mood, to: mood, share: 0 });
		if (mood === 'Dusk') expect(strength, 'the dusk light in Dusk').toBeCloseTo(DUSK_SKY.gain, 6);
		else expect(strength, `the dusk light in ${mood}`).toBe(0);
	}
	sky.setLook({ from: 'Golden', to: 'Dusk', share: 0.5 });
	expect(strength).toBeCloseTo(DUSK_SKY.gain / 2, 6);
});

test("the spray light keeps within one in each part, and keeps the air's hue at noon", () => {
	const out: [number, number, number] = [0, 0, 0];
	// A dim air passes as it is: a light under one is not scaled.
	sprayLight([0.02, 0.02, 0.025], out);
	const dim = [...out];
	expect(Math.max(...dim)).toBeLessThan(1);
	// The bright noon air would give a light past one: it is scaled as a whole.
	const noon: [number, number, number] = [0.19, 0.19, 0.21];
	sprayLight(noon, out);
	expect(Math.max(...out)).toBeCloseTo(1, 6);
	for (const part of out) expect(part).toBeLessThanOrEqual(1);
	// Its parts keep their ratios, so the faint lilac stays: the blue part is still the largest.
	const grey = 0.2126 * noon[0] + 0.7152 * noon[1] + 0.0722 * noon[2];
	const raw = noon.map(
		(part, c) => (grey + (part - grey) * 0.15) * ([1, 0.975, 1.02][c] as number),
	);
	const top = Math.max(...raw);
	out.forEach((part, c) => {
		expect(part, `part ${c} against the unscaled light`).toBeCloseTo((raw[c] as number) / top, 6);
	});
	expect(out[2]).toBeGreaterThan(out[1]);
});
