import { beforeEach, describe, expect, it } from 'bun:test';
import { setErrorFixes } from '../errors/engine-error';
import { ERROR_FIXES } from '../errors/fixes';
import type { QualitySettings } from '../quality/presets';
import { SketchQuality } from './quality';

// The page sets the table of fixes that ends each error's message before it can raise an error.
beforeEach(() => setErrorFixes(ERROR_FIXES));

/** Medium's settings. */
const MEDIUM: QualitySettings = { maxPixelRatio: 2, minRenderScale: 0.6, maxRenderScale: 1 };

/** A sketch's quality API on Medium, and the settings that it gave the page. */
function medium() {
	const applied: QualitySettings[] = [];
	let scale = 0.8;
	const quality = new SketchQuality(
		{ preset: 'medium', settings: MEDIUM },
		(settings) => applied.push(settings),
		() => scale,
	);
	return { quality, applied, setScale: (to: number) => (scale = to) };
}

describe('SketchQuality', () => {
	it('starts with the preset and the settings that the page chose', () => {
		const { quality, applied } = medium();
		expect(quality.preset).toBe('medium');
		expect(quality.settings).toEqual(MEDIUM);
		expect(quality.takeChange()).toBe(false);
		expect(applied).toEqual([]);
	});

	it('changes a setting, gives the page the new settings, and notes one change for the next frame', () => {
		const { quality, applied } = medium();
		quality.set({ maxPixelRatio: 1.25 });
		expect(quality.settings.maxPixelRatio).toBe(1.25);
		expect(applied).toEqual([{ ...MEDIUM, maxPixelRatio: 1.25 }]);
		expect(quality.takeChange()).toBe(true);
		expect(quality.takeChange()).toBe(false);
	});

	it('gives the page a copy, which later changes leave alone', () => {
		const { quality, applied } = medium();
		quality.set({ maxPixelRatio: 1 });
		quality.set({ maxPixelRatio: Number.POSITIVE_INFINITY });
		expect(applied).toEqual([
			{ ...MEDIUM, maxPixelRatio: 1 },
			{ ...MEDIUM, maxPixelRatio: Number.POSITIVE_INFINITY },
		]);
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
		expect(() => quality.set({ minRenderScale: 0.2 })).toThrow('E1213');
		expect(() => quality.set({ maxRenderScale: 1.5 })).toThrow('E1213');
		expect(quality.settings).toEqual(MEDIUM);
		expect(applied).toEqual([]);
		expect(quality.takeChange()).toBe(false);
	});

	it('keeps the lowest render scale at or below the highest', () => {
		const { quality, applied } = medium();
		expect(() => quality.set({ maxRenderScale: 0.5 })).toThrow(
			'quality.set() would give minRenderScale 0.6, above maxRenderScale 0.5.',
		);
		expect(() => quality.set({ minRenderScale: 0.9, maxRenderScale: 0.8 })).toThrow('E1213');
		expect(applied).toEqual([]);
		quality.set({ minRenderScale: 0.5, maxRenderScale: 0.5 });
		expect(quality.settings).toEqual({ ...MEDIUM, minRenderScale: 0.5, maxRenderScale: 0.5 });
	});

	it('reads the render scale that the engine draws at', () => {
		const { quality, setScale } = medium();
		expect(quality.renderScale).toBe(0.8);
		setScale(0.65);
		expect(quality.renderScale).toBe(0.65);
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
