// The control block: a small shared array through which the page, the game worker and the render
// worker exchange frame signals, canvas size and input events. It lives in its own shared buffer,
// separate from WebAssembly memory, so it exists before any worker has loaded the engine core.

/** Int32 slots of the control block. */
export enum Slot {
	/** Frames the game worker has published, counting from 1. */
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
	/** Frames the renderer has presented, for frame statistics. */
	FramesPresented = 8,
	/** Addresses of the two draw lists in engine memory, by frame parity. They never move. */
	DrawListAddress0 = 9,
	DrawListAddress1 = 10,
	/** Words recorded into each draw list, by frame parity. */
	DrawListWords0 = 11,
	DrawListWords1 = 12,
	/**
	 * Incremented each time the page resumes the game or shows a hidden page again, so the game's
	 * next step counts no time.
	 */
	Resumes = 13,
	/**
	 * Incremented by the thread that draws each time it replaces a GPU device that the browser took
	 * away. The game thread then records a frame that creates every GPU object again.
	 */
	GpuEpoch = 14,
	/**
	 * The GPU epoch each frame parity's draw list was recorded for. A list from an older epoch names
	 * GPU objects that the new device lacks, so the renderer takes that frame without drawing it.
	 */
	FrameEpoch0 = 15,
	FrameEpoch1 = 16,
}

const SLOT_COUNT = 20;

/** Int32 values per input event record. */
export const INPUT_EVENT_INTS = 8;
/** Input events the ring holds; older unread events are overwritten. */
export const INPUT_RING_EVENTS = 256;

export enum InputEventType {
	PointerMove = 1,
	PointerDown = 2,
	PointerUp = 3,
	KeyDown = 4,
	KeyUp = 5,
	Wheel = 6,
}

/** Byte size of the whole control buffer: the slots, then the input ring. */
export const CONTROL_BYTES =
	(SLOT_COUNT + INPUT_RING_EVENTS * INPUT_EVENT_INTS) * Int32Array.BYTES_PER_ELEMENT;

export interface ControlViews {
	slots: Int32Array;
	/** Input records as integers: type, time in ms, x and y as float bits, buttons, key code, modifiers, pointer id. */
	inputInts: Int32Array;
	/** The same memory as floats, for pointer coordinates. */
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
		inputInts: new Int32Array(buffer, slotBytes, INPUT_RING_EVENTS * INPUT_EVENT_INTS),
		inputFloats: new Float32Array(buffer, slotBytes, INPUT_RING_EVENTS * INPUT_EVENT_INTS),
	};
}
