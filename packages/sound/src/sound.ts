// The sketch's half of the add-on: the sounds a sketch makes and the table it writes for them. Each
// sound owns emitters in the table, a place, a level, a rate and a tone each, and voices, which the
// page's half turns into the browser's audio nodes. The sketch writes the listener's place and turn
// once a frame, in `update`, and the values of its emitters whenever it likes. The mixer on the
// audio thread reads them from there, so nothing in a frame sends a message.
//
// The page's half opens a link of its own with a message port, so the add-on never listens on the
// page's own channel of messages. The sketch sends the table and each sound's description over that
// link, and a message for each shot that plays.
import type { QuatLike, SketchContext, Vec3Like } from '@null3d/engine';
import { SOUND_CODES, soundError } from './errors';
import {
	CONNECT_MESSAGE,
	type ConnectData,
	DEFAULT_CAPACITY,
	isShared,
	MAX_CAPACITY,
	MAX_VOICES,
	tableLayout,
} from './layout';
import { NAMESPACE } from './namespace';
import type { Panning, SketchMessage, SoundKind, SoundSpec, TableLayout } from './protocol';

/**
 * The object that hears the sounds, usually the active camera. The add-on reads its place and turn
 * in the world once a frame. A camera looks down its own -Z axis, and so does the listener.
 *
 * @category api/sound
 */
export interface SoundListener {
	/** Writes the object's place in the world into `out`. */
	getWorldPosition(out: Vec3Like): void;
	/** Writes the object's turn in the world, as a quaternion, into `out`. */
	getWorldQuaternion(out: QuatLike): void;
}

/**
 * Options for `createSound`.
 *
 * @category api/sound
 */
export interface SoundOptions {
	/** The object that hears the sounds, usually the active camera. */
	listener: SoundListener;
	/**
	 * The emitters that the sketch's sounds hold together: one for each loop, one for each member of
	 * a group, and one for each voice of a shot. The default is 256 and the most is 4,096.
	 */
	capacity?: number;
	/** The volume of every sound, from 0 to 1. The default is 1. */
	volume?: number;
}

/**
 * How a sound falls off with distance. A sound with neither distance keeps the level that the sketch
 * gives it wherever the listener stands.
 *
 * @category api/sound
 */
export interface SoundPlacement {
	/**
	 * The distance within which the sound is at its full level. Beyond it the level falls as the
	 * distance grows: at twice this distance it is half. Leave it out for a sound whose level the
	 * sketch sets itself.
	 */
	near?: number;
	/** The distance at which the sound has faded out. Leave it out for no such distance. */
	far?: number;
	/**
	 * Whether the sound loses its highs as it nears its far distance, as distant sounds do. The
	 * default is true for a sound with a far distance.
	 */
	muffle?: boolean;
}

/**
 * Options for `sound.loop`.
 *
 * @category api/sound
 */
export interface SoundLoopOptions extends SoundPlacement {
	/** The audio file's address: an absolute address, or `new URL('./file.mp3', import.meta.url)`. */
	file: string | URL;
	/**
	 * True for a sound that comes from a place, which `setPosition` moves. False for a bed that plays
	 * in both ears alike, such as wind or rain. The default is true.
	 */
	positional?: boolean;
	/** The first level, from 0. The default is 1. */
	level?: number;
	/** The first playback rate, where 1 is the file's own speed and pitch. The default is 1. */
	rate?: number;
	/** The first tone, from 0 (muffled) to 1 (the file's own brightness). The default is 1. */
	tone?: number;
	/** The first place in the world. The default is the origin. */
	position?: readonly [number, number, number];
}

/**
 * Options for `sound.group`.
 *
 * @category api/sound
 */
export interface SoundGroupOptions extends SoundPlacement {
	/** The audio file that every member plays, as `SoundLoopOptions.file` takes it. */
	file: string | URL;
	/** The members of the group, each with its own place, level, rate and tone. */
	count: number;
	/** The members that sound at once: the loudest where the listener stands. */
	voices: number;
}

/**
 * Options for `sound.shot`.
 *
 * @category api/sound
 */
export interface SoundShotOptions extends SoundPlacement {
	/** The audio file that each play starts, as `SoundLoopOptions.file` takes it. */
	file: string | URL;
	/** The plays that sound at once. A play past this count stops the oldest. The default is 2. */
	voices?: number;
	/** True for a shot that comes from a place. The default is true. */
	positional?: boolean;
}

/**
 * A sound that plays its file over and over, as `sound.loop` makes it.
 *
 * @category api/sound
 */
export interface SoundLoop {
	/** Sets the level, from 0. A level of 0 silences the sound. */
	setLevel(level: number): void;
	/** Sets the playback rate, where 1 is the file's own speed and pitch. */
	setRate(rate: number): void;
	/** Sets the tone, from 0 (muffled) to 1 (the file's own brightness). */
	setTone(tone: number): void;
	/** Moves the sound to a place in the world. A bed that plays in both ears ignores its place. */
	setPosition(x: number, y: number, z: number): void;
	/** Stops the sound, with a short fade, and frees its emitter and its voice. */
	destroy(): void;
}

/**
 * Many sounds that play one file, such as the engines of the cars in a street, as `sound.group`
 * makes it. Its arrays are views of the table, which a sketch may also write in bulk.
 *
 * @category api/sound
 */
export interface SoundGroup {
	/** The members of the group. */
	readonly count: number;
	/** Each member's place in the world, three numbers each. */
	readonly positions: Float32Array;
	/** Each member's level, from 0. */
	readonly levels: Float32Array;
	/** Each member's playback rate. */
	readonly rates: Float32Array;
	/** Each member's tone, from 0 to 1. */
	readonly tones: Float32Array;
	/** Moves member `index` to a place in the world. */
	setPosition(index: number, x: number, y: number, z: number): void;
	/** Sets member `index`'s level. */
	setLevel(index: number, level: number): void;
	/** Sets member `index`'s playback rate. */
	setRate(index: number, rate: number): void;
	/** Sets member `index`'s tone. */
	setTone(index: number, tone: number): void;
	/** Stops every member, with a short fade, and frees the group's emitters and voices. */
	destroy(): void;
}

/**
 * A sound that plays its file once for each call, such as thunder or a door, as `sound.shot` makes
 * it.
 *
 * @category api/sound
 */
export interface SoundShot {
	/**
	 * Plays the file once at a place in the world, at a level and a playback rate. A shot that plays
	 * in both ears ignores the place.
	 */
	play(x: number, y: number, z: number, level?: number, rate?: number): void;
	/** Stops every play and frees the shot's emitters and voices. */
	destroy(): void;
}

/**
 * The sketch's sounds, as `createSound` makes them.
 *
 * @category api/sound
 */
export interface Sound {
	/** True once the page's half has opened its link to the sketch. */
	readonly connected: boolean;
	/** Makes a sound that plays its file over and over. */
	loop(options: SoundLoopOptions): SoundLoop;
	/** Makes a group of sounds that play one file, of which the loudest few sound at once. */
	group(options: SoundGroupOptions): SoundGroup;
	/** Makes a sound that plays its file once for each call of its `play`. */
	shot(options: SoundShotOptions): SoundShot;
	/** Sets the volume of every sound, from 0 to 1. */
	setVolume(volume: number): void;
	/**
	 * Reads the listener's place and turn and counts the frame. Call it once a frame, in
	 * `onLateUpdate`, after the camera has moved. A sketch that stops calling it fades every sound
	 * out, as a paused engine does.
	 */
	update(): void;
	/** Stops every sound and closes the link to the page. */
	destroy(): void;
}

/** The panning that a quality preset gives: the full ear model on the two heaviest presets. */
function panningOf(preset: string): Panning {
	return preset === 'high' || preset === 'ultra' ? 'hrtf' : 'equal-power';
}

/** True where a worker and the page can share memory. */
function canShare(): boolean {
	return (
		typeof SharedArrayBuffer !== 'undefined' &&
		(globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
	);
}

/** The absolute address of a file that a sketch names. */
function addressOf(file: string | URL): string {
	if (file instanceof URL) return file.href;
	if (typeof file !== 'string' || file === '')
		throw soundError(SOUND_CODES, 'a sound needs its file: an address string or a URL.');
	const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
	return new URL(file, base).href;
}

/** A number that a sketch gave, checked: finite, and at least `least`. */
function checked(name: string, value: number | undefined, fallback: number, least = 0): number {
	if (value === undefined) return fallback;
	if (!Number.isFinite(value) || value < least)
		throw soundError(
			SOUND_CODES,
			`${name} must be a finite number of at least ${least}, and got ${value}.`,
		);
	return value;
}

/** True when `data` is what the page's half sends to connect. */
function isConnectData(data: unknown): data is ConnectData {
	const value = data as Partial<ConnectData> | null;
	return (
		typeof value?.port?.postMessage === 'function' &&
		typeof value.box === 'object' &&
		value.box !== null
	);
}

class SoundSystem implements Sound {
	private readonly layout: TableLayout;
	private readonly buffer: ArrayBuffer | SharedArrayBuffer;
	private readonly floats: Float32Array;
	private readonly ints: Int32Array;
	/** 1 for each emitter that a sound owns. */
	private readonly emittersUsed: Uint8Array;
	/** 1 for each voice that a sound owns. */
	private readonly voicesUsed = new Uint8Array(MAX_VOICES);
	private readonly sounds = new Map<number, SoundSpec>();
	private nextId = 1;
	private link: MessagePort | null = null;
	private panning: Panning;
	private readonly stopMessages: () => void;
	private readonly stopQuality: () => void;
	private destroyed = false;
	/** The listener's place and turn, read into arrays that the sketch keeps. */
	private readonly at = new Float64Array(3);
	private readonly turn = new Float64Array(4);

	constructor(
		ctx: SketchContext,
		private readonly listener: SoundListener,
		capacity: number,
		volume: number,
	) {
		this.layout = tableLayout(capacity);
		const bytes = this.layout.length * Float32Array.BYTES_PER_ELEMENT;
		this.buffer = canShare() ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
		this.floats = new Float32Array(this.buffer);
		this.ints = new Int32Array(this.buffer);
		this.floats[this.layout.volume] = volume;
		this.floats[this.layout.listenerTurn + 3] = 1;
		this.emittersUsed = new Uint8Array(capacity);
		this.panning = panningOf(ctx.quality.preset);
		this.stopMessages = ctx.page.onMessage((type, data) => {
			if (type === CONNECT_MESSAGE && isConnectData(data)) this.connect(data);
		});
		this.stopQuality = ctx.quality.onChange((quality) => {
			const panning = panningOf(quality.preset);
			if (panning === this.panning) return;
			this.panning = panning;
			this.send({ type: 'panning', panning });
		});
	}

	get connected(): boolean {
		return this.link !== null;
	}

	/** Takes the page's link, and sends it the table and every sound. */
	private connect(data: ConnectData): void {
		if (this.destroyed) return;
		this.link?.close();
		this.link = data.port;
		// Where the sketch runs on the page's thread, the page sent this very box, and reads the live
		// table from it. Elsewhere the page got a copy of the box, and the table is shared.
		if (!isShared(this.buffer)) data.box.table = this.buffer;
		this.send({ type: 'table', buffer: this.buffer, layout: this.layout, panning: this.panning });
		for (const sound of this.sounds.values()) this.send({ type: 'add', sound });
	}

	private send(message: SketchMessage): void {
		this.link?.postMessage(message);
	}

	/** Takes `count` emitters in a row, or throws when the table has no such room. */
	private takeEmitters(count: number): number {
		const used = this.emittersUsed;
		let run = 0;
		for (let e = 0; e < used.length; e++) {
			run = used[e] === 1 ? 0 : run + 1;
			if (run === count) {
				const first = e - count + 1;
				used.fill(1, first, first + count);
				return first;
			}
		}
		throw soundError(
			SOUND_CODES + 2,
			`the sounds need ${count} more emitters in a row, and the table of ${used.length} has no such room. Raise createSound's capacity option (up to ${MAX_CAPACITY}).`,
		);
	}

	/** Takes `count` voices in a row, or throws when the page has no such room. */
	private takeVoices(count: number): number {
		const used = this.voicesUsed;
		let run = 0;
		for (let v = 0; v < used.length; v++) {
			run = used[v] === 1 ? 0 : run + 1;
			if (run === count) {
				const first = v - count + 1;
				used.fill(1, first, first + count);
				return first;
			}
		}
		throw soundError(
			SOUND_CODES + 1,
			`the sounds need ${count} more voices in a row, and the page plays ${MAX_VOICES} at most. Give groups and shots fewer voices, or destroy sounds that are no longer heard.`,
		);
	}

	/** Makes a sound's description, takes its emitters and voices, and tells the page. */
	private make(
		kind: SoundKind,
		file: string | URL,
		count: number,
		voices: number,
		positional: boolean,
		placement: SoundPlacement,
	): SoundSpec {
		if (this.destroyed)
			throw soundError(SOUND_CODES, 'this sound system was destroyed; make a new one.');
		const address = addressOf(file);
		const near = checked('near', placement.near, 0);
		const far = checked('far', placement.far, 0);
		if (far > 0 && far <= near)
			throw soundError(SOUND_CODES, `far (${far}) must be larger than near (${near}).`);
		const first = this.takeEmitters(count);
		let voice: number;
		try {
			voice = this.takeVoices(voices);
		} catch (error) {
			this.emittersUsed.fill(0, first, first + count);
			throw error;
		}
		const layout = this.layout;
		this.floats.fill(0, layout.places + 3 * first, layout.places + 3 * (first + count));
		this.floats.fill(1, layout.levels + first, layout.levels + first + count);
		this.floats.fill(1, layout.rates + first, layout.rates + first + count);
		this.floats.fill(1, layout.tones + first, layout.tones + first + count);
		const sound: SoundSpec = {
			id: this.nextId++,
			kind,
			file: address,
			first,
			count,
			voice,
			voices,
			positional,
			near,
			far,
			muffle: placement.muffle ?? far > 0,
		};
		this.sounds.set(sound.id, sound);
		this.send({ type: 'add', sound });
		return sound;
	}

	/** Frees a sound's emitters and voices and tells the page. */
	private free(sound: SoundSpec): void {
		if (!this.sounds.delete(sound.id)) return;
		this.floats.fill(
			0,
			this.layout.levels + sound.first,
			this.layout.levels + sound.first + sound.count,
		);
		this.emittersUsed.fill(0, sound.first, sound.first + sound.count);
		this.voicesUsed.fill(0, sound.voice, sound.voice + sound.voices);
		this.send({ type: 'remove', id: sound.id });
	}

	loop(options: SoundLoopOptions): SoundLoop {
		const sound = this.make('loop', options.file, 1, 1, options.positional ?? true, options);
		const { floats, layout } = this;
		const e = sound.first;
		floats[layout.levels + e] = checked('level', options.level, 1);
		floats[layout.rates + e] = checked('rate', options.rate, 1);
		floats[layout.tones + e] = checked('tone', options.tone, 1);
		const [x = 0, y = 0, z = 0] = options.position ?? [];
		floats[layout.places + 3 * e] = x;
		floats[layout.places + 3 * e + 1] = y;
		floats[layout.places + 3 * e + 2] = z;
		return {
			setLevel: (level) => {
				floats[layout.levels + e] = level;
			},
			setRate: (rate) => {
				floats[layout.rates + e] = rate;
			},
			setTone: (tone) => {
				floats[layout.tones + e] = tone;
			},
			setPosition: (px, py, pz) => {
				const at = layout.places + 3 * e;
				floats[at] = px;
				floats[at + 1] = py;
				floats[at + 2] = pz;
			},
			destroy: () => this.free(sound),
		};
	}

	group(options: SoundGroupOptions): SoundGroup {
		const count = checked('count', options.count, 0, 1);
		const voices = checked('voices', options.voices, 0, 1);
		if (!Number.isInteger(count) || !Number.isInteger(voices))
			throw soundError(
				SOUND_CODES,
				`count and voices must be whole numbers, and got ${count} and ${voices}.`,
			);
		const sound = this.make('group', options.file, count, Math.min(voices, count), true, options);
		const { floats, layout } = this;
		const first = sound.first;
		const index = (i: number): number => {
			if (!(i >= 0 && i < count))
				throw soundError(SOUND_CODES + 3, `member ${i} is not one of the group's ${count}.`);
			return first + i;
		};
		return {
			count,
			positions: floats.subarray(layout.places + 3 * first, layout.places + 3 * (first + count)),
			levels: floats.subarray(layout.levels + first, layout.levels + first + count),
			rates: floats.subarray(layout.rates + first, layout.rates + first + count),
			tones: floats.subarray(layout.tones + first, layout.tones + first + count),
			setPosition: (i, x, y, z) => {
				const at = layout.places + 3 * index(i);
				floats[at] = x;
				floats[at + 1] = y;
				floats[at + 2] = z;
			},
			setLevel: (i, level) => {
				floats[layout.levels + index(i)] = level;
			},
			setRate: (i, rate) => {
				floats[layout.rates + index(i)] = rate;
			},
			setTone: (i, tone) => {
				floats[layout.tones + index(i)] = tone;
			},
			destroy: () => this.free(sound),
		};
	}

	shot(options: SoundShotOptions): SoundShot {
		const voices = checked('voices', options.voices, 2, 1);
		if (!Number.isInteger(voices))
			throw soundError(SOUND_CODES, `voices must be a whole number, and got ${voices}.`);
		const sound = this.make(
			'shot',
			options.file,
			voices,
			voices,
			options.positional ?? true,
			options,
		);
		const { floats, layout } = this;
		let next = 0;
		return {
			play: (x, y, z, level = 1, rate = 1) => {
				if (!this.sounds.has(sound.id)) return;
				const slot = next;
				next = (next + 1) % voices;
				const e = sound.first + slot;
				floats[layout.places + 3 * e] = x;
				floats[layout.places + 3 * e + 1] = y;
				floats[layout.places + 3 * e + 2] = z;
				floats[layout.levels + e] = level;
				floats[layout.rates + e] = rate;
				this.send({ type: 'play', id: sound.id, slot });
			},
			destroy: () => this.free(sound),
		};
	}

	setVolume(volume: number): void {
		this.floats[this.layout.volume] = volume;
	}

	update(): void {
		const { floats, layout, at, turn } = this;
		this.listener.getWorldPosition(at);
		this.listener.getWorldQuaternion(turn);
		floats[layout.listenerAt] = at[0] as number;
		floats[layout.listenerAt + 1] = at[1] as number;
		floats[layout.listenerAt + 2] = at[2] as number;
		floats[layout.listenerTurn] = turn[0] as number;
		floats[layout.listenerTurn + 1] = turn[1] as number;
		floats[layout.listenerTurn + 2] = turn[2] as number;
		floats[layout.listenerTurn + 3] = turn[3] as number;
		this.ints[layout.frame] = ((this.ints[layout.frame] as number) + 1) | 0;
	}

	destroy(): void {
		if (this.destroyed) return;
		for (const sound of [...this.sounds.values()]) this.free(sound);
		this.destroyed = true;
		this.stopMessages();
		this.stopQuality();
		this.link?.close();
		this.link = null;
	}
}

/**
 * Makes the sketch's sounds. Call it in the sketch's setup, and call `update` once a frame in
 * `onLateUpdate`. The sounds play on the page once the page's half, `connectSound` from
 * `@null3d/sound/page`, has started the audio. A sketch may make its sounds at any time; a sound made
 * before the page connects plays once it does.
 *
 * @category api/sound
 */
export function createSound(ctx: SketchContext, options: SoundOptions): Sound {
	void NAMESPACE;
	const listener = options?.listener;
	if (
		typeof listener?.getWorldPosition !== 'function' ||
		typeof listener.getWorldQuaternion !== 'function'
	)
		throw soundError(
			SOUND_CODES,
			'createSound needs a listener: the camera, or another scene object that hears the sounds.',
		);
	const capacity = checked('capacity', options.capacity, DEFAULT_CAPACITY, 1);
	if (!Number.isInteger(capacity) || capacity > MAX_CAPACITY)
		throw soundError(
			SOUND_CODES,
			`capacity must be a whole number from 1 to ${MAX_CAPACITY}, and got ${capacity}.`,
		);
	const volume = checked('volume', options.volume, 1);
	return new SoundSystem(ctx, listener, capacity, volume);
}
