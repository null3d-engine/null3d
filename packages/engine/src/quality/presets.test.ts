import { beforeEach, describe, expect, it } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { DEFAULT_MAXIMUM_MIB, MAX_MAXIMUM_MIB, MIN_MAXIMUM_MIB } from '../page/loader';
import { PLANNED_SETTINGS, SETTING_DOCS, settingRows } from './preset-docs';
import {
	checkSettings,
	describeValues,
	LIVE_SETTINGS,
	lowered,
	MIB,
	presetArgument,
	presetOption,
	presetSettings,
	presetValue,
	QUALITY_PRESETS,
	QUALITY_SETTINGS,
	type QualitySettingName,
	type QualitySettings,
	type SettingValues,
	SKETCH_SETTINGS,
	takesValue,
} from './presets';

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Every row of the preset table, applied and planned. */
const ROWS = settingRows();

/** A value's place in its setting's order of cost: a higher number costs more. */
function cost(values: SettingValues, value: unknown): number {
	if (values === 'flag') return value ? 1 : 0;
	if ('min' in values) return values.heavierBelow ? -(value as number) : (value as number);
	return (values as readonly unknown[]).indexOf(value);
}

/** The settings that a sketch reads and changes: those that can change after the load. */
type SketchSettingName = {
	[K in QualitySettingName]: (typeof QUALITY_SETTINGS)[K]['changes'] extends 'load' ? never : K;
}[QualitySettingName];

/** True when the public settings type has a member for each such setting, and no other. */
const sameNames: [SketchSettingName] extends [keyof QualitySettings]
	? [keyof QualitySettings] extends [SketchSettingName]
		? true
		: false
	: false = true;

describe('the preset table', () => {
	it('gives every setting a value on each preset, which the setting takes', () => {
		for (const { name, setting } of ROWS) {
			expect([name, setting.presets.length]).toEqual([name, QUALITY_PRESETS.length]);
			for (const value of setting.presets)
				expect([name, value, takesValue(setting.values, value)]).toEqual([name, value, true]);
		}
	});

	it('makes each preset as light as the next one up, or lighter, in every setting', () => {
		for (const { name, setting } of ROWS) {
			const { presets, values } = setting;
			for (let k = 1; k < presets.length; k++) {
				const lighterOrSame = cost(values, presets[k - 1]) <= cost(values, presets[k]);
				expect([name, QUALITY_PRESETS[k - 1], lighterOrSame]).toEqual([
					name,
					QUALITY_PRESETS[k - 1],
					true,
				]);
			}
		}
	});

	it('orders each list of choices from the lightest to the heaviest', () => {
		expect(QUALITY_SETTINGS.antialias.values).toEqual(['none', 'fxaa', 'msaa']);
		expect(PLANNED_SETTINGS.shadowMapSize.values).toEqual([512, 1024, 2048, 4096]);
		expect(PLANNED_SETTINGS.shadowFilter.values).toEqual([3, 5]);
	});

	it('keeps every preset within the portable GPU budget', () => {
		// The largest 2D texture that every WebGPU device offers: compatibility mode's 4096 texels.
		for (const size of PLANNED_SETTINGS.shadowMapSize.values)
			expect(size).toBeLessThanOrEqual(4096);
		// A texture array holds the cascades, and every device allows 256 layers.
		expect(PLANNED_SETTINGS.shadowCascades.values.max).toBeLessThanOrEqual(256);
		// WebGPU samplers take an anisotropy of at most 16.
		expect(QUALITY_SETTINGS.maxAnisotropy.values.max).toBe(16);
		// The render scale draws into a corner of targets made at the full size, never past it.
		expect(PLANNED_SETTINGS.minRenderScale.values.max).toBe(1);
	});

	it('keeps each setting in one table: applied or planned', () => {
		for (const name of Object.keys(PLANNED_SETTINGS)) expect(name in QUALITY_SETTINGS).toBe(false);
		expect(ROWS.filter((row) => row.built).map((row) => row.name)).toEqual([
			'maxPixelRatio',
			'antialias',
			'maxAnisotropy',
			'uploadBytesPerFrame',
			'memoryMaximumMiB',
		]);
	});

	it('takes memory maxima from 256 MiB to the 4 GiB that the threaded core declares', () => {
		expect(QUALITY_SETTINGS.memoryMaximumMiB.values).toEqual({ min: 256, max: 4096, whole: true });
		expect([MIN_MAXIMUM_MIB, MAX_MAXIMUM_MIB]).toEqual([256, 4096]);
	});

	it('asks for no more than 1 GiB of memory on any preset until a 4 GB iPad has run the memory plan (D-04)', () => {
		for (const mib of QUALITY_SETTINGS.memoryMaximumMiB.presets)
			expect(mib).toBeLessThanOrEqual(DEFAULT_MAXIMUM_MIB);
	});

	it('lets a sketch read the settings that are fixed after the load, and change the live ones', () => {
		expect(sameNames).toBe(true);
		expect(SKETCH_SETTINGS).toEqual([
			'maxPixelRatio',
			'maxAnisotropy',
			'uploadBytesPerFrame',
			'antialias',
		]);
		expect(LIVE_SETTINGS).toEqual(['maxPixelRatio', 'maxAnisotropy', 'uploadBytesPerFrame']);
	});

	it('takes FXAA on Low, which phones draw, and MSAA from Medium up', () => {
		expect(QUALITY_SETTINGS.antialias.presets).toEqual(['fxaa', 'msaa', 'msaa', 'msaa']);
		expect(QUALITY_SETTINGS.antialias.changes).toBe('start');
	});

	it('names every setting and prints every value in the docs', () => {
		expect(ROWS.map((row): string => row.name).sort()).toEqual(
			[...Object.keys(QUALITY_SETTINGS), ...Object.keys(PLANNED_SETTINGS)].sort(),
		);
		for (const { name, label, values } of ROWS) {
			expect([name, label.length > 0]).toEqual([name, true]);
			for (const text of values) expect(text).not.toMatch(/undefined|NaN/);
		}
		expect(Object.keys(SETTING_DOCS)).toEqual(ROWS.map((row) => row.name));
	});
});

describe('presetSettings', () => {
	it("gives a sketch each preset's values", () => {
		expect(presetSettings('low')).toEqual({
			maxPixelRatio: 1.5,
			maxAnisotropy: 2,
			uploadBytesPerFrame: 2 * MIB,
			antialias: 'fxaa',
		});
		expect(presetSettings('medium')).toEqual({
			maxPixelRatio: 2,
			maxAnisotropy: 4,
			uploadBytesPerFrame: 4 * MIB,
			antialias: 'msaa',
		});
		expect(presetSettings('high')).toEqual({
			maxPixelRatio: 2,
			maxAnisotropy: 8,
			uploadBytesPerFrame: 8 * MIB,
			antialias: 'msaa',
		});
		expect(presetSettings('ultra')).toEqual({
			maxPixelRatio: Number.POSITIVE_INFINITY,
			maxAnisotropy: 16,
			uploadBytesPerFrame: 16 * MIB,
			antialias: 'msaa',
		});
	});

	it("takes the page's option over the preset's value", () => {
		expect(presetSettings('low', { maxPixelRatio: 3 }).maxPixelRatio).toBe(3);
		expect(presetSettings('high', { maxPixelRatio: undefined }).maxPixelRatio).toBe(2);
		expect(presetSettings('high', { antialias: 'none' }).antialias).toBe('none');
	});

	it("reads one setting's value on a preset", () => {
		expect(presetValue('maxPixelRatio', 'low')).toBe(1.5);
		expect(presetValue('maxAnisotropy', 'ultra')).toBe(16);
		expect(presetValue('memoryMaximumMiB', 'high')).toBe(1024);
	});
});

describe('checkSettings', () => {
	it('takes the settings that a sketch can change, with values that they take', () => {
		for (const maxPixelRatio of [0.5, 1, 2.75, 3, Number.POSITIVE_INFINITY])
			expect(() => checkSettings('quality.set()', { maxPixelRatio })).not.toThrow();
		for (const maxAnisotropy of [1, 3, 16])
			expect(() => checkSettings('quality.set()', { maxAnisotropy })).not.toThrow();
		for (const uploadBytesPerFrame of [64 * 1024, 5_000_000, 64 * MIB])
			expect(() => checkSettings('quality.set()', { uploadBytesPerFrame })).not.toThrow();
		expect(() => checkSettings('quality.set()', {})).not.toThrow();
		expect(() => checkSettings('quality.set()', { maxPixelRatio: undefined })).not.toThrow();
	});

	it('refuses a value that the setting does not take, with E1213', () => {
		for (const bad of [0, 0.25, -2, Number.NaN, '2', null, true]) {
			expect(() => checkSettings('quality.set()', { maxPixelRatio: bad })).toThrow('E1213');
		}
		expect(() => checkSettings('quality.set()', { maxPixelRatio: 0 })).toThrow(
			'E1213: quality.set() got maxPixelRatio 0, which is not a number from 0.5 up.',
		);
		expect(() => checkSettings('quality.set()', { maxPixelRatio: '2' })).toThrow(
			'E1213: quality.set() got maxPixelRatio "2", which is not a number from 0.5 up.',
		);
		for (const bad of [0, 1.5, 17]) {
			expect(() => checkSettings('quality.set()', { maxAnisotropy: bad })).toThrow(
				`E1213: quality.set() got maxAnisotropy ${bad}, which is not a whole number from 1 to 16.`,
			);
		}
		for (const bad of [1024, 64 * MIB + 1, 100_000.5]) {
			expect(() => checkSettings('quality.set()', { uploadBytesPerFrame: bad })).toThrow(
				`E1213: quality.set() got uploadBytesPerFrame ${bad}, which is not a whole number from 65536 to 67108864.`,
			);
		}
	});

	it('refuses a setting that the call does not take, with E1213, and names those it takes', () => {
		expect(() =>
			checkSettings('quality.set()', { shadows: { cascades: 2 } }, LIVE_SETTINGS),
		).toThrow(
			'E1213: quality.set() got "shadows", which is not a setting it takes. It takes maxPixelRatio, maxAnisotropy or uploadBytesPerFrame.',
		);
		// A setting whose feature is not built yet, and one that is fixed before the engine loads.
		expect(() => checkSettings('quality.set()', { shadowCascades: 2 }, LIVE_SETTINGS)).toThrow(
			'E1213',
		);
		expect(() => checkSettings('quality.set()', { memoryMaximumMiB: 512 })).toThrow('E1213');
	});

	it('says where a setting that is fixed at the start comes from', () => {
		expect(() => checkSettings('quality.set()', { antialias: 'fxaa' }, LIVE_SETTINGS)).toThrow(
			'E1213: quality.set() got antialias, which is fixed when the engine starts. Set it with the antialias option of createEngine().',
		);
		// The page's options take it, each mode and nothing else.
		for (const antialias of ['none', 'fxaa', 'msaa'])
			expect(() => checkSettings('createEngine()', { antialias })).not.toThrow();
		expect(() => checkSettings('createEngine()', { antialias: 'smaa' })).toThrow(
			`E1213: createEngine() got antialias "smaa", which is not 'none', 'fxaa' or 'msaa'.`,
		);
	});

	it('refuses a call that gets no object of settings, with E1213', () => {
		for (const bad of [null, undefined, 2, 'fast'])
			expect(() => checkSettings('quality.set()', bad as unknown as object)).toThrow('E1213');
	});
});

describe('describeValues', () => {
	it('names the values of each kind of setting in words', () => {
		expect(describeValues({ min: 0.5, max: Number.POSITIVE_INFINITY })).toBe(
			'a number from 0.5 up',
		);
		expect(describeValues({ min: 1, max: 16, whole: true })).toBe('a whole number from 1 to 16');
		expect(describeValues('flag')).toBe('true or false');
		expect(describeValues(['none', 'fxaa', 'msaa'])).toBe("'none', 'fxaa' or 'msaa'");
		expect(describeValues([3, 5])).toBe('3 or 5');
	});
});

describe('presetOption', () => {
	it('takes auto, or the name of a preset', () => {
		expect(presetOption(undefined)).toBe('auto');
		expect(presetOption('auto')).toBe('auto');
		for (const preset of QUALITY_PRESETS) expect(presetOption(preset)).toBe(preset);
	});

	it('refuses any other value, with E1213', () => {
		expect(() => presetOption('Ultra')).toThrow(
			`E1213: createEngine() got the preset "Ultra", which is not 'auto', 'low', 'medium', 'high' or 'ultra'.`,
		);
		for (const bad of ['epic', '', 2, null]) expect(() => presetOption(bad)).toThrow('E1213');
	});
});

describe('presetArgument', () => {
	it('takes the name of a preset, and refuses auto and any other value with E1213', () => {
		for (const preset of QUALITY_PRESETS) expect(presetArgument(preset)).toBe(preset);
		expect(() => presetArgument('auto')).toThrow(
			`E1213: quality.setPreset() got the preset "auto", which is not 'low', 'medium', 'high' or 'ultra'.`,
		);
		for (const bad of ['Ultra', '', 2, null, undefined])
			expect(() => presetArgument(bad)).toThrow('E1213');
	});
});

describe('LIVE_SETTINGS', () => {
	it('holds the settings that change during play, which quality.set takes', () => {
		for (const name of LIVE_SETTINGS) expect(QUALITY_SETTINGS[name].changes).toBe('live');
		for (const name of SKETCH_SETTINGS)
			if (QUALITY_SETTINGS[name].changes === 'live') expect(LIVE_SETTINGS).toContain(name);
	});
});

describe('lowered', () => {
	it('lowers a preset by a number of steps, down to Low', () => {
		expect(lowered('ultra', 1)).toBe('high');
		expect(lowered('medium', 1)).toBe('low');
		expect(lowered('low', 1)).toBe('low');
		expect(lowered('high', 5)).toBe('low');
	});
});
