import { describe, expect, it } from 'bun:test';
import * as C from '../generated/core';
import { maxInstances, storageBindingBytes } from './limits';

const MIB = 1024 * 1024;

describe('storageBindingBytes', () => {
	it('keeps WebGPU default where the adapter offers no more, or reports nothing', () => {
		const portable = C.LIMIT_PORTABLE_STORAGE_BINDING_BYTES;
		expect(storageBindingBytes({})).toBe(portable);
		expect(
			storageBindingBytes({ maxStorageBufferBindingSize: 128 * MIB, maxBufferSize: 256 * MIB }),
		).toBe(portable);
		expect(maxInstances(portable)).toBe(C.LIMIT_PORTABLE_MAX_SOURCES);
	});

	it('takes what the adapter offers for both a binding and a buffer, on 256-byte steps', () => {
		expect(
			storageBindingBytes({ maxStorageBufferBindingSize: 1024 * MIB, maxBufferSize: 256 * MIB }),
		).toBe(256 * MIB);
		expect(
			storageBindingBytes({
				maxStorageBufferBindingSize: 256 * MIB + 100,
				maxBufferSize: 1024 * MIB,
			}),
		).toBe(256 * MIB);
		expect(maxInstances(256 * MIB)).toBe(2 * C.LIMIT_PORTABLE_MAX_SOURCES);
	});

	it('stops at the most one culling dispatch can draw, however much the adapter offers', () => {
		const huge = { maxStorageBufferBindingSize: 4294967292, maxBufferSize: 4294967292 };
		expect(storageBindingBytes(huge)).toBe(C.LIMIT_MAX_USEFUL_BINDING_BYTES);
		expect(maxInstances(storageBindingBytes(huge))).toBe(65535 * 128);
	});
});
