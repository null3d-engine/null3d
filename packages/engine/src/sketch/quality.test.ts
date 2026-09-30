import { beforeEach, describe, expect, it } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import { type QualityPreset, type QualitySettings, SKETCH_SETTINGS } from '../quality/presets';
import {
	NO_CHANGE,
	PRESET_CHANGE,
	type QualityStart,
	type QualityUpdate,
	SETTINGS_CHANGE,
	SketchQuality,
} from './quality';

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

/**
 * A sketch's quality API on Medium, with the page's options and highest preset from `start`, the
 * updates that it gave the page, and the times that it waited for a new preset's frame.
 */
function medium(start: Partial<QualityStart> = {}) {
	const applied: QualityUpdate[] = [];
	const settled = { count: 0 };
	const quality = new SketchQuality(
		{
			preset: 'medium',
			settings: { maxPixelRatio: 2 },
			options: {},
			highest: 'ultra',
			...start,
		},
		(update) => applied.push(update),
		async () => {
			settled.count++;
		},
	);
	return { quality, applied, settled };
}

describe('SketchQuality', () => {
	it('starts with the preset and the settings that the page chose', () => {
		const { quality, applied } = medium();
		expect(quality.preset).toBe('medium');
		expect(quality.settings).toEqual({ maxPixelRatio: 2 });
		expect(quality.takeChange()).toBe(NO_CHANGE);
		expect(quality.takeRestart()).toBe(false);
		expect(applied).toEqual([]);
	});

	it('changes a setting, gives the page the new settings, and notes one change for the next frame', () => {
		const { quality, applied } = medium();
		quality.set({ maxPixelRatio: 1.25 });
		expect(quality.settings.maxPixelRatio).toBe(1.25);
		expect(applied).toEqual([{ preset: 'medium', settings: { maxPixelRatio: 1.25 } }]);
		expect(quality.takeChange()).toBe(SETTINGS_CHANGE);
		expect(quality.takeChange()).toBe(NO_CHANGE);
		expect(quality.takeRestart()).toBe(false);
	});

	it('gives the page a copy, which later changes leave alone', () => {
		const { quality, applied } = medium();
		quality.set({ maxPixelRatio: 1 });
		quality.set({ maxPixelRatio: Number.POSITIVE_INFINITY });
		expect(applied.map((update) => update.settings)).toEqual([
			{ maxPixelRatio: 1 },
			{ maxPixelRatio: Number.POSITIVE_INFINITY },
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
		expect(() => quality.set({ antialias: 'fxaa' } as Partial<QualitySettings>)).toThrow('E1213');
		expect(quality.settings).toEqual({ maxPixelRatio: 2 });
		expect(applied).toEqual([]);
		expect(quality.takeChange()).toBe(NO_CHANGE);
	});

	it('keeps the change handlers until their remover runs', () => {
		const { quality } = medium();
		const handler = () => {};
		const remove = quality.onChange(handler);
		expect([...quality.handlers]).toEqual([handler]);
		remove();
		expect(quality.handlers.size).toBe(0);
	});
});

describe('SketchQuality.setPreset', () => {
	it("gives every setting the new preset's value, and waits for the new preset's frame", async () => {
		const { quality, applied, settled } = medium();
		quality.set({ maxPixelRatio: 1 });
		quality.takeChange();
		await quality.setPreset('low');
		expect(quality.preset).toBe('low');
		expect(quality.settings).toEqual({ maxPixelRatio: 1.5 });
		expect(Object.keys(quality.settings)).toEqual([...SKETCH_SETTINGS]);
		expect(applied.at(-1)).toEqual({ preset: 'low', settings: { maxPixelRatio: 1.5 } });
		expect(settled.count).toBe(1);
		// The next frame holds for its pipelines, and its handlers hear of a new preset.
		expect(quality.takeRestart()).toBe(true);
		expect(quality.takeRestart()).toBe(false);
		expect(quality.takeChange()).toBe(PRESET_CHANGE);
	});

	it("keeps the settings that the page's options give", async () => {
		const { quality } = medium({ options: { maxPixelRatio: 1 }, settings: { maxPixelRatio: 1 } });
		await quality.setPreset('ultra');
		expect(quality.settings).toEqual({ maxPixelRatio: 1 });
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

	it('gives the page the preset check with the preset it chose', () => {
		const { quality, applied } = medium();
		const check = {
			from: 'high' as const,
			targetFps: 60,
			rounds: [{ preset: 'medium' as const, presentedFps: 60, completedFps: 60 }],
		};
		quality.report(check);
		expect(applied).toEqual([{ preset: 'medium', settings: { maxPixelRatio: 2 }, check }]);
	});
});
