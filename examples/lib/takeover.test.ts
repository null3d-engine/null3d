// Taking the camera must never jump: when the user takes over at any moment of the route, the camera
// stays where the Auto frame had it, and the first frames move it only the little that the easing
// asks ([D-170](../../.dev/decisions/D-170-showcase-camera.md), owner, 14 October 2026).
import { expect, test } from 'bun:test';
import { quat, vec3 } from '@null3d/engine';
import { StandInCamera } from '../../tests/pages/lib/stand-in-cameras';
import { SHOTS } from '../showcase/night-town/sketch';
import { type Cinematic, createCinematic } from './cinematic';

/** A context with no input, a still scene and a clock the test moves. */
function stub() {
	const time = { now: 0 };
	const input = {
		wasPressed: () => false,
		isDown: () => false,
		pointer: {
			x: 0,
			y: 0,
			buttons: 0,
			dragDx: 0,
			dragDy: 0,
			wheel: 0,
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

/** The cinematic's camera and a frame step, with the clock advanced. */
function run(
	seconds: number,
	cinematic: Cinematic,
	camera: StandInCamera,
	time: { now: number },
	frames = 60,
): void {
	const step = seconds / frames;
	for (let k = 0; k < frames; k++) {
		time.now += step;
		cinematic.update(step);
	}
}

test('taking over never jumps the camera', () => {
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
		run(at, cinematic, camera, time);
		const before = [...camera.stored];
		cinematic.select('Manual');
		cinematic.update(1 / 60);
		const after = [...camera.stored];
		const moved = Math.hypot(
			(after[0] as number) - (before[0] as number),
			(after[1] as number) - (before[1] as number),
			(after[2] as number) - (before[2] as number),
		);
		expect(
			moved,
			`the camera moved ${moved.toFixed(3)} m when taking over at ${at} s`,
		).toBeLessThan(0.1);
		// And the pose it lands on is the route's own, not a shot of its own accord.
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
