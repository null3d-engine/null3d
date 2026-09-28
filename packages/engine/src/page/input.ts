// The page side of input and resizing. Pointer, keyboard and wheel events go into the input ring in
// the control block, where the game reads them at the start of its next frame. Canvas size changes
// go into the control block too; the thread that owns the canvas applies them at frame start. When
// the window loses focus, the page hides or a touch turns into a scroll, every held key and button
// is released, so none stays down in the game.

import {
	controlViews,
	INPUT_EVENT_INTS,
	INPUT_RING_EVENTS,
	InputEventType,
	Slot,
} from '../shared/control';
import { HeldInput, isEditableTarget } from './held-input';

export interface InputCapture {
	stop(): void;
}

function modifiers(event: KeyboardEvent | PointerEvent | WheelEvent): number {
	return (
		(event.shiftKey ? 1 : 0) |
		(event.ctrlKey ? 2 : 0) |
		(event.altKey ? 4 : 0) |
		(event.metaKey ? 8 : 0)
	);
}

/** Watches the canvas and the window and writes their events into the control block. */
export function captureInput(
	canvas: HTMLCanvasElement,
	control: ArrayBufferLike,
	maxPixelRatio: number,
): InputCapture {
	const { slots, inputInts, inputFloats } = controlViews(control);

	const write = (
		type: InputEventType,
		x: number,
		y: number,
		buttons: number,
		code: number,
		mods: number,
		id: number,
	) => {
		const index = Atomics.load(slots, Slot.InputWrite);
		const base = (index % INPUT_RING_EVENTS) * INPUT_EVENT_INTS;
		inputInts[base] = type;
		inputInts[base + 1] = Math.round(performance.now());
		inputFloats[base + 2] = x;
		inputFloats[base + 3] = y;
		inputInts[base + 4] = buttons;
		inputInts[base + 5] = code;
		inputInts[base + 6] = mods;
		inputInts[base + 7] = id;
		Atomics.store(slots, Slot.InputWrite, index + 1);
	};

	const held = new HeldInput();
	const pointer = (type: InputEventType) => (event: PointerEvent) => {
		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		if (type === InputEventType.PointerDown) held.pointerDown(event.pointerId, x, y, event.button);
		else if (type === InputEventType.PointerMove) held.pointerMove(event.pointerId, x, y);
		// A release of a pointer the canvas never saw pressed belongs to the rest of the page.
		else if (!held.pointerUp(event.pointerId)) return;
		write(type, x, y, event.buttons, event.button, modifiers(event), event.pointerId);
	};
	const onMove = pointer(InputEventType.PointerMove);
	const onDown = pointer(InputEventType.PointerDown);
	const onUp = pointer(InputEventType.PointerUp);
	const onKeyDown = (event: KeyboardEvent) => {
		if (isEditableTarget(event.target)) return;
		held.keyDown(event.keyCode);
		write(InputEventType.KeyDown, 0, 0, 0, event.keyCode, modifiers(event), 0);
	};
	const onKeyUp = (event: KeyboardEvent) => {
		// A key pressed in the game still releases there when focus moved to a text field meanwhile.
		if (!held.keyUp(event.keyCode) && isEditableTarget(event.target)) return;
		write(InputEventType.KeyUp, 0, 0, 0, event.keyCode, modifiers(event), 0);
	};
	const onWheel = (event: WheelEvent) =>
		write(InputEventType.Wheel, event.deltaX, event.deltaY, 0, 0, modifiers(event), 0);
	const releaseAll = () =>
		held.releaseAll(
			(id, x, y, button) => write(InputEventType.PointerUp, x, y, 0, button, 0, id),
			(code) => write(InputEventType.KeyUp, 0, 0, 0, code, 0, 0),
		);
	const onVisibility = () => {
		if (document.hidden) releaseAll();
		else Atomics.add(slots, Slot.Resumes, 1);
	};

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

	const writeSize = (
		cssWidth: number,
		cssHeight: number,
		devicePixels?: { width: number; height: number },
	) => {
		const ratio = Math.min(globalThis.devicePixelRatio ?? 1, maxPixelRatio);
		const width =
			devicePixels && ratio === globalThis.devicePixelRatio
				? devicePixels.width
				: Math.round(cssWidth * ratio);
		const height =
			devicePixels && ratio === globalThis.devicePixelRatio
				? devicePixels.height
				: Math.round(cssHeight * ratio);
		Atomics.store(slots, Slot.CanvasWidth, Math.max(1, width));
		Atomics.store(slots, Slot.CanvasHeight, Math.max(1, height));
		Atomics.add(slots, Slot.ResizeSerial, 1);
	};
	const initial = canvas.getBoundingClientRect();
	writeSize(initial.width, initial.height);
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const device = entry.devicePixelContentBoxSize?.[0];
			writeSize(
				entry.contentRect.width,
				entry.contentRect.height,
				device ? { width: device.inlineSize, height: device.blockSize } : undefined,
			);
		}
	});
	try {
		observer.observe(canvas, { box: 'device-pixel-content-box' });
	} catch {
		observer.observe(canvas);
	}

	return {
		stop: () => {
			observer.disconnect();
			canvas.removeEventListener('pointermove', onMove);
			canvas.removeEventListener('pointerdown', onDown);
			window.removeEventListener('pointerup', onUp);
			window.removeEventListener('pointercancel', onUp);
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', releaseAll);
			document.removeEventListener('visibilitychange', onVisibility);
			canvas.removeEventListener('wheel', onWheel);
		},
	};
}
