// The camera's route, as the owner asked for it: it opens and settles on the same view, looking at
// the configurator with the car in frame beside it, and between those two it turns around the car in
// the studio, follows it out to the street and comes back in front of it. These checks hold the
// route to that shape, so a later edit to the shots cannot quietly lose the opening view.
import { expect, test } from 'bun:test';
import { routePosition, routeTimeline } from '../lib/cinematic';
import { CAR_PERIOD, carPose, TOWARD_STREET } from './route';
import { SHOTS } from './shots';

/** The tablet's panel, and the car's middle, in the world. */
const TABLET = [3.6, 1.18, 10.2] as const;
const CAR = [0, 0.9, 9] as const;

const route = routeTimeline(SHOTS);

/** The pose the route plays at a time of the loop: the camera's place, then the point it looks at. */
function pose(time: number): number[] {
	const out = new Float32Array(6);
	routePosition(route, time, out);
	return [...out];
}

/** The angle, in radians, between a pose's view direction and the way to a point. */
function offAxis(view: number[], to: readonly number[]): number {
	const direction = [view[3]! - view[0]!, view[4]! - view[1]!, view[5]! - view[2]!];
	const there = [to[0]! - view[0]!, to[1]! - view[1]!, to[2]! - view[2]!];
	const dot = direction[0]! * there[0]! + direction[1]! * there[1]! + direction[2]! * there[2]!;
	const lengths = Math.hypot(...direction) * Math.hypot(...there);
	return Math.acos(Math.min(1, Math.max(-1, dot / lengths)));
}

test("the route takes the car's loop, so the two meet at the seam", () => {
	expect(route.total).toBe(CAR_PERIOD);
});

test('the first shot holds, and the loop settles back onto its pose', () => {
	expect(SHOTS[0]?.move).toBe('hold');
	const opening = pose(0);
	const settled = pose(CAR_PERIOD);
	for (const [index, value] of opening.entries()) expect(settled[index]).toBeCloseTo(value, 4);
});

test('the opening looks at the configurator with the car in frame beside it', () => {
	const opening = pose(0);
	// The view faces the tablet: the panel sits within a tenth of the frame's width of its centre.
	expect(offAxis(opening, TABLET)).toBeLessThan(0.2);
	// The car stands off to one side, inside the frame of the widest lens the route uses.
	expect(offAxis(opening, CAR)).toBeLessThan(0.5);
	// Both are in front of the camera, and the camera is in the studio.
	expect(opening[2]!).toBeGreaterThan(0);
	expect(opening[2]!).toBeLessThan(10);
});

test('the car leaves the studio before the camera follows it out', () => {
	// The times are the current shot lengths, not a property of the demo: a shot that lasts longer
	// moves every one of them, and the checks below move with it.
	for (const time of [2, 5, 8]) {
		expect(carPose(time).heading).toBeGreaterThanOrEqual(TOWARD_STREET - 0.5);
		expect(pose(time)[2]!).toBeGreaterThan(0);
	}
	// By the time the car has turned at the far end, the camera is down in the street.
	expect(pose(20)[2]!).toBeLessThan(-10);
	// And it comes back in for the settle, which ends on the opening view.
	expect(pose(30)[2]!).toBeGreaterThan(0);
});

test('the camera backs away in front of the car as it returns', () => {
	// The camera waits ahead of the car, on the studio side, and retreats before it all the way in,
	// so the car stays in frame as it passes toward the showroom. The times are the current shot
	// lengths, as the test above says.
	for (const time of [23, 25, 27]) {
		const camera = pose(time)[2]!;
		expect(camera).toBeGreaterThan(carPose(time).z + 4);
		expect(camera - carPose(time).z).toBeLessThan(14);
	}
	// It goes that way: each pose is nearer the studio than the one before it.
	expect(pose(25)[2]!).toBeGreaterThan(pose(23)[2]!);
	expect(pose(27)[2]!).toBeGreaterThan(pose(25)[2]!);
});
