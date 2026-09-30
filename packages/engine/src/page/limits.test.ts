import { describe, expect, it } from 'bun:test';
import * as C from '../generated/core';
import {
	coreDevice,
	DEPTH_WITHOUT_CLIP_CONTROL,
	type DeviceReport,
	maxInstances,
	storageBindingBytes,
	webgl2Depth,
} from './limits';

const MIB = 1024 * 1024;

/** A WebGPU device with this storage binding. */
const webgpu = (storageBindingBytes: number) => ({
	webgl2: false,
	storageBindingBytes,
	capabilities: 0,
	maxTextureSize: 0,
	sharedUploads: true,
	depth: 'reversed' as const,
});

/** No test switch. */
const NO_SWITCHES = { copyUploads: false, depth: undefined };
/** ?uploads=copy. */
const COPY_UPLOADS = { copyUploads: true, depth: undefined };

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
		const device = coreDevice(true, report({ maxTextureSize: 8192 }), NO_SWITCHES);
		expect(maxInstances(device)).toBe(C.LIMIT_MATRICES_PER_TEXTURE_ROW * 8192);
		const small = coreDevice(true, report({ maxTextureSize: 1024 }), NO_SWITCHES);
		expect(small.maxTextureSize).toBe(C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE);
	});

	it('stops at the sources an index list entry can name, however large the textures', () => {
		const large = coreDevice(true, report({ maxTextureSize: 32768 }), NO_SWITCHES);
		expect(maxInstances(large)).toBe(C.LIMIT_WEBGL2_MAX_SOURCES);
		expect(C.LIMIT_WEBGL2_MAX_SOURCES).toBe(C.LIMIT_MATRICES_PER_TEXTURE_ROW * 16384);
	});

	it('passes multi-draw to the core only where the extension exists', () => {
		const withIt = report({ extensions: { WEBGL_multi_draw: true } });
		expect(coreDevice(true, withIt, NO_SWITCHES).capabilities).toBe(C.CAPABILITY_MULTI_DRAW);
		expect(coreDevice(true, report({}), NO_SWITCHES).capabilities).toBe(0);
	});

	it('reads shared memory only where WebGL accepts it for both kinds of upload', () => {
		expect(coreDevice(true, report({}), NO_SWITCHES).sharedUploads).toBe(true);
		expect(coreDevice(true, report({}), COPY_UPLOADS).sharedUploads).toBe(false);
		const noTextures = report({
			sharedMemoryUploads: { bufferSubData: true, texSubImage2D: false },
		});
		expect(coreDevice(true, noTextures, NO_SWITCHES).sharedUploads).toBe(false);
		expect(coreDevice(true, report({ sharedMemoryUploads: null }), NO_SWITCHES).sharedUploads).toBe(
			false,
		);
	});
});

describe('the depth mode', () => {
	const clipControl = report({ extensions: { EXT_clip_control: true } });

	it('is reversed on WebGPU, and on WebGL2 where the browser has EXT_clip_control', () => {
		expect(coreDevice(false, report({}), NO_SWITCHES).depth).toBe('reversed');
		expect(coreDevice(true, clipControl, NO_SWITCHES).depth).toBe('reversed');
		expect(coreDevice(true, report({}), NO_SWITCHES).depth).toBe(DEPTH_WITHOUT_CLIP_CONTROL);
	});

	it('follows ?depth= on WebGL2, but never to reversed depth without EXT_clip_control', () => {
		for (const wanted of ['reversed', 'reversed-gl', 'standard'] as const)
			expect(coreDevice(true, clipControl, { copyUploads: false, depth: wanted }).depth).toBe(
				wanted,
			);
		expect(webgl2Depth(false, 'standard')).toBe('standard');
		expect(webgl2Depth(false, 'reversed-gl')).toBe('reversed-gl');
		expect(webgl2Depth(false, 'reversed')).toBe(DEPTH_WITHOUT_CLIP_CONTROL);
		expect(coreDevice(false, report({}), { copyUploads: false, depth: 'standard' }).depth).toBe(
			'reversed',
		);
	});
});
