// The Auto route's clearance guard: the guard judges a stretch of the route with one query, and
// skips the cast while that stretch holds. It must stop the camera at a surface ahead, and a
// stretch that is clear must leave the camera exactly where the route puts it, with far fewer
// frames that query the scene than there are frames ([D-30](../../.dev/decisions/D-30-showcase-clearance.md)).
import { expect, test } from 'bun:test';
import { vec3 } from '@null3d/engine';
import { StandInCamera } from '../../tests/pages/lib/stand-in-cameras';
import { createCinematic, routePosition, routeTimeline, type Shot } from './cinematic';

/** How far the camera keeps from a surface, as the guard's margin, in meters. */
const MARGIN = 0.5;

/** A route that flies along +x, a quarter of a meter a frame. */
const SHOTS: readonly Shot[] = [
	{ position: [0, 5, 0], target: [400, 5, 0], seconds: 20 },
	{ position: [200, 5, 0], target: [400, 5, 0], seconds: 20 },
	{ position: [400, 5, 0], target: [400, 5, 0], seconds: 20 },
];

/** A scene whose only solid is a wall at x = `wallX`, facing -x, and which counts its queries. */
function stubScene(wallX: number) {
	const counted = { calls: 0 };
	const scene = {
		raycast(
			origin: number[],
			direction: number[],
			options: { maxDistance?: number } | undefined,
			hit: { distance: number },
		): boolean {
			counted.calls++;
			if ((direction[0] as number) <= 0) return false;
			const distance = (wallX - (origin[0] as number)) / (direction[0] as number);
			if (distance < 0 || distance > (options?.maxDistance ?? Number.POSITIVE_INFINITY))
				return false;
			hit.distance = distance;
			return true;
		},
	};
	return { scene, counted };
}

/** Runs the route for some frames, and gives the camera's position and the frames that queried. */
function flight(wallX: number, frames: number): { poses: number[][]; queried: number } {
	const { scene, counted } = stubScene(wallX);
	const time = { now: 0 };
	const context = {
		input: {
			wasPressed: () => false,
			isDown: () => false,
			pointer: { wheel: 0, pinch: 0, buttons: 0, x: 0, y: 0, locked: false, isTouch: false },
			touches: [] as unknown[],
		},
		time,
		page: { post: () => {}, onMessage: () => () => {} },
		engine: { viewport: { width: 640, height: 360, pixelRatio: 1 } },
		scene,
	};
	const camera = new StandInCamera();
	const cinematic = createCinematic(context as never, camera as never, {
		shots: SHOTS,
		target: [0, 5, 0],
	});
	const step = 1 / 60;
	const eye = vec3.create();
	const poses: number[][] = [];
	let queried = 0;
	for (let k = 0; k < frames; k++) {
		time.now += step;
		const before = counted.calls;
		cinematic.update(step);
		if (counted.calls > before) queried++;
		camera.getPosition(eye);
		poses.push([eye[0] as number, eye[1] as number, eye[2] as number]);
	}
	return { poses, queried };
}

test('the guard stops the camera at a wall ahead, though it judges stretches', () => {
	const { poses } = flight(50, 400);
	for (const [x] of poses) expect(x as number).toBeLessThan(50 - MARGIN + 1e-3);
	// It reaches the wall's margin: the stretch that ended there was judged.
	expect(Math.max(...poses.map((pose) => pose[0] as number))).toBeGreaterThan(48);
});

test('a clear route keeps the camera on the route with far fewer queries than frames', () => {
	const frames = 240;
	const { poses, queried } = flight(4000, frames);
	const route = routeTimeline(SHOTS);
	const expected = new Float32Array(6);
	for (let k = 0; k < frames; k++) {
		routePosition(route, (k + 1) / 60, expected);
		expect(Math.abs((poses[k]?.[0] as number) - (expected[0] as number))).toBeLessThan(1e-3);
		expect(Math.abs((poses[k]?.[1] as number) - (expected[1] as number))).toBeLessThan(1e-3);
	}
	// One query judges a stretch of the route, so few frames pay for a query of the scene.
	expect(queried).toBeLessThan(frames / 5);
});

test('a wall behind the camera never stops a move away from it', () => {
	const { poses } = flight(-50, 60);
	for (const [x] of poses) expect(x as number).toBeGreaterThan(0);
});
