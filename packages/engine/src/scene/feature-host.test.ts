// The live link between a sketch's quality and an add-on's features: a feature's settings follow the
// preset, the GPU path and the frame-budget governor, its budget joins the sketch's budgets, and its
// figures name its values and its budget. The feature here is a small one with no frame work, which
// keeps the test to the link itself.
import { beforeEach, describe, expect, it } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { presetSettings, type QualityPreset, type QualitySettings } from '../quality/presets';
import { SketchQuality } from '../sketch/quality';
import { activateAddonDebugView, hasAddonDebugView } from './addon-debug-views';
import { FeatureHost, type FeatureHostOptions } from './feature-host';
import { defineFeature, type FeatureDescription, type FeatureStats } from './features';
import { AddonNamespaces } from './namespaces';

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

/** A sketch's quality API on `preset`, with no page options. */
function qualityOn(preset: QualityPreset = 'medium'): SketchQuality {
	return new SketchQuality(
		{ preset, settings: presetSettings(preset), options: {}, highest: 'ultra' },
		() => {},
		async () => {},
		() => 1,
	);
}

/** Moves the sketch's budgets to the governor's step `level`, as the frame loop does. */
function stepTo(quality: SketchQuality, level: number): void {
	quality.budgets.follow(level, (error) => {
		throw error;
	});
}

/** Tells the sketch's change handlers of a change, as the frame loop does. */
function notify(quality: SketchQuality): void {
	for (const handler of quality.handlers) handler(quality);
}

/** A feature host for one add-on, on a namespace registry of the test's own. */
function hostOn(
	options: Omit<FeatureHostOptions, 'namespace' | 'namespaces'>,
	addon = 'test',
): FeatureHost {
	const namespaces = new AddonNamespaces();
	const namespace = namespaces.claim({ name: addon, package: `@test/${addon}` });
	return new FeatureHost({ ...options, namespace, namespaces });
}

/** Two feature hosts of different add-ons, which share one namespace registry. */
function twoHosts(quality = qualityOn()): { water: FeatureHost; terrain: FeatureHost } {
	const namespaces = new AddonNamespaces();
	return {
		water: new FeatureHost({
			quality,
			tier: 'webgpu',
			namespace: namespaces.claim({ name: 'water', package: '@test/water' }),
			namespaces,
		}),
		terrain: new FeatureHost({
			quality,
			tier: 'webgpu',
			namespace: namespaces.claim({ name: 'terrain', package: '@test/terrain' }),
			namespaces,
		}),
	};
}

/** A feature whose setting falls with the governor's scale, and whose cadence doubles. */
function glow(overrides: Partial<FeatureDescription> = {}): FeatureDescription {
	return defineFeature({
		name: 'glow',
		settings: {
			samples: { presets: [0, 22, 43, 71], values: [0, 16, 22, 43, 71], governor: 'scale' },
			cadence: {
				presets: [1, 1, 2, 4],
				webgl2: [1, 1, 1, 2],
				values: { min: 1, max: 16, whole: true },
				governor: 'double',
			},
		},
		budget: { presets: [2, 4, 8, 12], min: 0 },
		memory: () => 1024 * 1024,
		...overrides,
	});
}

describe('the preset rows of an add-on feature', () => {
	it('gives each preset and GPU path its own value', async () => {
		const quality = qualityOn('medium');
		const host = hostOn({ quality, tier: 'webgpu' });
		const feature = host.add(glow());
		expect(feature.settings.samples).toBe(22);
		expect(feature.settings.cadence).toBe(1);
		await quality.setPreset('ultra');
		notify(quality);
		expect(feature.settings.samples).toBe(71);
		expect(feature.settings.cadence).toBe(4);
		host.destroy();
	});

	it('takes the WebGL2 column where a row gives one', () => {
		const host = hostOn({ quality: qualityOn('ultra'), tier: 'webgl2' });
		const feature = host.add(glow());
		expect(feature.settings.cadence).toBe(2);
		host.destroy();
	});

	it('calls the quality callback with the feature’s own values and budget', async () => {
		const quality = qualityOn('high');
		const seen: { preset: QualityPreset; settings: Readonly<QualitySettings>; samples: unknown }[] =
			[];
		const host = hostOn({ quality, tier: 'webgpu' });
		host.add(
			glow({
				quality: (preset, settings, feature) => {
					seen.push({ preset, settings, samples: feature.settings.samples });
				},
			}),
		);
		expect(seen.length).toBe(1);
		expect(seen[0]?.preset).toBe('high');
		expect(seen[0]?.settings).toBe(quality.settings as Readonly<QualitySettings>);
		expect(seen[0]?.samples).toBe(43);
		await quality.setPreset('low');
		notify(quality);
		expect(seen.at(-1)?.preset).toBe('low');
		expect(seen.at(-1)?.samples).toBe(0);
		host.destroy();
	});

	it('refuses a row that the engine cannot read', () => {
		expect(() =>
			defineFeature({
				name: 'a',
				settings: { s: { presets: [true, true, true] as never, values: 'flag' } },
			}),
		).toThrow(/E1223/);
		expect(() =>
			defineFeature({
				name: 'a',
				settings: { s: { presets: [1, 2, 3, 4], values: { min: 0, max: 2 } } },
			}),
		).toThrow(/E1223/);
		expect(() =>
			defineFeature({
				name: 'a',
				settings: { s: { presets: [true, true, true, true], values: 'flag', governor: 'scale' } },
			}),
		).toThrow(/budget/);
		expect(() => defineFeature({ name: 'a', budget: { presets: [0, 1, 1, 1] } })).toThrow(/E1223/);
		expect(() => defineFeature({ name: 'a', budget: { presets: [1, 1, 1, 1], min: 2 } })).toThrow(
			/E1223/,
		);
	});
});

describe('the governor’s steps reaching an add-on feature', () => {
	it('registers the budget on each preset and follows the budget scale', async () => {
		const quality = qualityOn('medium');
		const host = hostOn({ quality, tier: 'webgpu' });
		const feature = host.add(glow());
		expect(feature.budgetScale).toBe(1);
		expect(feature.budgetMs).toBe(4);
		// One step of the budgets' scale is a quarter less, so a setting that scales falls to
		// three quarters, and an interval doubles.
		stepTo(quality, 1);
		expect(feature.budgetScale).toBe(0.75);
		expect(feature.budgetMs).toBe(3);
		expect(feature.settings.samples).toBe(17);
		expect(feature.settings.cadence).toBe(2);
		stepTo(quality, 2);
		expect(feature.settings.samples).toBe(11);
		expect(feature.settings.cadence).toBe(4);
		// A new preset gives the budget its own time there, and the settings their values.
		await quality.setPreset('ultra');
		notify(quality);
		expect(feature.stats.budgetMs).toBe(12);
		expect(feature.stats.allowedMs).toBe(6);
		expect(feature.settings.samples).toBe(36);
		host.destroy();
	});

	it('keeps a setting inside the highest value of its range', () => {
		const quality = qualityOn('ultra');
		const host = hostOn({ quality, tier: 'webgpu' });
		const feature = host.add(glow());
		stepTo(quality, 4);
		expect(feature.settings.cadence).toBe(16);
		host.destroy();
	});

	it('stops the steps when the host is destroyed', () => {
		const quality = qualityOn('medium');
		const host = hostOn({ quality, tier: 'webgpu' });
		const feature = host.add(glow());
		host.destroy();
		expect(quality.budgets.steps).toBe(0);
		expect(feature.settings.samples).toBe(22);
	});
});

describe('the figures of an add-on feature', () => {
	it('names its values, its budget and its memory, with one GPU scope', () => {
		const quality = qualityOn('medium');
		const reported: (readonly FeatureStats[])[] = [];
		const host = hostOn({
			quality,
			tier: 'webgpu',
			page: { post: (_name, data) => reported.push(data as readonly FeatureStats[]) },
		});
		host.add(glow());
		const figures = host.stats;
		expect(figures.length).toBe(1);
		const [figure] = figures;
		expect(figure?.name).toBe('glow');
		expect(figure?.settings).toEqual({ samples: 22, cadence: 1 });
		expect(figure?.budgetMs).toBe(4);
		expect(figure?.allowedMs).toBe(4);
		expect(figure?.bytes).toBe(1024 * 1024);
		// The feature records no frame work, so the engine times none of its GPU scope.
		expect(figure?.gpuMs).toBeNull();
		expect(reported.at(-1)).toEqual(figures);
		host.destroy();
		expect(reported.at(-1)).toEqual([]);
	});

	it('removes a feature and gives its budget back', () => {
		const quality = qualityOn('medium');
		const host = hostOn({ quality, tier: 'webgpu' });
		const feature = host.add(glow());
		expect(quality.budgets.steps).toBe(4);
		feature.remove();
		expect(host.stats).toEqual([]);
		expect(host.get('glow')).toBeUndefined();
		expect(quality.budgets.steps).toBe(0);
		host.destroy();
	});
});

describe('names that two add-ons cannot share', () => {
	it('refuses a host for an add-on that declared no namespace', () => {
		expect(
			() =>
				new FeatureHost({
					quality: qualityOn('medium'),
					namespace: { name: 'undeclared', package: '@test/undeclared' },
					namespaces: new AddonNamespaces(),
				}),
		).toThrow(
			/E1225: FeatureHost\(\) got the add-on 'undeclared', which has no namespace in this thread\./,
		);
	});

	it('refuses a feature name that another add-on registers, and names both', () => {
		const quality = qualityOn('medium');
		const { water, terrain } = twoHosts(quality);
		water.add(glow({ name: 'waves' }));
		expect(() => terrain.add(glow({ name: 'waves' }))).toThrow(
			/E1225: FeatureHost.add\(\) got the feature 'waves' for the add-on 'terrain', which the add-on 'water' registers already\./,
		);
		// The refused feature left nothing behind in its own host or in the shared names.
		expect(terrain.get('waves')).toBeUndefined();
		expect(terrain.stats).toEqual([]);
		water.destroy();
		terrain.destroy();
	});

	it('refuses an output name that another add-on publishes', () => {
		const { water, terrain } = twoHosts();
		water.add(glow({ name: 'waves', outputs: { spray: { default: 'black' } } }));
		expect(() =>
			terrain.add(glow({ name: 'rock', outputs: { spray: { default: 'white' } } })),
		).toThrow(
			/E1225: .*got the output 'spray' for the add-on 'terrain', which the add-on 'water' publishes already\./,
		);
		terrain.destroy();
		water.destroy();
	});

	it('refuses a lighting slot that another add-on provides', () => {
		const { water, terrain } = twoHosts();
		water.add(glow({ name: 'waves', provides: ['sky'] }));
		expect(() => terrain.add(glow({ name: 'rock', provides: ['sky'] }))).toThrow(
			/E1225: .*got the slot 'sky' for the add-on 'terrain', which the add-on 'water' provides already\./,
		);
		terrain.destroy();
		water.destroy();
	});

	it('gives a removed feature’s names to another add-on', () => {
		const { water, terrain } = twoHosts();
		const waves = water.add(glow({ name: 'waves' }));
		expect(() => terrain.add(glow({ name: 'waves' }))).toThrow(/E1225/);
		waves.remove();
		expect(terrain.add(glow({ name: 'waves' })).name).toBe('waves');
		terrain.destroy();
		water.destroy();
	});

	it('gives each add-on’s features their own budgets', () => {
		const quality = qualityOn('medium');
		const { water, terrain } = twoHosts(quality);
		const waves = water.add(glow({ name: 'waves' }));
		const rock = terrain.add(glow({ name: 'rock' }));
		// One governor step reaches the budgets of both add-ons.
		stepTo(quality, 1);
		expect(waves.budgetScale).toBe(0.75);
		expect(rock.budgetScale).toBe(0.75);
		rock.remove();
		expect(waves.budgetScale).toBe(0.75);
		expect(quality.budgets.steps).toBe(4);
		terrain.destroy();
		water.destroy();
	});
});

describe('the debug views that features add', () => {
	it('starts a view when the page or the sketch picks it, and stops it when another replaces it', () => {
		const host = hostOn({ quality: qualityOn() });
		const calls: boolean[] = [];
		host.add(
			glow({
				name: 'terrain',
				debugViews: [{ name: 'test-terrain-blocks', set: (active) => calls.push(active) }],
			}),
		);
		expect(hasAddonDebugView('test-terrain-blocks')).toBe(true);
		expect(activateAddonDebugView('test-terrain-blocks')).toBe(true);
		expect(calls).toEqual([true]);
		expect(activateAddonDebugView('lit')).toBe(false);
		expect(calls).toEqual([true, false]);
		expect(activateAddonDebugView(undefined)).toBe(true);
		host.destroy();
		expect(hasAddonDebugView('test-terrain-blocks')).toBe(false);
	});

	it('starts a view that the page asked for before the feature registered it', () => {
		const host = hostOn({ quality: qualityOn() });
		expect(activateAddonDebugView('test-late')).toBe(false);
		const calls: boolean[] = [];
		host.add(
			glow({
				name: 'terrain',
				debugViews: [{ name: 'test-late', set: (active) => calls.push(active) }],
			}),
		);
		expect(calls).toEqual([true]);
		host.destroy();
		activateAddonDebugView(undefined);
	});

	it('refuses a view name that another add-on adds, and a name of the engine’s own', () => {
		const { water, terrain } = twoHosts();
		const view = (name: string) => [{ name, set: () => {} }];
		water.add(glow({ name: 'waves', debugViews: view('test-blocks') }));
		expect(() => terrain.add(glow({ name: 'rock', debugViews: view('test-blocks') }))).toThrow(
			/E1225/,
		);
		expect(() => terrain.add(glow({ name: 'rock', debugViews: view('levels') }))).toThrow(/E1223/);
		terrain.destroy();
		water.destroy();
	});
});
