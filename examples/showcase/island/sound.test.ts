// The island's traffic sounds: the placeholders' traffic and the models' traffic hold the same
// vehicles, so the second call keeps the sounds the first made; a traffic of other counts gets
// sounds of its own size and the old ones go.
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const made = { groups: 0, loops: 0, destroyed: 0 };

const fakePlace = () => ({
	setPosition() {},
	setLevel() {},
	setRate() {},
	setTone() {},
	destroy() {
		made.destroyed++;
	},
});

mock.module('@null3d/sound', () => ({
	createSound: () => ({
		group() {
			made.groups++;
			return { positions: new Float32Array(128), ...fakePlace() };
		},
		loop() {
			made.loops++;
			return fakePlace();
		},
		shot() {},
		update() {},
		destroy() {},
	}),
}));

const { createIslandSound } = await import('./sound');

/** A traffic of the given counts, with its vehicles parked far from the sea's points. */
function trafficOf(cars: number, buses: number) {
	const vehicles = new Float32Array((cars + buses) * 3);
	const speeds = new Float32Array(cars + buses);
	return { vehicles, speeds, counts: { cars, buses } };
}

describe("the island's traffic sounds", () => {
	beforeEach(() => {
		made.groups = 0;
		made.loops = 0;
		made.destroyed = 0;
	});

	it('keeps the sounds when the models replace the placeholders with the same vehicles', () => {
		const sound = createIslandSound({} as never, { getWorldPosition: () => {} } as never);
		sound.setTraffic(trafficOf(9, 1));
		const groups = made.groups;
		const loops = made.loops;
		sound.setTraffic(trafficOf(9, 1));
		expect(made.groups).toBe(groups);
		expect(made.loops).toBe(loops);
		expect(made.destroyed).toBe(0);
	});

	it('makes sounds of the new size and destroys the old ones when the counts differ', () => {
		const sound = createIslandSound({} as never, { getWorldPosition: () => {} } as never);
		sound.setTraffic(trafficOf(9, 1));
		const groups = made.groups;
		const loops = made.loops;
		sound.setTraffic(trafficOf(4, 0));
		expect(made.groups).toBe(groups + 1);
		expect(made.loops).toBe(loops);
		// The car group and the bus loop of the first traffic were sent away.
		expect(made.destroyed).toBe(2);
	});
});
