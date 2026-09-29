import { describe, expect, it } from 'bun:test';
import * as C from '../generated/core';
import { coreDevice, type DeviceReport, maxInstances, storageBindingBytes } from './limits';

const MIB = 1024 * 1024;

/** A WebGPU device with this storage binding. */
const webgpu = (storageBindingBytes: number) => ({
	webgl2: false,
	storageBindingBytes,
	capabilities: 0,
	maxTextureSize: 0,
	sharedUploads: true,
});

/** A report whose WebGL2 part has these fields. */
function report(webgl2: Partial<DeviceReport['webgl2']>): DeviceReport {
	return {
		webgpu: { limits: {} },
		webgl2: {
			extensions: {},
			maxTextureSize: 4096,
			sharedMemoryUploads: { bufferSubData: true, texSubImage2D: true },
			...webgl2,
		},
	};
}

describe('storageBindingBytes', () => {
	it('keeps WebGPU default where the adapter offers no more, or reports nothing', () => {
		const portable = C.LIMIT_PORTABLE_STORAGE_BINDING_BYTES;
		expect(storageBindingBytes({})).toBe(portable);
		expect(
			storageBindingBytes({ maxStorageBufferBindingSize: 128 * MIB, maxBufferSize: 256 * MIB }),
		).toBe(portable);
		expect(maxInstances(webgpu(portable))).toBe(C.LIMIT_PORTABLE_MAX_SOURCES);
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
		expect(maxInstances(webgpu(256 * MIB))).toBe(2 * C.LIMIT_PORTABLE_MAX_SOURCES);
	});

	it('stops at the most one culling dispatch can draw, however much the adapter offers', () => {
		const huge = { maxStorageBufferBindingSize: 4294967292, maxBufferSize: 4294967292 };
		expect(storageBindingBytes(huge)).toBe(C.LIMIT_MAX_USEFUL_BINDING_BYTES);
		expect(maxInstances(webgpu(storageBindingBytes(huge)))).toBe(65535 * 128);
	});
});

describe('coreDevice on WebGL2', () => {
	it('sizes the scene by the texture size, never below what every device allows', () => {
		const device = coreDevice(true, report({ maxTextureSize: 8192 }), false);
		expect(maxInstances(device)).toBe(C.LIMIT_MATRICES_PER_TEXTURE_ROW * 8192);
		const small = coreDevice(true, report({ maxTextureSize: 1024 }), false);
		expect(small.maxTextureSize).toBe(C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE);
	});

	it('stops at the sources an index list entry can name, however large the textures', () => {
		const large = coreDevice(true, report({ maxTextureSize: 32768 }), false);
		expect(maxInstances(large)).toBe(C.LIMIT_WEBGL2_MAX_SOURCES);
		expect(C.LIMIT_WEBGL2_MAX_SOURCES).toBe(C.LIMIT_MATRICES_PER_TEXTURE_ROW * 16384);
	});

	it('passes multi-draw to the core only where the extension exists', () => {
		const withIt = report({ extensions: { WEBGL_multi_draw: true } });
		expect(coreDevice(true, withIt, false).capabilities).toBe(C.CAPABILITY_MULTI_DRAW);
		expect(coreDevice(true, report({}), false).capabilities).toBe(0);
	});

	it('reads shared memory only where WebGL accepts it for both kinds of upload', () => {
		expect(coreDevice(true, report({}), false).sharedUploads).toBe(true);
		expect(coreDevice(true, report({}), true).sharedUploads).toBe(false);
		const noTextures = report({
			sharedMemoryUploads: { bufferSubData: true, texSubImage2D: false },
		});
		expect(coreDevice(true, noTextures, false).sharedUploads).toBe(false);
		expect(coreDevice(true, report({ sharedMemoryUploads: null }), false).sharedUploads).toBe(
			false,
		);
	});
});
