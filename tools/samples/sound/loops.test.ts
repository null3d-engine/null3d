import { describe, expect, test } from 'bun:test';
import {
	crossfadeLoop,
	fadeOut,
	PADDING_LEVEL,
	paddingFrames,
	parseArgs,
	RATE,
	type Report,
	reportProblems,
	SOUNDS,
	type Sound,
	seamSteps,
} from './loops';

describe('the sound table', () => {
	test('names each sound once', () => {
		const names = SOUNDS.map((sound) => sound.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test('gives every sound a cut that fits and a fade well inside its length', () => {
		for (const sound of SOUNDS) {
			expect(sound.start).toBeGreaterThanOrEqual(0);
			expect(sound.fade).toBeGreaterThan(0);
			expect(sound.fade * (sound.loop ? 4 : 2)).toBeLessThan(sound.length);
			expect(Number.isInteger(sound.length * RATE)).toBe(true);
			expect(sound.channels === 1 || sound.mono === undefined).toBe(true);
		}
	});

	test('sets every loop to -20 LUFS and every one-shot by its true peak', () => {
		for (const sound of SOUNDS) expect(sound.loudness).toBe(sound.loop ? -20 : null);
	});
});

describe('parseArgs', () => {
	const sounds = [{ name: 'wind' }, { name: 'rain' }] as Sound[];

	test('reads the output folder and each option', () => {
		expect(
			parseArgs(['out', '--raw', 'r', '--only', 'rain,wind', '--spectra', 's'], sounds),
		).toEqual({
			out: 'out',
			raw: 'r',
			only: ['rain', 'wind'],
			spectra: 's',
		});
		expect(parseArgs(['out'], sounds)).toEqual({ out: 'out' });
	});

	test('refuses a missing folder, an unknown sound, a missing value and an unknown option', () => {
		expect(() => parseArgs([], sounds)).toThrow('output folder');
		expect(() => parseArgs(['--raw', 'r'], sounds)).toThrow('output folder');
		expect(() => parseArgs(['out', '--only', 'sea'], sounds)).toThrow('wind, rain');
		expect(() => parseArgs(['out', '--raw'], sounds)).toThrow('needs a value');
		expect(() => parseArgs(['out', '--loud', '1'], sounds)).toThrow('Unknown option');
	});
});

describe('crossfadeLoop', () => {
	test('runs on from its last sample into its first, in every channel', () => {
		// A stereo ramp whose channels climb at different rates: a cut is a seamless loop when its
		// last sample is followed by the one that the tail would have played next.
		const frames = 1000;
		const fade = 100;
		const cut = new Float32Array((frames + fade) * 2);
		for (let i = 0; i < frames + fade; i++) {
			cut[i * 2] = i / 1000;
			cut[i * 2 + 1] = -i / 500;
		}
		const loop = crossfadeLoop(cut, 2, fade);
		expect(loop.length).toBe(frames * 2);
		// The loop's middle keeps the cut, and its start is mostly the tail past its end.
		expect(loop[500 * 2]).toBe(cut[500 * 2] as number);
		expect(loop[0]).toBeCloseTo((cut[frames * 2] as number) * Math.cos(Math.PI / 400), 3);
		const { seam, inside } = seamSteps(loop, 2);
		expect(seam).toBeLessThan(0.02);
		expect(inside).toBeLessThan(0.05);
	});

	test('keeps the power of two unrelated signals through the crossfade', () => {
		const frames = 4000;
		const fade = 2000;
		const cut = new Float32Array(frames + fade);
		for (let i = 0; i < cut.length; i++)
			cut[i] = i < frames ? Math.sin(i * 0.3) : Math.sin(i * 0.71);
		const loop = crossfadeLoop(cut, 1, fade);
		const power = (from: number, to: number) => {
			let sum = 0;
			for (let i = from; i < to; i++) sum += (loop[i] as number) ** 2;
			return sum / (to - from);
		};
		expect(power(800, 1200)).toBeCloseTo(power(2500, 3500), 1);
	});

	test('refuses a cut too short for its fade', () => {
		expect(() => crossfadeLoop(new Float32Array(150), 1, 100)).toThrow('longer');
	});
});

describe('fadeOut', () => {
	test('ends at silence and leaves the start alone', () => {
		const out = fadeOut(new Float32Array(400).fill(0.5), 2, 50);
		expect(out[0]).toBe(0.5);
		expect(out[2 * 149]).toBe(0.5);
		expect(out[399]).toBeCloseTo(0, 6);
	});
});

describe('paddingFrames', () => {
	test('counts the frames at each end that the add-on trims as padding', () => {
		const samples = new Float32Array(20).fill(0.1);
		samples[0] = 0;
		samples[1] = PADDING_LEVEL / 2;
		samples[2] = 0;
		samples[3] = -PADDING_LEVEL / 2;
		samples[19] = 0;
		expect(paddingFrames(samples, 2)).toEqual({ head: 2, tail: 0 });
		expect(paddingFrames(samples, 1)).toEqual({ head: 4, tail: 1 });
		expect(paddingFrames(new Float32Array(8), 2)).toEqual({ head: 4, tail: 0 });
	});
});

describe('reportProblems', () => {
	const loop = { name: 'wind', length: 2, loop: true } as Sound;
	const shot = { name: 'thunder', length: 2, loop: false } as Sound;
	const good: Report = {
		name: 'wind',
		seconds: 2,
		channels: 2,
		bytes: 1000,
		loudness: -20,
		peak: -3,
		limitedFrom: null,
		seam: 0.01,
		inside: 0.2,
		padding: { head: 0, tail: 0 },
	};

	test('passes a loop of the right length with a smooth seam and loud ends', () => {
		expect(reportProblems(loop, good)).toEqual([]);
	});

	test('refuses a wrong length, a quiet end and a seam that steps like a click', () => {
		const problems = reportProblems(loop, {
			...good,
			seconds: 2.024,
			seam: 0.15,
			padding: { head: 0, tail: 12 },
		});
		expect(problems).toHaveLength(3);
		expect(problems[0]).toContain('decodes to 2.024 s');
		expect(problems[1]).toContain('12 at its end');
		expect(problems[2]).toContain('seam');
	});

	test('lets a one-shot fade out to silence, but not start in it', () => {
		expect(reportProblems(shot, { ...good, padding: { head: 0, tail: 300 } })).toEqual([]);
		expect(reportProblems(shot, { ...good, padding: { head: 5, tail: 0 } })).toHaveLength(1);
	});
});
