import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MAX_CAPACITY, MAX_VOICES, MIXER_OUTPUTS, OUTPUT_COUNT, tableLayout } from './layout';
import { MIXER_NAME, Mixer } from './mixer-worklet';
import type { MixerReply, MixerSetup, SoundSpec } from './protocol';

/**
 * The mixer's WebAssembly module, which `bun run build` builds from `crates/null3d-sound`. Each
 * mixer takes an instance of its own, so the tests share no state.
 */
const WASM = fileURLToPath(new URL('../dist/sound.wasm', import.meta.url));
const built = existsSync(WASM);
const inCI = Boolean(process.env.CI);
const missing = `the built sound mixer is missing at ${WASM}; run \`bun run build\` to run these tests`;
const MODULE = built ? new WebAssembly.Module(readFileSync(WASM)) : null;

if (!built && !inCI) console.warn(`${missing}.`);

// CI's build job uploads the module with the page's other WebAssembly, so a missing file there is
// a broken upload rather than a checkout that has not built yet.
test.skipIf(!inCI)('CI hands the unit tests the sound mixer', () => {
	if (!built)
		throw new Error(`${missing}. CI's build job uploads it with the page's other WebAssembly.`);
});

test('the page and the mixer name the mixer alike', async () => {
	const page = await Bun.file(new URL('./page.ts', import.meta.url)).text();
	expect(page).toContain(`const MIXER_NAME = '${MIXER_NAME}';`);
});
const SETUP: MixerSetup = {
	outputs: MIXER_OUTPUTS,
	voices: MAX_VOICES,
	wasm: new ArrayBuffer(0),
};

/** A mixer over the module, whose replies go to `replies`. */
function mixerFor(replies: MixerReply[]): Mixer {
	if (!MODULE) throw new Error(missing);
	return new Mixer(RATE, SETUP, (reply) => replies.push(reply), MODULE);
}

const RATE = 48_000;
const FRAMES = 128;
const CAPACITY = 16;
/**
 * The tone that a sound keeps at its far distance, which the mixer's muffle takes about a fifth of.
 * A sound that a scene asks to muffle trades brightness for distance, and this is the whole trade.
 */
const TONE_AT_FAR = 0.78;

/** A sound's description with the fields a test does not care about filled in. */
function spec(over: Partial<SoundSpec>): SoundSpec {
	return {
		id: 1,
		kind: 'loop',
		file: 'https://example.test/a.mp3',
		first: 0,
		count: 1,
		voices: [0],
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
	const mixer = mixerFor(replies);
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

describe.skipIf(!built)('distance', () => {
	/** The settled gain of a loop at `distance` in front of the listener. */
	const gainAt = (sound: Partial<SoundSpec>, distance: number) => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec(sound) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.at(0, 0, 0, -distance);
		r.run(SETTLE);
		return r;
	};

	test('a sound keeps its level within near and halves at twice near', () => {
		expect(gainAt({ near: 2 }, 1).last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(1, 3);
		expect(gainAt({ near: 2 }, 4).last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(0.5, 3);
	});

	test('a sound fades out by its far distance, and muffles on the way when asked', () => {
		expect(gainAt({ near: 1, far: 50 }, 50).last(MIXER_OUTPUTS.gain, 0)).toBe(0);
		expect(gainAt({ near: 1, far: 50 }, 20).last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(1 / 20, 3);
		const muffled = gainAt({ near: 1, far: 50, muffle: true }, 49).last(MIXER_OUTPUTS.cutoff, 0);
		const open = gainAt({ near: 1, far: 50, muffle: false }, 49).last(MIXER_OUTPUTS.cutoff, 0);
		expect(open).toBeCloseTo(20_000, -2);
		// The sound stands a meter inside its far distance, where the muffle has reached its whole
		// share to within a fraction of a per cent.
		expect(muffled).toBeCloseTo(120 * (20_000 / 120) ** TONE_AT_FAR, -2);
	});

	test('a table of the most emitters fits the module, and its last emitter sounds', () => {
		const layout = tableLayout(MAX_CAPACITY);
		const buffer = new SharedArrayBuffer(layout.length * 4);
		const floats = new Float32Array(buffer);
		const ints = new Int32Array(buffer);
		floats[layout.volume] = 1;
		floats[layout.listenerTurn + 3] = 1;
		const last = MAX_CAPACITY - 1;
		floats[layout.places + 3 * last + 2] = -1;
		floats[layout.levels + last] = 1;
		floats[layout.rates + last] = 1;
		floats[layout.tones + last] = 1;
		const mixer = mixerFor([]);
		mixer.receive({ type: 'table', layout, buffer });
		mixer.receive({ type: 'add', sound: spec({ first: last, near: 1 }) });
		mixer.receive({ type: 'ready', voice: 0 });
		const outputs = Array.from({ length: OUTPUT_COUNT }, () =>
			Array.from({ length: MAX_VOICES }, () => new Float32Array(FRAMES)),
		);
		for (let q = 0; q < SETTLE; q++) {
			ints[layout.frame] = (ints[layout.frame] as number) + 1;
			mixer.render(outputs);
		}
		expect(outputs[MIXER_OUTPUTS.gain]?.[0]?.[FRAMES - 1]).toBeCloseTo(1, 3);
	});
});

describe.skipIf(!built)('a loop', () => {
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
		// World -Z then lies on the listener's right, its +X: a mirror would put it on the left.
		r.at(0, 10, 0, -5);
		r.run(4);
		expect(r.last(MIXER_OUTPUTS.x, 0)).toBeCloseTo(5, 4);
		expect(r.last(MIXER_OUTPUTS.z, 0)).toBeCloseTo(0, 4);
	});

	test('eases its gain across a quantum', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({}) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		// The first quantum reads the frame count; the second sees it move and starts the fade-in.
		r.run(2);
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
		expect(r.last(MIXER_OUTPUTS.cutoff, 0)).toBeCloseTo(120 * (20_000 / 120) ** TONE_AT_FAR, -1);
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

describe.skipIf(!built)('the sketch stopping', () => {
	test('fades every voice out and tells the page, then wakes with the frames', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({}) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.run(SETTLE);
		expect(r.replies).toEqual([]);
		r.run(SETTLE, true);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeLessThan(1e-4);
		expect(r.replies.at(-1)).toEqual({ type: 'idle' });
		r.run(1);
		expect(r.replies.at(-1)).toEqual({ type: 'active' });
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(1, 3);
	});
});

describe.skipIf(!built)('a group', () => {
	/** A group of six emitters with two voices, all ready, standing in a row down -Z. */
	function group() {
		const r = rig();
		r.mixer.receive({
			type: 'add',
			sound: spec({ kind: 'group', count: 6, voices: [0, 1], near: 1, far: 100 }),
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
		// The voice that leaves fades out first, at its old member's place, before it moves. The fade
		// runs at a time constant of an eighth of a second, so a third of a second holds it whole.
		let faded = false;
		for (let q = 0; q < 128 && !faded; q++) {
			r.run(1);
			for (const v of [0, 1]) {
				const atOld = Math.round(-r.last(MIXER_OUTPUTS.z, v)) === 20;
				if (atOld && r.last(MIXER_OUTPUTS.gain, v) < 0.01) faded = true;
			}
		}
		expect(faded).toBe(true);
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

describe.skipIf(!built)('a group, ranked by loudness', () => {
	test('gives a voice to a loud far member before a silent near one', () => {
		const r = rig();
		r.mixer.receive({
			type: 'add',
			sound: spec({ kind: 'group', count: 3, voices: [4], near: 1, far: 200 }),
		});
		r.mixer.receive({ type: 'ready', voice: 4 });
		r.at(0, 0, 0, -2);
		r.at(1, 0, 0, -30);
		r.at(2, 0, 0, -60);
		r.level(0, 0);
		r.run(SETTLE);
		expect(Math.round(-r.last(MIXER_OUTPUTS.z, 4))).toBe(30);
	});

	test("takes the new member's pitch at once as a voice moves", () => {
		const r = rig();
		r.mixer.receive({
			type: 'add',
			sound: spec({ kind: 'group', count: 2, voices: [0], near: 1, far: 200 }),
		});
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.at(0, 0, 0, -2);
		r.at(1, 0, 0, -50);
		r.floats[r.layout.rates] = 0.5;
		r.floats[r.layout.rates + 1] = 2;
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.rate, 0)).toBeCloseTo(0.5, 3);
		// The near member goes quiet, so the voice moves to the far one, which runs at rate 2.
		r.level(0, 0);
		for (let q = 0; q < SETTLE; q++) {
			r.run(1);
			if (Math.round(-r.last(MIXER_OUTPUTS.z, 0)) === 50 && r.last(MIXER_OUTPUTS.gain, 0) > 0.005) {
				expect(r.last(MIXER_OUTPUTS.rate, 0)).toBeCloseTo(2, 2);
				return;
			}
		}
		throw new Error('the voice never moved to the far member');
	});
});

describe.skipIf(!built)('a shot', () => {
	test("starts at its own level, place and pitch, not its slot's last play", () => {
		const r = rig();
		r.mixer.receive({
			type: 'add',
			sound: spec({ kind: 'shot', count: 1, voices: [2], near: 4, far: 0 }),
		});
		r.at(0, 0, 0, -1);
		r.floats[r.layout.rates] = 2;
		// A shot's voice is silent until its first play.
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 2)).toBe(0);
		r.mixer.receive({ type: 'shot', voice: 2 });
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 2)).toBeCloseTo(1, 3);
		// The sketch writes the next play far off and slow. Until the page says it starts, the voice
		// keeps the last play's values, so a play that still fades keeps its own level.
		r.at(0, 0, 0, -400);
		r.floats[r.layout.rates] = 0.5;
		r.run(4);
		expect(r.last(MIXER_OUTPUTS.gain, 2)).toBeCloseTo(1, 3);
		expect(r.last(MIXER_OUTPUTS.rate, 2)).toBeCloseTo(2, 3);
		r.mixer.receive({ type: 'shot', voice: 2 });
		r.run(1);
		expect(r.last(MIXER_OUTPUTS.gain, 2)).toBeCloseTo(0.01, 4);
		expect(r.last(MIXER_OUTPUTS.rate, 2)).toBeCloseTo(0.5, 4);
		expect(r.last(MIXER_OUTPUTS.z, 2)).toBeCloseTo(-400, 2);
	});
});

describe.skipIf(!built)('values that are not numbers', () => {
	test('silence a voice for as long as they last, and no longer', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({ near: 1, far: 50 }) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.at(0, 0, 0, -2);
		r.run(SETTLE);
		r.level(0, Number.POSITIVE_INFINITY);
		r.floats[r.layout.rates] = Number.NaN;
		r.at(0, Number.NaN, 0, 0);
		r.run(SETTLE);
		for (let i = 0; i < FRAMES; i++)
			expect(Number.isFinite(r.outputs[MIXER_OUTPUTS.gain]?.[0]?.[i] as number)).toBe(true);
		// An endless level is silence, not the loudest level.
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeLessThan(1e-4);
		r.level(0, 1);
		r.floats[r.layout.rates] = 1;
		r.at(0, 0, 0, -2);
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(0.5, 3);
		expect(r.last(MIXER_OUTPUTS.rate, 0)).toBeCloseTo(1, 3);
	});

	test("keep a member out of a group's ranking", () => {
		const r = rig();
		r.mixer.receive({
			type: 'add',
			sound: spec({ kind: 'group', count: 2, voices: [0], near: 1, far: 200 }),
		});
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.at(0, Number.NaN, 0, 0);
		r.at(1, 0, 0, -10);
		r.run(SETTLE);
		expect(Math.round(-r.last(MIXER_OUTPUTS.z, 0))).toBe(10);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(0.1, 3);
	});
});

describe.skipIf(!built)('a sketch that was paused before the sound started', () => {
	test('is reported as stopped, so the page can suspend the audio', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({}) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.run(SETTLE, true);
		expect(r.replies).toEqual([{ type: 'idle' }]);
	});
});

describe.skipIf(!built)('rates and levels at their limits', () => {
	test('holds a rate past the widest at the widest, and plays one that is not a number at 1', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({ positional: false }) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.floats[r.layout.rates] = 0;
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.rate, 0)).toBeCloseTo(1 / 16, 3);
		r.floats[r.layout.rates] = 100;
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.rate, 0)).toBeCloseTo(16, 2);
		r.floats[r.layout.rates] = Number.NaN;
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.rate, 0)).toBeCloseTo(1, 3);
	});

	test('reads an endless level at a good place as silence', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({ near: 1, far: 50 }) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.at(0, 0, 0, -2);
		r.level(0, Number.POSITIVE_INFINITY);
		r.run(SETTLE);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBe(0);
	});

	test('ranks members at one distance by their level', () => {
		const r = rig();
		r.mixer.receive({
			type: 'add',
			sound: spec({ kind: 'group', count: 2, voices: [0], near: 1, far: 200 }),
		});
		r.mixer.receive({ type: 'ready', voice: 0 });
		r.at(0, -10, 0, 0);
		r.at(1, 10, 0, 0);
		r.level(0, 0.3);
		r.level(1, 0.9);
		r.run(SETTLE);
		expect(Math.round(r.last(MIXER_OUTPUTS.x, 0))).toBe(10);
		expect(r.last(MIXER_OUTPUTS.gain, 0)).toBeCloseTo(0.09, 3);
	});
});

describe.skipIf(!built)('a sketch whose frames have not moved yet', () => {
	test('swells no voice before its frame count moves, whatever the count reads', () => {
		const r = rig();
		r.ints[r.layout.frame] = 5000;
		r.mixer.receive({ type: 'add', sound: spec({ positional: false }) });
		r.mixer.receive({ type: 'ready', voice: 0 });
		let loudest = 0;
		for (let q = 0; q < SETTLE; q++) {
			r.run(1, true);
			loudest = Math.max(loudest, r.last(MIXER_OUTPUTS.gain, 0));
		}
		expect(loudest).toBe(0);
	});
});

describe.skipIf(!built)('quanta and voices that the module does not take as they come', () => {
	test('a quantum longer than the module renders plays in pieces, with no frame left silent', () => {
		const layout = tableLayout(CAPACITY);
		const buffer = new SharedArrayBuffer(layout.length * 4);
		const floats = new Float32Array(buffer);
		const ints = new Int32Array(buffer);
		floats[layout.volume] = 1;
		floats[layout.listenerTurn + 3] = 1;
		floats[layout.levels] = 1;
		floats[layout.rates] = 1;
		floats[layout.tones] = 1;
		const mixer = mixerFor([]);
		mixer.receive({ type: 'table', layout, buffer });
		mixer.receive({ type: 'add', sound: spec({ positional: false }) });
		mixer.receive({ type: 'ready', voice: 0 });
		const long = 2560;
		const outputs = Array.from({ length: OUTPUT_COUNT }, () =>
			Array.from({ length: MAX_VOICES }, () => new Float32Array(long)),
		);
		for (let q = 0; q < 200; q++) {
			ints[layout.frame] = (ints[layout.frame] as number) + 1;
			mixer.render(outputs);
		}
		const gains = outputs[MIXER_OUTPUTS.gain]?.[0] as Float32Array;
		expect(Math.min(...gains)).toBeGreaterThan(0.99);
	});

	test('a voice that is not a whole number in range is refused, as the page never sends one', () => {
		const r = rig();
		r.mixer.receive({ type: 'add', sound: spec({ voices: [Number.NaN] }) });
		r.mixer.receive({ type: 'add', sound: spec({ id: 2, voices: [2.9] }) });
		r.mixer.receive({ type: 'ready', voice: Number.NaN });
		r.mixer.receive({ type: 'ready', voice: 2.9 });
		r.at(0, 0, 0, -1);
		r.run(SETTLE);
		for (let v = 0; v < 3; v++) expect(r.last(MIXER_OUTPUTS.gain, v)).toBe(0);
	});
});

describe.skipIf(!built)('a table the page copies', () => {
	test('reads each copy and hands the buffer back', () => {
		const layout = tableLayout(4);
		const replies: MixerReply[] = [];
		const mixer = mixerFor(replies);
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
