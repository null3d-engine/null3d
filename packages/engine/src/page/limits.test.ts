import { describe, expect, it } from 'bun:test';
import * as C from '../generated/core';
import { FORMAT_CANVAS, FORMAT_RG11B10_UFLOAT, FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import {
	type CoreDevice,
	coreDevice,
	type DeviceOptions,
	type DeviceReport,
	maxInstances,
	sceneColorFormat,
	storageBindingBytes,
} from './limits';

const MIB = 1024 * 1024;

/** A WebGPU device with this storage binding. */
const webgpu = (storageBindingBytes: number): CoreDevice => ({
	webgl2: false,
	storageBindingBytes,
	capabilities: 0,
	maxTextureSize: 0,
	sharedUploads: true,
	sceneColor: FORMAT_RGBA16_FLOAT,
	transparent: false,
});

/** A WebGL2 device that draws RGBA16F targets with the engine's MSAA. */
const HDR_TARGETS = {
	rgba16f: { complete: true, readsBack: true, samples: C.LIMIT_MSAA_SAMPLES },
};

/** A report whose WebGL2 part has these fields, from a device with no optional WebGPU feature. */
function report(webgl2: Partial<DeviceReport['webgl2']>, features: string[] = []): DeviceReport {
	return {
		webgpu: { limits: {}, features },
		webgl2: {
			extensions: {},
			maxTextureSize: 4096,
			sharedMemoryUploads: { bufferSubData: true, texSubImage2D: true },
			floatRenderTargets: HDR_TARGETS,
			...webgl2,
		},
	};
}

/** The options of a page that asks for nothing special. */
const PLAIN: DeviceOptions = { copyUploads: false, hdr: true, transparent: false };

describe('sceneColorFormat', () => {
	const small = ['rg11b10ufloat-renderable'];

	it('draws HDR color on core WebGPU, in the small float format where the canvas needs no alpha', () => {
		expect(sceneColorFormat('webgpu', report({}), true, false)).toBe(FORMAT_RGBA16_FLOAT);
		expect(sceneColorFormat('webgpu', report({}, small), true, false)).toBe(FORMAT_RG11B10_UFLOAT);
		expect(sceneColorFormat('webgpu', report({}, small), true, true)).toBe(FORMAT_RGBA16_FLOAT);
	});

	it('takes the 8-bit path in compatibility mode, and where the page turns HDR off', () => {
		expect(sceneColorFormat('webgpu-compat', report({}, small), true, false)).toBe(FORMAT_CANVAS);
		expect(sceneColorFormat('webgpu', report({}, small), false, false)).toBe(FORMAT_CANVAS);
		expect(sceneColorFormat('webgl2', report({}), false, false)).toBe(FORMAT_CANVAS);
	});

	it('draws HDR color on WebGL2 only where RGBA16F targets work with the MSAA the engine uses', () => {
		expect(sceneColorFormat('webgl2', report({}), true, false)).toBe(FORMAT_RGBA16_FLOAT);
		const fewSamples = { rgba16f: { ...HDR_TARGETS.rgba16f, samples: 2 } };
		const clipped = { rgba16f: { ...HDR_TARGETS.rgba16f, readsBack: false } };
		for (const floatRenderTargets of [null, fewSamples, clipped])
			expect(sceneColorFormat('webgl2', report({ floatRenderTargets }), true, false)).toBe(
				FORMAT_CANVAS,
			);
	});

	it('reaches the core with the canvas transparency', () => {
		const device = coreDevice('webgpu', report({}, small), { ...PLAIN, transparent: true });
		expect([device.sceneColor, device.transparent]).toEqual([FORMAT_RGBA16_FLOAT, true]);
		expect(coreDevice('webgl2', report({}), PLAIN).sceneColor).toBe(FORMAT_RGBA16_FLOAT);
	});
});

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
	const copied: DeviceOptions = { ...PLAIN, copyUploads: true };

	it('sizes the scene by the texture size, never below what every device allows', () => {
		const device = coreDevice('webgl2', report({ maxTextureSize: 8192 }), PLAIN);
		expect(maxInstances(device)).toBe(C.LIMIT_MATRICES_PER_TEXTURE_ROW * 8192);
		const small = coreDevice('webgl2', report({ maxTextureSize: 1024 }), PLAIN);
		expect(small.maxTextureSize).toBe(C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE);
	});

	it('passes multi-draw to the core only where the extension exists', () => {
		const withIt = report({ extensions: { WEBGL_multi_draw: true } });
		expect(coreDevice('webgl2', withIt, PLAIN).capabilities).toBe(C.CAPABILITY_MULTI_DRAW);
		expect(coreDevice('webgl2', report({}), PLAIN).capabilities).toBe(0);
	});

	it('reads shared memory only where WebGL accepts it for both kinds of upload', () => {
		expect(coreDevice('webgl2', report({}), PLAIN).sharedUploads).toBe(true);
		expect(coreDevice('webgl2', report({}), copied).sharedUploads).toBe(false);
		const noTextures = report({
			sharedMemoryUploads: { bufferSubData: true, texSubImage2D: false },
		});
		expect(coreDevice('webgl2', noTextures, PLAIN).sharedUploads).toBe(false);
		expect(coreDevice('webgl2', report({ sharedMemoryUploads: null }), PLAIN).sharedUploads).toBe(
			false,
		);
	});
});
