// The first-person controls against three.js's own FirstPersonControls and PointerLockControls.
// Each test feeds the same scripted keys, drags and touches to both. three.js's controls get them as
// the browser would send DOM events. null3D's get them through the engine's input ring and reader,
// and read them once per frame. After each frame, both cameras must have the same position and
// rotation.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PerspectiveCamera as Perspective } from '@null3d/engine';
import { PerspectiveCamera, Vector3 } from 'three';
import { FirstPersonControls as ThreeFirstPersonControls } from 'three/addons/controls/FirstPersonControls.js';
import { PointerLockControls as ThreePointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { ScriptedInput, type ScriptedPointer } from '../../../tests/pages/lib/scripted-input';
import { STAND_IN_FOV as FOV, StandInCamera } from '../../../tests/pages/lib/stand-in-cameras';
import {
	createFirstPersonControls,
	type FirstPersonControls,
	type FirstPersonControlsOptions,
} from './first-person-controls';

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
	_onMouseMove(event: object): void;
}

type ThreeControls = ThreeFirstPersonControls & ThreeHandlers;

/** The canvas that three.js's FirstPersonControls focus and capture the pointer on. */
function standInElement() {
	const ignore = () => {};
	return { focus: ignore, setPointerCapture: ignore, releasePointerCapture: ignore, style: {} };
}

// three.js's FirstPersonControls compare their element with the document, which bun lacks.
const hadDocument = 'document' in globalThis;
beforeEach(() => {
	if (!hadDocument) Object.assign(globalThis, { document: {} });
});
afterEach(() => {
	if (!hadDocument) Reflect.deleteProperty(globalThis, 'document');
});

/** One camera with null3D's controls and one with three.js's, fed the same input. */
class Twin {
	readonly camera = new StandInCamera();
	readonly controls: FirstPersonControls;
	readonly threeCamera = new PerspectiveCamera(FOV, WIDTH / HEIGHT, 0.1, 1000);
	readonly three: ThreeControls;
	readonly lock: ThreePointerLockControls & ThreeHandlers;
	readonly input = new ScriptedInput(WIDTH, HEIGHT);
	private readonly start: number[];

	constructor(
		options: FirstPersonControlsOptions = {},
		position: [number, number, number] = [0, 1.5, 6],
	) {
		this.camera.setPosition(...position);
		this.camera.lookAt(2, 1, 0);
		this.threeCamera.position.set(...position);
		this.matchRotation();
		this.controls = createFirstPersonControls(
			this.input.context,
			this.camera as unknown as Perspective,
			options,
		);
		this.three = new ThreeFirstPersonControls(this.threeCamera) as ThreeControls;
		(this.three as unknown as { domElement: unknown }).domElement = standInElement();
		const { pointerSpeed, minPolarAngle, maxPolarAngle, ...rest } = options;
		Object.assign(this.three, rest);
		this.lock = new ThreePointerLockControls(this.threeCamera) as ThreePointerLockControls &
			ThreeHandlers;
		Object.assign(this.lock, { pointerSpeed, minPolarAngle, maxPolarAngle });
		for (const [name, value] of Object.entries(this.lock))
			if (value === undefined) Reflect.deleteProperty(this.lock, name);
		this.lock.pointerSpeed ??= 1;
		this.lock.minPolarAngle ??= 0;
		this.lock.maxPolarAngle ??= Math.PI;
		this.start = [...this.camera.stored];
	}

	/** Gives three.js's camera the stand-in camera's rotation. */
	matchRotation(): void {
		const [x, y, z, w] = this.camera.rotation as unknown as number[];
		this.threeCamera.quaternion.set(x as number, y as number, z as number, w as number);
		this.threeCamera.updateMatrix();
	}

	travel(): number {
		return Math.hypot(...this.start.map((value, k) => (this.camera.stored[k] as number) - value));
	}

	key(code: string, down: boolean): void {
		if (down) this.three._onKeyDown({ code });
		else this.three._onKeyUp({ code });
		this.input.key(code, down);
	}

	pointer(type: 'down' | 'move' | 'up', x: number, y: number, options: ScriptedPointer): void {
		const event = {
			pointerId: options.id ?? 1,
			pointerType: options.touch ? 'touch' : 'mouse',
			button: options.button ?? -1,
			buttons: options.buttons,
			pageX: x,
			pageY: y,
		};
		if (type === 'down') this.three._onPointerDown(event);
		else if (type === 'move') this.three._onPointerMove(event);
		else this.three._onPointerUp(event);
		this.input.pointer(type, x, y, options);
	}

	/** The page locks the pointer, which both sides see. */
	lockPointer(): void {
		this.lock.isLocked = true;
		this.input.lock(true);
	}

	/** The locked mouse moves: three.js's PointerLockControls turn the camera at once. */
	lockedMove(dx: number, dy: number): void {
		this.lock._onMouseMove({ movementX: dx, movementY: dy });
		this.input.pointer('move', dx, dy, { buttons: 0 }, true);
	}

	/** A frame of FirstPersonControls on both sides. */
	step(dt = STEP): void {
		this.input.beginFrame();
		this.controls.update(dt);
		this.three.update(dt);
		this.threeCamera.updateMatrix();
	}

	/** A frame while the pointer is locked: three.js's PointerLockControls need no update. */
	lockedStep(dt = STEP): void {
		this.input.beginFrame();
		this.controls.update(dt);
		this.threeCamera.updateMatrix();
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

	frames(count: number, dt = STEP): void {
		for (let frame = 0; frame < count; frame++) {
			this.step(dt);
			expect(this.differences()).toEqual([]);
		}
	}

	lockedFrames(count: number): void {
		for (let frame = 0; frame < count; frame++) {
			this.lockedStep();
			expect(this.differences()).toEqual([]);
		}
	}
}

describe('first-person controls against three.js', () => {
	it('walk with W, A, S, D and the arrows, climb with R and F, and ease to a stop', () => {
		const twin = new Twin({ movementSpeed: 4 });
		for (const keys of [
			['KeyW'],
			['KeyA', 'ArrowUp'],
			['KeyR', 'KeyD'],
			['ArrowDown', 'KeyF', 'ArrowLeft'],
		]) {
			for (const key of keys) twin.key(key, true);
			twin.frames(20);
			for (const key of keys) twin.key(key, false);
		}
		twin.frames(30);
		expect(twin.travel()).toBeGreaterThan(1.5);
	});

	it('look around and walk forward with a left drag, and walk back with a right drag', () => {
		const twin = new Twin({ lookSpeed: 0.4, movementSpeed: 2 });
		twin.pointer('move', 320, 180, { buttons: 0 });
		twin.pointer('down', 320, 180, LEFT);
		twin.frames(2);
		for (let move = 1; move <= 12; move++) {
			twin.pointer('move', 320 + 8 * move, 180 - 5 * move, { buttons: 1 });
			twin.frames(2);
		}
		twin.pointer('up', 416, 120, { button: 0, buttons: 0 });
		twin.frames(20);
		twin.pointer('down', 300, 200, RIGHT);
		for (let move = 1; move <= 8; move++) {
			twin.pointer('move', 300 - 10 * move, 200 + 6 * move, { buttons: 2 });
			twin.frames(3);
		}
		twin.pointer('up', 220, 248, { button: 2, buttons: 0 });
		twin.frames(30);
		expect(twin.travel()).toBeGreaterThan(0.1);
	});

	it('only look with a drag while a key walks forward or back', () => {
		const twin = new Twin({ lookSpeed: 0.3 });
		twin.key('KeyS', true);
		twin.pointer('down', 200, 100, LEFT);
		for (let move = 1; move <= 10; move++) {
			twin.pointer('move', 200 + 6 * move, 100, { buttons: 1 });
			twin.frames(2);
		}
		twin.key('KeyS', false);
		twin.frames(10);
		twin.pointer('up', 260, 100, { button: 0, buttons: 0 });
		twin.frames(10);
	});

	it('walk forward and look with one finger, and walk back with two', () => {
		const twin = new Twin({ lookSpeed: 0.3, movementSpeed: 2 });
		const one = { id: 11, touch: true, primary: true };
		const two = { id: 12, touch: true, primary: false };
		twin.pointer('down', 300, 200, { ...one, button: 0, buttons: 1 });
		twin.frames(2);
		for (let move = 1; move <= 10; move++) {
			twin.pointer('move', 300 - 7 * move, 200 + 3 * move, { ...one, buttons: 1 });
			twin.frames(2);
		}
		twin.pointer('down', 400, 220, { ...two, button: 0, buttons: 1 });
		twin.frames(20);
		twin.pointer('up', 400, 220, { ...two, button: 0, buttons: 0 });
		twin.pointer('up', 230, 230, { ...one, button: 0, buttons: 0 });
		twin.frames(20);
		expect(twin.travel()).toBeGreaterThan(0.05);
	});

	it('follow autoForward, heightSpeed, constrainVertical and lookVertical', () => {
		const options = [
			{ autoForward: true, movementSpeed: 3 },
			{ heightSpeed: true, heightCoef: 2, heightMin: 0, heightMax: 4, movementSpeed: 1 },
			{ constrainVertical: true, verticalMin: 1, verticalMax: 2, lookSpeed: 0.3 },
			{ lookVertical: false, lookSpeed: 0.3, dampingFactor: 0.3 },
		];
		for (const option of options) {
			const twin = new Twin(option, [0, 2.5, 6]);
			twin.key('KeyW', true);
			twin.frames(10);
			twin.key('KeyW', false);
			twin.pointer('down', 320, 180, { button: 1, buttons: 4 });
			for (let move = 1; move <= 10; move++) {
				twin.pointer('move', 320 + 9 * move, 180 + 9 * move, { buttons: 4 });
				twin.frames(2);
			}
			twin.pointer('up', 410, 270, { button: 1, buttons: 0 });
			twin.frames(10);
		}
	});

	it('turn toward a point with lookAt', () => {
		const twin = new Twin({ lookSpeed: 0.3 });
		twin.controls.lookAt(-3, 4, 1);
		twin.three.lookAt(-3, 4, 1);
		expect(twin.differences()).toEqual([]);
		twin.key('KeyW', true);
		twin.frames(10);
	});

	it('carry on from a camera that the sketch moved', () => {
		const twin = new Twin({ movementSpeed: 2 });
		twin.key('KeyD', true);
		twin.frames(10);
		twin.camera.setPosition(5, 0.5, -3);
		twin.threeCamera.position.set(5, 0.5, -3);
		twin.frames(10);
	});
});

describe('first-person controls against three.js, with the pointer locked', () => {
	it('turn as PointerLockControls turn, within their polar limits', () => {
		const twin = new Twin({
			movementSpeed: 0,
			pointerSpeed: 1.5,
			minPolarAngle: 0.6,
			maxPolarAngle: 2.2,
		});
		twin.lockPointer();
		twin.lockedFrames(1);
		const moves = [
			[30, -4],
			[-12.5, 8],
			[3, -260],
			[40, 120],
			[-80, 400],
			[0, -45],
		];
		for (const [dx, dy] of moves) {
			twin.lockedMove(dx as number, dy as number);
			twin.lockedFrames(1);
		}
		// Several moves in one frame add up, as long as none of them reaches a limit.
		twin.lockedMove(10, 5);
		twin.lockedMove(-4, 7.5);
		twin.lockedMove(22, -3);
		twin.lockedFrames(2);
	});

	it('move forward over the ground and to the right, as PointerLockControls move', () => {
		const twin = new Twin({ movementSpeed: 0 });
		twin.lockPointer();
		const direction = new Vector3();
		const ours = [0, 0, 0];
		for (const [dx, dy, forward, right] of [
			[60, -30, 1.5, 0],
			[-200, 80, -0.5, 2],
			[35, 10, 3, -1.25],
		]) {
			twin.lockedMove(dx as number, dy as number);
			twin.lockedFrames(1);
			twin.controls.moveForward(forward as number);
			twin.lock.moveForward(forward as number);
			twin.controls.moveRight(right as number);
			twin.lock.moveRight(right as number);
			twin.threeCamera.updateMatrix();
			expect(twin.differences()).toEqual([]);
			twin.lock.getDirection(direction);
			twin.controls.getDirection(ours);
			for (const [k, value] of direction.toArray().entries())
				expect(Math.abs((ours[k] as number) - value)).toBeLessThan(TOLERANCE);
		}
	});
});

describe('first-person controls', () => {
	it('stop looking with the pointer while it is locked, and turn only by its movement', () => {
		const twin = new Twin({ lookSpeed: 0.3 });
		twin.input.pointer('down', 100, 100, LEFT);
		twin.input.beginFrame();
		twin.controls.update(STEP);
		twin.input.lock(true);
		twin.input.beginFrame();
		twin.controls.update(STEP);
		const before = [...twin.camera.stored];
		// A locked drag walks no further: without movement, the camera eases to a stop.
		for (let frame = 0; frame < 120; frame++) {
			twin.input.beginFrame();
			twin.controls.update(STEP);
		}
		const after = [...twin.camera.stored];
		twin.input.beginFrame();
		expect(twin.controls.update(STEP)).toBe(false);
		expect(Math.hypot(...after.map((value, k) => value - (before[k] as number)))).toBeLessThan(0.1);
	});

	it('start no drag from a button that was down when they started', () => {
		const input = new ScriptedInput(WIDTH, HEIGHT);
		input.pointer('down', 100, 100, LEFT);
		input.beginFrame();
		const camera = new StandInCamera();
		camera.setPosition(0, 1, 5);
		camera.lookAt(0, 1, 0);
		const controls = createFirstPersonControls(input.context, camera as unknown as Perspective);
		input.pointer('move', 300, 50, { buttons: 1 });
		for (let frame = 0; frame < 10; frame++) {
			input.beginFrame();
			controls.update(STEP);
		}
		expect([...camera.stored]).toEqual([0, 1, 5]);
	});
});
