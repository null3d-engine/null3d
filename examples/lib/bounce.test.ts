// The bounce-light demo's cycle and its manual takeover: the light is on through the first half
// and off through the second until the viewer toggles it, and the demo asserts the shown state in
// every frame. A change handler cannot keep that state: the engine calls the handlers for the
// demo's own live changes, so a handler would put the light back the frame after the demo changed
// it, and the picture would never change.
import { describe, expect, it } from 'bun:test';
import { BOUNCE_RAYS, bounceRaysAt, bounceStateAt, showBounce, toggledBounce } from './bounce';

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
		showBounce(ctx, 1, null);
		expect(sets).toEqual([BOUNCE_RAYS]);
	});

	it('leaves the light off through the dark half, however many frames run', () => {
		const { ctx, sets, quality } = stub(BOUNCE_RAYS);
		showBounce(ctx, 4, null);
		for (let frame = 1; frame < 240; frame++) showBounce(ctx, 4 + frame / 60, null);
		expect(sets).toEqual([0]);
		expect(quality.settings.bounceRays).toBe(0);
	});

	it('sets the rays once, and no frame after it repeats the call', () => {
		const { ctx, sets } = stub(0);
		for (let frame = 0; frame < 60; frame++) showBounce(ctx, frame / 60, null);
		expect(sets).toEqual([BOUNCE_RAYS]);
	});

	it('puts the phase value back after a preset change gives the setting another', () => {
		const { ctx, sets, quality } = stub(BOUNCE_RAYS);
		// A lighter preset turns the light off, and a heavier one turns it on at another count.
		quality.settings.bounceRays = 0;
		showBounce(ctx, 2, null);
		quality.settings.bounceRays = 4;
		showBounce(ctx, 2, null);
		// The dark half keeps the light off whatever a preset gives it.
		quality.settings.bounceRays = BOUNCE_RAYS;
		showBounce(ctx, 6, null);
		expect(sets).toEqual([BOUNCE_RAYS, BOUNCE_RAYS, 0]);
	});
});

describe('the bounce light’s manual takeover', () => {
	it('takes the light over at the opposite of the state on show', () => {
		expect(bounceStateAt(1, null)).toBe('on');
		expect(toggledBounce(1, null)).toBe('off');
		expect(bounceStateAt(5, null)).toBe('off');
		expect(toggledBounce(5, null)).toBe('on');
	});

	it('flips the state while the viewer holds it, whatever the cycle shows', () => {
		expect(toggledBounce(1, 'off')).toBe('on');
		expect(toggledBounce(5, 'off')).toBe('on');
		expect(toggledBounce(1, 'on')).toBe('off');
		expect(toggledBounce(5, 'on')).toBe('off');
	});

	it('keeps the viewer’s state through both halves of the cycle', () => {
		const { ctx, sets, quality } = stub(BOUNCE_RAYS);
		for (const seconds of [0, 2, 4, 6, 8, 10]) showBounce(ctx, seconds, 'off');
		expect(sets).toEqual([0]);
		expect(quality.settings.bounceRays).toBe(0);

		const held = stub(0);
		for (const seconds of [0, 2, 4, 6, 8, 10]) showBounce(held.ctx, seconds, 'on');
		expect(held.sets).toEqual([BOUNCE_RAYS]);
		expect(held.quality.settings.bounceRays).toBe(BOUNCE_RAYS);
	});

	it('puts the viewer’s state back after a preset change gives the setting another', () => {
		const { ctx, sets, quality } = stub(BOUNCE_RAYS);
		quality.settings.bounceRays = 0;
		showBounce(ctx, 2, 'on');
		quality.settings.bounceRays = BOUNCE_RAYS;
		showBounce(ctx, 6, 'off');
		expect(sets).toEqual([BOUNCE_RAYS, 0]);
	});
});
