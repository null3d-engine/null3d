import { describe, expect, it } from 'bun:test';
import {
	EVENT_GAMEPAD_AXIS,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_WHEEL,
} from './control';
import {
	decodeRecording,
	EVENT_STRIDE,
	MAX_RECORDING_SECONDS,
	RECORDING_MAGIC,
	RECORDING_VERSION,
	Recorder,
	RecordingError,
} from './recording';

/** The keys of the test's sketch, as the page numbers them. */
const KEY_CODES = ['KeyA', 'KeyW', 'Space'];

/** What reading `bytes` throws, as a person sees it. */
function mistake(bytes: Uint8Array): string {
	try {
		decodeRecording(bytes);
	} catch (error) {
		expect(error).toBeInstanceOf(RecordingError);
		return (error as Error).message;
	}
	throw new Error('the recording decoded without a mistake');
}

/** A recorder of the test's keys. */
const recorder = () => new Recorder(7, KEY_CODES);

/** A recording of one frame with a key press, for the malformed-file tests. */
function sample(): Uint8Array {
	const made = recorder();
	made.beginFrame(0);
	made.event(EVENT_KEY_DOWN, 1, 0, 0, 0, 0, 0);
	return made.encode({ fixedRate: 60, sketch: '/sketch.ts' });
}

describe('a recording of frames and their input', () => {
	it('keeps each frame’s step and the input that the sketch read, exactly', () => {
		const made = recorder();
		made.beginFrame(0);
		made.beginFrame(1 / 60);
		made.event(EVENT_KEY_DOWN, 1, 0, 0, 0, 0, 0);
		made.event(EVENT_POINTER_MOVE, 0, 1, 3, 0, 120.5, 63.25);
		made.beginFrame(0.2);
		made.event(EVENT_POINTER_DOWN, 0, 1, 3, 1, 120.5, 63.25);
		made.event(EVENT_WHEEL, 0, 0, 0, 0, 0, 120);
		made.event(EVENT_GAMEPAD_AXIS, 2, 0, 0, 0, -0.5, 0);
		made.beginFrame(1 / 60);
		made.event(EVENT_KEY_UP, 1, 0, 0, 0, 0, 0);

		const program = decodeRecording(made.encode({ fixedRate: 60, sketch: '/sketch.ts' }));
		expect(program.seed).toBe(7);
		expect(program.fixedRate).toBe(60);
		expect(program.sketch).toBe('/sketch.ts');
		expect(program.stopped).toBe(false);
		expect(Array.from(program.steps)).toEqual([0, 1 / 60, 0.2, 1 / 60]);
		expect(Array.from(program.starts)).toEqual([0, 0, 2, 5]);
		expect(Array.from(program.counts)).toEqual([0, 2, 3, 1]);
		expect(program.keyNames).toEqual(['KeyW']);
		expect(Array.from(program.events)).toEqual([
			EVENT_KEY_DOWN,
			0,
			0,
			0,
			0,
			0,
			0,
			EVENT_POINTER_MOVE,
			0,
			1,
			3,
			0,
			120.5,
			63.25,
			EVENT_POINTER_DOWN,
			0,
			1,
			3,
			1,
			120.5,
			63.25,
			EVENT_WHEEL,
			0,
			0,
			0,
			0,
			0,
			120,
			EVENT_GAMEPAD_AXIS,
			2,
			0,
			0,
			0,
			-0.5,
			0,
			EVENT_KEY_UP,
			0,
			0,
			0,
			0,
			0,
			0,
		]);
	});

	it('keeps every frame’s step exactly, so a long session does not drift', () => {
		const made = recorder();
		/** A step that no whole number of microseconds or milliseconds holds. */
		const step = 1 / 60;
		for (let k = 0; k < 4000; k++) made.beginFrame(step);
		const program = decodeRecording(made.encode({ fixedRate: 60, sketch: '/sketch.ts' }));
		let now = 0;
		let expected = 0;
		for (let k = 0; k < 4000; k++) {
			now += step;
			expected += program.steps[k] as number;
			expect(program.steps[k]).toBe(step);
		}
		expect(now).toBe(expected);
	});

	it('stops at the recording limit, and says so in the file', () => {
		const made = recorder();
		for (let k = 0; k < MAX_RECORDING_SECONDS * 60 + 60; k++) made.beginFrame(1 / 60);
		expect(made.stopped).toBe(true);
		const program = decodeRecording(made.encode({ fixedRate: 60, sketch: '/sketch.ts' }));
		expect(program.stopped).toBe(true);
		expect(program.steps.length).toBe(MAX_RECORDING_SECONDS * 60);
	});
});

describe('a recording that cannot be read', () => {
	it('refuses a file without the format marker', () => {
		const bytes = sample();
		bytes[0] = 0;
		expect(mistake(bytes)).toContain('does not start with the format marker');
	});

	it('refuses a version that this engine does not read', () => {
		const bytes = sample();
		bytes[4] = RECORDING_VERSION + 1;
		expect(mistake(bytes)).toContain('recording version 2');
	});

	it('refuses a file that ends early, and names where', () => {
		const bytes = sample();
		expect(mistake(bytes.slice(0, bytes.length - 3))).toContain(
			`the file ends after ${bytes.length - 3} bytes`,
		);
	});

	it('refuses a step that is no time of a frame', () => {
		const bytes = sample();
		// The sample is one frame of one 13-byte event: its step follows the frame's input count.
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const stepAt = bytes.length - 13 - 1 - 8;
		view.setFloat64(stepAt, 0.5, true);
		expect(mistake(bytes)).toContain('as its step');
	});

	it('refuses an input type that this engine does not know', () => {
		const bytes = sample();
		// The sample's one event is its last 13 bytes, whose type is the first of them.
		bytes[bytes.length - 13] = 0;
		expect(mistake(bytes)).toContain('which this engine does not know');
	});

	it('names the format marker and the version in the constants', () => {
		expect(RECORDING_MAGIC).toBe(0x4e334452);
		expect(RECORDING_VERSION).toBe(1);
		expect(EVENT_STRIDE).toBe(7);
	});
});
