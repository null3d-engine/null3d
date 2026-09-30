import { describe, expect, it } from 'bun:test';
import type { Tier } from '../shared/tier';
import {
	afterCrashes,
	choosePreset,
	crashTier,
	type DeviceHints,
	deviceKind,
	hintedPreset,
	memoryPreset,
	type PresetRequest,
	TABLET_MIN_EDGE,
} from './chooser';
import type { QualityPreset } from './presets';

/** Device hints, with a fine pointer, a laptop's screen and no memory reading unless given. */
const hints = (given: Partial<DeviceHints> = {}): DeviceHints => ({
	coarsePointer: false,
	screenMinEdge: 900,
	deviceMemoryGB: null,
	...given,
});

/** A request to choose a preset: auto, with no crashed start, unless given. */
const request = (given: Partial<PresetRequest> = {}): PresetRequest => ({
	wanted: 'auto',
	hints: hints(),
	crashedStarts: 0,
	...given,
});

describe('deviceKind and hintedPreset', () => {
	// Screens in CSS pixels; Chrome reports memory, Safari and Firefox report none.
	const devices: [name: string, hints: DeviceHints, kind: string, preset: QualityPreset][] = [
		[
			'a phone held upright',
			hints({ coarsePointer: true, screenMinEdge: 384, deviceMemoryGB: 8 }),
			'phone',
			'low',
		],
		['a large phone', hints({ coarsePointer: true, screenMinEdge: 440 }), 'phone', 'low'],
		[
			'a phone just under the edge',
			hints({ coarsePointer: true, screenMinEdge: TABLET_MIN_EDGE - 1 }),
			'phone',
			'low',
		],
		[
			'a small tablet',
			hints({ coarsePointer: true, screenMinEdge: TABLET_MIN_EDGE }),
			'tablet',
			'medium',
		],
		['an 11-inch tablet', hints({ coarsePointer: true, screenMinEdge: 834 }), 'tablet', 'medium'],
		['a 13-inch tablet', hints({ coarsePointer: true, screenMinEdge: 1024 }), 'tablet', 'medium'],
		['a laptop', hints({ screenMinEdge: 982 }), 'desktop', 'high'],
		[
			'a desktop with a 4K screen',
			hints({ screenMinEdge: 2160, deviceMemoryGB: 8 }),
			'desktop',
			'high',
		],
		['a narrow desktop window on a small screen', hints({ screenMinEdge: 400 }), 'desktop', 'high'],
		[
			'a touch laptop whose main pointer is its trackpad',
			hints({ screenMinEdge: 800 }),
			'desktop',
			'high',
		],
	];

	for (const [name, device, kind, preset] of devices) {
		it(`calls ${name} a ${kind}, which starts at ${preset}`, () => {
			expect(deviceKind(device)).toBe(kind as ReturnType<typeof deviceKind>);
			expect(hintedPreset(device)).toBe(preset);
		});
	}

	it('lowers the preset by one for a memory reading under 4 GB', () => {
		expect(hintedPreset(hints({ deviceMemoryGB: 2 }))).toBe('medium');
		expect(
			hintedPreset(hints({ coarsePointer: true, screenMinEdge: 800, deviceMemoryGB: 2 })),
		).toBe('low');
		expect(
			hintedPreset(hints({ coarsePointer: true, screenMinEdge: 380, deviceMemoryGB: 0.5 })),
		).toBe('low');
	});

	it('never raises the preset for more memory, and ignores a missing reading', () => {
		expect(hintedPreset(hints({ deviceMemoryGB: 4 }))).toBe('high');
		expect(hintedPreset(hints({ deviceMemoryGB: 8 }))).toBe('high');
		expect(
			hintedPreset(hints({ coarsePointer: true, screenMinEdge: 380, deviceMemoryGB: 8 })),
		).toBe('low');
		expect(hintedPreset(hints({ deviceMemoryGB: null }))).toBe('high');
	});
});

describe('choosePreset', () => {
	it("caps the preset at each GPU path's highest", () => {
		const tiers: [Tier, QualityPreset][] = [
			['webgpu', 'ultra'],
			['webgpu-compat', 'medium'],
			['webgl2', 'medium'],
		];
		for (const [tier, highest] of tiers) {
			expect(choosePreset(request({ wanted: 'ultra' }), tier)).toBe(highest);
			expect(choosePreset(request({ wanted: 'low' }), tier)).toBe('low');
		}
		expect(choosePreset(request(), 'webgpu')).toBe('high');
		expect(choosePreset(request(), 'webgl2')).toBe('medium');
	});

	it('takes the preset that the page names over the hints', () => {
		const phone = hints({ coarsePointer: true, screenMinEdge: 390 });
		expect(choosePreset(request({ wanted: 'high', hints: phone }), 'webgpu')).toBe('high');
		expect(choosePreset(request({ wanted: 'low' }), 'webgpu')).toBe('low');
	});

	it('starts one preset lower after a crashed start, and at low after two', () => {
		expect(choosePreset(request({ crashedStarts: 1 }), 'webgpu')).toBe('medium');
		expect(choosePreset(request({ crashedStarts: 2 }), 'webgpu')).toBe('low');
		expect(choosePreset(request({ crashedStarts: 5 }), 'webgpu')).toBe('low');
		expect(choosePreset(request({ wanted: 'ultra', crashedStarts: 1 }), 'webgpu')).toBe('high');
	});

	it('lowers the capped preset after a crash, so the start after it runs lighter than the one that crashed', () => {
		// A desktop runs medium on WebGL2, so a crash there moves it to low.
		expect(choosePreset(request({ crashedStarts: 1 }), 'webgl2')).toBe('low');
		expect(choosePreset(request({ wanted: 'ultra', crashedStarts: 1 }), 'webgpu-compat')).toBe(
			'low',
		);
	});

	it('picks the expected preset on each device and browser of the team', () => {
		const mac = hints({ screenMinEdge: 982, deviceMemoryGB: 8 });
		const macWithoutReading = hints({ screenMinEdge: 982 });
		const iPad = hints({ coarsePointer: true, screenMinEdge: 834 });
		const galaxy = hints({ coarsePointer: true, screenMinEdge: 384, deviceMemoryGB: 8 });
		const cases: [name: string, hints: DeviceHints, tier: Tier, preset: QualityPreset][] = [
			['the MacBook Pro in Chrome and Brave', mac, 'webgpu', 'high'],
			['the MacBook Pro in Safari and Firefox', macWithoutReading, 'webgpu', 'high'],
			['the MacBook Pro with WebGL2 forced', mac, 'webgl2', 'medium'],
			['the MacBook Pro in compatibility mode', mac, 'webgpu-compat', 'medium'],
			['the iPad Pro in Safari and Brave', iPad, 'webgpu', 'medium'],
			['the iPad Pro with WebGL2 forced', iPad, 'webgl2', 'medium'],
			['the Galaxy S24+ in Chrome and Brave', galaxy, 'webgl2', 'low'],
		];
		for (const [name, device, tier, preset] of cases)
			expect([name, choosePreset(request({ hints: device }), tier)]).toEqual([name, preset]);
	});
});

describe('memoryPreset', () => {
	it("follows the hints and the crashes, but not the GPU path's ceiling", () => {
		expect(memoryPreset(request())).toBe('high');
		expect(memoryPreset(request({ wanted: 'ultra' }))).toBe('ultra');
		expect(
			memoryPreset(request({ hints: hints({ coarsePointer: true, screenMinEdge: 390 }) })),
		).toBe('low');
	});

	it('is one preset lower after a crashed start, and low after two', () => {
		expect(memoryPreset(request({ crashedStarts: 1 }))).toBe('medium');
		expect(memoryPreset(request({ crashedStarts: 2 }))).toBe('low');
	});
});

describe('afterCrashes', () => {
	it('never goes below low', () => {
		expect(afterCrashes('low', 1)).toBe('low');
		expect(afterCrashes('medium', 1)).toBe('low');
		expect(afterCrashes('ultra', 0)).toBe('ultra');
	});
});

describe('crashTier', () => {
	it('starts on WebGL2 after two crashed starts on WebGPU', () => {
		expect(crashTier(2, 'webgpu')).toBe('webgl2');
		expect(crashTier(3, 'webgpu-compat')).toBe('webgl2');
	});

	it('leaves the GPU path alone after fewer crashes, or when the last crash was on WebGL2', () => {
		expect(crashTier(0, null)).toBeUndefined();
		expect(crashTier(1, 'webgpu')).toBeUndefined();
		expect(crashTier(2, 'webgl2')).toBeUndefined();
		expect(crashTier(2, null)).toBeUndefined();
	});
});
