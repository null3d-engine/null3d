// The control block: a small shared array through which the page, the sketch worker and the render
// worker exchange frame signals, canvas size and input events, and the label tables after them. It
// lives in its own shared buffer, separate from WebAssembly memory, so it exists before any worker
// has loaded the engine core.

import { type LabelRegion, labelBytes, labelRegion, setLabelCapacity3d } from './labels';
import * as Slot from './slot';

/** Int32 slots of the control block, read as `Slot.Running`. */
export { Slot };

/** The Int32 slots at the start of the control block, one for every name in the slot table. */
export const SLOT_COUNT = 60;
/** Int32 values per input event record. */
export const INPUT_EVENT_INTS = 8;
/** Input events the ring holds, a power of two; older unread events are overwritten. */
export const INPUT_RING_EVENTS = 256;

/** Gamepads the ring carries, by the browser's pad number, and the standard layout's buttons and axes. */
export const GAMEPADS = 4;
export const GAMEPAD_BUTTONS = 17;
export const GAMEPAD_AXES = 4;

// The input ring's record format. Plain constants, which the bundler writes into the code as
// numbers: an enum would ship as an object with every member's name.

/** Input event types. A pointer's release and the browser's cancel of a touch are both `EVENT_POINTER_UP`. */
export const EVENT_POINTER_MOVE = 1;
export const EVENT_POINTER_DOWN = 2;
export const EVENT_POINTER_UP = 3;
export const EVENT_KEY_DOWN = 4;
export const EVENT_KEY_UP = 5;
export const EVENT_WHEEL = 6;
export const EVENT_GAMEPAD_BUTTON = 7;
export const EVENT_GAMEPAD_AXIS = 8;
/**
 * The pointer left the canvas, or an element over the canvas covers it, while no drag holds it. Its
 * fields are those of a pointer event.
 */
export const EVENT_POINTER_LEAVE = 9;
/** The pointer lock began or ended. Its code is 1 while the canvas holds the lock, and 0 after. */
export const EVENT_POINTER_LOCK = 10;

/** An input event's type: one of the `EVENT_` numbers. */
export type InputEventType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

/*
 * Int32 offsets of the fields of an input record. What a field holds depends on the event:
 *
 * | Field | Pointer | Wheel | Key | Gamepad button | Gamepad axis | Pointer lock |
 * | --- | --- | --- | --- | --- | --- | --- |
 * | `FIELD_X`, `FIELD_Y` (floats) | position in CSS pixels | scroll in pixels | | `X`: value | `X`: value | |
 * | `FIELD_CODE` | the button that changed | | key number | button number | axis number | 1 locked, 0 not |
 * | `FIELD_ID` | pointer id | | | pad number | pad number | |
 * | `FIELD_BUTTONS` | the buttons held | | | 1 while pressed | | |
 * | `FIELD_FLAGS` | `FLAG_` bits | modifiers | modifiers | | | |
 *
 * While the pointer is locked, a pointer record holds the movement since the pointer's previous
 * event in place of a position, and `FLAG_LOCKED`. Every record holds the frame on screen when the
 * page wrote it, at `FIELD_FRAME`.
 */
export const FIELD_TYPE = 0;
export const FIELD_FRAME = 1;
export const FIELD_X = 2;
export const FIELD_Y = 3;
export const FIELD_CODE = 4;
export const FIELD_ID = 5;
export const FIELD_BUTTONS = 6;
export const FIELD_FLAGS = 7;

/** Bits of an input record's flags: the modifier keys held, and the kind of pointer. */
export const FLAG_SHIFT = 1;
export const FLAG_CONTROL = 2;
export const FLAG_ALT = 4;
export const FLAG_META = 8;
export const FLAG_PEN = 16;
export const FLAG_TOUCH = 32;
/** The pointer is the mouse, a pen, or the first finger of a touch. */
export const FLAG_PRIMARY = 64;
/** The pointer is locked to the canvas: the record's X and Y hold movement, not a position. */
export const FLAG_LOCKED = 128;

/** Byte size of the control buffer's slots and input ring, after which the label tables start. */
const CONTROL_BYTES =
	(SLOT_COUNT + INPUT_RING_EVENTS * INPUT_EVENT_INTS) * Int32Array.BYTES_PER_ELEMENT;

export interface ControlViews {
	slots: Int32Array;
	/** The same slots as floats, for the slots that hold float bits. */
	slotFloats: Float32Array;
	/** Input records as integers, with fields at the `FIELD_` offsets. */
	inputInts: Int32Array;
	/** The same memory as floats, for the fields that hold floats. */
	inputFloats: Float32Array;
}

/**
 * A shared control buffer in threaded mode, or a plain one when the page is not isolated, with
 * label tables for `maxLabels` screen labels and `maxLabels3d` 3D labels.
 */
export function createControlBuffer(
	shared: boolean,
	maxLabels = 0,
	maxLabels3d = 0,
): ArrayBufferLike {
	const bytes = CONTROL_BYTES + labelBytes(maxLabels, maxLabels3d);
	const buffer = shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
	// A buffer without label tables has no header to hold the 3D capacity.
	if (bytes > CONTROL_BYTES) setLabelCapacity3d(buffer, CONTROL_BYTES, maxLabels3d);
	return buffer;
}

/** The label tables of a control buffer, or undefined when it holds none. */
export function controlLabels(buffer: ArrayBufferLike): LabelRegion | undefined {
	return labelRegion(buffer, CONTROL_BYTES);
}

export function controlViews(buffer: ArrayBufferLike): ControlViews {
	const slotBytes = SLOT_COUNT * Int32Array.BYTES_PER_ELEMENT;
	return {
		slots: new Int32Array(buffer, 0, SLOT_COUNT),
		slotFloats: new Float32Array(buffer, 0, SLOT_COUNT),
		inputInts: new Int32Array(buffer, slotBytes, INPUT_RING_EVENTS * INPUT_EVENT_INTS),
		inputFloats: new Float32Array(buffer, slotBytes, INPUT_RING_EVENTS * INPUT_EVENT_INTS),
	};
}

/**
 * Writes one input record at the ring's write index, where the sketch reads it at the start of its
 * next frame. The page's input capture writes the user's events this way; hold mode writes a timed
 * script's events this way, on the thread that runs the sketch.
 *
 * @param {ControlViews} views
 * @param {InputEventType} type
 * @param {number} x The pointer's distance from the canvas's left edge, or a wheel's scroll.
 * @param {number} y The pointer's distance from the canvas's top edge, or a wheel's scroll.
 * @param {number} code The key's number, or a mouse button's.
 * @param {number} id The pointer's id.
 * @param {number} buttons The pointer's buttons, as `PointerEvent.buttons` gives them.
 * @param {number} flags The event's flags, as the `FLAG_` names give them.
 * @param {number} frame The frame on screen at the event, in the engine's count.
 */
export function writeInputEvent(
	views: ControlViews,
	type: InputEventType,
	x: number,
	y: number,
	code: number,
	id: number,
	buttons: number,
	flags: number,
	frame: number,
): void {
	const { slots, inputInts: ints, inputFloats: floats } = views;
	const index = Atomics.load(slots, Slot.InputWrite);
	const base = (index & (INPUT_RING_EVENTS - 1)) * INPUT_EVENT_INTS;
	ints[base + FIELD_TYPE] = type;
	ints[base + FIELD_FRAME] = frame;
	floats[base + FIELD_X] = x;
	floats[base + FIELD_Y] = y;
	ints[base + FIELD_CODE] = code;
	ints[base + FIELD_ID] = id;
	ints[base + FIELD_BUTTONS] = buttons;
	ints[base + FIELD_FLAGS] = flags;
	Atomics.store(slots, Slot.InputWrite, (index + 1) | 0);
}

// The engine's frame numbers, as every thread and the core count them. The control slots hold them
// in 32 bits, so the count goes round after about 4 billion frames: 2 years at 60 frames a second,
// and 207 days at 240. A frame number is a 32-bit integer that skips 0, which means "no frame yet",
// and -1, which means "none" where a frame is asked for. Frames compare by their distance in that
// circle, which holds while two frames lie less than 2^31 frames apart.

/** The first frame number, which also follows the last of the circle, -2. */
export const FIRST_FRAME = 1;

/** The frame after `frame`. */
export function nextFrame(frame: number): number {
	const next = (frame + 1) | 0;
	return next === 0 || next === -1 ? FIRST_FRAME : next;
}

/** The frame before `frame`. */
export function previousFrame(frame: number): number {
	return frame === FIRST_FRAME ? -2 : (frame - 1) | 0;
}

/** True when frame `a` comes after frame `b`. */
export function frameAfter(a: number, b: number): boolean {
	return ((a - b) | 0) > 0;
}

/** True when frame `a` is frame `b` or comes after it. */
export function frameReached(a: number, b: number): boolean {
	return ((a - b) | 0) >= 0;
}
