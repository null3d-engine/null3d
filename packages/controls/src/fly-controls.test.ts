// The fly controls against three.js's own FlyControls. Each test feeds the same scripted keys and
// pointer events to both. three.js's controls get them as the browser would send DOM events.
// null3D's get them through the engine's input ring and reader, and read them once per frame.
// After each frame, both cameras must have the same position and rotation.
import { describe, expect, it } from 'bun:test';
import type { PerspectiveCamera as Perspective } from '@null3d/engine';
import { PerspectiveCamera } from 'three';
import { FlyControls as ThreeFlyControls } from 'three/addons/controls/FlyControls.js';
import { ScriptedInput } from '../../../tests/pages/lib/scripted-input';
import { STAND_IN_FOV as FOV, StandInCamera } from '../../../tests/pages/lib/stand-in-cameras';
import { createFlyControls, type FlyControls, type FlyControlsOptions } from './fly-controls';

/** The canvas's size in CSS pixels. */
const WIDTH = 640;
const HEIGHT = 360;
const STEP = 1 / 60;
/** How far a value may stray, relative to its size: the camera stores 32-bit floats. */
const TOLERANCE = 2e-6;

const LEFT = { button: 0, buttons: 1 };
const RIGHT = { button: 2, buttons: 2 };

/** The parts of three.js's controls that take events. */
interface ThreeHandlers {
	_onKeyDown(event: object): void;
	_onKeyUp(event: object): void;
	_onPointerDown(event: object): void;
	_onPointerMove(event: object): void;
	_onPointerUp(event: object): void;
	_getContainerDimensions(): { size: number[]; offset: number[] };
	_updateMovementVector(): void;
}

type ThreeControls = ThreeFlyControls & ThreeHandlers;

/** One camera with null3D's controls and one with three.js's, fed the same input. */
class Twin {
	readonly camera = new StandInCamera();
	readonly controls: FlyControls;
	readonly threeCamera = new PerspectiveCamera(FOV, WIDTH / HEIGHT, 0.1, 1000);
	readonly three: ThreeControls;
	readonly input = new ScriptedInput(WIDTH, HEIGHT);
	private readonly start: number[];

	constructor(options: FlyControlsOptions = {}) {
		this.camera.setPosition(0, 2, 8);
		this.camera.lookAt(1, 0.5, 0);
		this.threeCamera.position.set(0, 2, 8);
		const [x, y, z, w] = this.camera.rotation as unknown as number[];
		this.threeCamera.quaternion.set(x as number, y as number, z as number, w as number);
		this.controls = createFlyControls(
			this.input.context,
			this.camera as unknown as Perspective,
			options,
		);
		// No DOM element: the test sends the events, and gives the canvas's size.
		this.three = new ThreeFlyControls(this.threeCamera) as ThreeControls;
		this.three._getContainerDimensions = () => ({ size: [WIDTH, HEIGHT], offset: [0, 0] });
		Object.assign(this.three, options);
		// three.js takes autoForward at its next key or pointer event, and null3D at once.
		this.three._updateMovementVector();
		this.start = [...this.camera.stored];
	}

	/** How far the camera moved since the controls started, to show that it moved. */
	travel(): number {
		return Math.hypot(...this.start.map((value, k) => (this.camera.stored[k] as number) - value));
	}

	key(code: string, down: boolean): void {
		if (down) this.three._onKeyDown({ code, altKey: false });
		else this.three._onKeyUp({ code });
		this.input.key(code, down);
	}

	pointer(
		type: 'down' | 'move' | 'up',
		x: number,
		y: number,
		button: { button?: number; buttons: number },
	): void {
		const event = { pointerId: 1, pointerType: 'mouse', pageX: x, pageY: y, ...button };
		if (type === 'down') this.three._onPointerDown(event);
		else if (type === 'move') this.three._onPointerMove(event);
		else this.three._onPointerUp(event);
		this.input.pointer(type, x, y, button);
	}

	step(dt = STEP): void {
		this.input.beginFrame();
		this.controls.update(dt);
		this.three.update(dt);
	}

	differences(): string[] {
		const found: string[] = [];
		const { position, quaternion: q } = this.threeCamera;
		for (const [k, value] of [position.x, position.y, position.z].entries()) {
			const got = this.camera.stored[k] as number;
			if (!(Math.abs(got - value) <= TOLERANCE * Math.max(1, Math.abs(value))))
				found.push(`position[${k}] is ${got}, and three.js has ${value}`);
		}
		const r = this.camera.rotation;
		const dot = Math.abs(
			(r[0] as number) * q.x +
				(r[1] as number) * q.y +
				(r[2] as number) * q.z +
				(r[3] as number) * q.w,
		);
		if (!(1 - dot <= 1e-6)) found.push(`the rotations differ: their dot product is ${dot}`);
		return found;
	}

	/** Runs frames, and checks that both cameras agree after each. */
	frames(count: number, dt = STEP): void {
		for (let frame = 0; frame < count; frame++) {
			this.step(dt);
			expect(this.differences()).toEqual([]);
		}
	}
}

describe('fly controls against three.js', () => {
	it('move along the camera with W, A, S, D, R and F, and turn and roll with the arrows, Q and E', () => {
		const twin = new Twin({ movementSpeed: 3, rollSpeed: 0.8 });
		for (const keys of [['KeyW'], ['KeyA', 'KeyR'], ['KeyS', 'KeyD', 'KeyF']]) {
			for (const key of keys) twin.key(key, true);
			twin.frames(20);
			for (const key of keys) twin.key(key, false);
		}
		for (const keys of [
			['ArrowUp', 'KeyW'],
			['ArrowLeft'],
			['KeyQ', 'ArrowDown'],
			['KeyE', 'ArrowRight', 'KeyW'],
		]) {
			for (const key of keys) twin.key(key, true);
			twin.frames(25);
			for (const key of keys) twin.key(key, false);
		}
		twin.frames(2);
		expect(twin.travel()).toBeGreaterThan(2);
	});

	it('steer by the pointer, and move forward and back with the left and right buttons', () => {
		const twin = new Twin({ rollSpeed: 0.5, movementSpeed: 2 });
		twin.pointer('move', 500, 90, { buttons: 0 });
		twin.frames(20);
		twin.pointer('move', 100, 300, { buttons: 0 });
		twin.frames(20);
		twin.pointer('down', 100, 300, LEFT);
		twin.frames(15);
		twin.pointer('up', 100, 300, { button: 0, buttons: 0 });
		twin.frames(1);
		twin.pointer('move', 330, 170, { buttons: 0 });
		twin.pointer('down', 330, 170, RIGHT);
		twin.frames(5);
		twin.pointer('up', 330, 170, { button: 2, buttons: 0 });
		twin.frames(5);
		expect(twin.travel()).toBeGreaterThan(0.2);
	});

	it('steer only during a drag with dragToLook, and stop turning at the release', () => {
		const twin = new Twin({ dragToLook: true, rollSpeed: 0.5 });
		// A move without a press steers nothing.
		twin.pointer('move', 600, 40, { buttons: 0 });
		twin.frames(5);
		twin.pointer('down', 600, 40, LEFT);
		twin.frames(3);
		for (let move = 1; move <= 10; move++) {
			twin.pointer('move', 600 - 40 * move, 40 + 20 * move, { buttons: 1 });
			twin.frames(2);
		}
		twin.pointer('up', 200, 240, { button: 0, buttons: 0 });
		twin.frames(10);
		expect(twin.travel()).toBe(0);
	});

	it('move forward on their own with autoForward, until a key moves back', () => {
		const twin = new Twin({ autoForward: true, movementSpeed: 4 });
		twin.frames(20);
		twin.key('KeyS', true);
		twin.frames(10);
		twin.key('KeyS', false);
		twin.frames(10, 1 / 30);
		expect(twin.travel()).toBeGreaterThan(2);
	});

	it('carry on from a camera that the sketch moved and turned', () => {
		const twin = new Twin({ movementSpeed: 2 });
		twin.key('KeyW', true);
		twin.frames(10);
		twin.camera.setPosition(4, 1, -2);
		twin.camera.lookAt(0, 3, 0);
		twin.threeCamera.position.set(4, 1, -2);
		const [x, y, z, w] = twin.camera.rotation as unknown as number[];
		twin.threeCamera.quaternion.set(x as number, y as number, z as number, w as number);
		twin.frames(10);
	});
});

describe('fly controls', () => {
	it('stop the camera, and take no input, while not enabled', () => {
		const twin = new Twin();
		twin.controls.enabled = false;
		twin.input.key('KeyW', true);
		twin.input.beginFrame();
		expect(twin.controls.update(STEP)).toBe(false);
		expect(twin.travel()).toBe(0);
		twin.controls.enabled = true;
		twin.input.beginFrame();
		expect(twin.controls.update(STEP)).toBe(true);
		expect(twin.travel()).toBeGreaterThan(0);
	});

	it('say whether the camera moved', () => {
		const twin = new Twin();
		twin.input.beginFrame();
		expect(twin.controls.update(STEP)).toBe(false);
		twin.input.key('ArrowLeft', true);
		twin.input.beginFrame();
		expect(twin.controls.update(1)).toBe(true);
	});
});
