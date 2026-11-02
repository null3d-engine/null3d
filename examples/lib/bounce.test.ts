// The bounce-light demo's cycle: the light is on through the first half and off through the
// second, and the demo asserts it in every frame. A change handler cannot keep it on: the engine
// calls the handlers for the demo's own live changes, so a handler would put the light back on the
// frame after the cycle turned it off, and the picture would never change.
import { describe, expect, it } from 'bun:test';
import { BOUNCE_RAYS, bounceRaysAt, showBounce } from './bounce';

/** A quality API that records each ray count it is given, as a preset or a sketch would. */
function stub(rays: number) {
	const sets: number[] = [];
	const quality = {
		settings: { bounceRays: rays },
		set(values: { bounceRays?: number }) {
			sets.push(values.bounceRays as number);
			quality.settings.bounceRays = values.bounceRays as number;
			return Promise.resolve();
		},
	};
	return { ctx: { quality } as never, sets, quality };
}

describe('the bounce light’s cycle', () => {
	it('shows the light through the first half and hides it through the second', () => {
		expect(bounceRaysAt(0)).toBe(BOUNCE_RAYS);
		expect(bounceRaysAt(3.9)).toBe(BOUNCE_RAYS);
		expect(bounceRaysAt(4)).toBe(0);
		expect(bounceRaysAt(7.9)).toBe(0);
		expect(bounceRaysAt(8)).toBe(BOUNCE_RAYS);
	});

	it('turns the light on at a preset that leaves it off', () => {
		const { ctx, sets } = stub(0);
		showBounce(ctx, 1);
		expect(sets).toEqual([BOUNCE_RAYS]);
	});

	it('leaves the light off through the dark half, however many frames run', () => {
		const { ctx, sets, quality } = stub(BOUNCE_RAYS);
		showBounce(ctx, 4);
		for (let frame = 1; frame < 240; frame++) showBounce(ctx, 4 + frame / 60);
		expect(sets).toEqual([0]);
		expect(quality.settings.bounceRays).toBe(0);
	});

	it('sets the rays once, and no frame after it repeats the call', () => {
		const { ctx, sets } = stub(0);
		for (let frame = 0; frame < 60; frame++) showBounce(ctx, frame / 60);
		expect(sets).toEqual([BOUNCE_RAYS]);
	});

	it('puts the phase value back after a preset change gives the setting another', () => {
		const { ctx, sets, quality } = stub(BOUNCE_RAYS);
		// A lighter preset turns the light off, and a heavier one turns it on at another count.
		quality.settings.bounceRays = 0;
		showBounce(ctx, 2);
		quality.settings.bounceRays = 4;
		showBounce(ctx, 2);
		// The dark half keeps the light off whatever a preset gives it.
		quality.settings.bounceRays = BOUNCE_RAYS;
		showBounce(ctx, 6);
		expect(sets).toEqual([BOUNCE_RAYS, BOUNCE_RAYS, 0]);
	});
});
