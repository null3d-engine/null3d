// Input for the tests of the camera controls, with no page behind it. Events go into the engine's
// input ring as the page writes them, and the engine's reader takes them once per frame, as the
// sketch does. The context it makes holds the parts of a sketch context that the controls read.
import type { SketchContext } from '@null3d/engine';
import { InputRing } from '../../../packages/engine/src/page/input-ring';
import {
	controlViews,
	createControlBuffer,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_LOCK,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	FLAG_LOCKED,
	FLAG_PRIMARY,
	FLAG_TOUCH,
	Slot,
} from '../../../packages/engine/src/shared/control';
import { KEY_CODES } from '../../../packages/engine/src/shared/key-codes';
import { InputReader } from '../../../packages/engine/src/sketch/input';

/** A pointer event's fields besides its place. */
export interface ScriptedPointer {
	/** The button that changed, as `PointerEvent.button` gives it; -1 for none. */
	button?: number;
	/** The buttons held, as `PointerEvent.buttons` gives them. */
	buttons: number;
	/** The pointer's id: 1 for the mouse, and one per finger. */
	id?: number;
	touch?: boolean;
	/** True for the mouse and for the first finger down. */
	primary?: boolean;
}

export class ScriptedInput {
	readonly ring: InputRing;
	readonly reader: InputReader;
	/** The parts of a sketch context that the controls read. */
	readonly context: SketchContext;
	private frame = 0;

	constructor(width: number, height: number) {
		const buffer = createControlBuffer(false);
		const views = controlViews(buffer);
		views.slotFloats[Slot.CanvasCssWidth] = width;
		views.slotFloats[Slot.CanvasCssHeight] = height;
		this.ring = new InputRing(buffer);
		this.reader = new InputReader(views, KEY_CODES);
		this.context = {
			input: this.reader,
			engine: { viewport: { width, height, pixelRatio: 1 } },
			preferences: { reducedMotion: false },
		} as unknown as SketchContext;
	}

	/**
	 * A pointer event at (x, y) in CSS pixels. While the pointer is locked, (x, y) is the movement
	 * since the pointer's previous event, as the page writes it.
	 */
	pointer(
		type: 'down' | 'move' | 'up',
		x: number,
		y: number,
		options: ScriptedPointer,
		locked = false,
	): void {
		const touch = options.touch ?? false;
		const flags =
			(touch ? FLAG_TOUCH : 0) |
			((options.primary ?? !touch) ? FLAG_PRIMARY : 0) |
			(locked ? FLAG_LOCKED : 0);
		const ringType =
			type === 'down'
				? EVENT_POINTER_DOWN
				: type === 'move'
					? EVENT_POINTER_MOVE
					: EVENT_POINTER_UP;
		this.ring.write(ringType, x, y, options.button ?? -1, options.id ?? 1, options.buttons, flags);
	}

	/** Presses or releases a key, by its `KeyboardEvent.code`. */
	key(code: string, down: boolean): void {
		this.ring.write(down ? EVENT_KEY_DOWN : EVENT_KEY_UP, 0, 0, KEY_CODES.indexOf(code), 0, 0, 0);
	}

	/** The pointer lock begins or ends. */
	lock(on: boolean): void {
		this.ring.write(EVENT_POINTER_LOCK, 0, 0, on ? 1 : 0, 0, 0, 0);
	}

	/** Starts the next frame: the reader takes the events written since the previous one. */
	beginFrame(): void {
		this.reader.beginFrame(++this.frame);
	}
}
