// Gamepads on the page. While a gamepad is connected, the page reads every pad once per animation
// frame and writes each change of a button or an axis into the input ring. With no pad connected it
// reads nothing. When it stops, it releases every button and centers every stick in the sketch.

import {
	EVENT_GAMEPAD_AXIS,
	EVENT_GAMEPAD_BUTTON,
	GAMEPAD_AXES,
	GAMEPAD_BUTTONS,
	GAMEPADS,
} from '../shared/control';
import type { InputRing } from './input-ring';

/**
 * The smallest change of an analog value that the page writes, so a stick's noise at rest writes
 * nothing. A value that reaches 0 or 1 is written at once.
 */
const VALUE_STEP = 0.01;

/** The buttons and the axes of a pad that is not connected. */
const NONE: readonly never[] = [];

/** The parts of a browser's `Gamepad` that the page reads. */
export interface PadReading {
	readonly index: number;
	readonly connected: boolean;
	readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
	readonly axes: readonly number[];
}

/** The browser's pads, or none where the page may not read them. */
function browserPads(): readonly (PadReading | null)[] {
	try {
		return navigator.getGamepads?.() ?? NONE;
	} catch {
		// A permissions policy that blocks gamepads makes the call throw.
		return NONE;
	}
}

/** True when an analog value moved far enough from the value last written to write it again. */
function moved(value: number, written: number): boolean {
	return (
		value !== written &&
		(Math.abs(value - written) >= VALUE_STEP || value === 0 || Math.abs(value) === 1)
	);
}

export class GamepadWatch {
	/** Each pad's buttons and axes, as the page last wrote them. */
	private readonly pressed = new Uint8Array(GAMEPADS * GAMEPAD_BUTTONS);
	private readonly values = new Float32Array(GAMEPADS * GAMEPAD_BUTTONS);
	private readonly axes = new Float32Array(GAMEPADS * GAMEPAD_AXES);
	private readonly connected = new Uint8Array(GAMEPADS);
	private running = false;
	/** The pending animation frame request, or 0 while no pad is connected. */
	private request = 0;

	constructor(
		private readonly ring: InputRing,
		private readonly readPads: () => readonly (PadReading | null)[] = browserPads,
	) {}

	private readonly tick = () => {
		this.request = 0;
		if (this.running && this.poll()) this.request = requestAnimationFrame(this.tick);
	};

	/** A pad came or went: reads the pads now, which starts the reading loop when one is connected. */
	private readonly onConnection = () => {
		if (this.running && this.request === 0) this.tick();
	};

	start(): void {
		if (this.running) return;
		this.running = true;
		addEventListener('gamepadconnected', this.onConnection);
		addEventListener('gamepaddisconnected', this.onConnection);
		// A pad that the page saw before the engine started sends no new event.
		this.tick();
	}

	stop(): void {
		if (!this.running) return;
		this.running = false;
		removeEventListener('gamepadconnected', this.onConnection);
		removeEventListener('gamepaddisconnected', this.onConnection);
		if (this.request !== 0) cancelAnimationFrame(this.request);
		this.request = 0;
		for (let pad = 0; pad < GAMEPADS; pad++) this.writePad(pad, NONE, NONE);
	}

	/** Reads every pad and writes what changed. Returns whether a pad is connected. */
	poll(): boolean {
		const pads = this.readPads();
		this.connected.fill(0);
		for (let k = 0; k < pads.length; k++) {
			const pad = pads[k];
			if (!pad?.connected || pad.index < 0 || pad.index >= GAMEPADS) continue;
			this.connected[pad.index] = 1;
			this.writePad(pad.index, pad.buttons, pad.axes);
		}
		let any = false;
		for (let pad = 0; pad < GAMEPADS; pad++) {
			if (this.connected[pad] === 1) any = true;
			else this.writePad(pad, NONE, NONE);
		}
		return any;
	}

	/**
	 * Writes each button and axis of a pad that changed. While the ring is busy, it writes only
	 * presses and releases: a value it leaves out stays different from the value written, so the
	 * next read writes it.
	 */
	private writePad(pad: number, buttons: PadReading['buttons'], axes: PadReading['axes']): void {
		const busy = this.ring.busy();
		for (let button = 0; button < GAMEPAD_BUTTONS; button++) {
			const state = buttons[button];
			const pressed = state?.pressed ? 1 : 0;
			const value = state ? state.value : 0;
			const at = pad * GAMEPAD_BUTTONS + button;
			const toggled = pressed !== this.pressed[at];
			if (!toggled && (busy || !moved(value, this.values[at] as number))) continue;
			this.pressed[at] = pressed;
			this.values[at] = value;
			this.ring.write(EVENT_GAMEPAD_BUTTON, value, 0, button, pad, pressed, 0);
		}
		if (busy) return;
		for (let axis = 0; axis < GAMEPAD_AXES; axis++) {
			const value = axes[axis] ?? 0;
			const at = pad * GAMEPAD_AXES + axis;
			if (!moved(value, this.axes[at] as number)) continue;
			this.axes[at] = value;
			this.ring.write(EVENT_GAMEPAD_AXIS, value, 0, axis, pad, 0, 0);
		}
	}
}
