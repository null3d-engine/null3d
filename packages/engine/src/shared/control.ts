// The control block: a small shared array through which the page, the sketch worker and the render
// worker exchange frame signals, canvas size and input events. It lives in its own shared buffer,
// separate from WebAssembly memory, so it exists before any worker has loaded the engine core.

/** Int32 slots of the control block. */
export enum Slot {
	/** Frames the sketch worker has published, counting from 1. */
	FramesPublished = 0,
	/** The newest frame the renderer has taken for drawing. */
	FramesTaken = 1,
	/** Nonzero while the engine runs; zero stops every loop. */
	Running = 2,
	/** Nonzero while the engine is paused by the page. */
	Paused = 3,
	/** Incremented each time the page writes a new canvas size. */
	ResizeSerial = 4,
	/** Canvas size in device pixels. */
	CanvasWidth = 5,
	CanvasHeight = 6,
	/** Input ring: the index of the next event slot the page writes, counting up without wrapping. */
	InputWrite = 7,
	/**
	 * The number of the frame the renderer drew last. The page writes it with each input event, so a
	 * pointer event names the frame that was on screen when it came.
	 */
	FramePresented = 8,
	/** Addresses of the two draw lists in engine memory, by frame parity. They never move. */
	DrawListAddress0 = 9,
	DrawListAddress1 = 10,
	/** Words recorded into each draw list, by frame parity. */
	DrawListWords0 = 11,
	DrawListWords1 = 12,
	/**
	 * Incremented each time the page resumes the sketch or shows a hidden page again, so the sketch's
	 * next step counts no time.
	 */
	Resumes = 13,
	/**
	 * Incremented by the thread that draws each time it replaces a GPU device that the browser took
	 * away. The sketch thread then records a frame that creates every GPU object again.
	 */
	GpuEpoch = 14,
	/**
	 * The GPU epoch each frame parity's draw list was recorded for. A list from an older epoch names
	 * GPU objects that the new device lacks, so the renderer takes that frame without drawing it.
	 */
	FrameEpoch0 = 15,
	FrameEpoch1 = 16,
	/** Nonzero while the user's system asks pages for less motion. */
	ReducedMotion = 17,
	/** Nonzero once the sketch thread has created the job system that the job workers serve. */
	JobsReady = 18,
	/** Input ring: the index of the next event the sketch reads, counting up as `InputWrite` does. */
	InputRead = 19,
	/** The canvas size in CSS pixels, as float bits: read them through `slotFloats`. */
	CanvasCssWidth = 20,
	CanvasCssHeight = 21,
	/**
	 * Device pixels per CSS pixel that the engine draws with, as float bits: the display's ratio,
	 * capped by the page's `maxPixelRatio`.
	 */
	PixelRatio = 22,
}

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
