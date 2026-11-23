import { describe, expect, test } from 'bun:test';
import { MAX_VOICES, MIXER_OUTPUTS, OUTPUT_COUNT, tableLayout } from './layout';
import { cutoffOf, distanceGain, distanceTone, MIXER_NAME, Mixer } from './mixer-worklet';
import type { MixerReply, SoundSpec } from './protocol';

const RATE = 48_000;
const FRAMES = 128;
const CAPACITY = 16;

/** A sound's description with the fields a test does not care about filled in. */
function spec(over: Partial<SoundSpec>): SoundSpec {
	return {
		id: 1,
		kind: 'loop',
		file: 'https://example.test/a.mp3',
		first: 0,
		count: 1,
		voice: 0,
		voices: 1,
		positional: true,
		near: 0,
		far: 0,
		muffle: false,
		...over,
	};
}

/** A mixer over a shared table, its outputs, and the replies it sent. */
function rig() {
	const layout = tableLayout(CAPACITY);
	const buffer = new SharedArrayBuffer(layout.length * 4);
	const floats = new Float32Array(buffer);
	const ints = new Int32Array(buffer);
	floats[layout.volume] = 1;
	floats[layout.listenerTurn + 3] = 1;
	const replies: MixerReply[] = [];
	const mixer = new Mixer(RATE, { outputs: MIXER_OUTPUTS, voices: MAX_VOICES }, (reply) =>
		replies.push(reply),
	);
	mixer.receive({ type: 'table', layout, buffer });
	const outputs = Array.from({ length: OUTPUT_COUNT }, () =>
		Array.from({ length: MAX_VOICES }, () => new Float32Array(FRAMES)),
	);
	/** Renders `quanta` quanta, counting a sketch frame before each unless `still`. */
	const run = (quanta: number, still = false) => {
		for (let q = 0; q < quanta; q++) {
			if (!still) ints[layout.frame] = ((ints[layout.frame] as number) + 1) | 0;
			mixer.render(outputs);
		}
	};
	const at = (e: number, x: number, y: number, z: number) => {
		floats[layout.places + 3 * e] = x;
		floats[layout.places + 3 * e + 1] = y;
		floats[layout.places + 3 * e + 2] = z;
	};
	const level = (e: number, value: number) => {
		floats[layout.levels + e] = value;
	};
	for (let e = 0; e < CAPACITY; e++) {
		level(e, 1);
		floats[layout.rates + e] = 1;
		floats[layout.tones + e] = 1;
	}
	/** The last sample of a voice's channel on one output. */
	const last = (output: number, voice: number) => outputs[output]?.[voice]?.[FRAMES - 1] as number;
	return { layout, floats, ints, mixer, outputs, replies, run, at, level, last };
}

/** Enough quanta for every fade to settle: two seconds. */
const SETTLE = Math.ceil((2 * RATE) / FRAMES);

describe('distance', () => {
	test('a sound keeps its level within near and halves at twice near', () => {
		const sound = spec({ near: 2 });
		expect(distanceGain(sound, 1)).toBe(1);
		expect(distanceGain(sound, 4)).toBeCloseTo(0.5, 6);
	});

	test('a sound fades out by its far distance', () => {
		const sound = spec({ near: 1, far: 50 });
		expect(distanceGain(sound, 50)).toBe(0);
		expect(distanceGain(sound, 20)).toBeCloseTo(1 / 20, 6);
		expect(distanceTone({ ...sound, muffle: true }, 50)).toBeCloseTo(0.55, 6);
		expect(distanceTone({ ...sound, muffle: false }, 50)).toBe(1);
	});

	test('a tone runs the cutoff from the low end to the high end', () => {
		expect(cutoffOf(0)).toBeCloseTo(120, 3);
		expect(cutoffOf(1)).toBeCloseTo(20_000, 0);
		expect(cutoffOf(2)).toBeCloseTo(20_000, 0);
	});

	test('the page and the mixer name the mixer alike', async () => {
		const page = await Bun.file(new URL('./page.ts', import.meta.url)).text();
		expect(page).toContain(`const MIXER_NAME = '${MIXER_NAME}';`);
	});
});

describe('a loop', () => {
	test('stays silent until its file plays, then fades in to its level at its distance', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({ near: 2 }) });
		r.at(0, 0, 0, -4);
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBe(0);
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(0.5, 3);
		expect(r.last(MIXER_OUTPUTS.z, 0)).toBeCloseTo(-4, 5);
	});

	test('carries its place into the listener frame', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({}) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		// The listener turns a quarter turn to its left, so it looks down the world's -X axis.
		r.floats[r.layout.listenerTurn + 1] = Math.SQRT1_2;
		r.floats[r.layout.listenerTurn + 3] = Math.SQRT1_2;
		r.floats[r.layout.listenerAt] = 10;
		r.at(0, 5, 0, 0);
		r.run(4);
		expect(r.last(MIXER_OUTPUTS.x, 0)).toBeCloseTo(0, 4);
		expect(r.last(MIXER_OUTPUTS.z, 0)).toBeCloseTo(-5, 4);
	});

	test('eases its gain across a quantum', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({}) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.run(1);
		const channel = r.outputs[MIXER_OUTPUTS.gain]?.[0] as Float32Array;
		expect(channel[0] as number).toBeLessThan(channel[FRAMES - 1] as number);
		for (let i = 1; i < FRAMES; i++)
			expect(channel[i] as number).toBeGreaterThanOrEqual(channel[i - 1] as number);
	});

	test('follows its rate and its tone, with the tone muffled by distance', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({ near: 1, far: 40, muffle: true }) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.at(0, 0, 0, -40);
		r.floats[r.layout.rates] = 1.5;
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.rate, 0)).toBeCloseTo(1.5, 3);
		expect(r.last(MIXER_OUTPUTS.cutoff, 0)).toBeCloseTo(cutoffOf(0.55), -1);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(0, 5);
	});

	test('a bed that plays in both ears ignores distance', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({ positional: false, near: 1, far: 5 }) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.at(0, 0, 0, -100);
		r.level(0, 0.8);
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(0.8, 3);
	});

	test('fades out when the sketch removes it, then frees its voice', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({}) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.run(SETTLE);
		r.mixer.receive({ type: 'remove', id: 1 });
		r.run(1);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeGreaterThan(0);
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBe(0);
	});
});

describe('the sketch stopping', () => {
	test('fades every voice out and tells the page, then wakes with the frames', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({}) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.run(SETTLE);
		expect(r.replies).toEqual([{ type: 'active' }]);
		r.run(SETTLE, true);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeLessThan(1e-4);
		expect(r.replies.at(-1)).toEqual({ type: 'idle' });
		r.run(1);
		expect(r.replies.at(-1)).toEqual({ type: 'active' });
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(1, 3);
	});
});

describe('a group', () => {
	/** A group of six emitters with two voices, all ready, standing in a row down -Z. */
	function group() {
		const r = rig();
		r.mixer.receive({
			type: 'add',
			sound: spec({ kind: 'group', count: 6, voices: 2, near: 1, far: 100 }),
		});
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.mixer.receive({ type: 'ready', voice: 1 });
		for (let e = 0; e < 6; e++) r.at(e, 0, 0, -(10 + 10 * e));
		return r;
	}

	/** The distances that the group's two voices sound from. */
	const heard = (r: ReturnType<typeof rig>) =>
		[0, 1].map((v) => -Math.round(r.last(MIXER_OUTPUTS.z, v))).sort((a, b) => a - b);

	test('gives its voices to the loudest members', () => {
		const r = group();
		r.run(SETTLE);
		expect(heard(r)).toEqual([10, 20]);
	});

	test('keeps a voice on a member that stays near the cut', () => {
		const r = group();
		r.run(SETTLE);
		// The third member comes a little closer than the second, inside the hold share.
		r.at(2, 0, 0, -19);
		r.run(SETTLE);
		expect(heard(r)).toEqual([10, 20]);
	});

	test('moves a voice to a member that comes much closer, through a fade', () => {
		const r = group();
		r.run(SETTLE);
		r.at(5, 0, 0, -2);
		r.run(8);
		// The voice that leaves fades first, so for a moment one voice is quieter than its place says.
		r.run(SETTLE);
		expect(heard(r)).toEqual([2, 10]);
		const gains = [0, 1].map((v) => r.last(MIXER_OUTPUTS.gain, v)).sort((a, b) => b - a);
		expect(gains[0]).toBeCloseTo(0.5, 2);
		expect(gains[1]).toBeCloseTo(0.1, 2);
	});

	test('silences a voice whose member goes quiet', () => {
		const r = group();
		r.run(SETTLE);
		for (let e = 1; e < 6; e++) r.level(e, 0);
		r.run(SETTLE);
		const gains = [0, 1].map((v) => r.last(MIXER_OUTPUTS.gain, v)).sort((a, b) => b - a);
		expect(gains[0]).toBeCloseTo(0.1, 3);
		expect(gains[1]).toBeLessThan(1e-4);
	});
});

describe('a table the page copies', () => {
	test('reads each copy and hands the buffer back', () => {
		const layout = tableLayout(4);
		const replies: MixerReply[] = [];
		const mixer = new Mixer(RATE, { outputs: MIXER_OUTPUTS, voices: MAX_VOICES }, (reply) =>
			replies.push(reply),
		);
		mixer.receive({ type: 'table', layout, buffer: null });
		mixer.receive({ type: 'add', sound: spec({ positional: false }) });
		mixer.receive({ type: 'ready', voice: 0 });
		const copy = new ArrayBuffer(layout.length * 4);
		const floats = new Float32Array(copy);
		floats[layout.volume] = 1;
		floats[layout.levels] = 0.25;
		const outputs = Array.from({ length: OUTPUT_COUNT }, () =>
			Array.from({ length: MAX_VOICES }, () => new Float32Array(FRAMES)),
		);
		for (let q = 0; q < SETTLE; q++) {
			new Int32Array(copy)[layout.frame] = q + 1;
			mixer.receive({ type: 'copy', buffer: copy.slice(0) });
			mixer.render(outputs);
		}
		expect(outputs[MIXER_OUTPUTS.gain]?.[0]?.[FRAMES - 1]).toBeCloseTo(0.25, 3);
		expect(replies.filter((reply) => reply.type === 'copy')).toHaveLength(SETTLE);
	});
});
