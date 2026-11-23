// The table that the sketch writes and the audio thread reads: a frame count, the volume, the
// listener's place and turn, then the values of each sound's emitters. The sketch makes the table
// and the page tells the mixer where each block lies, so the mixer's module needs nothing from here.
//
// The table is one buffer with a float view and an integer view. Where the page shares memory with
// its workers, the buffer is a SharedArrayBuffer that the sketch writes in its frame and the mixer
// reads in each render quantum, with no message between them. A page without shared memory runs
// the sketch on its own thread, and the page then hands the mixer a copy of the table once per
// display frame.
import type { MixerOutputs, TableLayout } from './protocol';

/** The integer slot that counts the sketch's frames, which tells the mixer the sketch is running. */
const FRAME = 0;
/** The float slot of the volume of every sound, from 0 to 1. */
const VOLUME = 1;
/** The first float slot of the listener's place: three numbers in world units. */
const LISTENER_AT = 4;
/** The first float slot of the listener's turn: a quaternion, x, y, z then w. */
const LISTENER_TURN = 7;
/** The slots that come before the emitters. */
const HEADER = 12;

/**
 * The message that the page's half sends the sketch to open a link of its own: a message port, which
 * carries every later message between the two, and a box. Where the sketch runs on the page's own
 * thread, the engine hands the sketch the very object that the page sent, and the sketch puts its
 * table in the box, since a port would hand the page a copy.
 */
export const CONNECT_MESSAGE = 'null3d-sound:connect';

/** What the page sends with the connect message. */
export interface ConnectData {
	readonly port: MessagePort;
	readonly box: { table: ArrayBuffer | SharedArrayBuffer | null };
}

/**
 * True when `buffer` is shared memory. A page without cross-origin isolation has no
 * `SharedArrayBuffer` at all, so the check names it only where it exists.
 */
export function isShared(buffer: ArrayBuffer | SharedArrayBuffer): buffer is SharedArrayBuffer {
	return typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer;
}

/** The emitters that a table holds by default, which `createSound`'s `capacity` option changes. */
export const DEFAULT_CAPACITY = 256;
/** The most emitters that one table holds. */
export const MAX_CAPACITY = 4096;

/**
 * The voices that one page plays at once. Each voice is one sound that the browser mixes, and the
 * mixer drives each voice's place, level, rate and tone through one channel of an output, of which
 * the browser allows 32.
 */
export const MAX_VOICES = 32;

/** The mixer's outputs, one for each value that it drives in every voice. */
export const MIXER_OUTPUTS: MixerOutputs = { x: 0, y: 1, z: 2, gain: 3, rate: 4, cutoff: 5 };
/** How many outputs the mixer has. */
export const OUTPUT_COUNT = 6;

/**
 * Where each block of a table of `capacity` emitters lies. Each emitter has a place of three
 * numbers, a level, a rate and a tone, kept in a block for each value, so a page can copy a whole
 * array of places in one call.
 */
export function tableLayout(capacity: number): TableLayout {
	const places = HEADER;
	const levels = places + 3 * capacity;
	const rates = levels + capacity;
	const tones = rates + capacity;
	return {
		capacity,
		frame: FRAME,
		volume: VOLUME,
		listenerAt: LISTENER_AT,
		listenerTurn: LISTENER_TURN,
		places,
		levels,
		rates,
		tones,
		length: tones + capacity,
	};
}
