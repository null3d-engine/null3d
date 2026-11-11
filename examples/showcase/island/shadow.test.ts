// The Island's Low preset keeps a short, fixed shadow reach, which is the change that ships: the
// heavier presets take the scene's stretchable range, and a phone's must not grow again as the
// camera draws back.
import { describe, expect, it } from 'bun:test';
import { SHADOW_DISTANCE, SHADOW_REACH } from './shadow';

describe("the Island's shadow reach", () => {
	it('holds Low short and apart from the stretchable range', () => {
		expect(SHADOW_DISTANCE.low).toBe(250);
		expect(SHADOW_DISTANCE.low).toBeLessThan(SHADOW_REACH.distance);
	});

	it("gives the heavier presets the scene's stretchable range", () => {
		for (const preset of ['medium', 'high', 'ultra'] as const)
			expect(SHADOW_DISTANCE[preset]).toBe(SHADOW_REACH.distance);
	});
});
