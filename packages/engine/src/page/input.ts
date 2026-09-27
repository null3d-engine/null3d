// The page side of input and resizing. Pointer, keyboard and wheel events go into the input ring in
// the control block, where the game reads them at the start of its next frame. Canvas size changes
// go into the control block too; the thread that owns the canvas applies them at frame start.

import {
	controlViews,
	INPUT_EVENT_INTS,
	INPUT_RING_EVENTS,
	InputEventType,
	Slot,
} from '../shared/control';

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

	const pointer = (type: InputEventType) => (event: PointerEvent) => {
		const rect = canvas.getBoundingClientRect();
		write(
			type,
			event.clientX - rect.left,
			event.clientY - rect.top,
			event.buttons,
			event.button,
			modifiers(event),
			event.pointerId,
		);
	};
	const key = (type: InputEventType) => (event: KeyboardEvent) => {
		write(type, 0, 0, 0, event.keyCode, modifiers(event), 0);
	};
	const onMove = pointer(InputEventType.PointerMove);
	const onDown = pointer(InputEventType.PointerDown);
	const onUp = pointer(InputEventType.PointerUp);
	const onKeyDown = key(InputEventType.KeyDown);
	const onKeyUp = key(InputEventType.KeyUp);
	const onWheel = (event: WheelEvent) =>
		write(InputEventType.Wheel, event.deltaX, event.deltaY, 0, 0, modifiers(event), 0);

	canvas.addEventListener('pointermove', onMove);
	canvas.addEventListener('pointerdown', onDown);
	window.addEventListener('pointerup', onUp);
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('keyup', onKeyUp);
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
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			canvas.removeEventListener('wheel', onWheel);
		},
	};
}
