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
	it('turns a wheel by the distance over its radius, the other way on the left side', () => {
		// A wheel of 0.3 m radius covers its own circumference in one full turn.
		const radius = 0.3;
		expect(wheelTurn(2 * Math.PI * radius, radius, 1)).toBeCloseTo(2 * Math.PI, 9);
		expect(wheelTurn(2 * Math.PI * radius, radius, -1)).toBeCloseTo(-2 * Math.PI, 9);
		expect(wheelTurn(0.3, radius, 1)).toBeCloseTo(1, 9);
		expect(wheelTurn(0.3, radius, -1)).toBeCloseTo(-1, 9);
	});

	it('rolls forward on both sides when the car drives forward', () => {
		// The right wheel's axle is +y and the left's -y, so the same forward distance turns them
		// opposite ways about their own axles, which is one way in the world.
		expect(Math.sign(wheelTurn(1, 0.3, 1))).toBe(1);
		expect(Math.sign(wheelTurn(1, 0.3, -1))).toBe(-1);
	});
});
