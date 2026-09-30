// The page's end of the input ring: writes each input event as one record into the control block,
// where the sketch reads it at the start of its next frame. Each record also holds the number of the
// frame on screen when the page wrote it, so a pointer event names the frame that the user saw.

import {
	controlViews,
	FIELD_BUTTONS,
	FIELD_CODE,
	FIELD_FLAGS,
	FIELD_FRAME,
	FIELD_ID,
	FIELD_TYPE,
	FIELD_X,
	FIELD_Y,
	INPUT_EVENT_INTS,
	INPUT_RING_EVENTS,
	type InputEventType,
	Slot,
} from '../shared/control';

const RING_MASK = INPUT_RING_EVENTS - 1;

export class InputRing {
	private readonly slots: Int32Array;
	private readonly ints: Int32Array;
	private readonly floats: Float32Array;

	constructor(control: ArrayBufferLike) {
		const views = controlViews(control);
		this.slots = views.slots;
		this.ints = views.inputInts;
		this.floats = views.inputFloats;
	}

	/**
	 * True while half the ring waits for the sketch, as while its setup runs. The page then leaves out
	 * events that a later event replaces, such as pointer moves, and keeps the rest of the ring for
	 * presses and releases.
	 */
	busy(): boolean {
		const unread =
			(Atomics.load(this.slots, Slot.InputWrite) - Atomics.load(this.slots, Slot.InputRead)) | 0;
		return unread >= INPUT_RING_EVENTS / 2;
	}

	/** Writes one event, with its fields as `InputField` describes them. */
	write(
		type: InputEventType,
		x: number,
		y: number,
		code: number,
		id: number,
		buttons: number,
		flags: number,
	): void {
		const { slots, ints, floats } = this;
		const index = Atomics.load(slots, Slot.InputWrite);
		const base = (index & RING_MASK) * INPUT_EVENT_INTS;
		ints[base + FIELD_TYPE] = type;
		ints[base + FIELD_FRAME] = Atomics.load(slots, Slot.FramePresented);
		floats[base + FIELD_X] = x;
		floats[base + FIELD_Y] = y;
		ints[base + FIELD_CODE] = code;
		ints[base + FIELD_ID] = id;
		ints[base + FIELD_BUTTONS] = buttons;
		ints[base + FIELD_FLAGS] = flags;
		Atomics.store(slots, Slot.InputWrite, (index + 1) | 0);
	}
}
