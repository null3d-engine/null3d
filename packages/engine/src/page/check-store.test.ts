import { describe, expect, it } from 'bun:test';
import type { PresetCheck } from '../quality/check';
import type { CapabilityReport } from './capabilities';
import {
	CheckStore,
	checkConditions,
	reusableCheck,
	STORED_CHECK_AREA_RATIO,
	STORED_CHECK_MS,
} from './check-store';

const SKETCH = 'https://example.com/sketch.js';
const NOW = Date.UTC(2026, 9, 3);
const AREA = 1024 * 768;

/** A check that lowered High to Medium against the highest target. */
const CHECK: PresetCheck = {
	from: 'high',
	targetFps: 60,
	rounds: [
		{ preset: 'high', presentedFps: 41.5, completedFps: 40.2 },
		{ preset: 'medium', presentedFps: 60, completedFps: 59.8 },
	],
	reused: false,
};

/** A localStorage stand-in that keeps its items in a map, or refuses every call when `blocked`. */
function memoryStorage(blocked = false) {
	const items = new Map<string, string>();
	const refuse = () => {
		throw new Error('SecurityError');
	};
	const storage = {
		getItem: (key: string) => (blocked ? refuse() : (items.get(key) ?? null)),
		setItem: (key: string, value: string) => (blocked ? refuse() : void items.set(key, value)),
	};
	return { items, storage: storage as unknown as Storage };
}

/** The parts of a capability report that the conditions read, on a desktop with one GPU. */
function report(change: Partial<CapabilityReport> = {}): CapabilityReport {
	return {
		coarsePointer: false,
		screenMinEdge: 1080,
		deviceMemoryGB: 8,
		devicePixelRatio: 2,
		hardwareConcurrency: 12,
		webgpu: {
			adapterInfo: { vendor: 'apple', architecture: 'metal-3', device: '', description: '' },
			features: ['float32-filterable'],
			limits: { maxTextureDimension2D: 16384 },
			preferredCanvasFormat: 'bgra8unorm',
		},
		webgl2: {
			renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Max)',
			extensions: { EXT_color_buffer_float: true },
			maxSamples: 4,
			maxTextureSize: 16384,
			floatRenderTargets: null,
		},
		...change,
	} as CapabilityReport;
}

const CONDITIONS = checkConditions(report(), 'webgpu', 'high', undefined, 60);

/** A store for a start under `conditions`, with a canvas of `area`, in `storage`. */
const store = (storage: Storage, conditions = CONDITIONS, area = AREA) =>
	new CheckStore(SKETCH, conditions, area, storage);

describe('CheckStore', () => {
	it('gives a later start the result that a start measured, marked as reused', () => {
		const { storage } = memoryStorage();
		expect(store(storage).read(NOW)).toBeUndefined();
		store(storage).save(CHECK, 60, NOW);
		expect(store(storage).read(NOW + 1000)).toEqual({ ...CHECK, reused: true });
	});

	it('keeps one result for each sketch', () => {
		const { storage } = memoryStorage();
		store(storage).save(CHECK, 60, NOW);
		expect(new CheckStore(`${SKETCH}?n=2`, CONDITIONS, AREA, storage).read(NOW)).toBeUndefined();
	});

	it('stores no result that a start reused, and none against a lowered target', () => {
		const { items, storage } = memoryStorage();
		store(storage).save({ ...CHECK, reused: true }, 60, NOW);
		store(storage).save({ ...CHECK, targetFps: 30 }, 60, NOW);
		expect(items.size).toBe(0);
		// A frame rate cap lowers the highest target with it.
		store(storage).save({ ...CHECK, targetFps: 30 }, 30, NOW);
		expect(items.size).toBe(1);
	});

	it("stores a check of the display's full rate from 60 frames a second up", () => {
		const { items, storage } = memoryStorage();
		const display = Number.POSITIVE_INFINITY;
		const conditions = checkConditions(report(), 'webgpu', 'high', undefined, display);
		store(storage, conditions).save({ ...CHECK, targetFps: 30 }, display, NOW);
		expect(items.size).toBe(0);
		store(storage, conditions).save({ ...CHECK, targetFps: 120 }, display, NOW);
		expect(store(storage, conditions).read(NOW)?.targetFps).toBe(120);
		// A start that defends another rate measures again.
		expect(store(storage).read(NOW)).toBeUndefined();
	});

	it('stores and reads nothing for a canvas without an area', () => {
		const { items, storage } = memoryStorage();
		store(storage, CONDITIONS, 0).save(CHECK, 60, NOW);
		expect(items.size).toBe(0);
		store(storage).save(CHECK, 60, NOW);
		expect(store(storage, CONDITIONS, 0).read(NOW)).toBeUndefined();
	});

	it('counts storage that the browser refuses as empty', () => {
		const { storage } = memoryStorage(true);
		expect(() => store(storage).save(CHECK, 60, NOW)).not.toThrow();
		expect(store(storage).read(NOW)).toBeUndefined();
		expect(new CheckStore(SKETCH, CONDITIONS, AREA, undefined).read(NOW)).toBeUndefined();
	});
});

describe('reusableCheck', () => {
	const stored = (change: object = {}) =>
		JSON.stringify({ conditions: CONDITIONS, area: AREA, savedAt: NOW, check: CHECK, ...change });

	it('applies for a week after the check', () => {
		expect(reusableCheck(stored(), CONDITIONS, AREA, NOW + STORED_CHECK_MS - 1)).toBeDefined();
		expect(reusableCheck(stored(), CONDITIONS, AREA, NOW + STORED_CHECK_MS)).toBeUndefined();
		// A clock that went back cannot date the result.
		expect(reusableCheck(stored(), CONDITIONS, AREA, NOW - 1)).toBeUndefined();
	});

	it('applies to a canvas close to the measured size only', () => {
		const inside = STORED_CHECK_AREA_RATIO * 0.99;
		const outside = STORED_CHECK_AREA_RATIO * 1.01;
		expect(reusableCheck(stored(), CONDITIONS, AREA * inside, NOW)).toBeDefined();
		expect(reusableCheck(stored(), CONDITIONS, AREA / inside, NOW)).toBeDefined();
		expect(reusableCheck(stored(), CONDITIONS, AREA * outside, NOW)).toBeUndefined();
		expect(reusableCheck(stored(), CONDITIONS, AREA / outside, NOW)).toBeUndefined();
	});

	it('applies under the same conditions only', () => {
		const other = checkConditions(report(), 'webgpu', 'medium', undefined, 60);
		expect(reusableCheck(stored(), other, AREA, NOW)).toBeUndefined();
	});

	it('ignores text that is not a stored check', () => {
		for (const text of [
			null,
			'',
			'{',
			'null',
			'[]',
			stored({ area: '1' }),
			stored({ check: { ...CHECK, rounds: [] } }),
			stored({ check: { ...CHECK, from: 'epic' } }),
			stored({ check: { ...CHECK, rounds: [{ preset: 'low', presentedFps: '60' }] } }),
		])
			expect(reusableCheck(text, CONDITIONS, AREA, NOW)).toBeUndefined();
	});
});

describe('checkConditions', () => {
	it('changes with the GPU path, the start preset, the frame rate cap, the target and the device', () => {
		const variants = [
			checkConditions(report(), 'webgl2', 'high', undefined, 60),
			checkConditions(report(), 'webgpu', 'medium', undefined, 60),
			checkConditions(report(), 'webgpu', 'high', 30, 60),
			checkConditions(report(), 'webgpu', 'high', undefined, 120),
			checkConditions(report(), 'webgpu', 'high', undefined, Number.POSITIVE_INFINITY),
			checkConditions(report({ devicePixelRatio: 1 }), 'webgpu', 'high', undefined, 60),
			checkConditions(report({ screenMinEdge: 1440 }), 'webgpu', 'high', undefined, 60),
			checkConditions(
				report({ webgpu: { ...report().webgpu, adapterInfo: null } }),
				'webgpu',
				'high',
				undefined,
				60,
			),
		];
		expect(new Set([CONDITIONS, ...variants]).size).toBe(variants.length + 1);
	});

	it("reads only the GPU path's own report", () => {
		const otherWebgl2 = report({ webgl2: { ...report().webgl2, renderer: 'another GPU' } });
		expect(checkConditions(otherWebgl2, 'webgpu', 'high', undefined, 60)).toBe(CONDITIONS);
		expect(checkConditions(otherWebgl2, 'webgl2', 'high', undefined, 60)).not.toBe(
			checkConditions(report(), 'webgl2', 'high', undefined, 60),
		);
	});
});
