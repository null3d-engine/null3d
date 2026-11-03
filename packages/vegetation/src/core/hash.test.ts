import { describe, expect, test } from 'bun:test';
import { hashAt, hashBytes, hashText, pcg, unitAt } from './hash';

/** The shaders' pcg, worked out with exact integer arithmetic, for the first values. */
function referencePcg(value: number): number {
	const state = (BigInt(value) * 747796405n + 2891336453n) & 0xffffffffn;
	const shift = Number((state >> 28n) + 4n);
	const word = (((state >> BigInt(shift)) ^ state) * 277803737n) & 0xffffffffn;
	return Number((word >> 22n) ^ word);
}

describe('the integer hash', () => {
	test('gives the same bits as the shaders pcg', () => {
		for (const value of [0, 1, 2, 42, 12345, 0xffffffff, 0x9e3779b9])
			expect(pcg(value)).toBe(referencePcg(value));
	});

	test('stays a 32-bit whole number', () => {
		for (let i = 0; i < 1000; i++) {
			const value = pcg(i * 2654435761);
			expect(Number.isInteger(value)).toBe(true);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(0xffffffff);
		}
	});

	test('gives the same choice for the same seed and keys', () => {
		expect(hashAt(7, 1, 2, 3, 4)).toBe(hashAt(7, 1, 2, 3, 4));
		expect(unitAt(7, 1, 2, 3, 4)).toBe(unitAt(7, 1, 2, 3, 4));
	});

	test('gives a different choice when a key changes', () => {
		const values = new Set<number>();
		for (let key = 0; key < 64; key++) values.add(hashAt(7, key));
		expect(values.size).toBe(64);
	});

	test('gives values in [0, 1)', () => {
		for (let i = 0; i < 10000; i++) {
			const value = unitAt(i, i * 3, i * 7);
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThan(1);
		}
	});

	test('spreads a thousand choices over every tenth of the range', () => {
		const buckets = new Array<number>(10).fill(0);
		for (let i = 0; i < 1000; i++) {
			const bucket = Math.floor(unitAt(11, i) * 10);
			buckets[bucket] = (buckets[bucket] as number) + 1;
		}
		for (const count of buckets) expect(count).toBeGreaterThan(50);
	});
});

describe('the byte and text hashes', () => {
	test('change with any bit and with the length', () => {
		const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
		const base = hashBytes(bytes);
		expect(hashBytes(bytes)).toBe(base);
		const flipped = bytes.slice();
		flipped[5] = 7;
		expect(hashBytes(flipped)).not.toBe(base);
		expect(hashBytes(bytes.subarray(0, 6))).not.toBe(base);
		expect(hashText('oak')).toMatch(/^[0-9a-f]{16}$/);
		expect(hashText('oak')).not.toBe(hashText('oaks'));
	});
});
