import { describe, expect, it } from 'bun:test';
import { InputRing } from '../page/input-ring';
import {
	controlViews,
	createControlBuffer,
	EVENT_GAMEPAD_AXIS,
	EVENT_GAMEPAD_BUTTON,
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_WHEEL,
	FLAG_CONTROL,
	FLAG_PRIMARY,
	FLAG_TOUCH,
	INPUT_RING_EVENTS,
	type InputEventType,
	Slot,
} from '../shared/control';
import { KEY_CODES } from '../shared/key-codes';
import { InputReader } from './input';

/** A control block with the page's end of the ring and the sketch's reader, stepped frame by frame. */
function setup() {
	const control = createControlBuffer(false);
	const views = controlViews(control);
	const ring = new InputRing(control);
	const input = new InputReader(views, KEY_CODES);
	let frame = 0;
	const next = () => input.beginFrame(++frame);
	const key = (type: typeof EVENT_KEY_DOWN | typeof EVENT_KEY_UP, name: string) =>
		ring.write(type, 0, 0, KEY_CODES.indexOf(name), 0, 0, 0);
	/** A pointer event of the mouse, unless `flags` names another pointer. */
	const pointer = (
		type: InputEventType,
		x: number,
		y: number,
		buttons = 0,
		id = 1,
		flags: number = FLAG_PRIMARY,
	) => ring.write(type, x, y, 0, id, buttons, flags);
	const padButton = (pad: number, button: number, value: number, pressed = value > 0.5) =>
		ring.write(EVENT_GAMEPAD_BUTTON, value, 0, button, pad, pressed ? 1 : 0, 0);
	const padAxis = (pad: number, axis: number, value: number) =>
		ring.write(EVENT_GAMEPAD_AXIS, value, 0, axis, pad, 0, 0);
	return { views, ring, input, next, key, pointer, padButton, padAxis };
}

/** The edges and state of one name in the current frame. */
function edges(input: InputReader, name: string) {
	return {
		down: input.isDown(name),
		pressed: input.wasPressed(name),
		released: input.wasReleased(name),
	};
}

const PRIMARY_TOUCH = FLAG_TOUCH | FLAG_PRIMARY;
/** The standard layout's A button and right trigger. */
const PAD_A = 0;
const PAD_RT = 7;

describe('input: keys and presses per frame', () => {
	it('counts a press and a release in one frame as both, and the key as up', () => {
		const { input, next, key } = setup();
		key(EVENT_KEY_DOWN, 'Space');
		key(EVENT_KEY_UP, 'Space');
		next();
		expect(edges(input, 'Space')).toEqual({ down: false, pressed: true, released: true });
		expect(input.value('Space')).toBe(0);
		next();
		expect(edges(input, 'Space')).toEqual({ down: false, pressed: false, released: false });
	});

	it('counts a held key as pressed in one frame and down until its release', () => {
		const { input, next, key } = setup();
		key(EVENT_KEY_DOWN, 'KeyW');
		next();
		expect(edges(input, 'KeyW')).toEqual({ down: true, pressed: true, released: false });
		expect(input.value('KeyW')).toBe(1);
		next();
		expect(edges(input, 'KeyW')).toEqual({ down: true, pressed: false, released: false });
		key(EVENT_KEY_UP, 'KeyW');
		next();
		expect(edges(input, 'KeyW')).toEqual({ down: false, pressed: false, released: true });
	});

	it('counts nothing as pressed before the first frame', () => {
		const { input, key } = setup();
		key(EVENT_KEY_DOWN, 'KeyA');
		expect(edges(input, 'KeyA')).toEqual({ down: false, pressed: false, released: false });
		expect(edges(input, 'Mouse0')).toEqual({ down: false, pressed: false, released: false });
	});

	it('throws E1205 for a name that no key, button or action has', () => {
		const { input, next } = setup();
		next();
		expect(() => input.isDown('keyW')).toThrow(
			'E1205: isDown() got "keyW", which names no key, button or action.',
		);
		expect(() => input.value('Jump')).toThrow('E1205: value() got "Jump"');
	});
});

describe('input: the ring', () => {
	it('reads events across the end of the ring, in order', () => {
		const { views, input, next, pointer } = setup();
		let x = 0;
		for (let batch = 0; batch < 12; batch++) {
			// Batches of 100 cross the end of the ring several times.
			for (let k = 0; k < 100; k++) pointer(EVENT_POINTER_MOVE, ++x, 2 * x);
			next();
			expect([batch, input.pointer.x, input.pointer.y]).toEqual([batch, x, 2 * x]);
			expect(input.pointer.dx).toBe(batch === 0 ? 99 : 100);
			expect(Atomics.load(views.slots, Slot.InputRead)).toBe(x);
		}
	});

	it('keeps reading when the event count passes the largest 32-bit integer', () => {
		const { views, input, next, key } = setup();
		Atomics.store(views.slots, Slot.InputWrite, 0x7fffffff - 2);
		next();
		for (let k = 0; k < 4; k++) {
			key(EVENT_KEY_DOWN, 'KeyQ');
			key(EVENT_KEY_UP, 'KeyQ');
		}
		expect(Atomics.load(views.slots, Slot.InputWrite)).toBeLessThan(0);
		next();
		expect(edges(input, 'KeyQ')).toEqual({ down: false, pressed: true, released: true });
	});

	it('releases every key and button when the page wrote over events the sketch never read', () => {
		const { input, next, key, pointer } = setup();
		key(EVENT_KEY_DOWN, 'ShiftLeft');
		pointer(EVENT_POINTER_DOWN, 5, 5, 1);
		next();
		expect(input.isDown('ShiftLeft') && input.isDown('Mouse0')).toBe(true);
		for (let k = 0; k <= INPUT_RING_EVENTS; k++) pointer(EVENT_POINTER_MOVE, k, k, 1);
		next();
		expect(edges(input, 'ShiftLeft')).toEqual({ down: false, pressed: false, released: true });
		expect(edges(input, 'Mouse0')).toEqual({ down: false, pressed: false, released: true });
		// The next events count again.
		key(EVENT_KEY_DOWN, 'ShiftLeft');
		next();
		expect(edges(input, 'ShiftLeft')).toEqual({ down: true, pressed: true, released: false });
	});

	it('writes each event with the frame on screen, and tells the page when half the ring waits', () => {
		const { views, ring, input, next, pointer } = setup();
		Atomics.store(views.slots, Slot.FramePresented, 42);
		pointer(EVENT_POINTER_DOWN, 3, 4, 1);
		for (let k = 1; k < INPUT_RING_EVENTS / 2 - 1; k++) pointer(EVENT_POINTER_MOVE, 3, 4, 1);
		expect(ring.busy()).toBe(false);
		pointer(EVENT_POINTER_MOVE, 3, 4, 1);
		expect(ring.busy()).toBe(true);
		next();
		expect(ring.busy()).toBe(false);
		expect((input.pointer as unknown as { frame: number }).frame).toBe(42);
	});
});

describe('input: the pointer', () => {
	it('gives the position in CSS pixels and in device coordinates, and the movement of the frame', () => {
		const { views, input, next, pointer } = setup();
		views.slotFloats[Slot.CanvasCssWidth] = 200;
		views.slotFloats[Slot.CanvasCssHeight] = 100;
		pointer(EVENT_POINTER_MOVE, 10, 20);
		pointer(EVENT_POINTER_MOVE, 150, 25);
		next();
		expect(input.pointer).toMatchObject({ x: 150, y: 25, ndcX: 0.5, ndcY: 0.5 });
		// The first event places the pointer; movement counts from there.
		expect([input.pointer.dx, input.pointer.dy]).toEqual([140, 5]);
		next();
		expect([input.pointer.dx, input.pointer.dy]).toEqual([0, 0]);
	});

	it('presses and releases mouse buttons from the buttons held, a second button on a move too', () => {
		const { input, next, pointer } = setup();
		pointer(EVENT_POINTER_DOWN, 0, 0, 1);
		next();
		expect(edges(input, 'Mouse0')).toEqual({ down: true, pressed: true, released: false });
		// The right button pressed during a drag, then the main button let go: both arrive as moves.
		pointer(EVENT_POINTER_MOVE, 1, 0, 3);
		pointer(EVENT_POINTER_MOVE, 2, 0, 2);
		next();
		expect(edges(input, 'Mouse2')).toEqual({ down: true, pressed: true, released: false });
		expect(edges(input, 'Mouse0')).toEqual({ down: false, pressed: false, released: true });
		expect(input.pointer.buttons).toBe(2);
		pointer(EVENT_POINTER_UP, 2, 0, 0);
		pointer(EVENT_POINTER_DOWN, 2, 0, 4);
		next();
		expect(edges(input, 'Mouse2')).toEqual({ down: false, pressed: false, released: true });
		expect(edges(input, 'Mouse1')).toEqual({ down: true, pressed: true, released: false });
	});

	it('counts the movement made while a button is held as a drag, from the press to the release', () => {
		const { input, next, pointer } = setup();
		pointer(EVENT_POINTER_MOVE, 10, 10);
		pointer(EVENT_POINTER_MOVE, 20, 10);
		pointer(EVENT_POINTER_DOWN, 25, 10, 1);
		pointer(EVENT_POINTER_MOVE, 40, 20, 1);
		pointer(EVENT_POINTER_UP, 45, 20, 0);
		pointer(EVENT_POINTER_MOVE, 60, 30);
		next();
		expect(input.pointer).toMatchObject({ dx: 50, dy: 20, dragDx: 20, dragDy: 10 });
		pointer(EVENT_POINTER_DOWN, 60, 30, 2);
		pointer(EVENT_POINTER_MOVE, 70, 25, 2);
		next();
		expect(input.pointer).toMatchObject({ dx: 10, dy: -5, dragDx: 10, dragDy: -5 });
		next();
		expect(input.pointer).toMatchObject({ dragDx: 0, dragDy: 0 });
	});

	it('sums the wheel of a frame, and tells the scroll of a trackpad pinch from a wheel', () => {
		const { ring, input, next, key } = setup();
		const wheel = (scroll: number, flags = 0) => ring.write(EVENT_WHEEL, 0, scroll, 0, 0, 0, flags);
		wheel(100);
		wheel(-30);
		next();
		expect(input.pointer).toMatchObject({ wheel: 70, pinch: 0 });
		// A pinch comes as scroll with the Control key's flag; a held Control key makes it a wheel's.
		wheel(-4, FLAG_CONTROL);
		wheel(10);
		key(EVENT_KEY_DOWN, 'ControlRight');
		wheel(3, FLAG_CONTROL);
		next();
		expect(input.pointer).toMatchObject({ wheel: 9, pinch: -4 });
		key(EVENT_KEY_UP, 'ControlRight');
		wheel(2, FLAG_CONTROL);
		next();
		expect(input.pointer).toMatchObject({ wheel: 2, pinch: 2 });
		next();
		expect(input.pointer).toMatchObject({ wheel: 0, pinch: 0 });
	});

	it('follows the first finger as the main button, and moves to it without movement', () => {
		const { input, next, pointer } = setup();
		pointer(EVENT_POINTER_MOVE, 100, 100);
		next();
		pointer(EVENT_POINTER_DOWN, 10, 10, 1, 7, PRIMARY_TOUCH);
		pointer(EVENT_POINTER_DOWN, 50, 50, 1, 8, FLAG_TOUCH);
		next();
		expect(input.pointer).toMatchObject({ x: 10, y: 10, dx: 0, dy: 0, isTouch: true, buttons: 1 });
		expect(edges(input, 'Mouse0')).toEqual({ down: true, pressed: true, released: false });
		pointer(EVENT_POINTER_UP, 12, 10, 0, 7, PRIMARY_TOUCH);
		next();
		expect(input.pointer.dx).toBe(2);
		expect(edges(input, 'Mouse0')).toEqual({ down: false, pressed: false, released: true });
	});
});

describe('input: touches', () => {
	it('lists the fingers on the canvas oldest first, with their movement in the frame', () => {
		const { input, next, pointer } = setup();
		const list = input.touches;
		pointer(EVENT_POINTER_DOWN, 1, 1, 1, 5, PRIMARY_TOUCH);
		pointer(EVENT_POINTER_DOWN, 2, 2, 1, 6, FLAG_TOUCH);
		pointer(EVENT_POINTER_MOVE, 5, 6, 1, 6, FLAG_TOUCH);
		next();
		expect(input.touches.map((t) => ({ ...t }))).toEqual([
			{ id: 5, x: 1, y: 1, dx: 0, dy: 0 },
			{ id: 6, x: 5, y: 6, dx: 3, dy: 4 },
		]);
		pointer(EVENT_POINTER_UP, 1, 1, 0, 5, PRIMARY_TOUCH);
		pointer(EVENT_POINTER_DOWN, 9, 9, 1, 11, FLAG_TOUCH);
		next();
		expect(input.touches.map((t) => [t.id, t.dx])).toEqual([
			[6, 0],
			[11, 0],
		]);
		expect(input.touches).toBe(list);
	});

	it('follows ten fingers at most', () => {
		const { input, next, pointer } = setup();
		for (let id = 1; id <= 12; id++) pointer(EVENT_POINTER_DOWN, id, id, 1, id, FLAG_TOUCH);
		next();
		expect(input.touches.map((t) => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		for (let id = 1; id <= 12; id++) pointer(EVENT_POINTER_UP, id, id, 0, id, FLAG_TOUCH);
		next();
		expect(input.touches).toHaveLength(0);
	});
});

describe('input: actions', () => {
	it('counts an action down while any of its keys and buttons is down, pressed and released once', () => {
		const { input, next, key, padButton } = setup();
		input.actions.define({ jump: ['Space', 'GamepadA'] });
		key(EVENT_KEY_DOWN, 'Space');
		next();
		expect(edges(input, 'jump')).toEqual({ down: true, pressed: true, released: false });
		padButton(0, PAD_A, 1);
		next();
		expect(edges(input, 'jump')).toEqual({ down: true, pressed: false, released: false });
		key(EVENT_KEY_UP, 'Space');
		next();
		expect(edges(input, 'jump')).toEqual({ down: true, pressed: false, released: false });
		padButton(0, PAD_A, 0);
		next();
		expect(edges(input, 'jump')).toEqual({ down: false, pressed: false, released: true });
		key(EVENT_KEY_DOWN, 'Space');
		key(EVENT_KEY_UP, 'Space');
		next();
		expect(edges(input, 'jump')).toEqual({ down: false, pressed: true, released: true });
	});

	it("gives an action the largest value of its keys and buttons, and replaces an action's list", () => {
		const { input, next, key, padButton } = setup();
		input.actions.define({ fire: ['Mouse0', 'GamepadRT'] });
		padButton(0, PAD_RT, 0.25, false);
		key(EVENT_KEY_DOWN, 'KeyJ');
		next();
		expect(input.value('fire')).toBe(0.25);
		expect(input.isDown('fire')).toBe(false);
		input.actions.define({ fire: ['KeyJ'] });
		expect(input.isDown('fire')).toBe(true);
		expect(input.value('fire')).toBe(1);
		padButton(0, PAD_RT, 1);
		next();
		expect(input.isDown('fire')).toBe(true);
		key(EVENT_KEY_UP, 'KeyJ');
		next();
		expect(edges(input, 'fire')).toEqual({ down: false, pressed: false, released: true });
	});

	it('throws E1205 for an action named like a key, or bound to a name that is not a key or button', () => {
		const { input } = setup();
		expect(() => input.actions.define({ Space: ['KeyJ'] })).toThrow(
			'E1205: input.actions.define() got the action name "Space", which names a key or button.',
		);
		expect(() => input.actions.define({ jump: ['space'] })).toThrow(
			'input.actions.define() got "space" for the action "jump"',
		);
		input.actions.define({ run: ['ShiftLeft'] });
		expect(() => input.actions.define({ sprint: ['run'] })).toThrow('got "run" for the action');
	});
});

describe('input: gamepads', () => {
	it('merges the pads: a button is down while any pad holds it', () => {
		const { input, next, padButton } = setup();
		padButton(0, PAD_A, 1);
		padButton(1, PAD_A, 1);
		next();
		expect(edges(input, 'GamepadA')).toEqual({ down: true, pressed: true, released: false });
		padButton(0, PAD_A, 0);
		next();
		expect(edges(input, 'GamepadA')).toEqual({ down: true, pressed: false, released: false });
		padButton(1, PAD_A, 0);
		next();
		expect(edges(input, 'GamepadA')).toEqual({ down: false, pressed: false, released: true });
	});

	it('names every button of the standard layout by its number, the last one too', () => {
		const { input, next, padButton, key } = setup();
		const names = ['GamepadA', 'GamepadStart', 'GamepadDpadRight', 'GamepadHome'];
		for (const [k, button] of [0, 9, 15, 16].entries()) {
			padButton(0, button, 1);
			next();
			expect([button, input.wasPressed(names[k] as string)]).toEqual([button, true]);
		}
		// The keys come after the stick directions, whose names sit between.
		key(EVENT_KEY_DOWN, 'KeyA');
		next();
		expect([input.isDown('KeyA'), input.isDown('GamepadRightStickDown')]).toEqual([true, false]);
	});

	it('gives a trigger its value, and its press as the browser reports it', () => {
		const { input, next, padButton } = setup();
		padButton(0, PAD_RT, 0.25, false);
		next();
		expect([input.value('GamepadRT'), input.isDown('GamepadRT')]).toEqual([0.25, false]);
		padButton(0, PAD_RT, 0.75, true);
		next();
		expect([input.value('GamepadRT'), input.wasPressed('GamepadRT')]).toEqual([0.75, true]);
	});

	it('turns each stick into four directions, with a dead zone at the center', () => {
		const { input, next, padAxis } = setup();
		padAxis(0, 0, 1);
		padAxis(0, 1, -1);
		next();
		expect(input.value('GamepadLeftStickRight')).toBeCloseTo(Math.SQRT1_2, 6);
		expect(input.value('GamepadLeftStickUp')).toBeCloseTo(Math.SQRT1_2, 6);
		expect(input.value('GamepadLeftStickLeft')).toBe(0);
		expect(input.value('GamepadLeftStickDown')).toBe(0);
		expect(edges(input, 'GamepadLeftStickRight')).toEqual({
			down: true,
			pressed: true,
			released: false,
		});
		// Inside the dead zone, even on a diagonal.
		padAxis(0, 0, 0.1);
		padAxis(0, 1, -0.1);
		next();
		expect(input.value('GamepadLeftStickRight')).toBe(0);
		expect(input.value('GamepadLeftStickUp')).toBe(0);
		expect(edges(input, 'GamepadLeftStickRight')).toEqual({
			down: false,
			pressed: false,
			released: true,
		});
		// The right stick has axes 2 and 3; a value counts from the dead zone's edge.
		padAxis(0, 2, -0.55);
		next();
		expect(input.value('GamepadRightStickLeft')).toBeCloseTo(0.5, 6);
		expect(input.value('GamepadLeftStickLeft')).toBe(0);
	});

	it('keeps a direction down until it falls clearly below the value that pressed it', () => {
		const { input, next, padAxis } = setup();
		const right = (value: number) => {
			padAxis(0, 0, value);
			next();
			return input.isDown('GamepadLeftStickRight');
		};
		expect(right(0.5)).toBe(false);
		expect(right(0.75)).toBe(true);
		expect(right(0.5)).toBe(true);
		expect(right(0.45)).toBe(false);
		expect(right(0.5)).toBe(false);
	});

	it('takes each stick from the pad that pushes it furthest', () => {
		const { input, next, padAxis } = setup();
		padAxis(0, 0, 0.35);
		padAxis(1, 0, -0.95);
		next();
		expect(input.value('GamepadLeftStickLeft')).toBeCloseTo(1, 6);
		expect(input.value('GamepadLeftStickRight')).toBe(0);
		padAxis(1, 0, 0);
		next();
		expect(input.value('GamepadLeftStickRight')).toBeCloseTo(0.25, 6);
	});
});
