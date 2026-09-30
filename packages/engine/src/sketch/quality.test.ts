import { beforeEach, describe, expect, it } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import {
	LIVE_SETTINGS,
	presetSettings,
	type QualityPreset,
	type QualitySettingName,
	type QualitySettings,
	SKETCH_SETTINGS,
} from '../quality/presets';
import {
	LIVE_CHANGE,
	NO_CHANGE,
	type QualityStart,
	type QualityUpdate,
	RESTART_CHANGE,
	SketchQuality,
} from './quality';

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Medium's settings. */
const MEDIUM = presetSettings('medium');

/**
 * A sketch's quality API on Medium, with the page's options and highest preset from `start`, the
 * updates that it applied, the names that changed in each, and the times that it waited for a
 * restart's frame.
 */
function medium(start: Partial<QualityStart> = {}) {
	const applied: QualityUpdate[] = [];
	const changes: (readonly QualitySettingName[])[] = [];
	const settled = { count: 0 };
	const quality = new SketchQuality(
		{ preset: 'medium', settings: MEDIUM, options: {}, highest: 'ultra', ...start },
		(update, changed) => {
			applied.push(update);
			changes.push(changed);
		},
		async () => {
			settled.count++;
		},
	);
	return { quality, applied, changes, settled };
}

/**
 * Runs `test` while the table counts `name` as fixed while a preset runs, as the settings of
 * pipelines and render targets are.
 */
async function asStartSetting(name: QualitySettingName, test: () => Promise<void>): Promise<void> {
	const live = LIVE_SETTINGS as QualitySettingName[];
	const at = live.indexOf(name);
	live.splice(at, 1);
	try {
		await test();
	} finally {
		live.splice(at, 0, name);
	}
}

describe('SketchQuality', () => {
	it('starts with the preset and the settings that the page chose', () => {
		const { quality, applied } = medium();
		expect(quality.preset).toBe('medium');
		expect(quality.settings).toEqual(MEDIUM);
		expect(quality.settings).not.toBe(MEDIUM);
		expect(quality.takeChange()).toBe(NO_CHANGE);
		expect(quality.takeRestart()).toBe(false);
		expect(applied).toEqual([]);
	});

	it('changes a setting, applies the new settings, and notes one change for the next frame', async () => {
		const { quality, applied, changes, settled } = medium();
		await quality.set({ maxPixelRatio: 1.25 });
		expect(quality.settings.maxPixelRatio).toBe(1.25);
		expect(applied).toEqual([{ preset: 'medium', settings: { ...MEDIUM, maxPixelRatio: 1.25 } }]);
		expect(changes).toEqual([['maxPixelRatio']]);
		expect(quality.takeChange()).toBe(LIVE_CHANGE);
		expect(quality.takeChange()).toBe(NO_CHANGE);
		// A live change waits for no frame.
		expect(quality.takeRestart()).toBe(false);
		expect(settled.count).toBe(0);
	});

	it('names only the settings that took new values', () => {
		const { quality, changes } = medium();
		quality.set({
			maxPixelRatio: MEDIUM.maxPixelRatio,
			maxAnisotropy: 2,
			uploadBytesPerFrame: 1_048_576,
		});
		expect(changes).toEqual([['maxAnisotropy', 'uploadBytesPerFrame']]);
		expect(quality.settings).toEqual({
			maxPixelRatio: MEDIUM.maxPixelRatio,
			maxAnisotropy: 2,
			uploadBytesPerFrame: 1_048_576,
		});
	});

	it('applies a copy, which later changes leave alone', () => {
		const { quality, applied } = medium();
		quality.set({ maxPixelRatio: 1 });
		quality.set({ maxPixelRatio: Number.POSITIVE_INFINITY });
		expect(applied.map((update) => update.settings.maxPixelRatio)).toEqual([
			1,
			Number.POSITIVE_INFINITY,
		]);
	});

	it('notes no change when a setting keeps its value', () => {
		const { quality, applied } = medium();
		quality.set({ maxPixelRatio: 2 });
		quality.set({});
		quality.set({ maxPixelRatio: undefined });
		expect(applied).toEqual([]);
		expect(quality.takeChange()).toBe(NO_CHANGE);
	});

	it('refuses a setting or a value that it does not take with E1213, and changes nothing', () => {
		const { quality, applied } = medium();
		expect(() => quality.set({ maxPixelRatio: 0 })).toThrow('E1213');
		expect(() => quality.set({ maxAnisotropy: 32 })).toThrow('E1213');
		expect(() => quality.set({ maxPixelRatio: 1, uploadBytesPerFrame: 1024 })).toThrow('E1213');
		expect(() => quality.set({ antialias: 'fxaa' } as Partial<QualitySettings>)).toThrow('E1213');
		expect(() => quality.set({ memoryMaximumMiB: 512 } as Partial<QualitySettings>)).toThrow(
			'E1213',
		);
		expect(quality.settings).toEqual(MEDIUM);
		expect(applied).toEqual([]);
		expect(quality.takeChange()).toBe(NO_CHANGE);
	});

	it('waits as a new preset does when a setting fixed at the start changes', () =>
		asStartSetting('maxAnisotropy', async () => {
			const { quality, changes, settled } = medium();
			await quality.set({ maxAnisotropy: 2, maxPixelRatio: 1 });
			expect(quality.preset).toBe('medium');
			expect(changes).toEqual([['maxAnisotropy', 'maxPixelRatio']]);
			expect(settled.count).toBe(1);
			expect(quality.takeRestart()).toBe(true);
			expect(quality.takeChange()).toBe(RESTART_CHANGE);
		}));

	it('keeps the change handlers until their remover runs', () => {
		const { quality } = medium();
		const handler = () => {};
		const remove = quality.onChange(handler);
		expect([...quality.handlers]).toEqual([handler]);
		remove();
		expect(quality.handlers.size).toBe(0);
	});
});

describe('SketchQuality.lower', () => {
	it('moves to the next lighter preset, and waits for its frame, as setPreset does', async () => {
		const { quality, applied, settled } = medium();
		await quality.lower();
		expect(quality.preset).toBe('low');
		expect(quality.settings).toEqual(presetSettings('low'));
		expect(applied.at(-1)?.preset).toBe('low');
		expect(settled.count).toBe(1);
		expect(quality.takeRestart()).toBe(true);
	});

	it('keeps the settings that the sketch chose itself and those of the page', async () => {
		const { quality, changes } = medium({
			options: { maxPixelRatio: 1 },
			settings: { ...MEDIUM, maxPixelRatio: 1 },
		});
		quality.set({ maxAnisotropy: 16 });
		quality.own('uploadBytesPerFrame');
		await quality.lower();
		expect(quality.preset).toBe('low');
		expect(quality.settings).toEqual({
			maxPixelRatio: 1,
			maxAnisotropy: 16,
			uploadBytesPerFrame: MEDIUM.uploadBytesPerFrame,
		});
		// The preset changed, and none of the settings did.
		expect(changes.at(-1)).toEqual([]);
	});
});

describe('SketchQuality.setPreset', () => {
	it("gives every setting the new preset's value, and waits for the new preset's frame", async () => {
		const { quality, applied, changes, settled } = medium();
		quality.set({ maxPixelRatio: 1 });
		quality.takeChange();
		await quality.setPreset('low');
		expect(quality.preset).toBe('low');
		expect(quality.settings).toEqual(presetSettings('low'));
		expect(Object.keys(quality.settings)).toEqual([...SKETCH_SETTINGS]);
		expect(applied.at(-1)).toEqual({ preset: 'low', settings: presetSettings('low') });
		expect(changes.at(-1)).toEqual(SKETCH_SETTINGS);
		expect(settled.count).toBe(1);
		// The next frame holds for its pipelines, and its handlers hear of a new preset.
		expect(quality.takeRestart()).toBe(true);
		expect(quality.takeRestart()).toBe(false);
		expect(quality.takeChange()).toBe(RESTART_CHANGE);
	});

	it("keeps the settings that the page's options give", async () => {
		const { quality } = medium({
			options: { maxPixelRatio: 1 },
			settings: { ...MEDIUM, maxPixelRatio: 1 },
		});
		await quality.setPreset('ultra');
		expect(quality.settings).toEqual(presetSettings('ultra', { maxPixelRatio: 1 }));
	});

	it("caps the preset at the GPU path's highest", async () => {
		const { quality } = medium({ highest: 'medium' });
		await quality.setPreset('ultra');
		expect(quality.preset).toBe('medium');
		await quality.setPreset('low');
		expect(quality.preset).toBe('low');
	});

	it('resolves at once and notes no change when the preset and its settings stay the same', async () => {
		const { quality, applied, settled } = medium({ highest: 'medium' });
		await quality.setPreset('high');
		expect(applied).toEqual([]);
		expect(settled.count).toBe(0);
		expect(quality.takeRestart()).toBe(false);
		expect(quality.takeChange()).toBe(NO_CHANGE);
	});

	it("gives live settings back the running preset's values without waiting", async () => {
		const { quality, changes, settled } = medium();
		quality.set({ maxPixelRatio: 1 });
		await quality.setPreset('medium');
		expect(quality.settings).toEqual(MEDIUM);
		expect(changes.at(-1)).toEqual(['maxPixelRatio']);
		expect(settled.count).toBe(0);
		expect(quality.takeRestart()).toBe(false);
	});

	it('refuses a name that is no preset with E1213, and changes nothing', () => {
		const { quality, applied } = medium();
		for (const bad of ['auto', 'Low', 'epic', 2])
			expect(() => quality.setPreset(bad as QualityPreset)).toThrow('E1213');
		expect(() => quality.setPreset('epic' as QualityPreset)).toThrow(
			"quality.setPreset() got the preset \"epic\", which is not 'low', 'medium', 'high' or 'ultra'.",
		);
		expect(quality.preset).toBe('medium');
		expect(applied).toEqual([]);
	});

	it("puts back the preset's values of the settings that set changed", async () => {
		const { quality } = medium();
		quality.set({ maxAnisotropy: 16 });
		await quality.setPreset('low');
		expect(quality.settings).toEqual(presetSettings('low'));
		// The sketch's choice ended with the preset change, so the check's lower preset applies.
		await quality.lower();
		expect(quality.settings.maxAnisotropy).toBe(presetSettings('low').maxAnisotropy);
	});

	it('gives the page the preset check with the preset it chose, and changes no setting', () => {
		const { quality, applied, changes } = medium();
		const check = {
			from: 'high' as const,
			targetFps: 60,
			rounds: [{ preset: 'medium' as const, presentedFps: 60, completedFps: 60 }],
		};
		quality.report(check);
		expect(applied).toEqual([{ preset: 'medium', settings: MEDIUM, check }]);
		expect(changes).toEqual([[]]);
	});
});
