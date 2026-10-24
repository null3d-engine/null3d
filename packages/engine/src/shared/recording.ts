// A recording of a sketch's frames: each frame's step and the input that the sketch read in it, in
// a small binary file that replays on another machine to the same frames. The file holds the time
// of every frame as a step, delta-coded, and a dictionary of the keys that the input used. Replay
// runs the frames from the first one, with the sketch's setup as it started, so a session on a
// phone reproduces on a computer.
//
// The recorder lives on the sketch's thread, so it records what the sketch read, not what the page
// sent. A frame that read no input costs four bytes in memory and about two in the file.

import { EVENT_KEY_DOWN, EVENT_KEY_UP } from './control';

/** The file's first four bytes, which name the format. */
export const RECORDING_MAGIC = 0x4e334452;

/** The format's version, which a reader refuses when it does not know. */
export const RECORDING_VERSION = 1;

/** The most sketch time that a recording keeps, in seconds. */
export const MAX_RECORDING_SECONDS = 600;

/** The most frames and input records that a recording keeps, so a broken page cannot exhaust memory. */
const MAX_FRAMES = 2_000_000;
const MAX_EVENTS = 4_000_000;

/** The flag that marks a recording that stopped at its limit before the session ended. */
const FLAG_STOPPED = 1;

/** The numbers of one input record, in the order that the file stores them. */
export interface RecordedEvent {
	/** The event's type, as the input ring's `EVENT_` names give it. */
	type: number;
	/** A key's index in the dictionary for a key event, or the record's own code. */
	code: number;
	/** The event's flags, as `FLAG_` names give them. */
	flags: number;
	/** The pointer's or the pad's id. */
	id: number;
	/** The pointer's buttons, or a pad button's value. */
	buttons: number;
	/** The pointer's distance from the canvas's left edge, or a wheel's first delta. */
	x: number;
	/** The pointer's distance from the canvas's top edge, or a wheel's second delta. */
	y: number;
}

/** The numbers of one event, as the recording stores them side by side. */
export const EVENT_STRIDE = 7;

/**
 * What a replay gave, once its frames ran.
 *
 * @category api/engine
 */
export interface ReplayResult {
	/** The frames that ran, which is the recording's frame count. */
	frames: number;
	/** The sketch time at the end, in seconds. */
	seconds: number;
	/** The sketch that the recording was made with. */
	sketch: string;
	/** True when the recording stopped at its limit before the recorded session ended. */
	stopped: boolean;
}

/** A recording that cannot be read, with the reason in plain words. */
export class RecordingError extends Error {}

/** What a replay needs: the frames and their input, in time order, with the session's seed. */
export interface ReplayProgram {
	/** The seed of the sketch thread's random numbers when the recording started. */
	seed: number;
	/** The fixed rate of the sketch's fixed updates, which a replay must match. */
	fixedRate: number;
	/** The sketch's address when it was recorded, for a message about a different scene. */
	sketch: string;
	/** True when the recording stopped at its limit before the session ended. */
	stopped: boolean;
	/** Each frame's step in seconds, which sums to the frame's sketch time. */
	steps: Float64Array;
	/** The first event of each frame, as an index into `events`. */
	starts: Uint32Array;
	/** How many events each frame has. */
	counts: Uint32Array;
	/** The events' numbers, `stride` for each event, in frame order. */
	events: Float64Array;
	/** How many numbers each event takes in `events`. */
	stride: number;
	/** The key names that the events' codes index, from the file's dictionary. */
	keyNames: readonly string[];
}

/** A byte writer that grows as it writes, for a file that the caller then keeps. */
class ByteWriter {
	private bytes: Uint8Array;
	/** How many bytes hold the file so far. */
	length = 0;

	constructor(capacity = 1024) {
		this.bytes = new Uint8Array(capacity);
	}

	/** Makes room for `more` bytes, and gives the file's bytes once it is complete. */
	private room(more: number): Uint8Array {
		if (this.length + more <= this.bytes.length) return this.bytes;
		let capacity = this.bytes.length * 2;
		while (capacity < this.length + more) capacity *= 2;
		const grown = new Uint8Array(capacity);
		grown.set(this.bytes.subarray(0, this.length));
		this.bytes = grown;
		return grown;
	}

	u8(value: number): void {
		const bytes = this.room(1);
		bytes[this.length++] = value & 0xff;
	}

	u16(value: number): void {
		const bytes = this.room(2);
		bytes[this.length++] = value & 0xff;
		bytes[this.length++] = (value >>> 8) & 0xff;
	}

	u32(value: number): void {
		const bytes = this.room(4);
		bytes[this.length++] = value & 0xff;
		bytes[this.length++] = (value >>> 8) & 0xff;
		bytes[this.length++] = (value >>> 16) & 0xff;
		bytes[this.length++] = (value >>> 24) & 0xff;
	}

	/** An unsigned whole number, seven bits to a byte and the top bit saying that more follow. */
	varint(value: number): void {
		let rest = Math.floor(value);
		while (rest >= 0x80) {
			this.u8((rest & 0x7f) | 0x80);
			rest = Math.floor(rest / 0x80);
		}
		this.u8(rest);
	}

	f32(value: number): void {
		const bytes = this.room(4);
		new DataView(bytes.buffer, bytes.byteOffset + this.length, 4).setFloat32(0, value, true);
		this.length += 4;
	}

	f64(value: number): void {
		const bytes = this.room(8);
		new DataView(bytes.buffer, bytes.byteOffset + this.length, 8).setFloat64(0, value, true);
		this.length += 8;
	}

	text(value: string): void {
		const encoded = new TextEncoder().encode(value);
		this.varint(encoded.length);
		const bytes = this.room(encoded.length);
		bytes.set(encoded, this.length);
		this.length += encoded.length;
	}

	/** The file's bytes, copied so that the writer's spare room does not travel with it. */
	done(): Uint8Array {
		return this.bytes.slice(0, this.length);
	}
}

/** A byte reader that refuses a file that ends early or holds a number that cannot be right. */
class ByteReader {
	private readonly view: DataView;
	private at = 0;

	constructor(private readonly bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	get left(): number {
		return this.bytes.length - this.at;
	}

	/** Throws when fewer than `count` bytes are left. */
	private need(count: number): void {
		if (this.left < count)
			throw new RecordingError(
				`the file ends after ${this.bytes.length} bytes, in the middle of what it holds. Download it again, or record a new session.`,
			);
	}

	u8(): number {
		this.need(1);
		return this.bytes[this.at++] as number;
	}

	u16(): number {
		this.need(2);
		const value = this.view.getUint16(this.at, true);
		this.at += 2;
		return value;
	}

	u32(): number {
		this.need(4);
		const value = this.view.getUint32(this.at, true);
		this.at += 4;
		return value;
	}

	varint(): number {
		let value = 0;
		let scale = 1;
		for (let index = 0; index < 8; index++) {
			const byte = this.u8();
			value += (byte & 0x7f) * scale;
			if ((byte & 0x80) === 0) return value;
			scale *= 0x80;
		}
		throw new RecordingError('the file holds a number that is too long to be one of its fields.');
	}

	f32(): number {
		this.need(4);
		const value = this.view.getFloat32(this.at, true);
		this.at += 4;
		return value;
	}

	f64(): number {
		this.need(8);
		const value = this.view.getFloat64(this.at, true);
		this.at += 8;
		return value;
	}

	text(max: number): string {
		const length = this.varint();
		if (length > max)
			throw new RecordingError(`the file names a text of ${length} bytes, which is too long.`);
		this.need(length);
		const text = new TextDecoder().decode(this.bytes.subarray(this.at, this.at + length));
		this.at += length;
		return text;
	}
}

/** A key event's type, which uses the file's dictionary for its code. */
const isKeyEvent = (type: number) => type === EVENT_KEY_DOWN || type === EVENT_KEY_UP;

/**
 * A recording as it is made: each frame's step and the input that the sketch read in it, kept until
 * the page saves it. It records from the first frame, so a replay starts from the sketch's setup;
 * it stops at [`MAX_RECORDING_SECONDS`] of sketch time and says so in the file.
 */
export class Recorder {
	/** The seed that the sketch thread's random numbers started from, which the file keeps. */
	readonly seed: number;
	/** True once the recording stopped at its limit, so a saved file says it is not the whole session. */
	stopped = false;
	private steps: Float64Array;
	private starts: Uint32Array;
	private counts: Uint32Array;
	private events: Float64Array;
	private frameCount = 0;
	private eventCount = 0;
	/** The sketch time so far, in seconds, which the limit counts. */
	private now = 0;
	/** The key names that the events use, and each key's place in the dictionary. */
	private readonly keyNames: string[] = [];
	private readonly keySlots = new Map<number, number>();
	/** The name of each key by its control number, which the file's dictionary needs. */
	private readonly keyCodes: readonly string[];

	constructor(seed: number, keyCodes: readonly string[], capacity = 4096) {
		this.seed = seed;
		this.keyCodes = keyCodes;
		this.steps = new Float64Array(Math.max(1, capacity));
		this.starts = new Uint32Array(this.steps.length);
		this.counts = new Uint32Array(this.steps.length);
		this.events = new Float64Array(this.steps.length * 8);
	}

	/** The frames recorded so far. */
	get frames(): number {
		return this.frameCount;
	}

	/** Starts a frame whose step is `step` seconds, or records nothing once the recording is full. */
	beginFrame(step: number): void {
		if (this.stopped) return;
		if (this.frameCount >= MAX_FRAMES || this.now + step > MAX_RECORDING_SECONDS) {
			this.stopped = true;
			return;
		}
		this.now += step;
		if (this.frameCount === this.steps.length) this.growFrames();
		const at = this.frameCount++;
		this.steps[at] = step;
		this.starts[at] = this.eventCount;
		this.counts[at] = 0;
	}

	/** Records one input record that the sketch read in the frame that is open. */
	event(
		type: number,
		code: number,
		flags: number,
		id: number,
		buttons: number,
		x: number,
		y: number,
	): void {
		if (this.stopped || this.frameCount === 0) return;
		const frame = this.frameCount - 1;
		if (this.eventCount * EVENT_STRIDE + EVENT_STRIDE > this.events.length) {
			if (this.eventCount >= MAX_EVENTS) {
				this.stopped = true;
				return;
			}
			this.growEvents();
		}
		const at = this.eventCount++ * EVENT_STRIDE;
		this.events[at] = type;
		this.events[at + 1] = isKeyEvent(type) ? this.keySlot(code) : code;
		this.events[at + 2] = flags;
		this.events[at + 3] = id;
		this.events[at + 4] = buttons;
		this.events[at + 5] = x;
		this.events[at + 6] = y;
		this.counts[frame] = (this.counts[frame] as number) + 1;
	}

	/** The place of key `code` in the file's dictionary, which gains the name the first time. */
	private keySlot(code: number): number {
		const known = this.keySlots.get(code);
		if (known !== undefined) return known;
		const slot = this.keyNames.length;
		this.keyNames.push(this.keyCodes[code] ?? `Key${code}`);
		this.keySlots.set(code, slot);
		return slot;
	}

	private growFrames(): void {
		const capacity = this.steps.length * 2;
		const steps = new Float64Array(capacity);
		steps.set(this.steps);
		const starts = new Uint32Array(capacity);
		starts.set(this.starts);
		const counts = new Uint32Array(capacity);
		counts.set(this.counts);
		this.steps = steps;
		this.starts = starts;
		this.counts = counts;
	}

	private growEvents(): void {
		const events = new Float64Array(this.events.length * 2);
		events.set(this.events);
		this.events = events;
	}

	/**
	 * The file's bytes: the session's seed, the statistics that a replay needs, the dictionary of
	 * the keys that the input used, and each frame's step with the input that the sketch read.
	 *
	 * @param header The fixed rate of the sketch's fixed updates, and the sketch's address.
	 */
	encode(header: { fixedRate: number; sketch: string }): Uint8Array {
		const out = new ByteWriter(64 + this.frameCount * 8);
		out.u32(RECORDING_MAGIC);
		out.u8(RECORDING_VERSION);
		out.u8(this.stopped ? FLAG_STOPPED : 0);
		out.u16(header.fixedRate);
		out.u32(this.seed);
		out.text(header.sketch);
		out.varint(this.keyNames.length);
		for (const name of this.keyNames) out.text(name);
		out.varint(this.frameCount);
		for (let frame = 0; frame < this.frameCount; frame++) {
			out.f64(this.steps[frame] as number);
			const start = this.starts[frame] as number;
			const count = this.counts[frame] as number;
			out.varint(count);
			for (let k = start; k < start + count; k++) {
				const at = k * EVENT_STRIDE;
				out.u8(this.events[at] as number);
				out.varint(this.events[at + 1] as number);
				out.u8(this.events[at + 2] as number);
				out.u8(this.events[at + 3] as number);
				out.varint(this.events[at + 4] as number);
				out.f32(this.events[at + 5] as number);
				out.f32(this.events[at + 6] as number);
			}
		}
		return out.done();
	}
}

/** A whole number of a field, or a recording error naming what the file holds instead. */
function whole(value: number, what: string, min: number, max: number): number {
	if (!(Number.isFinite(value) && Number.isInteger(value) && value >= min && value <= max))
		throw new RecordingError(
			`the file gives ${String(value)} for ${what}, which takes a whole number from ${min} to ${max}.`,
		);
	return value;
}

/**
 * The recording that `bytes` holds, or a [`RecordingError`] that says what is wrong with the file.
 * The events' key codes are the file's dictionary indexes; a replay maps them to its own keys.
 */
export function decodeRecording(bytes: Uint8Array): ReplayProgram {
	const reader = new ByteReader(bytes);
	if (bytes.length < 4 || reader.u32() !== RECORDING_MAGIC)
		throw new RecordingError(
			'the file is not a null3D recording: it does not start with the format marker. Save the recording again, or ask for a new one.',
		);
	const version = reader.u8();
	if (version !== RECORDING_VERSION)
		throw new RecordingError(
			`the file holds recording version ${version}, and this engine reads version ${RECORDING_VERSION}. Update the engine that made the recording, or replay it with the engine that recorded it.`,
		);
	const flags = reader.u8();
	const fixedRate = whole(reader.u16(), 'the fixed step rate', 1, 1000);
	const seed = reader.u32();
	const sketch = reader.text(4096);
	const keyCount = whole(reader.varint(), 'the dictionary of keys', 0, 512);
	const keyNames: string[] = [];
	for (let k = 0; k < keyCount; k++) keyNames.push(reader.text(64));
	const frameCount = whole(reader.varint(), 'the frame count', 0, MAX_FRAMES);
	const steps = new Float64Array(frameCount);
	const starts = new Uint32Array(frameCount);
	const counts = new Uint32Array(frameCount);
	/** The events as they are read, in a buffer of their own. */
	let events = new Float64Array(1024);
	let total = 0;
	for (let frame = 0; frame < frameCount; frame++) {
		const step = reader.f64();
		if (!(Number.isFinite(step) && step >= 0 && step <= 0.25))
			throw new RecordingError(
				`frame ${frame + 1} holds ${step} as its step, which is not a time from 0 to 0.25 seconds.`,
			);
		const count = whole(reader.varint(), `the input count of frame ${frame + 1}`, 0, MAX_EVENTS);
		if (total + count > MAX_EVENTS)
			throw new RecordingError(`the file holds more than ${MAX_EVENTS} input records.`);
		steps[frame] = step;
		starts[frame] = total;
		counts[frame] = count;
		for (let k = 0; k < count; k++) {
			const type = reader.u8();
			if (type < 1 || type > 10)
				throw new RecordingError(
					`frame ${frame + 1} holds input type ${type}, which this engine does not know.`,
				);
			const code = reader.varint();
			if (isKeyEvent(type) && code >= keyNames.length)
				throw new RecordingError(
					`frame ${frame + 1} names key ${code} of ${keyNames.length} in the file's dictionary.`,
				);
			const at = total * EVENT_STRIDE;
			if (at + EVENT_STRIDE > events.length) {
				const grown = new Float64Array(events.length * 2);
				grown.set(events);
				events = grown;
			}
			events[at] = type;
			events[at + 1] = code;
			events[at + 2] = reader.u8();
			events[at + 3] = reader.u8();
			events[at + 4] = reader.varint();
			events[at + 5] = reader.f32();
			events[at + 6] = reader.f32();
			total++;
		}
	}
	return {
		seed,
		fixedRate,
		sketch,
		stopped: (flags & FLAG_STOPPED) !== 0,
		steps,
		starts,
		counts,
		events: events.slice(0, total * EVENT_STRIDE),
		stride: EVENT_STRIDE,
		keyNames,
	};
}
