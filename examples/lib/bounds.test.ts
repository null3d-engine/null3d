// The Manual camera's bounds keep it inside a showcase scene: never past the mountains, never under
// the ground ([D-170](../../.dev/decisions/D-170-showcase-camera.md), owner, 20 October 2026). The
// ground stops the camera along its orbit, so pushing against it never draws the camera in, and a
// pan stops at the edge of the area the camera turns around.
import { describe, expect, it } from 'bun:test';
import { StandInCamera } from '../../tests/pages/lib/stand-in-cameras';
import { BOUNDS, SHOTS } from '../showcase/night-town/sketch';
import {
	type CameraBounds,
	type Cinematic,
	createCinematic,
	GROUND_CLEARANCE,
	keepInside,
} from './cinematic';

/** Flat ground at y = 0, inside the night town's bounds. */
const FLAT: CameraBounds = { ...BOUNDS, ground: () => 0 };

/** A context whose pointer a test drives, with a still scene and a clock the test moves. */
function stub() {
	const time = { now: 0 };
	const pointer = {
		x: 0,
		y: 0,
		ndcX: 0,
		ndcY: 0,
		buttons: 0,
		dragDx: 0,
		dragDy: 0,
		wheel: 0,
		pinch: 0,
		locked: false,
		isTouch: false,
	};
	const context = {
		input: { wasPressed: () => false, isDown: () => false, pointer, touches: [] as unknown[] },
		time,
		page: { post: () => {}, onMessage: () => () => {} },
		engine: { viewport: { width: 640, height: 360, pixelRatio: 1 } },
		scene: { raycast: () => false },
	};
	return { time, pointer, context: context as never };
}

/** A bounded camera, handed to the user at the night town's opening pose. */
function manual() {
	const { time, pointer, context } = stub();
	const camera = new StandInCamera();
	const target: [number, number, number] = [0, 1.4, 0];
	const film: Cinematic = createCinematic(context, camera as never, {
		shots: SHOTS,
		target,
		bounds: FLAT,
	});
	film.update(1 / 60);
	film.select('Manual');
	film.update(1 / 60);
	const frame = () => {
		time.now += 1 / 60;
		film.update(1 / 60);
	};
	const distance = () =>
		Math.hypot(...[0, 1, 2].map((k) => (camera.stored[k] as number) - (target[k] as number)));
	return { camera, pointer, target, frame, distance };
}

describe('keepInside', () => {
	it('moves nothing that lies inside the bounds', () => {
		const target = [0, 2, 0];
		const position = [0, 10, 30];
		expect(keepInside(FLAT, target, position)).toBe(false);
		expect(target).toEqual([0, 2, 0]);
		expect(position).toEqual([0, 10, 30]);
	});

	it('brings the point the camera turns around back to its disc, and the camera with it', () => {
		const [cx, cz] = FLAT.center;
		const target = [cx + 40, 2, cz];
		const position = [cx + 40, 10, cz + 30];
		expect(keepInside(FLAT, target, position)).toBe(true);
		expect(Math.hypot((target[0] as number) - cx, (target[2] as number) - cz)).toBeCloseTo(
			FLAT.focus,
			6,
		);
		// The camera moved as far as its target did, so it looks the same way.
		expect((position[0] as number) - (target[0] as number)).toBeCloseTo(0, 6);
		expect((position[2] as number) - (target[2] as number)).toBeCloseTo(30, 6);
	});

	it('lifts a camera under the ground along its orbit, keeping its distance', () => {
		const target = [0, 2, 0];
		const position = [0, -5, 20];
		const before = Math.hypot(0, -7, 20);
		expect(keepInside(FLAT, target, position)).toBe(true);
		expect(position[1]).toBeCloseTo(GROUND_CLEARANCE, 6);
		expect(Math.hypot((position[1] as number) - 2, position[2] as number)).toBeCloseTo(before, 6);
	});

	it('lets a camera with a small clearance dip under the water, but never through the bed', () => {
		// A stream's bed half a meter under the water's surface at y = 0.
		const stream: CameraBounds = {
			...FLAT,
			focusHeight: [0, 6],
			ground: () => -0.5,
			clearance: 0.15,
		};
		const target = [0, 0, 0];
		const under = [0, -0.3, 20];
		expect(keepInside(stream, target, under)).toBe(false);
		const through = [0, -2, 20];
		expect(keepInside(stream, target, through)).toBe(true);
		expect(through[1]).toBeCloseTo(-0.35, 6);
	});

	it('lifts the camera above a slope that rises under its new place too', () => {
		const slope: CameraBounds = { ...FLAT, center: [0, 0], ground: (_x, z) => 0.2 * z };
		const target = [0, 6, 0];
		const position = [0, -2, 25];
		keepInside(slope, target, position);
		expect(position[1] as number).toBeGreaterThanOrEqual(
			0.2 * (position[2] as number) + GROUND_CLEARANCE - 0.05,
		);
		expect(Math.hypot((position[1] as number) - 6, position[2] as number)).toBeCloseTo(
			Math.hypot(-8, 25),
			6,
		);
	});
});

describe('the bounded Manual camera', () => {
	it('dollies out no farther than its bounds allow', () => {
		const { pointer, frame, distance } = manual();
		for (let k = 0; k < 240; k++) {
			pointer.wheel = 120;
			frame();
		}
		pointer.wheel = 0;
		for (let k = 0; k < 120; k++) frame();
		expect(distance()).toBeLessThanOrEqual(FLAT.distance + 1e-3);
		expect(distance()).toBeGreaterThan(FLAT.distance - 1);
	});

	it('stops on the ground, and pushing against it never draws the camera in', () => {
		const { camera, pointer, frame, distance } = manual();
		const start = distance();
		pointer.buttons = 1;
		frame();
		for (let k = 0; k < 400; k++) {
			pointer.dragDy = -40;
			frame();
			expect(camera.stored[1] as number).toBeGreaterThanOrEqual(GROUND_CLEARANCE - 1e-3);
		}
		pointer.dragDy = 0;
		pointer.buttons = 0;
		for (let k = 0; k < 120; k++) frame();
		// The drag pushed the camera right down onto the ground, and it rests there.
		expect(camera.stored[1] as number).toBeGreaterThanOrEqual(GROUND_CLEARANCE - 1e-3);
		expect(camera.stored[1] as number).toBeLessThan(GROUND_CLEARANCE + 0.5);
		expect(Math.abs(distance() - start)).toBeLessThan(0.05);
	});

	it('pans no farther than the edge of the area it turns around', () => {
		const { pointer, target, frame } = manual();
		pointer.buttons = 2;
		frame();
		for (let k = 0; k < 400; k++) {
			pointer.dragDx = 60;
			frame();
		}
		pointer.dragDx = 0;
		pointer.buttons = 0;
		for (let k = 0; k < 120; k++) frame();
		const [cx, cz] = FLAT.center;
		// The pan carried the point right to the edge, and no farther.
		expect(Math.hypot(target[0] - cx, target[2] - cz)).toBeLessThanOrEqual(FLAT.focus + 1e-3);
		expect(Math.hypot(target[0] - cx, target[2] - cz)).toBeGreaterThan(FLAT.focus - 0.5);
	});
});
