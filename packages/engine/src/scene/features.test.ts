// The public feature description, its defaults and its checks, and one real built-in written
// against it. Depth of field's description lives here alone: it moves no built-in, and the test
// does not ship.
import { describe, expect, it } from 'bun:test';
import { presetSettings, QUALITY_SETTINGS, type QualityPreset } from '../quality/presets';
import {
	defineFeature,
	type FeatureDescription,
	FeatureRegistry,
	type FeatureSize,
} from './features';

/** The presets that depth of field's real setting draws on. */
const PRESETS: readonly QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/** What a feature's quality callback reads when the test calls it: no own settings or budget. */
const own = () => ({ settings: {}, budgetScale: 1, budgetMs: 0 }) as const;

/** A minimal description of a feature that records in the opaque pass. */
function minimal(overrides: Partial<FeatureDescription> = {}): FeatureDescription {
	return defineFeature({
		name: 'boxes',
		frame: 'opaque',
		kind: 'draw',
		...overrides,
	});
}

describe('defineFeature', () => {
	it('fills the neutral defaults', () => {
		const feature = minimal();
		expect(feature.name).toBe('boxes');
		expect(feature.frame).toBe('opaque');
		expect(feature.kind).toBe('draw');
		expect(feature.band).toBe('normal');
		expect(feature.order).toBe(0);
		expect(feature.reads).toEqual([]);
		expect(feature.writes).toEqual([]);
		expect(feature.provides).toEqual([]);
		expect(feature.outputs).toEqual({});
		expect(feature.views).toEqual(['main']);
		expect(Object.isFrozen(feature)).toBe(true);
	});

	it('fills the first place of the band that the feature names', () => {
		expect(minimal({ band: 'before' }).order).toBe(-1_048_576);
		expect(minimal({ band: 'after' }).order).toBe(1_048_576);
		expect(minimal({ order: 900 }).order).toBe(900);
	});

	it('takes a feature that publishes data and records no frame work', () => {
		const bake = defineFeature({
			name: 'bake',
			outputs: { lightMap: { default: 'white' } },
			provides: ['ao'],
			ready: () => true,
		});
		expect(bake.frame).toBe(undefined);
		expect(bake.kind).toBe(undefined);
		expect(bake.views).toEqual([]);
		expect(bake.outputs?.lightMap).toEqual({ default: 'white' });
	});

	it('refuses a frame point or a kind that does not go with it', () => {
		expect(() => minimal({ frame: 'colour' as never })).toThrow(/E1223/);
		expect(() => defineFeature({ name: 'glow', frame: 'post' })).toThrow(/E1223/);
		expect(() => minimal({ frame: 'post', kind: 'draw' })).toThrow(/E1223/);
		expect(() => minimal({ frame: 'shadow', kind: 'fullscreen' })).toThrow(/E1223/);
		// A compute feature publishes its results as outputs, not as scene resources.
		expect(() => minimal({ kind: 'compute', writes: ['sceneColor'] })).toThrow(/E1223/);
	});

	it('refuses a scene resource or a view without a frame point', () => {
		expect(() => defineFeature({ name: 'bake', reads: ['sceneColor'] })).toThrow(/E1223/);
		expect(() => defineFeature({ name: 'bake', writes: ['history'] })).toThrow(/E1223/);
		expect(() => defineFeature({ name: 'bake', views: ['main'] })).toThrow(/E1223/);
		expect(() => defineFeature({ name: 'bake', kind: 'draw' })).toThrow(/E1223/);
	});

	it('keeps an order inside its band and refuses an unknown option', () => {
		expect(() => minimal({ band: 'before', order: 0 })).toThrow(/E1223/);
		expect(() => minimal({ band: 'after', order: 1 })).toThrow(/E1223/);
		expect(() => minimal({ order: 1.5 })).toThrow(/E1223/);
		expect(() => minimal({ colour: '#fff' } as never)).toThrow(/E1223/);
	});

	it('checks names', () => {
		expect(() => minimal({ name: '' })).toThrow(/E1223/);
		expect(() => minimal({ name: 'x'.repeat(65) })).toThrow(/E1223/);
		expect(() => minimal({ name: 'boxes\n' })).toThrow(/E1223/);
		expect(() => minimal({ name: 'boxes', outputs: { sceneColor: { default: 'black' } } })).toThrow(
			/E1223/,
		);
	});

	it('gives every published output a neutral default', () => {
		const feature = minimal({
			outputs: {
				reflection: { default: 'black' },
				occlusion: { default: 'white' },
				mask: { default: 'transparent' },
			},
		});
		expect(Object.keys(feature.outputs ?? {}).sort()).toEqual(['mask', 'occlusion', 'reflection']);
		expect(feature.outputs?.reflection?.default).toBe('black');
		expect(() => minimal({ outputs: { glow: {} as never } })).toThrow(/E1223/);
		expect(() => minimal({ outputs: { glow: { default: 'grey' as never } } })).toThrow(/E1223/);
		expect(() => minimal({ outputs: { glow: { default: 'black', size: 4 } as never } })).toThrow(
			/E1223/,
		);
	});

	it('checks the callbacks', () => {
		expect(() => minimal({ ready: true as never })).toThrow(/E1223/);
		expect(() => minimal({ destroy: 'now' as never })).toThrow(/E1223/);
	});

	it('checks the debug views that a feature adds', () => {
		const set = () => {};
		const feature = minimal({ debugViews: [{ name: 'terrain-blocks', set }] });
		expect(feature.debugViews?.map((view) => view.name)).toEqual(['terrain-blocks']);
		expect(feature.debugViews?.[0]?.set).toBe(set);
		expect(() => minimal({ debugViews: [{} as never] })).toThrow(/E1223/);
		expect(() => minimal({ debugViews: [{ name: 'levels', set }] })).toThrow(/E1223/);
		expect(() =>
			minimal({
				debugViews: [
					{ name: 'blocks', set },
					{ name: 'blocks', set },
				],
			}),
		).toThrow(/E1223/);
		expect(() => minimal({ debugViews: [{ name: 'blocks', set: 4 as never }] })).toThrow(/E1223/);
	});
});

describe('the GPU scope of a feature', () => {
	it('names the passes that carry its work, and defaults to none', () => {
		const feature = minimal({ gpu: { passes: [{ name: 'water', place: 3 }] } });
		expect(feature.gpu).toEqual({ passes: [{ name: 'water', place: 3 }] });
		expect(Object.isFrozen(feature.gpu)).toBe(true);
		expect(minimal().gpu).toEqual({ passes: [] });
	});

	it('refuses a pass that render.addPass did not return', () => {
		const refused = (gpu: unknown) => (() => minimal({ gpu: gpu as FeatureDescription['gpu'] }))();
		expect(() => refused({ passes: [{}] })).toThrow(/name/);
		expect(() => refused({ passes: [{ name: 'water', place: 0 }] })).toThrow(/render\.addPass/);
		expect(() => refused({ passes: [{ name: '', place: 1 }] })).toThrow(/name/);
		expect(() => refused({ passes: {} })).toThrow(/passes/);
		expect(() => refused({ pass: 'water' })).toThrow(/gpu option/);
	});
});

describe('FeatureRegistry', () => {
	it('gives each feature, output and lighting slot one owner', () => {
		const registry = new FeatureRegistry();
		const sky = registry.add(
			defineFeature({
				name: 'sky',
				frame: 'background',
				kind: 'fullscreen',
				writes: ['sceneColor'],
				outputs: { environment: { default: 'white' } },
				provides: ['sky', 'ambient'],
			}),
		);
		expect(registry.size).toBe(1);
		expect(registry.get('sky')).toBe(sky);
		expect(registry.outputDefault('environment')).toBe('white');
		expect(registry.outputDefault('missing')).toBe(undefined);
		expect(registry.provider('sky')).toBe('sky');
		expect(registry.provider('fog')).toBe(undefined);

		expect(() => registry.add(defineFeature({ name: 'sky' }))).toThrow(/E1223/);
		expect(() =>
			registry.add(
				defineFeature({ name: 'other', outputs: { environment: { default: 'black' } } }),
			),
		).toThrow(/E1223/);
		expect(() => registry.add(defineFeature({ name: 'ao', provides: ['ambient'] }))).toThrow(
			/E1223/,
		);
		const view = [{ name: 'terrain-blocks', set: () => {} }];
		registry.add(defineFeature({ name: 'terrain', debugViews: view }));
		expect(() => registry.add(defineFeature({ name: 'other', debugViews: view }))).toThrow(/E1223/);
	});

	it('gives the names back when a feature is removed', () => {
		const registry = new FeatureRegistry();
		const view = [{ name: 'sky-layers', set: () => {} }];
		registry.add(
			defineFeature({
				name: 'sky',
				outputs: { environment: { default: 'white' } },
				provides: ['sky'],
				debugViews: view,
			}),
		);
		expect(registry.remove('sky')).toBe(true);
		expect(registry.remove('sky')).toBe(false);
		expect(registry.size).toBe(0);
		expect(registry.provider('sky')).toBe(undefined);
		expect(registry.outputDefault('environment')).toBe(undefined);
		// The names are free again.
		registry.add(
			defineFeature({
				name: 'sky',
				outputs: { environment: { default: 'black' } },
				provides: ['sky'],
				debugViews: view,
			}),
		);
		expect(registry.outputDefault('environment')).toBe('black');
	});
});

describe('a real built-in feature', () => {
	it('writes depth of field against the description', () => {
		let on = false;
		let samples = 0;
		let size: FeatureSize = { width: 0, height: 0, renderScale: 1 };
		let resets = 0;
		let destroyed = false;
		// Depth of field runs on the scene's HDR color and depth, after the custom effects and
		// before bloom, and writes the color back for the final pass.
		const feature = defineFeature({
			name: 'depth-of-field',
			frame: 'resolve',
			kind: 'fullscreen',
			band: 'normal',
			order: 0,
			reads: ['sceneColor', 'sceneDepth'],
			writes: ['sceneColor'],
			views: ['main'],
			ready: () => on && samples > 0,
			quality: (_preset, settings) => {
				samples = settings.dofSamples;
			},
			resize: (next) => {
				size = next;
			},
			reset: () => {
				resets += 1;
			},
			destroy: () => {
				destroyed = true;
			},
		});
		const registry = new FeatureRegistry();
		registry.add(feature);

		expect(feature.frame).toBe('resolve');
		expect(feature.kind).toBe('fullscreen');
		expect(feature.reads).toEqual(['sceneColor', 'sceneDepth']);
		expect(feature.writes).toEqual(['sceneColor']);

		// The setter turns depth of field on, and the quality setting gates it.
		expect(feature.ready?.()).toBe(false);
		on = true;
		for (const preset of PRESETS) {
			feature.quality?.(preset, presetSettings(preset), own());
			expect(samples).toBe(QUALITY_SETTINGS.dofSamples.presets[PRESETS.indexOf(preset)] ?? -1);
			expect(feature.ready?.()).toBe(samples > 0);
		}
		// The real preset table draws none on Low.
		feature.quality?.('low', presetSettings('low'), own());
		expect(samples).toBe(0);
		expect(feature.ready?.()).toBe(false);

		feature.resize?.({ width: 1280, height: 720, renderScale: 1 });
		expect(size).toEqual({ width: 1280, height: 720, renderScale: 1 });
		feature.reset?.('camera');
		expect(resets).toBe(1);
		feature.destroy?.();
		expect(destroyed).toBe(true);
	});
});
