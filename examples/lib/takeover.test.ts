// Taking the camera halts the route at once: when the user takes over at any moment of the route,
// the camera holds the route's pose that moment, from the first frame and with no drift afterwards,
// and never jumps to a shot of its own ([D-170](../../.dev/decisions/D-170-showcase-camera.md),
// owner, 14 October 2026).
import { expect, test } from 'bun:test';
import { quat, vec3 } from '@null3d/engine';
import { StandInCamera } from '../../tests/pages/lib/stand-in-cameras';
import { SHOTS } from '../showcase/night-town/sketch';
import { type Cinematic, createCinematic } from './cinematic';

/** How far the camera may move at the switch, and over the frames after it, in meters. */
const EPSILON = 1e-3;

/** A context with no input, a still scene and a clock the test moves. */
function stub() {
	const time = { now: 0 };
	const input = {
		wasPressed: () => false,
		isDown: () => false,
		pointer: {
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
		},
		touches: [] as unknown[],
	};
	return {
		time,
		context: {
			input,
			time,
			page: { post: () => {}, onMessage: () => () => {} },
			engine: { viewport: { width: 640, height: 360, pixelRatio: 1 } },
			scene: { raycast: () => false },
		},
	} as never as { time: { now: number }; context: never };
}

/** Runs the cinematic for a stretch of time, in fixed frame steps, with the clock advanced. */
function run(seconds: number, cinematic: Cinematic, time: { now: number }, frames = 60): void {
	const step = seconds / frames;
	for (let k = 0; k < frames; k++) {
		time.now += step;
		cinematic.update(step);
	}
}

/** How far the camera moved between two poses. */
const moved = (a: number[], b: number[]) =>
	Math.hypot(
		(a[0] as number) - (b[0] as number),
		(a[1] as number) - (b[1] as number),
		(a[2] as number) - (b[2] as number),
	);

test('taking over halts the route at once, with no drift', () => {
	for (const at of [0, 1, 3, 6, 12]) {
		const { context, time } = stub();
		const camera = new StandInCamera();
		const target: [number, number, number] = [0, 1.4, 0];
		const cinematic = createCinematic(context, camera as never, {
			shots: SHOTS,
			target,
			speed: 420,
		});
		// Run the route to the moment of the takeover, and remember where it put the camera.
		time.now = 0;
		run(at, cinematic, time);
		const before = [...camera.stored];
		cinematic.select('Manual');
		// The first frame after the switch holds the route's pose: no ease, no drift.
		cinematic.update(1 / 60);
		const first = [...camera.stored];
		expect(
			moved(first, before),
			`the camera moved ${moved(first, before).toFixed(4)} m at the switch at ${at} s`,
		).toBeLessThan(EPSILON);
		// And it stays there with no input: the route's motion has stopped for good.
		run(1, cinematic, time);
		const later = [...camera.stored];
		expect(
			moved(later, first),
			`the camera drifted ${moved(later, first).toFixed(4)} m after taking over at ${at} s`,
		).toBeLessThan(EPSILON);
		// The pose it holds is the route's own, not a shot of its own accord.
		const pose = vec3.create();
		camera.getPosition(pose);
		expect(Math.hypot(pose[0] as number, pose[1] as number, pose[2] as number)).toBeGreaterThan(5);
		// The rotation is a unit quaternion, so a look-at happened.
		const q = quat.create();
		camera.getRotation(q);
		expect(Math.hypot(q[0] as number, q[1] as number, q[2] as number, q[3] as number)).toBeCloseTo(
			1,
			3,
		);
	}
});
