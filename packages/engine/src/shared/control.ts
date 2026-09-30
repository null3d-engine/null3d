// The control block: a small shared array through which the page, the sketch worker and the render
// worker exchange frame signals, canvas size and input events. It lives in its own shared buffer,
// separate from WebAssembly memory, so it exists before any worker has loaded the engine core.

/** Int32 slots of the control block, read as `Slot.Running`. */
export * as Slot from './slot';

const SLOT_COUNT = 23;

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

/** An input event's type: one of the `EVENT_` numbers. */
export type InputEventType = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

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

/** Byte size of the whole control buffer: the slots, then the input ring. */
export const CONTROL_BYTES =
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

/** A shared control buffer in threaded mode, or a plain one when the page is not isolated. */
export function createControlBuffer(shared: boolean): ArrayBufferLike {
	return shared ? new SharedArrayBuffer(CONTROL_BYTES) : new ArrayBuffer(CONTROL_BYTES);
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
