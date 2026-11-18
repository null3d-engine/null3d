// The byte and text hashes of the plant core. The integer hash they build on is the grass
// package's, whose own tests hold it to the shaders' pcg.
import { describe, expect, test } from 'bun:test';
import { hashBytes, hashText } from './hash';

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
