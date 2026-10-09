// The demos' interaction helper, fed input as the page writes it. With no input, as in hold mode,
// it must leave the scripted camera and the scripted path exactly as they are. A drag past the
// click limit or the wheel hands the camera over, with no jump. A hover or a tap steers, and the
// steering eases back to the scripted path after the idle time.
import { describe, expect, it } from 'bun:test';
import { type SketchContext, vec3 } from '@null3d/engine';
import { InputRing } from '../../packages/engine/src/page/input-ring';
import {
	controlViews,
	createControlBuffer,
	EVENT_POINTER_DOWN,
	EVENT_POINTER_MOVE,
	EVENT_POINTER_UP,
	EVENT_WHEEL,
	FLAG_PRIMARY,
	FLAG_TOUCH,
	Slot,
} from '../../packages/engine/src/shared/control';
import { KEY_CODES } from '../../packages/engine/src/shared/key-codes';
import { InputReader } from '../../packages/engine/src/sketch/input';
import { STAND_IN_FOV, StandInCamera } from '../../tests/pages/lib/stand-in-cameras';
import { type Interaction, type InteractOptions, interact } from './interact';

const WIDTH = 640;
const HEIGHT = 360;
const STEP = 1 / 60;
/** The scripted camera's place and the point it looks at. */
const EYE = [0, 5, 10] as const;
const LOOK = [0, 1, 0] as const;

/** A stand-in camera that also reads and writes its rotation, and casts rays through the canvas. */
class Camera extends StandInCamera {
	private readonly through = vec3.create();

	getRotation(out: { [index: number]: number }): void {
		for (let k = 0; k < 4; k++) out[k] = this.rotation[k] as number;
	}

	setRotation(x: number, y: number, z: number, w: number): void {
		this.rotation.set([x, y, z, w]);
	}

	screenToRay(x: number, y: number, ray: { origin: number[]; direction: number[] }): void {
		const tan = Math.tan((STAND_IN_FOV * Math.PI) / 360);
		const across = ((x / WIDTH) * 2 - 1) * tan * (WIDTH / HEIGHT);
		const up = (1 - (y / HEIGHT) * 2) * tan;
		vec3.normalize(this.through, vec3.set(this.through, across, up, -1));
		vec3.transformQuat(ray.direction, this.through, this.rotation);
		this.getPosition(ray.origin);
	}
}

/** A demo's camera and helper, with the page's input ring and a script that moves the camera. */
class Demo {
	readonly camera = new Camera();
	readonly view: Interaction;
	private readonly ring: InputRing;
	private readonly reader: InputReader;
	private frame = 0;
	/** How far the script has turned the camera around the point it looks at. */
	turn = 0;

	/** `tilt` turns the starting camera away from the target, as a camera on a turning rig is. */
	constructor(options: Partial<InteractOptions> = {}, tilt = 0) {
		const buffer = createControlBuffer(false);
		const views = controlViews(buffer);
		views.slotFloats[Slot.CanvasCssWidth] = WIDTH;
		views.slotFloats[Slot.CanvasCssHeight] = HEIGHT;
		this.ring = new InputRing(buffer);
		this.reader = new InputReader(views, KEY_CODES);
		const context = {
			input: this.reader,
			engine: { viewport: { width: WIDTH, height: HEIGHT, pixelRatio: 1 } },
			preferences: { reducedMotion: false },
		} as unknown as SketchContext;
		this.script();
		if (tilt !== 0) this.camera.setRotation(Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2));
		this.view = interact(context, this.camera as never, { target: [...LOOK], ...options });
	}

	/** The scripted camera: it circles the point it looks at. */
	script(): void {
		const radius = Math.hypot(EYE[2], EYE[0]);
		this.camera.setPosition(Math.sin(this.turn) * radius, EYE[1], Math.cos(this.turn) * radius);
		this.camera.lookAt(...LOOK);
	}

	/** One frame, as a demo runs it: the script moves the camera until the user takes it. */
	step(dt = STEP): void {
		this.reader.beginFrame(++this.frame);
		this.turn += 0.2 * dt;
		if (!this.view.userCamera) this.script();
		this.view.update(dt);
	}

	pointer(type: 'down' | 'move' | 'up', x: number, y: number, touch = false): void {
		const buttons = type === 'down' || (type === 'move' && this.held) ? 1 : 0;
		if (type !== 'move') this.held = type === 'down';
		const kind =
			type === 'down'
				? EVENT_POINTER_DOWN
				: type === 'move'
					? EVENT_POINTER_MOVE
					: EVENT_POINTER_UP;
		const flags = FLAG_PRIMARY | (touch ? FLAG_TOUCH : 0);
		this.ring.write(kind, x, y, type === 'move' ? -1 : 0, touch ? 2 : 1, buttons, flags);
	}

	wheel(deltaY: number): void {
		this.ring.write(EVENT_WHEEL, 0, deltaY, 0, 0, 0, 0);
	}

	private held = false;
}

const distance = (a: ArrayLike<number>, b: ArrayLike<number>) =>
	Math.hypot(
		(a[0] as number) - (b[0] as number),
		(a[1] as number) - (b[1] as number),
		(a[2] as number) - (b[2] as number),
	);

describe('interact', () => {
	it('leaves a camera that faces away from the target as the sketch placed it', () => {
		const demo = new Demo({}, -0.5);
		expect([...demo.camera.stored]).toEqual([...EYE]);
		expect([...demo.camera.rotation]).toEqual([
			Math.fround(Math.sin(-0.25)),
			0,
			0,
			Math.fround(Math.cos(-0.25)),
		]);
	});

	it('leaves the scripted camera and path exactly as they are while no input comes', () => {
		const demo = new Demo({ groundY: 0 });
		// The controls turn the camera toward the target as they start; the helper puts it back.
		const camera = new Camera();
		camera.setPosition(...EYE);
		camera.lookAt(...LOOK);
		expect([...demo.camera.stored]).toEqual([...camera.stored]);
		expect([...demo.camera.rotation]).toEqual([...camera.rotation]);
		const scripted = vec3.create();
		for (let frame = 0; frame < 300; frame++) {
			demo.step(frame === 0 ? 0 : STEP);
			const expected = new Camera();
			const radius = Math.hypot(EYE[2], EYE[0]);
			expected.setPosition(Math.sin(demo.turn) * radius, EYE[1], Math.cos(demo.turn) * radius);
			expected.lookAt(...LOOK);
			expect([...demo.camera.stored]).toEqual([...expected.stored]);
			expect([...demo.camera.rotation]).toEqual([...expected.rotation]);
			const value = Math.sin(frame + 0.5) * 3.7;
			vec3.set(scripted, value, -value, value / 3);
			expect(demo.view.steer(scripted)).toEqual([value, -value, value / 3]);
		}
		expect(demo.view.userCamera).toBe(false);
		expect(demo.view.steering).toBe(0);
	});

	it('hands the camera over at a drag past the click limit, from where the script left it', () => {
		const demo = new Demo();
		for (let frame = 0; frame < 30; frame++) demo.step();
		demo.pointer('down', 300, 200);
		demo.pointer('move', 302, 200);
		demo.step();
		// Two pixels are still a click.
		expect(demo.view.userCamera).toBe(false);
		const before = Float32Array.from(demo.camera.stored);
		demo.pointer('move', 303, 200);
		demo.step();
		expect(demo.view.userCamera).toBe(true);
		// The controls orbit the scripted target at the scripted distance, by this frame's drag alone.
		expect([...demo.view.controls.target]).toEqual([...LOOK]);
		expect(distance(demo.camera.stored, LOOK)).toBeCloseTo(distance(before, LOOK), 4);
		// At most the script's step and one pixel's turn.
		const turned = 0.2 * STEP + (2 * Math.PI) / HEIGHT;
		expect(distance(demo.camera.stored, before)).toBeLessThan(distance(before, LOOK) * turned);
		// From then on the script no longer moves the camera, which it would move 2 m in a second.
		demo.pointer('up', 303, 200);
		for (let frame = 0; frame < 120; frame++) demo.step();
		const settled = Float32Array.from(demo.camera.stored);
		for (let frame = 0; frame < 60; frame++) demo.step();
		expect(distance(demo.camera.stored, settled)).toBeLessThan(0.01);
	});

	it('hands the camera over at the wheel, and zooms in the same frame', () => {
		const demo = new Demo();
		demo.step();
		const before = distance(demo.camera.stored, LOOK);
		demo.wheel(-200);
		demo.step();
		expect(demo.view.userCamera).toBe(true);
		for (let frame = 0; frame < 120; frame++) demo.step();
		expect(distance(demo.camera.stored, LOOK)).toBeLessThan(before * 0.95);
	});

	it('steers by hover, and eases back to the scripted path after the idle time', () => {
		const demo = new Demo({ groundY: 0, bounds: [-4, 0, -4, 4, 0, 4] });
		demo.step();
		// The middle of the canvas looks at the scripted target, and meets the ground beyond it.
		demo.pointer('move', WIDTH / 2, HEIGHT / 2);
		demo.pointer('move', WIDTH / 2 + 1, HEIGHT / 2);
		demo.step();
		for (let frame = 0; frame < 90; frame++) demo.step();
		expect(demo.view.userCamera).toBe(false);
		expect(demo.view.steering).toBeGreaterThan(0.9);
		const { point } = demo.view;
		expect(point[1]).toBeCloseTo(0, 6);
		expect(Math.abs(point[0])).toBeLessThan(0.1);
		expect(point[2]).toBeCloseTo(-2.5, 1);
		for (let frame = 0; frame < 6 * 60; frame++) demo.step();
		expect(demo.view.steering).toBe(0);
		const scripted = vec3.set(vec3.create(), 1.25, 2.5, -3.75);
		expect(demo.view.steer(scripted)).toEqual([1.25, 2.5, -3.75]);
	});

	it('steers by a tap of a finger, and hands the camera over at a drag of a finger', () => {
		const demo = new Demo({ groundY: 0 });
		demo.step();
		demo.pointer('down', 320, 300, true);
		demo.pointer('move', 325, 300, true);
		demo.pointer('up', 325, 300, true);
		demo.step();
		for (let frame = 0; frame < 30; frame++) demo.step();
		expect(demo.view.userCamera).toBe(false);
		expect(demo.view.steering).toBeGreaterThan(0.5);
		demo.pointer('down', 320, 300, true);
		demo.pointer('move', 340, 300, true);
		demo.step();
		expect(demo.view.userCamera).toBe(true);
	});

	it('moves the user camera and its target together, only once the user has the camera', () => {
		const demo = new Demo();
		demo.step();
		const before = Float32Array.from(demo.camera.stored);
		demo.view.shift(5, 0, 0);
		expect([...demo.camera.stored]).toEqual([...before]);
		demo.wheel(10);
		demo.step();
		const at = Float32Array.from(demo.camera.stored);
		const target = [...demo.view.controls.target];
		demo.view.shift(5, 0, -2);
		expect(demo.camera.stored[0]).toBeCloseTo((at[0] as number) + 5, 5);
		expect(demo.camera.stored[2]).toBeCloseTo((at[2] as number) - 2, 5);
		expect(demo.view.controls.target).toEqual([
			(target[0] as number) + 5,
			target[1] as number,
			(target[2] as number) - 2,
		]);
		demo.step();
		expect(distance(demo.camera.stored, demo.view.controls.target)).toBeCloseTo(
			distance(at, target),
			4,
		);
	});
});
