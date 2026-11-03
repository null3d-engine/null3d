// The car's loop: it waits in the studio, drives out to the street's far end, turns, and drives
// back, and the loop meets itself. The tests check the poses at the points that matter and that the
// path moves smoothly enough for a car at every step.
import { describe, expect, it } from 'bun:test';
import { CAR_PERIOD, carPose, STREET_Z, STUDIO_Z, TOWARD_STREET, wheelTurn } from './route';

describe("the showroom car's loop", () => {
	it('starts in the studio, square to the street, at the pose that a held frame draws', () => {
		const pose = carPose(0);
		expect(pose.z).toBe(STUDIO_Z);
		expect(pose.heading).toBeCloseTo(TOWARD_STREET, 6);
	});

	it('reaches the street’s far end and comes back inside the loop', () => {
		const atStreet = Math.min(...[15, 16, 17].map((t) => carPose(t).z));
		expect(atStreet).toBeLessThan(-25);
		expect(carPose(15).z).toBeGreaterThan(STREET_Z);
		expect(carPose(17).z).toBeCloseTo(STREET_Z, 6);
		expect(carPose(29).z).toBeCloseTo(STUDIO_Z, 6);
	});

	it('turns the nose round at the end of the street and back again in the studio', () => {
		expect(carPose(17).heading).toBeGreaterThan(1);
		expect(carPose(21).heading).toBeLessThan(-1);
		expect(carPose(30).heading).toBeLessThan(-1);
		expect(Math.cos(carPose(CAR_PERIOD - 1e-6).heading - carPose(0).heading)).toBeCloseTo(1, 3);
	});

	it('moves smoothly at every step of the loop', () => {
		const step = 0.02;
		let previous = carPose(0);
		for (let t = step; t <= CAR_PERIOD; t += step) {
			const pose = carPose(t);
			expect(Math.abs(pose.z - previous.z)).toBeLessThan(0.3);
			expect(Math.abs(pose.heading - previous.heading)).toBeLessThan(0.05);
			previous = pose;
		}
	});
});

describe("the showroom car's wheels", () => {
	it('turns a wheel by the distance over its radius', () => {
		const radius = 0.3;
		expect(Math.abs(wheelTurn(2 * Math.PI * radius, radius, 1))).toBeCloseTo(2 * Math.PI, 9);
		expect(Math.abs(wheelTurn(2 * Math.PI * radius, radius, -1))).toBeCloseTo(2 * Math.PI, 9);
		expect(Math.abs(wheelTurn(0.3, radius, 1))).toBeCloseTo(1, 9);
		expect(Math.abs(wheelTurn(0.3, radius, -1))).toBeCloseTo(1, 9);
	});

	it('rolls the contact point backward relative to the hub when the car moves forward', () => {
		// The hub's quarter turn leaves the x coordinate of a spun tyre point alone, so the point's
		// place along the car is its local z, turned about the axle: x = outward * radius * sin(turn).
		// A forward roll moves the contact point backward (negative x) on both sides. An inverted
		// sign moves it forward and fails here.
		const radius = 0.3;
		for (const outward of [1, -1] as const) {
			const turn = wheelTurn(0.01, radius, outward);
			const x = outward * radius * Math.sin(turn);
			expect(x).toBeLessThan(0);
			expect(x).toBeCloseTo(-0.01, 4);
		}
	});
});
