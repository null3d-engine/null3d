// The full-screen adapter of the feature description: the checks that it refuses a feature that the
// effect chain cannot place, the place that it gives the description's band and order, the ready
// callback that adds and removes the effect, the values that a not-ready feature keeps, the depth
// that must agree with the WGSL, and the removal. Stand-ins take the effect chain's calls, so the
// test reads no GPU and ships nothing.
import { describe, expect, it } from 'bun:test';
import type { Effect, EffectOptions } from './effects';
import { createFeatureEffect, type FeatureEffectHost } from './feature-effects';
import { defineFeature, type FeatureDescription } from './features';

/** The WGSL of the stand-in, as plain text so that a uniform of any name fits its type. */
const WGSL: string = 'wgsl';

/** What the host recorded, and the stand-in effect that the last `addEffect` returned. */
function standIns(depth = true) {
	const calls: string[] = [];
	const added: EffectOptions[] = [];
	const removed: Effect[] = [];
	const values: { name: string; value: unknown }[] = [];
	let watch: (() => void) | undefined;
	let unwatched = 0;
	const effect = { depth } as unknown as Effect;
	const host: FeatureEffectHost = {
		addEffect: (options) => {
			calls.push('addEffect');
			added.push(options);
			return effect;
		},
		removeEffect: (given) => {
			calls.push('removeEffect');
			if (given !== effect) throw new Error('the host removed another effect');
			removed.push(given);
		},
		setUniform: (_given, name, value) => {
			calls.push(`setUniform:${name}`);
			values.push({ name, value });
		},
		watch: (handler) => {
			watch = handler;
			return () => {
				unwatched += 1;
			};
		},
		fail: (detail) => {
			calls.push('fail');
			return new Error(`E1223: ${detail}`);
		},
	};
	return {
		host,
		calls,
		added,
		removed,
		values,
		effect,
		/** A change of the engine's quality, as the post object reports it. */
		changeQuality: () => watch?.(),
		get unwatched() {
			return unwatched;
		},
	};
}

/** A full-screen description at the resolve point, with the reads and writes that it must give. */
function fullscreen(overrides: Partial<FeatureDescription> = {}): FeatureDescription {
	return defineFeature({
		name: 'depth-of-field',
		frame: 'resolve',
		kind: 'fullscreen',
		reads: ['sceneColor', 'sceneDepth'],
		writes: ['sceneColor'],
		...overrides,
	});
}

describe('createFeatureEffect', () => {
	it('places a full-screen feature in the effect chain', () => {
		const stand = standIns(true);
		const feature = createFeatureEffect(
			fullscreen({
				band: 'after',
				order: 1_048_600,
				ready: () => true,
			}),
			{ wgsl: WGSL, uniforms: { samples: 43 } },
			stand.host,
		);
		expect(feature.name).toBe('depth-of-field');
		expect(feature.draws).toBe(true);
		expect(feature.effect).toBe(stand.effect);
		expect(stand.added.length).toBe(1);
		// The band and order reach the chain as the place they give, which its own order compares.
		expect(stand.added[0]?.order).toBe(1_048_600);
		expect((stand.added[0]?.uniforms as Record<string, unknown>)?.samples).toBe(43);
	});

	it('keeps the effect of a feature that is not ready out of the chain', () => {
		const stand = standIns();
		let on = false;
		const feature = createFeatureEffect(
			fullscreen({ ready: () => on }),
			{ wgsl: WGSL, uniforms: { samples: 0 } },
			stand.host,
		);
		expect(feature.draws).toBe(false);
		expect(feature.effect).toBe(undefined);
		expect(stand.added).toEqual([]);

		// A value that the feature takes while it does not draw applies when it does.
		feature.setUniform('samples', 43);
		expect(stand.values).toEqual([]);
		on = true;
		expect(feature.refresh()).toBe(true);
		expect(feature.draws).toBe(true);
		expect((stand.added[0]?.uniforms as Record<string, unknown>)?.samples).toBe(43);
	});

	it('asks the ready callback again when the engine quality changes', () => {
		const stand = standIns();
		let on = true;
		const feature = createFeatureEffect(
			fullscreen({ ready: () => on }),
			{ wgsl: WGSL },
			stand.host,
		);
		expect(feature.draws).toBe(true);
		on = false;
		stand.changeQuality();
		expect(feature.draws).toBe(false);
		expect(stand.removed).toEqual([stand.effect]);
		on = true;
		stand.changeQuality();
		expect(feature.draws).toBe(true);
		expect(stand.added.length).toBe(2);
	});

	it('changes a live uniform, and keeps it for the next place', () => {
		const stand = standIns();
		let on = true;
		const feature = createFeatureEffect(
			fullscreen({ ready: () => on }),
			{ wgsl: WGSL },
			stand.host,
		);
		feature.setUniform('samples', 71);
		expect(stand.values).toEqual([{ name: 'samples', value: 71 }]);
		on = false;
		stand.changeQuality();
		on = true;
		stand.changeQuality();
		expect((stand.added[1]?.uniforms as Record<string, unknown>)?.samples).toBe(71);
	});

	it('removes the effect, stops watching and calls destroy once', () => {
		const stand = standIns();
		let destroyed = 0;
		const feature = createFeatureEffect(
			fullscreen({ ready: () => true, destroy: () => destroyed++ }),
			{ wgsl: WGSL },
			stand.host,
		);
		feature.destroy();
		expect(feature.draws).toBe(false);
		expect(stand.removed).toEqual([stand.effect]);
		expect(stand.unwatched).toBe(1);
		expect(destroyed).toBe(1);
		feature.destroy();
		expect(stand.unwatched).toBe(1);
		expect(destroyed).toBe(1);
		// A stopped feature does not draw again, whatever the quality does.
		stand.changeQuality();
		expect(feature.draws).toBe(false);
		expect(feature.refresh()).toBe(false);
	});
});

describe('the descriptions that a full-screen effect refuses', () => {
	it('refuses another kind, frame or view', () => {
		const stand = standIns();
		const place = (description: FeatureDescription) => () =>
			createFeatureEffect(description, { wgsl: WGSL }, stand.host);
		// Each of these descriptions is a shape that defineFeature takes, and a place that the
		// effect chain does not give.
		expect(place(fullscreen({ frame: 'opaque', kind: 'draw' }))).toThrow(/E1223/);
		expect(place(fullscreen({ frame: 'post' }))).toThrow(/E1223/);
		expect(place(fullscreen({ views: ['reflection'] }))).toThrow(/E1223/);
		expect(stand.added).toEqual([]);
	});

	it('refuses another write, another read, an output or a slot', () => {
		const stand = standIns();
		const place = (description: FeatureDescription) => () =>
			createFeatureEffect(description, { wgsl: WGSL }, stand.host);
		expect(place(fullscreen({ writes: [] }))).toThrow(/E1223/);
		expect(place(fullscreen({ writes: ['sceneColor', 'sceneDepth'] }))).toThrow(/E1223/);
		expect(place(fullscreen({ reads: ['sceneDepth'] }))).toThrow(/E1223/);
		expect(place(fullscreen({ reads: ['sceneColor', 'history'] }))).toThrow(/E1223/);
		expect(place(fullscreen({ outputs: { bloom: { default: 'black' } } }))).toThrow(/E1223/);
		expect(place(fullscreen({ provides: ['sky'] }))).toThrow(/E1223/);
		expect(stand.added).toEqual([]);
	});

	it('refuses a depth read that the WGSL or the description does not have', () => {
		const noDepth = standIns(false);
		expect(() =>
			createFeatureEffect(fullscreen(), { wgsl: WGSL, uniforms: {} }, noDepth.host),
		).toThrow(/E1223/);
		// The effect that the chain made before the check goes away again.
		expect(noDepth.removed).toEqual([noDepth.effect]);

		const depth = standIns(true);
		expect(() =>
			createFeatureEffect(fullscreen({ reads: ['sceneColor'] }), { wgsl: WGSL }, depth.host),
		).toThrow(/E1223/);
		expect(depth.removed).toEqual([depth.effect]);
	});
});
