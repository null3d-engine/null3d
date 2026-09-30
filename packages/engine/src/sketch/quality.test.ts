import { beforeEach, describe, expect, it } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import type { QualitySettings } from '../quality/presets';
import { SketchQuality } from './quality';

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

/** A sketch's quality API on Medium, and the settings that it gave the page. */
function medium() {
	const applied: QualitySettings[] = [];
	const quality = new SketchQuality(
		{ preset: 'medium', settings: { maxPixelRatio: 2 } },
		(settings) => applied.push(settings),
	);
	return { quality, applied };
}

describe('SketchQuality', () => {
	it('starts with the preset and the settings that the page chose', () => {
		const { quality, applied } = medium();
		expect(quality.preset).toBe('medium');
		expect(quality.settings).toEqual({ maxPixelRatio: 2 });
		expect(quality.takeChange()).toBe(false);
		expect(applied).toEqual([]);
	});

	it('changes a setting, gives the page the new settings, and notes one change for the next frame', () => {
		const { quality, applied } = medium();
		quality.set({ maxPixelRatio: 1.25 });
		expect(quality.settings.maxPixelRatio).toBe(1.25);
		expect(applied).toEqual([{ maxPixelRatio: 1.25 }]);
		expect(quality.takeChange()).toBe(true);
		expect(quality.takeChange()).toBe(false);
	});

	it('gives the page a copy, which later changes leave alone', () => {
		const { quality, applied } = medium();
		quality.set({ maxPixelRatio: 1 });
		quality.set({ maxPixelRatio: Number.POSITIVE_INFINITY });
		expect(applied).toEqual([{ maxPixelRatio: 1 }, { maxPixelRatio: Number.POSITIVE_INFINITY }]);
	});

	it('notes no change when a setting keeps its value', () => {
		const { quality, applied } = medium();
		quality.set({ maxPixelRatio: 2 });
		quality.set({});
		quality.set({ maxPixelRatio: undefined });
		expect(applied).toEqual([]);
		expect(quality.takeChange()).toBe(false);
	});

	it('refuses a setting or a value that it does not take with E1213, and changes nothing', () => {
		const { quality, applied } = medium();
		expect(() => quality.set({ maxPixelRatio: 0 })).toThrow('E1213');
		expect(() => quality.set({ antialias: 'fxaa' } as Partial<QualitySettings>)).toThrow('E1213');
		expect(quality.settings).toEqual({ maxPixelRatio: 2 });
		expect(applied).toEqual([]);
		expect(quality.takeChange()).toBe(false);
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
