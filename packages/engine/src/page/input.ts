// The page side of input. Pointer, keyboard, wheel and gamepad events go into the input ring in the
// control block, where the sketch reads them at the start of its next frame. The page writes input
// only while the sketch runs. When the window loses focus, the page hides, a touch turns into a
// scroll, or the engine stops listening, every held key and button is released, so none stays down
// in the sketch.

import {
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_WHEEL,
	FLAG_ALT,
	FLAG_CONTROL,
	FLAG_META,
	FLAG_PEN,
	FLAG_PRIMARY,
	FLAG_SHIFT,
	FLAG_TOUCH,
	type InputEventType,
} from '../shared/control';
import { KEY_CODES } from '../shared/key-codes';
import { GamepadWatch } from './gamepads';
import { HeldInput, isEditableTarget } from './held-input';
import { InputRing } from './input-ring';

export interface InputCapture {
	/** Starts or stops writing input. Stopping releases every held key and button first. */
	listen(on: boolean): void;
}

/** Pixels per line and per page of a wheel that scrolls by lines or pages, as three.js's controls count them. */
const WHEEL_LINE = 16;
const WHEEL_PAGE = 100;

function modifiers(event: KeyboardEvent | PointerEvent | WheelEvent): number {
	return (
		(event.shiftKey ? FLAG_SHIFT : 0) |
		(event.ctrlKey ? FLAG_CONTROL : 0) |
		(event.altKey ? FLAG_ALT : 0) |
		(event.metaKey ? FLAG_META : 0)
	);
}

/** The pointer's kind and the modifier keys held, as the input ring's flags. */
function pointerFlags(event: PointerEvent): number {
	const kind =
		event.pointerType === 'touch' ? FLAG_TOUCH : event.pointerType === 'pen' ? FLAG_PEN : 0;
	return modifiers(event) | kind | (event.isPrimary ? FLAG_PRIMARY : 0);
}

/** Watches the canvas, the window and the gamepads, and writes their input into the control block. */
export function captureInput(canvas: HTMLCanvasElement, control: ArrayBufferLike): InputCapture {
	const ring = new InputRing(control);
	const held = new HeldInput();
	const gamepads = new GamepadWatch(ring);
	const keys = new Map(KEY_CODES.map((code, key) => [code, key]));
	const metaKeys = [keys.get('MetaLeft'), keys.get('MetaRight')];

	const pointer = (type: InputEventType) => (event: PointerEvent) => {
		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		const { pointerId: id } = event;
		const flags = pointerFlags(event);
		if (type === EVENT_POINTER_DOWN) {
			held.pointerDown(id, x, y, event.button, flags);
			// A drag that leaves the canvas keeps sending moves and ends with a release.
			try {
				canvas.setPointerCapture(id);
			} catch {
				// The pointer is no longer active.
			}
		} else if (type === EVENT_POINTER_MOVE) {
			held.pointerMove(id, x, y);
			if (ring.busy()) return;
		}
		// A release of a pointer the canvas never saw pressed belongs to the rest of the page.
		else if (!held.pointerUp(id)) return;
		ring.write(type, x, y, event.button, id, event.buttons, flags);
	};
	const onMove = pointer(EVENT_POINTER_MOVE);
	const onDown = pointer(EVENT_POINTER_DOWN);
	const onUp = pointer(EVENT_POINTER_UP);
	const writeKeyUp = (key: number) => ring.write(EVENT_KEY_UP, 0, 0, key, 0, 0, 0);
	const onKeyDown = (event: KeyboardEvent) => {
		const key = keys.get(event.code);
		if (key === undefined || isEditableTarget(event.target) || !held.keyDown(key)) return;
		ring.write(EVENT_KEY_DOWN, 0, 0, key, 0, 0, modifiers(event));
	};
	const onKeyUp = (event: KeyboardEvent) => {
		// A key pressed in the sketch still releases there when focus moved to a text field meanwhile.
		const key = keys.get(event.code);
		if (key === undefined || !held.keyUp(key)) return;
		ring.write(EVENT_KEY_UP, 0, 0, key, 0, 0, modifiers(event));
		// On a Mac, the browser sends no release of a key pressed while Cmd is down.
		if (metaKeys.includes(key)) held.releaseKeys(writeKeyUp);
	};
	const onWheel = (event: WheelEvent) => {
		if (ring.busy()) return;
		const scale =
			event.deltaMode === WheelEvent.DOM_DELTA_LINE
				? WHEEL_LINE
				: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
					? WHEEL_PAGE
					: 1;
		ring.write(EVENT_WHEEL, event.deltaX * scale, event.deltaY * scale, 0, 0, 0, modifiers(event));
	};
	// The right button reaches the sketch, so it opens no menu over the canvas.
	const onContextMenu = (event: Event) => event.preventDefault();
	const releaseAll = () =>
		held.releaseAll(
			(id, x, y, button, flags) => ring.write(EVENT_POINTER_UP, x, y, button, id, 0, flags),
			writeKeyUp,
		);
	const onVisibility = () => {
		if (document.hidden) releaseAll();
	};

	let listening = false;
	return {
		listen(on) {
			if (on === listening) return;
			listening = on;
			if (on) {
				canvas.addEventListener('pointermove', onMove);
				canvas.addEventListener('pointerdown', onDown);
				window.addEventListener('pointerup', onUp);
				// The browser cancels a touch that becomes a page scroll or a system gesture: a release too.
				window.addEventListener('pointercancel', onUp);
				window.addEventListener('keydown', onKeyDown);
				window.addEventListener('keyup', onKeyUp);
				window.addEventListener('blur', releaseAll);
				document.addEventListener('visibilitychange', onVisibility);
				canvas.addEventListener('wheel', onWheel, { passive: true });
				canvas.addEventListener('contextmenu', onContextMenu);
				gamepads.start();
				return;
			}
			releaseAll();
			gamepads.stop();
			canvas.removeEventListener('pointermove', onMove);
			canvas.removeEventListener('pointerdown', onDown);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', releaseAll);
			document.removeEventListener('visibilitychange', onVisibility);
			canvas.removeEventListener('wheel', onWheel);
			canvas.removeEventListener('contextmenu', onContextMenu);
		},
	};
}
