// The control block: a small shared array through which the page, the sketch worker and the render
// worker exchange frame signals, canvas size and input events, and the label tables after them. It
// lives in its own shared buffer, separate from WebAssembly memory, so it exists before any worker
// has loaded the engine core.

import { type LabelRegion, labelBytes, labelRegion } from './labels';

/** Int32 slots of the control block, read as `Slot.Running`. */
export * as Slot from './slot';

const SLOT_COUNT = 33;

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

/** An input event's type: one of the `EVENT_` numbers. */
export type InputEventType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/*
 * Int32 offsets of the fields of an input record. What a field holds depends on the event:
 *
 * | Field | Pointer | Wheel | Key | Gamepad button | Gamepad axis |
 * | --- | --- | --- | --- | --- | --- |
 * | `FIELD_X`, `FIELD_Y` (floats) | position in CSS pixels | scroll in pixels | | `X`: value | `X`: value |
 * | `FIELD_CODE` | the button that changed | | key number | button number | axis number |
 * | `FIELD_ID` | pointer id | | | pad number | pad number |
 * | `FIELD_BUTTONS` | the buttons held | | | 1 while pressed | |
 * | `FIELD_FLAGS` | `FLAG_` bits | modifiers | modifiers | | |
 *
 * Every record holds the frame on screen when the page wrote it, at `FIELD_FRAME`.
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
 * label tables for `maxLabels` labels.
 */
export function createControlBuffer(shared: boolean, maxLabels = 0): ArrayBufferLike {
	const bytes = CONTROL_BYTES + labelBytes(maxLabels);
	return shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes);
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
