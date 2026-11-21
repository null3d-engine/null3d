// The Creek's look as one setting: its own tone curve, set with its stage, and its air, which the
// stage hands the scene's fog: thin and grey over the garden, growing with distance, and thick over
// the cloud sea. The air's share of a pixel follows the engine's height fog (fog.wgsl).
import { expect, test } from 'bun:test';
import { CLOUD_TOP } from './land';
import { AIR, createCreekStage, STAGE, TONE_CURVE } from './look';
import { WIDE } from './route';

interface Fog {
	color: readonly number[];
	density: number;
	height?: number;
	heightFalloff?: number;
}

/** The Creek's stage on a stand-in scene that keeps the last fog and the post's settings. */
function staged() {
	const last: { fog?: Fog | null; toneMapping?: unknown } = {};
	const context = {
		scene: {
			setBackground() {},
			setEnvironment() {},
			setFog: (fog: Fog | null) => {
				last.fog = fog && { ...fog, color: [...fog.color] };
			},
		},
		post: {
			set(settings: { toneMapping?: unknown }) {
				if ('toneMapping' in settings) last.toneMapping = settings.toneMapping;
			},
		},
		time: { now: 0 },
	};
	const sun = { setDirection() {}, setColor() {}, setIntensity() {} };
	const stage = createCreekStage(context as never, sun as never, {} as never, {} as never);
	return { stage, last };
}

/** The air's share of a pixel on a line of sight, by the engine's height fog. */
function airShare(density: number, from: readonly number[], to: readonly number[]): number {
	const distance = Math.hypot(
		(to[0] as number) - (from[0] as number),
		(to[1] as number) - (from[1] as number),
		(to[2] as number) - (from[2] as number),
	);
	const climb = AIR.falloff * ((to[1] as number) - (from[1] as number));
	const ratio = Math.abs(climb) < 1e-2 ? 1 - climb / 2 : (1 - Math.exp(-climb)) / climb;
	const atCamera = Math.exp(-AIR.falloff * ((from[1] as number) - CLOUD_TOP));
	return 1 - Math.exp(-density * distance * atCamera * ratio);
}

test('the Creek sets its own tone curve, with a gentler color boost than the punchy look', () => {
	const { last } = staged();
	expect(last.toneMapping).toBe(TONE_CURVE);
	expect(TONE_CURVE).toContain('fn toneCurve');
	const boost = Number(/const SATURATION: f32 = ([0-9.]+);/.exec(TONE_CURVE)?.[1]);
	expect(boost, 'the color boost').toBeLessThan(1.4);
	expect(boost, 'the color boost').toBeGreaterThanOrEqual(1);
});

test("the stage hands the scene the Creek's air: from the cloud's tops, thinning above them, grey", () => {
	const { stage, last } = staged();
	stage.set('Midday');
	for (let k = 0; k < 240; k++) stage.update(1 / 60);
	const fog = last.fog as Fog;
	expect(fog.height).toBe(CLOUD_TOP);
	expect(fog.heightFalloff).toBe(AIR.falloff);
	expect(fog.density).toBeCloseTo(AIR.density * (STAGE.haze?.Midday ?? 1), 6);
	const [r, g, b] = fog.color as [number, number, number];
	expect(
		(Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b),
		'a near-neutral air',
	).toBeLessThan(0.1);
});

test('the air grows with distance over the garden and lies thick over the cloud sea', () => {
	const density = AIR.density * (STAGE.haze?.Morning ?? 1);
	const close = airShare(density, [4, 6, 22], [2, 0, 14]);
	const bank = airShare(density, WIDE, [7.7, 0.2, 16]);
	const farRim = airShare(density, WIDE, [-20, 0.5, 0]);
	const farCliff = airShare(density, WIDE, [-22, -8, 5]);
	const clouds = airShare(density, WIDE, [-60, CLOUD_TOP, -40]);
	expect(close, 'the close view').toBeLessThan(0.03);
	expect(bank, 'the front bank from the opening camera').toBeGreaterThan(close);
	expect(bank, 'the front bank from the opening camera').toBeLessThan(0.08);
	expect(farRim, "the garden's far rim").toBeGreaterThan(bank);
	expect(farCliff, 'the far cliff').toBeGreaterThan(farRim);
	expect(clouds, "the cloud's tops at 120 m").toBeGreaterThan(0.3);
});
