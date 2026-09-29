import { describe, expect, it } from 'bun:test';
import { maximumPages } from './loader';

/** The limits of a core module that starts at 18 pages and declares 4 GiB. */
const LIMITS = { initial: 18, maximum: 65_536, shared: true };

describe('maximumPages', () => {
	it('turns MiB into 64 KiB pages', () => {
		expect(maximumPages(LIMITS, 256)).toBe(4_096);
		expect(maximumPages(LIMITS, 1_024)).toBe(16_384);
		expect(maximumPages(LIMITS, 4_096)).toBe(65_536);
	});

	it("stays within the module's declared maximum and above its initial size", () => {
		expect(maximumPages(LIMITS, 8_192)).toBe(65_536);
		expect(maximumPages(LIMITS, 1)).toBe(18);
		expect(maximumPages({ ...LIMITS, maximum: null }, 8_192)).toBe(131_072);
	});
});
