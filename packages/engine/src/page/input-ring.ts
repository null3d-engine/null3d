// The page's end of the input ring: writes each input event as one record into the control block,
// where the sketch reads it at the start of its next frame. Each record also holds the number of the
// frame on screen when the page wrote it, so a pointer event names the frame that the user saw.

import {
	type ControlViews,
	controlViews,
	INPUT_RING_EVENTS,
	type InputEventType,
	Slot,
	writeInputEvent,
} from '../shared/control';

export class InputRing {
	private readonly views: ControlViews;

	constructor(control: ArrayBufferLike) {
		this.views = controlViews(control);
	}

	/**
	 * True while half the ring waits for the sketch, as while its setup runs. The page then leaves out
	 * events that a later event replaces, such as pointer moves, and keeps the rest of the ring for
	 * presses and releases.
	 */
	busy(): boolean {
		const { slots } = this.views;
		const unread = (Atomics.load(slots, Slot.InputWrite) - Atomics.load(slots, Slot.InputRead)) | 0;
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
		const { slots } = this.views;
		writeInputEvent(
			this.views,
			type,
			x,
			y,
			code,
			id,
			buttons,
			flags,
			Atomics.load(slots, Slot.FramePresented),
		);
	}
}
