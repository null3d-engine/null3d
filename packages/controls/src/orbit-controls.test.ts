// The controls against three.js's own OrbitControls and MapControls. Each test feeds the same
// scripted drags, wheel scrolls and touches to both. three.js's controls get them as the browser
// would send DOM events. null3D's get them through the engine's input ring and reader, as the page
// writes them, and read them once per frame. After each frame, both cameras must have the same
// position, target and rotation, and an orthographic camera the same view height.
import { describe, expect, it } from 'bun:test';
import type { PerspectiveCamera as Perspective, SketchContext } from '@null3d/engine';
import { MOUSE, OrthographicCamera, PerspectiveCamera, TOUCH } from 'three';
import { MapControls as ThreeMapControls } from 'three/addons/controls/MapControls.js';
import { OrbitControls as ThreeOrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ScriptedInput } from '../../../tests/pages/lib/scripted-input';
import {
	STAND_IN_FOV as FOV,
	StandInCamera,
	StandInOrthographic,
	STAND_IN_VIEW_HEIGHT as VIEW_HEIGHT,
} from '../../../tests/pages/lib/stand-in-cameras';
import type { InputRing } from '../../engine/src/page/input-ring';
import {
	EVENT_KEY_DOWN,
	EVENT_KEY_UP,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_WHEEL,
	FLAG_CONTROL,
	FLAG_META,
	FLAG_PRIMARY,
	FLAG_SHIFT,
	FLAG_TOUCH,
} from '../../engine/src/shared/control';
import { KEY_CODES } from '../../engine/src/shared/key-codes';
import type { InputReader } from '../../engine/src/sketch/input';
import {
	createMapControls,
	createOrbitControls,
	type OrbitControls,
	type OrbitControlsOptions,
} from './orbit-controls';

/** The canvas's size in CSS pixels. */
const WIDTH = 640;
const HEIGHT = 360;
const STEP = 1 / 60;
/** How far a value may stray, relative to its size: the camera stores 32-bit floats. */
const TOLERANCE = 2e-6;

/** Mouse buttons, as `PointerEvent.button` and `PointerEvent.buttons` give them. */
const LEFT = { button: 0, buttons: 1 };
const MIDDLE = { button: 1, buttons: 4 };
const RIGHT = { button: 2, buttons: 2 };

/** The element that three.js's controls listen to: the canvas at the page's top-left corner. */
function standInElement() {
	const ignore = () => {};
	const document = { addEventListener: ignore, removeEventListener: ignore };
	return {
		clientWidth: WIDTH,
		clientHeight: HEIGHT,
		style: {},
		ownerDocument: document,
		getRootNode: () => document,
		addEventListener: ignore,
		removeEventListener: ignore,
		setPointerCapture: ignore,
		releasePointerCapture: ignore,
		getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT }),
	};
}

/** The parts of three.js's controls that take events, and a pan without an update. */
interface ThreeHandlers {
	_onPointerDown(event: object): void;
	_onPointerMove(event: object): void;
	_onPointerUp(event: object): void;
	_onMouseWheel(event: object): void;
	_interceptControlDown(event: object): void;
	_interceptControlUp(event: object): void;
	_rotateLeft(angle: number): void;
}

type ThreeControls = ThreeOrbitControls & ThreeHandlers;

const THREE_MOUSE = { rotate: MOUSE.ROTATE, dolly: MOUSE.DOLLY, pan: MOUSE.PAN } as const;
const THREE_TOUCH = {
	rotate: TOUCH.ROTATE,
	pan: TOUCH.PAN,
	'dolly-pan': TOUCH.DOLLY_PAN,
	'dolly-rotate': TOUCH.DOLLY_ROTATE,
} as const;

interface PointerOptions {
	button?: number;
	buttons: number;
	/** The pointer's id: 1 for the mouse, and one per finger. */
	id?: number;
	touch?: boolean;
	/** True for the mouse and for the first finger down. */
	primary?: boolean;
}

/**
 * One camera with null3D's controls and one with three.js's, fed the same input. Events go to
 * three.js's controls as they come; `step` then runs a frame of both.
 */
class Twin {
	readonly camera: StandInCamera;
	readonly controls: OrbitControls;
	readonly threeCamera: PerspectiveCamera | OrthographicCamera;
	readonly three: ThreeControls;
	private readonly ring: InputRing;
	readonly reader: InputReader;
	private frame = 0;
	/** The keys held, which three.js's controls see as flags on each pointer event. */
	private readonly held = new Set<string>();
	/** The pointers that three.js's controls follow: those pressed on the canvas. */
	private readonly pressed = new Set<number>();
	/** The camera and the target after the controls started. */
	private readonly start: { position: number[]; target: number[] };

	constructor(
		kind: 'orbit' | 'map',
		position: readonly [number, number, number],
		options: OrbitControlsOptions = {},
		lens: 'perspective' | 'orthographic' = 'perspective',
	) {
		const orthographic = lens === 'orthographic';
		this.camera = orthographic ? new StandInOrthographic() : new StandInCamera();
		const half = VIEW_HEIGHT / 2;
		const aspect = WIDTH / HEIGHT;
		this.threeCamera = orthographic
			? new OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 1000)
			: new PerspectiveCamera(FOV, aspect, 0.1, 1000);
		const input = new ScriptedInput(WIDTH, HEIGHT);
		this.ring = input.ring;
		this.reader = input.reader;
		this.camera.setPosition(...position);
		const context = input.context;
		const create = kind === 'map' ? createMapControls : createOrbitControls;
		this.controls = create(context, this.camera as unknown as Perspective, options);

		this.threeCamera.position.set(...position);
		const Controls = kind === 'map' ? ThreeMapControls : ThreeOrbitControls;
		const element = standInElement() as unknown as HTMLElement;
		this.three = new Controls(this.threeCamera, element) as ThreeControls;
		const { target, mouseButtons, touches, ...rest } = options;
		Object.assign(this.three, rest);
		if (target)
			this.three.target.set(target[0] as number, target[1] as number, target[2] as number);
		for (const [button, action] of Object.entries(mouseButtons ?? {}))
			Object.assign(this.three.mouseButtons, { [button]: action ? THREE_MOUSE[action] : -1 });
		for (const [fingers, action] of Object.entries(touches ?? {}))
			Object.assign(this.three.touches, { [fingers]: action ? THREE_TOUCH[action] : -1 });
		// As null3D's controls do when they start: turn toward the target, within the limits.
		this.three.update();
		this.threeCamera.updateMatrixWorld();
		this.start = { position: [...this.camera.stored], target: [...this.controls.target] };
	}

	/** How far the camera and the target moved since the controls started, to show that they moved. */
	travel(): { camera: number; target: number } {
		const apart = (a: ArrayLike<number>, b: readonly number[]) =>
			Math.sqrt(b.reduce((sum, value, k) => sum + ((a[k] as number) - value) ** 2, 0));
		return {
			camera: apart(this.camera.stored, this.start.position),
			target: apart(this.controls.target, this.start.target),
		};
	}

	/** A pointer event, sent as the browser sends it, and written into the ring as the page does. */
	pointer(type: 'down' | 'move' | 'up', x: number, y: number, options: PointerOptions): void {
		const id = options.id ?? 1;
		const touch = options.touch ?? false;
		const shiftKey = this.held.has('ShiftLeft');
		const ctrlKey = this.held.has('ControlLeft');
		const metaKey = this.held.has('MetaLeft');
		const event = {
			pointerId: id,
			pointerType: touch ? 'touch' : 'mouse',
			button: options.button ?? -1,
			buttons: options.buttons,
			clientX: x,
			clientY: y,
			pageX: x,
			pageY: y,
			shiftKey,
			ctrlKey,
			metaKey,
			preventDefault() {},
		};
		// three.js's controls listen for moves and releases only while a pointer is pressed.
		if (type === 'down') {
			this.three._onPointerDown(event);
			this.pressed.add(id);
		} else if (type === 'move') {
			if (this.pressed.size > 0) this.three._onPointerMove(event);
		} else if (this.pressed.delete(id)) this.three._onPointerUp(event);
		const flags =
			(touch ? FLAG_TOUCH : 0) |
			((options.primary ?? !touch) ? FLAG_PRIMARY : 0) |
			(shiftKey ? FLAG_SHIFT : 0) |
			(ctrlKey ? FLAG_CONTROL : 0) |
			(metaKey ? FLAG_META : 0);
		const ringType =
			type === 'down'
				? EVENT_POINTER_DOWN
				: type === 'move'
					? EVENT_POINTER_MOVE
					: EVENT_POINTER_UP;
		this.ring.write(ringType, x, y, options.button ?? -1, id, options.buttons, flags);
	}

	/** Wheel scroll in pixels. A pinch on a trackpad comes as scroll with the Control key's flag. */
	wheel(deltaY: number, pinch = false): void {
		const ctrlKey = pinch || this.held.has('ControlLeft');
		this.three._onMouseWheel({
			deltaY,
			deltaMode: 0,
			ctrlKey,
			clientX: WIDTH / 2,
			clientY: HEIGHT / 2,
			preventDefault() {},
		});
		this.ring.write(EVENT_WHEEL, 0, deltaY, 0, 0, 0, ctrlKey ? FLAG_CONTROL : 0);
	}

	/** Presses or releases a key: ShiftLeft, ControlLeft or MetaLeft. */
	key(code: string, down: boolean): void {
		if (down) this.held.add(code);
		else this.held.delete(code);
		if (code === 'ControlLeft') {
			const event = { key: 'Control' };
			if (down) this.three._interceptControlDown(event);
			else this.three._interceptControlUp(event);
		}
		this.ring.write(down ? EVENT_KEY_DOWN : EVENT_KEY_UP, 0, 0, KEY_CODES.indexOf(code), 0, 0, 0);
	}

	/** One frame: null3D's controls read the frame's input, and both cameras update and draw. */
	step(dt = STEP): void {
		this.reader.beginFrame(++this.frame);
		this.controls.update(dt);
		this.three.update(dt);
		this.threeCamera.updateMatrixWorld();
	}

	/** What differs between the two cameras: position, target and rotation. */
	differences(tolerance = TOLERANCE): string[] {
		const found: string[] = [];
		const compare = (what: string, actual: ArrayLike<number>, expected: readonly number[]) => {
			for (const [k, value] of expected.entries()) {
				const got = actual[k] as number;
				if (!(Math.abs(got - value) <= tolerance * Math.max(1, Math.abs(value))))
					found.push(`${what}[${k}] is ${got}, and three.js has ${value}`);
			}
		};
		const { position, quaternion: q } = this.threeCamera;
		const { target } = this.three;
		compare('position', this.camera.stored, [position.x, position.y, position.z]);
		compare('target', this.controls.target, [target.x, target.y, target.z]);
		// A quaternion and its negative are one rotation.
		// An orthographic camera's view height: three.js divides its frustum by the zoom.
		const three = this.threeCamera;
		if (this.camera instanceof StandInOrthographic && three instanceof OrthographicCamera)
			compare('view height', [this.camera.height], [(three.top - three.bottom) / three.zoom]);
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

	/** Runs a frame and checks that both cameras agree after it. */
	stepAndCompare(dt = STEP, tolerance = TOLERANCE): void {
		this.step(dt);
		expect(this.differences(tolerance)).toEqual([]);
	}

	/**
	 * A mouse drag from (x, y): a press, `moves` moves of (dx, dy), and a release. `perFrame` moves
	 * land in each frame. Both cameras must agree after every frame.
	 */
	drag(
		x: number,
		y: number,
		dx: number,
		dy: number,
		moves: number,
		button: { button: number; buttons: number },
		perFrame = 1,
	): void {
		this.pointer('down', x, y, button);
		this.stepAndCompare();
		for (let move = 1; move <= moves; move++) {
			this.pointer('move', x + dx * move, y + dy * move, { buttons: button.buttons });
			if (move % perFrame === 0 || move === moves) this.stepAndCompare();
		}
		this.pointer('up', x + dx * moves, y + dy * moves, { button: button.button, buttons: 0 });
		this.stepAndCompare();
	}

	/** Runs frames with no input, and checks that both cameras agree after each. */
	idle(frames: number, tolerance = TOLERANCE): void {
		for (let frame = 0; frame < frames; frame++) this.stepAndCompare(STEP, tolerance);
	}
}

/** A finger's events: `down`, then `move`s, then `up`. The first finger down is the primary one. */
function finger(twin: Twin, id: number, primary: boolean) {
	const options = (buttons: number, button?: number) => ({
		id,
		touch: true,
		primary,
		buttons,
		button,
	});
	return {
		down: (x: number, y: number) => twin.pointer('down', x, y, options(1, 0)),
		move: (x: number, y: number) => twin.pointer('move', x, y, options(1)),
		up: (x: number, y: number) => twin.pointer('up', x, y, options(0, 0)),
	};
}

describe('orbit controls against three.js: the mouse', () => {
	it('start where three.js starts: turned toward the target, within the limits', () => {
		const twin = new Twin('orbit', [0, 0, 30], {
			target: [1, 2, 0],
			maxDistance: 20,
			maxPolarAngle: 1.2,
		});
		expect(twin.differences()).toEqual([]);
		expect(twin.controls.getDistance()).toBeCloseTo(20, 5);
		expect(twin.controls.getPolarAngle()).toBeCloseTo(twin.three.getPolarAngle(), 9);
		expect(twin.controls.getAzimuthalAngle()).toBeCloseTo(twin.three.getAzimuthalAngle(), 9);
	});

	it('rotate with a left drag, one move per frame and four moves per frame', () => {
		const twin = new Twin('orbit', [0, 2, 8]);
		twin.drag(320, 180, 9, 4, 12, LEFT);
		twin.drag(300, 200, -13, -6, 16, LEFT, 4);
		expect(twin.travel()).toMatchObject({ target: 0 });
		expect(twin.travel().camera).toBeGreaterThan(3);
		expect(twin.controls.getPolarAngle()).toBeCloseTo(twin.three.getPolarAngle(), 6);
		expect(twin.controls.getAzimuthalAngle()).toBeCloseTo(twin.three.getAzimuthalAngle(), 6);
	});

	it('pan in the plane of the screen with a right drag, and over the ground without it', () => {
		const twin = new Twin('orbit', [3, 4, 6], { target: [0, 1, 0] });
		twin.drag(200, 100, 7, -5, 10, RIGHT);
		twin.drag(200, 100, -4, 9, 12, RIGHT, 3);
		const ground = new Twin('orbit', [3, 4, 6], { target: [0, 1, 0], screenSpacePanning: false });
		ground.drag(200, 100, 7, -5, 10, RIGHT);
		ground.drag(200, 100, -4, 9, 12, RIGHT, 3);
		// Panning over the ground keeps the target's height.
		expect(ground.controls.target[1]).toBeCloseTo(1, 12);
		expect(twin.travel().target).toBeGreaterThan(1);
		expect(ground.travel().target).toBeGreaterThan(1);
	});

	it('dolly with a middle drag, the wheel and a pinch on a trackpad', () => {
		const twin = new Twin('orbit', [0, 3, 10]);
		twin.drag(320, 180, 0, 6, 10, MIDDLE);
		twin.drag(320, 180, 0, -8, 12, MIDDLE, 4);
		for (const scroll of [120, -53, 300, -16]) {
			twin.wheel(scroll);
			twin.stepAndCompare();
		}
		// A pinch comes as small scroll with the Control key's flag, and zooms ten times as far.
		const before = twin.controls.getDistance();
		twin.wheel(-3, true);
		twin.wheel(-2.5, true);
		twin.stepAndCompare();
		expect(twin.controls.getDistance() / before).toBeCloseTo(0.95 ** 0.55, 5);
		// With a Control key down, the flag comes from the key: plain wheel scroll.
		twin.key('ControlLeft', true);
		twin.wheel(40);
		twin.stepAndCompare();
		twin.key('ControlLeft', false);
		twin.stepAndCompare();
	});

	it('swap rotate and pan while Shift, Control or Meta is down', () => {
		const twin = new Twin('orbit', [2, 3, 7]);
		twin.key('ShiftLeft', true);
		twin.drag(320, 180, 6, 3, 8, LEFT);
		twin.drag(320, 180, 6, 3, 8, RIGHT);
		twin.key('ShiftLeft', false);
		twin.key('MetaLeft', true);
		twin.drag(320, 180, -5, 2, 8, LEFT);
		twin.key('MetaLeft', false);
		twin.stepAndCompare();
	});

	it('ignore the wheel during a drag', () => {
		const twin = new Twin('orbit', [0, 2, 8]);
		twin.pointer('down', 100, 100, LEFT);
		twin.stepAndCompare();
		twin.pointer('move', 120, 104, { buttons: 1 });
		twin.wheel(200);
		twin.stepAndCompare();
		twin.pointer('up', 120, 104, { button: 0, buttons: 0 });
		twin.stepAndCompare();
	});

	it('dolly with the wheel after a drag, when the release and the scroll fall between two frames', () => {
		const twin = new Twin('orbit', [0, 4, 9], { target: [0, 0.5, 0] });
		twin.pointer('down', 200, 60, RIGHT);
		twin.pointer('move', 170, 76, { buttons: 2 });
		twin.stepAndCompare();
		const distance = twin.controls.getDistance();
		twin.pointer('up', 170, 76, { button: 2, buttons: 0 });
		twin.pointer('move', 160, 90, { buttons: 0 });
		twin.wheel(-150);
		// The scroll waits for the frame after the release.
		twin.step();
		twin.stepAndCompare();
		expect(twin.controls.getDistance()).toBeLessThan(distance * 0.95);
	});

	it('end a drag and start the next with its own button, when both fall between two frames', () => {
		const twin = new Twin('orbit', [0, 4, 9], { target: [0, 0.5, 0] });
		twin.pointer('down', 100, 90, LEFT);
		twin.pointer('move', 150, 100, { buttons: 1 });
		twin.stepAndCompare();
		// The left button's release and a whole right drag, before the next frame.
		twin.pointer('up', 150, 100, { button: 0, buttons: 0 });
		twin.pointer('move', 200, 60, { buttons: 0 });
		twin.pointer('down', 200, 60, RIGHT);
		twin.pointer('move', 170, 76, { buttons: 2 });
		twin.pointer('up', 170, 76, { button: 2, buttons: 0 });
		// The right drag waits for the frame after the release.
		twin.step();
		twin.stepAndCompare();
		const panned = twin.travel().target;
		expect(panned).toBeGreaterThan(0.5);
		// A left drag, then a right drag whose button is still down at the next frame.
		twin.pointer('down', 100, 90, LEFT);
		twin.pointer('move', 130, 80, { buttons: 1 });
		twin.stepAndCompare();
		twin.pointer('up', 130, 80, { button: 0, buttons: 0 });
		twin.pointer('down', 130, 80, RIGHT);
		twin.pointer('move', 110, 95, { buttons: 2 });
		twin.step();
		twin.stepAndCompare();
		twin.pointer('move', 90, 110, { buttons: 2 });
		twin.pointer('up', 90, 110, { button: 2, buttons: 0 });
		twin.stepAndCompare();
		expect(twin.travel().target).not.toBeCloseTo(panned, 3);
	});

	it('keep the distance and the angles within their limits', () => {
		const twin = new Twin('orbit', [0, 2, 8], {
			minDistance: 5,
			maxDistance: 12,
			minPolarAngle: 0.6,
			maxPolarAngle: 1.7,
		});
		for (const scroll of [400, 400, 400, -900, -900]) {
			twin.wheel(scroll);
			twin.stepAndCompare();
		}
		twin.drag(320, 180, 0, 20, 12, LEFT);
		twin.drag(320, 180, 0, -25, 12, LEFT);
		expect(twin.controls.getDistance()).toBeCloseTo(5, 5);
		expect(twin.controls.getPolarAngle()).toBeCloseTo(1.7, 9);
	});

	it('keep the azimuth within its limits, also for a range across the back of the target', () => {
		const twin = new Twin('orbit', [0, 2, 8], { minAzimuthAngle: -0.5, maxAzimuthAngle: 0.7 });
		twin.drag(320, 180, 25, 0, 10, LEFT);
		twin.drag(320, 180, -25, 0, 14, LEFT);
		expect(twin.controls.getAzimuthalAngle()).toBeCloseTo(0.7, 9);
		// From 135 degrees on one side to 135 degrees on the other, through the back.
		const back = new Twin('orbit', [0, 2, -8], {
			minAzimuthAngle: (3 * Math.PI) / 4,
			maxAzimuthAngle: (-3 * Math.PI) / 4,
		});
		back.drag(320, 180, 30, 0, 10, LEFT);
		back.drag(320, 180, -30, 0, 16, LEFT);
	});

	it('do nothing that the enable flags turn off', () => {
		const twin = new Twin('orbit', [1, 2, 8], {
			enableRotate: false,
			enableZoom: false,
			enablePan: false,
		});
		twin.drag(320, 180, 9, 4, 6, LEFT);
		twin.drag(320, 180, 9, 4, 6, MIDDLE);
		twin.drag(320, 180, 9, 4, 6, RIGHT);
		twin.wheel(300);
		twin.stepAndCompare();
		expect(twin.controls.target).toEqual([0, 0, 0]);
		expect(twin.controls.getDistance()).toBeCloseTo(Math.sqrt(69), 5);
	});

	it('come to the same rest after a damped drag, and damp an idle turn frame by frame', () => {
		const twin = new Twin('orbit', [0, 2, 8], { enableDamping: true, dampingFactor: 0.1 });
		const drag = (dx: number, dy: number, button: typeof LEFT) => {
			twin.pointer('down', 320, 180, button);
			twin.step();
			for (let move = 1; move <= 10; move++)
				twin.pointer('move', 320 + dx * move, 180 + dy * move, { buttons: button.buttons });
			twin.step();
			twin.pointer('up', 320 + dx * 10, 180 + dy * 10, { button: button.button, buttons: 0 });
			twin.step();
		};
		// three.js also updates on each event, so the cameras move apart while the motion decays,
		// and meet again at rest. A pan that starts while a turn still decays would pan along a
		// camera that has turned another way in each, so each drag gets its own rest.
		drag(8, 3, LEFT);
		for (let frame = 0; frame < 400; frame++) twin.step();
		expect(twin.differences(1e-5)).toEqual([]);
		drag(-6, 4, RIGHT);
		for (let frame = 0; frame < 400; frame++) twin.step();
		expect(twin.differences(1e-5)).toEqual([]);
		// With no events, three.js updates once per frame too: the cameras agree in every frame.
		twin.controls.rotateLeft(0.8);
		twin.three._rotateLeft(0.8);
		twin.idle(60);
	});

	it("turn at three.js's auto-rotation speed while nothing drags", () => {
		const twin = new Twin('orbit', [0, 2, 8], { autoRotateSpeed: 5 });
		twin.controls.autoRotate = true;
		twin.three.autoRotate = true;
		twin.idle(90);
		// A drag stops the turn while it lasts.
		twin.drag(320, 180, 4, 0, 5, LEFT);
		twin.idle(10);
	});

	it('carry on from a camera that the sketch moved', () => {
		const twin = new Twin('orbit', [0, 2, 8]);
		twin.drag(320, 180, 9, 4, 5, LEFT);
		twin.camera.setPosition(-4, 6, 3);
		twin.threeCamera.position.set(-4, 6, 3);
		twin.stepAndCompare();
		twin.drag(320, 180, -7, 2, 5, LEFT);
	});

	it('turn, pan and dolly on request, as three.js does', () => {
		const twin = new Twin('orbit', [1, 3, 9]);
		twin.controls.rotateLeft(0.4);
		twin.three.rotateLeft(0.4);
		twin.stepAndCompare();
		twin.controls.rotateUp(-0.3);
		twin.three.rotateUp(-0.3);
		twin.stepAndCompare();
		twin.controls.pan(40, -25);
		twin.three.pan(40, -25);
		twin.stepAndCompare();
		twin.controls.dollyIn(0.8);
		twin.three.dollyIn(0.8);
		twin.stepAndCompare();
		twin.controls.dollyOut(0.5);
		twin.three.dollyOut(0.5);
		twin.stepAndCompare();
	});

	it('follow the mouse buttons they are given', () => {
		const twin = new Twin('orbit', [0, 2, 8], {
			mouseButtons: { LEFT: 'pan', MIDDLE: 'rotate', RIGHT: null },
		});
		twin.drag(320, 180, 5, 5, 8, LEFT);
		twin.drag(320, 180, 5, 5, 8, MIDDLE);
		twin.drag(320, 180, 5, 5, 8, RIGHT);
	});
});

describe('orbit controls against three.js: touch', () => {
	it('rotate with one finger, dolly and pan with two, and rotate again after one lifts', () => {
		const twin = new Twin('orbit', [0, 2, 8]);
		const a = finger(twin, 11, true);
		const b = finger(twin, 12, false);
		a.down(300, 200);
		twin.stepAndCompare();
		for (let k = 1; k <= 6; k++) {
			a.move(300 + 5 * k, 200 + 2 * k);
			twin.stepAndCompare();
		}
		b.down(400, 150);
		twin.stepAndCompare();
		// One finger moves per frame: each frame then holds one event, as each of three.js's does.
		for (let k = 1; k <= 6; k++) {
			b.move(400 + 9 * k, 150 - 4 * k);
			twin.stepAndCompare();
			a.move(330 - 3 * k, 212 + 5 * k);
			twin.stepAndCompare();
		}
		b.up(454, 126);
		twin.stepAndCompare();
		for (let k = 1; k <= 4; k++) {
			a.move(312 + 6 * k, 242);
			twin.stepAndCompare();
		}
		a.up(336, 242);
		twin.stepAndCompare();
		expect(twin.travel().target).toBeGreaterThan(0.1);
		expect(twin.controls.getDistance()).toBeLessThan(7);
	});

	it('take a whole quick drag or swipe, even one that starts and ends between two frames', () => {
		const twin = new Twin('orbit', [0, 2, 8]);
		twin.pointer('down', 100, 100, LEFT);
		twin.pointer('move', 130, 110, { buttons: 1 });
		twin.pointer('move', 150, 115, { buttons: 1 });
		twin.pointer('up', 150, 115, { button: 0, buttons: 0 });
		twin.stepAndCompare();
		// A finger that lands, moves and lifts in two frames.
		const a = finger(twin, 51, true);
		a.down(200, 150);
		a.move(220, 160);
		twin.stepAndCompare();
		a.move(260, 170);
		a.up(260, 170);
		twin.stepAndCompare();
		// And in one frame.
		const b = finger(twin, 52, true);
		b.down(100, 60);
		b.move(80, 90);
		b.up(80, 90);
		twin.stepAndCompare();
		expect(twin.travel().camera).toBeGreaterThan(2);
	});

	it('follow the finger that stays when either of two fingers lifts', () => {
		const twin = new Twin('orbit', [0, 2, 8]);
		const a = finger(twin, 61, true);
		const b = finger(twin, 62, false);
		a.down(150, 150);
		twin.stepAndCompare();
		b.down(250, 150);
		twin.stepAndCompare();
		b.move(270, 140);
		twin.stepAndCompare();
		// The second finger lifts: the first, which the pointer follows, turns the camera again.
		b.up(270, 140);
		twin.stepAndCompare();
		for (let k = 1; k <= 3; k++) {
			a.move(150 + 10 * k, 150 + 4 * k);
			twin.stepAndCompare();
		}
		const c = finger(twin, 63, false);
		c.down(300, 100);
		twin.stepAndCompare();
		// Now the first finger lifts, and the other one turns the camera.
		a.up(180, 162);
		twin.stepAndCompare();
		for (let k = 1; k <= 3; k++) {
			c.move(300 - 12 * k, 100 + 5 * k);
			twin.stepAndCompare();
		}
		c.up(264, 115);
		twin.stepAndCompare();
		expect(twin.travel().camera).toBeGreaterThan(1);
	});

	// When both fingers move in one frame, three.js takes one finger's move at a time. Between the
	// two, the fingers' spread and midpoint are part way, so three.js dollies there and back, and
	// pans each half of the move at another distance. null3D takes the frame's whole move at once.
	// The dolly comes out the same, and the pans differ by a few percent.
	it('pan with two fingers that move together in one frame, within a few percent of three.js', () => {
		const twin = new Twin('orbit', [0, 2, 8]);
		const a = finger(twin, 21, true);
		const b = finger(twin, 22, false);
		a.down(200, 200);
		b.down(300, 220);
		twin.stepAndCompare();
		for (let k = 1; k <= 8; k++) {
			a.move(200 + 6 * k, 200 - 3 * k);
			b.move(300 + 6 * k, 220 - 3 * k);
			twin.step();
		}
		expect(twin.controls.getDistance()).toBeCloseTo(twin.three.getDistance(), 5);
		expect(twin.differences(0.05)).toEqual([]);
	});

	it('dolly with two fingers that spread in one frame, as far as three.js does', () => {
		const twin = new Twin('orbit', [0, 2, 8]);
		const a = finger(twin, 31, true);
		const b = finger(twin, 32, false);
		a.down(250, 180);
		b.down(390, 180);
		twin.stepAndCompare();
		for (let k = 1; k <= 8; k++) {
			a.move(250 - 7 * k, 180);
			b.move(390 + 7 * k, 180);
			twin.step();
			expect(twin.controls.getDistance()).toBeCloseTo(twin.three.getDistance(), 5);
		}
		// The midpoint stays put, so null3D does not pan; three.js pans a little there and back.
		expect(twin.controls.target).toEqual([0, 0, 0]);
		expect(twin.differences(0.05)).toEqual([]);
	});
});

describe('map controls against three.js', () => {
	it('pan over the ground with a left drag, keeping the point under the pointer', () => {
		const twin = new Twin('map', [0, 10, 10]);
		twin.drag(320, 180, 11, 7, 12, LEFT);
		expect(twin.travel().target).toBeGreaterThan(2);
		twin.drag(100, 300, -9, -12, 16, LEFT, 4);
		// A whole drag between two frames.
		twin.pointer('down', 200, 200, LEFT);
		twin.pointer('move', 230, 185, { buttons: 1 });
		twin.pointer('up', 230, 185, { button: 0, buttons: 0 });
		twin.stepAndCompare();
		// The ground stays at the target's height.
		expect(twin.controls.target[1]).toBeCloseTo(0, 12);
	});

	it('rotate with a right drag, and dolly with the middle button and the wheel', () => {
		const twin = new Twin('map', [2, 12, 6], { target: [1, 0, -1] });
		twin.drag(320, 180, 8, 3, 10, RIGHT);
		twin.drag(320, 180, 0, 7, 8, MIDDLE);
		twin.wheel(-240);
		twin.stepAndCompare();
		twin.drag(320, 180, -6, 5, 12, LEFT, 3);
	});

	it('pan in the plane of the screen when screen-space panning is on', () => {
		const twin = new Twin('map', [0, 10, 10], { screenSpacePanning: true });
		twin.drag(320, 180, 11, 7, 12, LEFT);
		expect(twin.controls.target[1]).not.toBeCloseTo(0, 1);
	});

	it('pan with one finger, and dolly and rotate with two', () => {
		const twin = new Twin('map', [0, 10, 10]);
		const a = finger(twin, 41, true);
		const b = finger(twin, 42, false);
		a.down(320, 180);
		twin.stepAndCompare();
		for (let k = 1; k <= 6; k++) {
			a.move(320 + 8 * k, 180 + 3 * k);
			twin.stepAndCompare();
		}
		b.down(200, 250);
		twin.stepAndCompare();
		for (let k = 1; k <= 6; k++) {
			b.move(200 - 6 * k, 250 + 5 * k);
			twin.stepAndCompare();
		}
		a.up(368, 198);
		b.up(164, 280);
		twin.stepAndCompare();
		expect(twin.travel().target).toBeGreaterThan(1);
		expect(twin.controls.getAzimuthalAngle()).not.toBeCloseTo(0, 1);
	});

	it('come to the same rest after a damped drag over the ground', () => {
		const twin = new Twin('map', [0, 10, 10], { enableDamping: true });
		twin.pointer('down', 320, 180, LEFT);
		twin.step();
		for (let k = 1; k <= 8; k++) {
			twin.pointer('move', 320 + 10 * k, 180 + 4 * k, { buttons: 1 });
			twin.step();
		}
		twin.pointer('up', 400, 212, { button: 0, buttons: 0 });
		for (let frame = 0; frame < 600; frame++) twin.step();
		expect(twin.differences(1e-5)).toEqual([]);
	});
});

describe('orthographic cameras against three.js', () => {
	it('turn, pan and zoom an orthographic camera, within its zoom limits', () => {
		const twin = new Twin('orbit', [3, 5, 9], { minZoom: 0.5, maxZoom: 3 }, 'orthographic');
		twin.drag(320, 180, 9, 4, 8, LEFT);
		twin.drag(200, 100, 7, -5, 10, RIGHT, 3);
		for (const scroll of [-300, -400, -500, 600, 900, 900]) {
			twin.wheel(scroll);
			twin.stepAndCompare();
		}
		twin.drag(320, 180, 0, -9, 8, MIDDLE);
		const a = finger(twin, 71, true);
		const b = finger(twin, 72, false);
		a.down(200, 180);
		b.down(300, 180);
		twin.stepAndCompare();
		for (let k = 1; k <= 4; k++) {
			b.move(300 + 12 * k, 180 - 3 * k);
			twin.stepAndCompare();
		}
		a.up(200, 180);
		b.up(348, 168);
		twin.stepAndCompare();
		// Zooming keeps the camera's distance: the view's height changes instead.
		expect(twin.controls.getDistance()).toBeCloseTo(Math.sqrt(115), 4);
	});

	it('pan an orthographic map over the ground, keeping the point under the pointer', () => {
		const twin = new Twin('map', [0, 10, 10], {}, 'orthographic');
		twin.drag(320, 180, 11, 7, 12, LEFT);
		twin.drag(100, 300, -9, -12, 16, LEFT, 4);
		twin.wheel(-250);
		twin.stepAndCompare();
		twin.drag(320, 180, 8, 3, 10, RIGHT);
		expect(twin.travel().target).toBeGreaterThan(1);
	});
});

describe('orbit controls', () => {
	it('say whether the camera moved', () => {
		const twin = new Twin('orbit', [0, 2, 8]);
		twin.reader.beginFrame(1);
		expect(twin.controls.update(STEP)).toBe(false);
		twin.pointer('down', 100, 100, LEFT);
		twin.pointer('move', 110, 100, { buttons: 1 });
		twin.reader.beginFrame(2);
		expect(twin.controls.update(STEP)).toBe(true);
	});

	it('take nothing from a drag that started before they did', () => {
		const twin = new Twin('orbit', [0, 2, 8], { enabled: false });
		twin.pointer('down', 100, 100, LEFT);
		twin.stepAndCompare();
		twin.controls.enabled = true;
		twin.three.enabled = true;
		twin.pointer('move', 140, 120, { buttons: 1 });
		twin.step();
		// three.js follows the pointer it saw pressed while disabled no further; neither do these.
		expect(twin.controls.getAzimuthalAngle()).toBeCloseTo(0, 12);
	});

	it('stop auto-rotation while the user asks for less motion', () => {
		const input = new ScriptedInput(WIDTH, HEIGHT);
		const camera = new StandInCamera();
		camera.setPosition(0, 0, 5);
		const preferences = { reducedMotion: true };
		const context = { ...input.context, preferences } as unknown as SketchContext;
		const controls = createOrbitControls(context, camera as unknown as Perspective, {
			autoRotate: true,
		});
		input.beginFrame();
		expect(controls.update(0.5)).toBe(false);
		preferences.reducedMotion = false;
		input.beginFrame();
		expect(controls.update(0.5)).toBe(true);
		// Auto-rotation turns the camera to its left: the azimuth falls.
		expect(controls.getAzimuthalAngle()).toBeCloseTo(-(2 * Math.PI * 2 * 0.5) / 60, 9);
	});
});
