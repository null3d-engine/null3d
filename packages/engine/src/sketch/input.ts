// ctx.input: the sketch's view of the input that the page writes into the input ring. Once per frame,
// before onUpdate, the reader takes every event that the page wrote since the previous frame, in
// order, and updates the state that the input calls answer from. So a key pressed and released
// between two frames counts as both pressed and released in the next frame. The exceptions follow a
// release of the pointer: a press starts a new drag, and wheel scroll may start a new gesture. The
// events from either on wait for the next frame, so a frame's drag never joins two drags, and its
// scroll never comes after the end of its drag. Reading allocates
// nothing: the state lives in typed arrays and in objects made once. While objects listen for
// pointer events, the reader also copies each pointer event into their log. Hold mode never reads
// the ring, so a held frame never depends on input.

import { DEV } from '../errors/checks';
import { EngineError } from '../errors/engine-error';
import type { PointerInput, PointerLog } from '../scene/pointer-events';
import {
	type ControlViews,
	EVENT_GAMEPAD_AXIS,
	EVENT_GAMEPAD_BUTTON,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_LEAVE,
	EVENT_POINTER_LOCK,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_WHEEL,
	FIELD_BUTTONS,
	FIELD_CODE,
	FIELD_FLAGS,
	FIELD_FRAME,
	FIELD_ID,
	FIELD_TYPE,
	FIELD_X,
	FIELD_Y,
	FLAG_CONTROL,
	FLAG_LOCKED,
	FLAG_PRIMARY,
	FLAG_TOUCH,
	GAMEPAD_AXES,
	GAMEPAD_BUTTONS,
	GAMEPADS,
	INPUT_EVENT_INTS,
	INPUT_RING_EVENTS,
	type InputEventType,
	Slot,
} from '../shared/control';

/**
 * The main pointer: the mouse, a pen, or the first finger that touches the canvas. A frame's drag
 * belongs to one press: a press that follows a release in the same frame waits for the next frame.
 *
 * @category api/input
 */
export interface InputPointer {
	/** Distance from the canvas's left edge in CSS pixels, at the pointer's last event. */
	readonly x: number;
	/** Distance from the canvas's top edge in CSS pixels, at the pointer's last event. */
	readonly y: number;
	/** `x` in normalized device coordinates: -1 at the canvas's left edge and 1 at its right edge. */
	readonly ndcX: number;
	/** `y` in normalized device coordinates: -1 at the canvas's bottom edge and 1 at its top edge. */
	readonly ndcY: number;
	/**
	 * The buttons held, as `PointerEvent.buttons` gives them: 1 for the main button, 2 for the right
	 * button and 4 for the middle button, added together. A finger on the screen holds the main button.
	 */
	readonly buttons: number;
	/** Movement to the right since the previous frame, in CSS pixels. */
	readonly dx: number;
	/** Movement down since the previous frame, in CSS pixels. */
	readonly dy: number;
	/**
	 * The part of `dx` made while a button was held: a drag. Movement before a press or after a
	 * release in the same frame does not count.
	 */
	readonly dragDx: number;
	/** The part of `dy` made while a button was held: a drag. */
	readonly dragDy: number;
	/**
	 * The wheel's scroll since the previous frame, in pixels: positive where a page would scroll down.
	 * A wheel that scrolls by lines counts 16 pixels a line, and one that scrolls by pages counts 100
	 * a page, as three.js's controls count them. Scroll that follows a release of the pointer waits
	 * for the next frame, so a frame's scroll never comes after the end of its drag.
	 */
	readonly wheel: number;
	/**
	 * The part of `wheel` that came from a pinch on a trackpad: positive as the fingers close.
	 * Browsers send a pinch as wheel scroll that holds the Control key's flag while no Control key is
	 * down.
	 */
	readonly pinch: number;
	/** True when the pointer is a finger on a touch screen. */
	readonly isTouch: boolean;
	/**
	 * True while the canvas holds the pointer lock, which `engine.requestPointerLock()` asks for on
	 * the page. The browser then hides the pointer and keeps it still: `x` and `y` stay where the lock
	 * began, `dx` and `dy` give the mouse's movement, and objects take no pointer events.
	 */
	readonly locked: boolean;
}

/**
 * A finger on the canvas.
 *
 * @category api/input
 */
export interface InputTouch {
	/** A number that stays the same while the finger stays down. */
	readonly id: number;
	/** Distance from the canvas's left edge in CSS pixels. */
	readonly x: number;
	/** Distance from the canvas's top edge in CSS pixels. */
	readonly y: number;
	/** Movement to the right since the previous frame, in CSS pixels. */
	readonly dx: number;
	/** Movement down since the previous frame, in CSS pixels. */
	readonly dy: number;
}

/**
 * Named actions, each for a list of keys and buttons.
 *
 * @category api/input
 */
export interface InputActions {
	/**
	 * Names actions, each for a list of key and button names, such as
	 * `{ jump: ['Space', 'GamepadA'] }`. The input calls then take the action's name. An action is
	 * down while any of its keys and buttons is down, and its value is the largest of their values.
	 * Defining a name again replaces its list.
	 */
	define(actions: Readonly<Record<string, readonly string[]>>): void;
}

/**
 * The input that the page forwards to the sketch: pointer, touch, keyboard and gamepad. It changes
 * once per frame, before `onUpdate`, so every call in one frame gives the same answer. Keys take
 * their `KeyboardEvent.code` names, such as `KeyW`, `Space` or `ArrowLeft`, which name the key's
 * place on the keyboard whatever its layout. Mouse buttons are `Mouse0` (the main button, or a
 * finger) to `Mouse4`. Gamepad names follow the standard layout, as on an Xbox controller.
 *
 * @category api/input
 */
export interface Input {
	/** The main pointer: the mouse, a pen, or the first finger on the canvas. */
	readonly pointer: InputPointer;
	/** The fingers on the canvas, oldest first. The list and its entries change in place. */
	readonly touches: readonly InputTouch[];
	/** Named actions, such as `jump`, each for a list of keys and buttons. */
	readonly actions: InputActions;
	/** True while the key, button or action is down. */
	isDown(name: string): boolean;
	/** True in the first frame after the key, button or action went down. */
	wasPressed(name: string): boolean;
	/** True in the first frame after the key, button or action came up. */
	wasReleased(name: string): boolean;
	/**
	 * How far the key, button or action is down, from 0 to 1. Keys and most buttons give 0 or 1. The
	 * triggers `GamepadLT` and `GamepadRT` and the stick directions, such as `GamepadLeftStickUp`,
	 * give the values between. A stick gives 0 until it leaves its dead zone near the center.
	 */
	value(name: string): number;
}

/** Mouse buttons, from `Mouse0`, the main button, to `Mouse4`, the forward button. */
const MOUSE_BUTTONS = 5;
/** The mouse button of each bit of `PointerEvent.buttons`, whose second bit is the right button. */
const BUTTON_OF_BIT = [0, 2, 1, 3, 4];
/** Gamepad buttons in the standard layout's order, after `Gamepad`. */
const PAD_BUTTONS = [
	'A',
	'B',
	'X',
	'Y',
	'LB',
	'RB',
	'LT',
	'RT',
	'Back',
	'Start',
	'LS',
	'RS',
	'DpadUp',
	'DpadDown',
	'DpadLeft',
	'DpadRight',
	'Home',
];
/** Each stick's four directions, after `Gamepad`, in the order `updateStick` sets them. */
const STICK_DIRECTIONS = ['Left', 'Right', 'Up', 'Down'];
const STICKS = ['LeftStick', 'RightStick'];

// Control numbers: the mouse buttons first, then the gamepad buttons, the stick directions and the
// keys. The page hands over the key names, so the count of keys is known only at the start.
const PAD = MOUSE_BUTTONS;
const STICK = PAD + GAMEPAD_BUTTONS;
const KEYS = STICK + STICKS.length * STICK_DIRECTIONS.length;

/** A stick's distance from its center, from 0 to 1, below which it counts as centered. */
const STICK_DEAD_ZONE = 0.15;
/** The distance at which a stick counts as pushed all the way, as few sticks reach 1 in every direction. */
const STICK_FULL = 0.95;
/** A stick direction goes down at this value and comes up below the lower one, so it cannot flicker. */
const DIRECTION_DOWN = 0.5;
const DIRECTION_UP = 0.4;

/** The most fingers the sketch follows at once. */
const MAX_TOUCHES = 10;

const RING_MASK = INPUT_RING_EVENTS - 1;

class PointerState implements InputPointer {
	x = 0;
	y = 0;
	ndcX = 0;
	ndcY = 0;
	buttons = 0;
	dx = 0;
	dy = 0;
	dragDx = 0;
	dragDy = 0;
	wheel = 0;
	pinch = 0;
	isTouch = false;
	locked = false;
	/** The pointer id of the last event, or -1 before the first. */
	id = -1;
	/**
	 * The frame on screen at the pointer's last event, in the engine's count, whose camera a pick of
	 * that event uses. The engine's count includes the frames that ran no sketch code, such as the
	 * setup's, and 0 means that no frame was on screen yet.
	 */
	frame = 0;
}

class TouchState implements InputTouch {
	id = 0;
	x = 0;
	y = 0;
	dx = 0;
	dy = 0;
	/** The frame on screen at the finger's last event, in the engine's count. */
	frame = 0;
}

/** Reads the input ring once per frame, and answers the sketch's input calls. */
export class InputReader implements Input, PointerInput {
	readonly pointer = new PointerState();
	/** The log that copies each frame's pointer events, which pointer events on objects set. */
	pointerLog: PointerLog | undefined = undefined;
	readonly touches: TouchState[];
	readonly actions: InputActions = { define: (actions) => this.define(actions) };
	/** Control numbers by name, and each action's number plus the count of controls. */
	private readonly names = new Map<string, number>();
	/** The count of controls: every action's number is at least this. */
	private readonly controls: number;
	private readonly down: Uint8Array;
	private readonly values: Float32Array;
	/** The frame in which each control last went down, and last came up. */
	private readonly pressedAt: Int32Array;
	private readonly releasedAt: Int32Array;
	/** The actions of each control. */
	private readonly bound: number[][];
	/** Each action's controls, how many of them are down, and the frames it went down and came up. */
	private readonly bindings: number[][] = [];
	private readonly actionDown: number[] = [];
	private readonly actionPressedAt: number[] = [];
	private readonly actionReleasedAt: number[] = [];
	/** Each pad's buttons and axes, as the page last wrote them. */
	private readonly padPressed = new Uint8Array(GAMEPADS * GAMEPAD_BUTTONS);
	private readonly padValues = new Float32Array(GAMEPADS * GAMEPAD_BUTTONS);
	private readonly padAxes = new Float32Array(GAMEPADS * GAMEPAD_AXES);
	private readonly pool: TouchState[] = Array.from({ length: MAX_TOUCHES }, () => new TouchState());
	/** The control numbers of the two Control keys, whose state tells a trackpad's pinch from a wheel. */
	private readonly controlKeys: readonly [number, number];
	/** The mouse buttons held, as `PointerEvent.buttons` bits. */
	private mouseButtons = 0;
	/** The frame the state belongs to, or -1 before the first, so nothing counts as just pressed. */
	private frame = -1;
	/**
	 * @internal The engine's frames so far that ran no sketch code, such as the setup's. A frame of
	 * the pointer less this count gives the sketch's frame, as `time.frame` counts it.
	 */
	setupFrames = 0;
	/** The index of the next record to read. */
	private next = 0;

	/** `keyCodes` holds the key names in the order of the numbers that the page gives keys. */
	constructor(
		private readonly control: ControlViews,
		keyCodes: readonly string[],
	) {
		const controls = KEYS + keyCodes.length;
		this.controls = controls;
		this.down = new Uint8Array(controls);
		this.values = new Float32Array(controls);
		this.pressedAt = new Int32Array(controls);
		this.releasedAt = new Int32Array(controls);
		this.bound = Array.from({ length: controls }, () => []);
		// The list shrinks only by pop, which keeps its storage. In Chrome, a list whose length is set
		// to 0 frees its storage, and the next touch would allocate it again.
		this.touches = this.pool.slice();
		while (this.touches.length > 0) this.touches.pop();
		const add = (name: string, control: number) => this.names.set(name, control);
		for (let button = 0; button < MOUSE_BUTTONS; button++) add(`Mouse${button}`, button);
		for (const [button, name] of PAD_BUTTONS.entries()) add(`Gamepad${name}`, PAD + button);
		let direction = STICK;
		for (const stick of STICKS)
			for (const way of STICK_DIRECTIONS) add(`Gamepad${stick}${way}`, direction++);
		for (const [key, code] of keyCodes.entries()) add(code, KEYS + key);
		this.controlKeys = [this.names.get('ControlLeft') ?? -1, this.names.get('ControlRight') ?? -1];
	}

	/**
	 * Takes the events the page wrote since the previous frame, for frame `frame`, up to a press of
	 * the pointer or wheel scroll that follows its release. Movement and wheel scroll start again
	 * from 0.
	 * `setupFrames` is the count of the engine's frames that ran no sketch code.
	 */
	beginFrame(frame: number, setupFrames = 0): void {
		this.frame = frame;
		this.setupFrames = setupFrames;
		const { pointer, touches } = this;
		pointer.dx = 0;
		pointer.dy = 0;
		pointer.dragDx = 0;
		pointer.dragDy = 0;
		pointer.wheel = 0;
		pointer.pinch = 0;
		for (let k = 0; k < touches.length; k++) {
			const touch = touches[k] as TouchState;
			touch.dx = 0;
			touch.dy = 0;
		}
		const { slots, slotFloats } = this.control;
		const written = Atomics.load(slots, Slot.InputWrite);
		if (((written - this.next) | 0) >= INPUT_RING_EVENTS) {
			// The page wrote over events that the sketch never read, one of which may have been a
			// release. Releasing everything keeps a key from staying down.
			this.releaseAll();
			this.next = written;
		}
		const { inputInts: ints, inputFloats: floats } = this.control;
		const log = this.pointerLog;
		if (log !== undefined) log.count = 0;
		let released = false;
		while (this.next !== written) {
			const base = (this.next & RING_MASK) * INPUT_EVENT_INTS;
			const type = ints[base + FIELD_TYPE] as InputEventType;
			const flags = ints[base + FIELD_FLAGS] as number;
			const primary = (flags & FLAG_PRIMARY) !== 0;
			// A press of the pointer after its release in this frame starts the next drag, which
			// waits for the next frame with every event after it. Each frame's drag then belongs to
			// one press, and two quick clicks count as two presses. Wheel scroll after the release
			// waits too: a frame's scroll then never follows the end of its drag, so controls that
			// ignore the wheel during a drag still take the scroll that comes after it.
			if (released && (type === EVENT_WHEEL || (primary && type === EVENT_POINTER_DOWN))) break;
			this.apply(base);
			// A locked pointer's records hold movement, which points at no object.
			if (
				log !== undefined &&
				(flags & FLAG_LOCKED) === 0 &&
				(type === EVENT_POINTER_MOVE ||
					type === EVENT_POINTER_DOWN ||
					type === EVENT_POINTER_UP ||
					type === EVENT_POINTER_LEAVE)
			)
				log.add(ints, floats, base);
			if (primary && type === EVENT_POINTER_UP) released = true;
			this.next = (this.next + 1) | 0;
		}
		Atomics.store(slots, Slot.InputRead, this.next);
		const width = slotFloats[Slot.CanvasCssWidth] as number;
		const height = slotFloats[Slot.CanvasCssHeight] as number;
		pointer.ndcX = width > 0 ? (pointer.x / width) * 2 - 1 : 0;
		pointer.ndcY = height > 0 ? 1 - (pointer.y / height) * 2 : 0;
	}

	/**
	 * The frame that was on screen at the last event of the pointer or a finger at (`x`, `y`) in CSS
	 * pixels, in the engine's count, or -1 when neither is there. A point that the sketch read from
	 * the input then names the frame that its event's user saw.
	 */
	frameAt(x: number, y: number): number {
		const { pointer, touches } = this;
		if (pointer.id >= 0 && pointer.x === x && pointer.y === y) return pointer.frame;
		for (let k = 0; k < touches.length; k++) {
			const touch = touches[k] as TouchState;
			if (touch.x === x && touch.y === y) return touch.frame;
		}
		return -1;
	}

	/** The frame on screen now, in the engine's count, as the pointer's frame numbers use it. */
	presentedFrame(): number {
		return Atomics.load(this.control.slots, Slot.FramePresented);
	}

	isDown(name: string): boolean {
		const index = this.find(name, 'isDown');
		if (index < this.controls) return index >= 0 && this.down[index] === 1;
		return (this.actionDown[index - this.controls] as number) > 0;
	}

	wasPressed(name: string): boolean {
		const index = this.find(name, 'wasPressed');
		if (index < this.controls) return index >= 0 && this.pressedAt[index] === this.frame;
		return this.actionPressedAt[index - this.controls] === this.frame;
	}

	wasReleased(name: string): boolean {
		const index = this.find(name, 'wasReleased');
		if (index < this.controls) return index >= 0 && this.releasedAt[index] === this.frame;
		return this.actionReleasedAt[index - this.controls] === this.frame;
	}

	value(name: string): number {
		const index = this.find(name, 'value');
		if (index < this.controls) return index >= 0 ? (this.values[index] as number) : 0;
		const controls = this.bindings[index - this.controls] as number[];
		let value = 0;
		for (let k = 0; k < controls.length; k++)
			value = Math.max(value, this.values[controls[k] as number] as number);
		return value;
	}

	/** The number of a control or an action; E1205 in development builds when nothing has the name. */
	private find(name: string, call: string): number {
		const index = this.names.get(name);
		if (index !== undefined) return index;
		if (DEV)
			throw new EngineError(
				'E1205',
				`${call}() got "${name}", which names no key, button or action.`,
			);
		return -1;
	}

	private define(actions: Readonly<Record<string, readonly string[]>>): void {
		for (const name of Object.keys(actions)) {
			const known = this.names.get(name);
			if (known !== undefined && known < this.controls) {
				if (DEV)
					throw new EngineError(
						'E1205',
						`input.actions.define() got the action name "${name}", which names a key or button.`,
					);
				continue;
			}
			const controls: number[] = [];
			for (const control of actions[name] ?? []) {
				const index = this.names.get(control);
				if (index === undefined || index >= this.controls) {
					if (DEV)
						throw new EngineError(
							'E1205',
							`input.actions.define() got "${control}" for the action "${name}", which names no key or button.`,
						);
					continue;
				}
				if (!controls.includes(index)) controls.push(index);
			}
			const action = known === undefined ? this.bindings.length : known - this.controls;
			if (known === undefined) {
				this.names.set(name, this.controls + action);
				this.bindings.push([]);
				this.actionDown.push(0);
				this.actionPressedAt.push(0);
				this.actionReleasedAt.push(0);
			}
			for (const control of this.bindings[action] as number[]) {
				const actionsOf = this.bound[control] as number[];
				actionsOf.splice(actionsOf.indexOf(action), 1);
			}
			this.bindings[action] = controls;
			let down = 0;
			for (const control of controls) {
				(this.bound[control] as number[]).push(action);
				down += this.down[control] as number;
			}
			this.actionDown[action] = down;
		}
	}

	/** Applies the record at `base` of the ring. */
	private apply(base: number): void {
		const { inputInts: ints, inputFloats: floats } = this.control;
		const type = ints[base + FIELD_TYPE] as InputEventType;
		const code = ints[base + FIELD_CODE] as number;
		switch (type) {
			case EVENT_POINTER_MOVE:
			case EVENT_POINTER_DOWN:
			case EVENT_POINTER_UP:
				this.onPointer(type, base);
				break;
			case EVENT_KEY_DOWN:
			case EVENT_KEY_UP:
				if (code >= 0 && KEYS + code < this.controls)
					this.setDown(KEYS + code, type === EVENT_KEY_DOWN);
				break;
			case EVENT_POINTER_LOCK:
				this.pointer.locked = code === 1;
				break;
			case EVENT_WHEEL:
				this.onWheel(floats[base + FIELD_Y] as number, ints[base + FIELD_FLAGS] as number);
				break;
			case EVENT_GAMEPAD_BUTTON:
				this.onPadButton(base);
				break;
			case EVENT_GAMEPAD_AXIS:
				this.onPadAxis(base);
				break;
		}
	}

	/** Sets whether a control is down, and counts its press or release in this frame and its actions'. */
	private setDown(control: number, down: boolean): void {
		if ((this.down[control] === 1) === down) return;
		this.down[control] = down ? 1 : 0;
		// Keys and mouse buttons are down or up; the gamepad's controls set their own values.
		if (control < PAD || control >= KEYS) this.values[control] = down ? 1 : 0;
		if (down) this.pressedAt[control] = this.frame;
		else this.releasedAt[control] = this.frame;
		const actions = this.bound[control] as number[];
		for (let k = 0; k < actions.length; k++) {
			const action = actions[k] as number;
			const held = (this.actionDown[action] as number) + (down ? 1 : -1);
			this.actionDown[action] = held;
			if (down && held === 1) this.actionPressedAt[action] = this.frame;
			else if (!down && held === 0) this.actionReleasedAt[action] = this.frame;
		}
	}

	private onPointer(type: InputEventType, base: number): void {
		const { inputInts: ints, inputFloats: floats } = this.control;
		const x = floats[base + FIELD_X] as number;
		const y = floats[base + FIELD_Y] as number;
		const id = ints[base + FIELD_ID] as number;
		const flags = ints[base + FIELD_FLAGS] as number;
		const frame = ints[base + FIELD_FRAME] as number;
		if ((flags & FLAG_TOUCH) !== 0) this.onTouch(type, id, x, y, frame);
		if ((flags & FLAG_PRIMARY) === 0) return;
		const { pointer } = this;
		if ((flags & FLAG_LOCKED) !== 0) {
			// A locked pointer stays where it is, and the record holds its movement.
			pointer.dx += x;
			pointer.dy += y;
			if (pointer.buttons !== 0) {
				pointer.dragDx += x;
				pointer.dragDy += y;
			}
			pointer.id = id;
			pointer.isTouch = false;
			pointer.frame = frame;
			this.setButtons(ints[base + FIELD_BUTTONS] as number);
			return;
		}
		// A new pointer, such as a finger after the mouse, moves the pointer without movement. The
		// buttons are still those of the previous event, so a press starts a drag and a release ends
		// one at the event's own position.
		if (id === pointer.id) {
			const dx = x - pointer.x;
			const dy = y - pointer.y;
			pointer.dx += dx;
			pointer.dy += dy;
			if (pointer.buttons !== 0) {
				pointer.dragDx += dx;
				pointer.dragDy += dy;
			}
		}
		pointer.id = id;
		pointer.x = x;
		pointer.y = y;
		pointer.isTouch = (flags & FLAG_TOUCH) !== 0;
		pointer.frame = frame;
		this.setButtons(ints[base + FIELD_BUTTONS] as number);
	}

	/** Sets the pointer's buttons, and counts each mouse button's press or release. */
	private setButtons(buttons: number): void {
		const changed = buttons ^ this.mouseButtons;
		this.mouseButtons = buttons;
		this.pointer.buttons = buttons;
		// Buttons change on moves too: a second button pressed while one is held comes as a move.
		for (let bit = 0; bit < MOUSE_BUTTONS; bit++)
			if ((changed & (1 << bit)) !== 0)
				this.setDown(BUTTON_OF_BIT[bit] as number, (buttons & (1 << bit)) !== 0);
	}

	/**
	 * Adds a wheel's scroll. Scroll with the Control key's flag while no Control key is down comes
	 * from a pinch on a trackpad.
	 */
	private onWheel(scroll: number, flags: number): void {
		const { pointer, down } = this;
		pointer.wheel += scroll;
		const [left, right] = this.controlKeys;
		if ((flags & FLAG_CONTROL) !== 0 && down[left] !== 1 && down[right] !== 1)
			pointer.pinch += scroll;
	}

	private onTouch(type: InputEventType, id: number, x: number, y: number, frame: number): void {
		const { touches } = this;
		let at = 0;
		while (at < touches.length && (touches[at] as TouchState).id !== id) at++;
		if (at === touches.length) {
			if (type !== EVENT_POINTER_DOWN || at === MAX_TOUCHES) return;
			// The list holds fewer touches than the pool, so one of the pool's is free.
			let free = 0;
			while (touches.indexOf(this.pool[free] as TouchState) >= 0) free++;
			const touch = this.pool[free] as TouchState;
			touch.id = id;
			touch.x = x;
			touch.y = y;
			touch.dx = 0;
			touch.dy = 0;
			touch.frame = frame;
			touches.push(touch);
			return;
		}
		if (type === EVENT_POINTER_UP) {
			for (let k = at + 1; k < touches.length; k++) touches[k - 1] = touches[k] as TouchState;
			touches.pop();
			return;
		}
		const touch = touches[at] as TouchState;
		touch.dx += x - touch.x;
		touch.dy += y - touch.y;
		touch.x = x;
		touch.y = y;
		touch.frame = frame;
	}

	/** A button is down while any pad holds it, and its value is the largest of any pad. */
	private onPadButton(base: number): void {
		const { inputInts: ints, inputFloats: floats } = this.control;
		const pad = ints[base + FIELD_ID] as number;
		const button = ints[base + FIELD_CODE] as number;
		if (pad < 0 || pad >= GAMEPADS || button < 0 || button >= GAMEPAD_BUTTONS) return;
		const at = pad * GAMEPAD_BUTTONS + button;
		this.padPressed[at] = ints[base + FIELD_BUTTONS] !== 0 ? 1 : 0;
		this.padValues[at] = floats[base + FIELD_X] as number;
		let pressed = 0;
		let value = 0;
		for (let p = button; p < GAMEPADS * GAMEPAD_BUTTONS; p += GAMEPAD_BUTTONS) {
			pressed |= this.padPressed[p] as number;
			value = Math.max(value, this.padValues[p] as number);
		}
		this.values[PAD + button] = value;
		this.setDown(PAD + button, pressed !== 0);
	}

	private onPadAxis(base: number): void {
		const { inputInts: ints, inputFloats: floats } = this.control;
		const pad = ints[base + FIELD_ID] as number;
		const axis = ints[base + FIELD_CODE] as number;
		if (pad < 0 || pad >= GAMEPADS || axis < 0 || axis >= GAMEPAD_AXES) return;
		this.padAxes[pad * GAMEPAD_AXES + axis] = floats[base + FIELD_X] as number;
		this.updateStick(axis >> 1);
	}

	/**
	 * Sets a stick's four directions from the pad whose stick is pushed furthest. Its distance from the
	 * center counts from the edge of the dead zone, so the stick moves smoothly out of it.
	 */
	private updateStick(stick: number): void {
		let x = 0;
		let y = 0;
		let furthest = 0;
		for (let at = stick * 2; at < GAMEPADS * GAMEPAD_AXES; at += GAMEPAD_AXES) {
			const px = this.padAxes[at] as number;
			const py = this.padAxes[at + 1] as number;
			const squared = px * px + py * py;
			if (squared > furthest) {
				furthest = squared;
				x = px;
				y = py;
			}
		}
		const distance = Math.sqrt(furthest);
		const scale =
			distance > STICK_DEAD_ZONE
				? Math.min(1, (distance - STICK_DEAD_ZONE) / (STICK_FULL - STICK_DEAD_ZONE)) / distance
				: 0;
		const first = STICK + stick * STICK_DIRECTIONS.length;
		this.setDirection(first, -x * scale);
		this.setDirection(first + 1, x * scale);
		// The axes grow downward, so a stick pushed up gives a negative y.
		this.setDirection(first + 2, -y * scale);
		this.setDirection(first + 3, y * scale);
	}

	private setDirection(control: number, amount: number): void {
		const value = amount > 0 ? amount : 0;
		this.values[control] = value;
		this.setDown(control, value >= (this.down[control] === 1 ? DIRECTION_UP : DIRECTION_DOWN));
	}

	/** Releases every key, button and finger, as when events were lost. */
	private releaseAll(): void {
		for (let control = 0; control < this.controls; control++) this.setDown(control, false);
		this.values.fill(0);
		this.padPressed.fill(0);
		this.padValues.fill(0);
		this.padAxes.fill(0);
		this.mouseButtons = 0;
		this.pointer.buttons = 0;
		while (this.touches.length > 0) this.touches.pop();
	}
}
