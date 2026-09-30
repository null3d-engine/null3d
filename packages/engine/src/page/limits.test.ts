import { describe, expect, it } from 'bun:test';
import * as C from '../generated/core';
import { FORMAT_CANVAS, FORMAT_RG11B10_UFLOAT, FORMAT_RGBA16_FLOAT } from '../generated/gpu';
import type { Tier } from '../render/renderer';
import {
	type AntialiasMode,
	type CoreDevice,
	coreDevice,
	DEPTH_WITHOUT_CLIP_CONTROL,
	type DeviceOptions,
	type DeviceReport,
	maxInstances,
	portableMaxInstances,
	rowLimitWarning,
	sceneColorFormat,
	storageBindingBytes,
	webgl2Depth,
} from './limits';

const MIB = 1024 * 1024;

/** A WebGPU device with this storage binding. */
const webgpu = (storageBindingBytes: number): CoreDevice => ({
	webgl2: false,
	storageBindingBytes,
	capabilities: 0,
	maxTextureSize: 0,
	sharedUploads: true,
	depth: 'reversed',
	parallelCompile: true,
	sceneColor: FORMAT_RGBA16_FLOAT,
	antialias: C.ANTIALIAS_MSAA,
	transparent: false,
});

/** A WebGL2 device that draws RGBA16F targets with the engine's MSAA. */
const HDR_TARGETS = {
	rgba16f: { complete: true, readsBack: true, samples: C.LIMIT_MSAA_SAMPLES },
};

/** A report whose WebGL2 part has these fields, from a device with no optional WebGPU feature. */
function report(webgl2: Partial<DeviceReport['webgl2']>, features: string[] = []): DeviceReport {
	return {
		webgpu: { limits: {}, features, transientAttachments: false },
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
const PLAIN: DeviceOptions = {
	copyUploads: false,
	depth: undefined,
	parallelCompile: true,
	hdr: true,
	antialias: 'msaa',
	transparent: false,
};

/** The scene color format on a tier for a page with the plain options and these changes. */
const formatOn = (tier: Tier, device: DeviceReport, options: Partial<DeviceOptions> = {}) =>
	sceneColorFormat(tier, device, { ...PLAIN, ...options });

describe('sceneColorFormat', () => {
	const small = ['rg11b10ufloat-renderable'];

	it('draws HDR color on core WebGPU, in the small float format where the canvas needs no alpha', () => {
		expect(formatOn('webgpu', report({}))).toBe(FORMAT_RGBA16_FLOAT);
		expect(formatOn('webgpu', report({}, small))).toBe(FORMAT_RG11B10_UFLOAT);
		expect(formatOn('webgpu', report({}, small), { transparent: true })).toBe(FORMAT_RGBA16_FLOAT);
	});

	it('takes the 8-bit path in compatibility mode with MSAA, and where the page turns HDR off', () => {
		expect(formatOn('webgpu-compat', report({}, small))).toBe(FORMAT_CANVAS);
		expect(formatOn('webgpu', report({}, small), { hdr: false })).toBe(FORMAT_CANVAS);
		expect(formatOn('webgl2', report({}), { hdr: false })).toBe(FORMAT_CANVAS);
	});

	it('never asks compatibility mode for a multisampled float target: FXAA and none draw HDR color', () => {
		for (const antialias of ['fxaa', 'none'] as const) {
			expect(formatOn('webgpu-compat', report({}), { antialias })).toBe(FORMAT_RGBA16_FLOAT);
			expect(formatOn('webgpu-compat', report({}, small), { antialias })).toBe(
				FORMAT_RG11B10_UFLOAT,
			);
			expect(formatOn('webgpu-compat', report({}), { antialias, hdr: false })).toBe(FORMAT_CANVAS);
		}
		for (const tier of ['webgpu', 'webgpu-compat', 'webgl2'] as const) {
			const device = coreDevice(tier, report({}), PLAIN);
			const multisampledFloat =
				device.antialias === C.ANTIALIAS_MSAA && device.sceneColor !== FORMAT_CANVAS;
			expect(multisampledFloat).toBe(tier !== 'webgpu-compat');
		}
	});

	it('draws HDR color on WebGL2 only where RGBA16F targets work, with the samples of MSAA', () => {
		expect(formatOn('webgl2', report({}))).toBe(FORMAT_RGBA16_FLOAT);
		const fewSamples = { rgba16f: { ...HDR_TARGETS.rgba16f, samples: 2 } };
		const clipped = { rgba16f: { ...HDR_TARGETS.rgba16f, readsBack: false } };
		for (const floatRenderTargets of [null, fewSamples, clipped])
			expect(formatOn('webgl2', report({ floatRenderTargets }))).toBe(FORMAT_CANVAS);
		// FXAA and no anti-aliasing draw one sample, which every device that renders RGBA16F takes.
		for (const antialias of ['fxaa', 'none'] as const) {
			expect(formatOn('webgl2', report({ floatRenderTargets: fewSamples }), { antialias })).toBe(
				FORMAT_RGBA16_FLOAT,
			);
			expect(formatOn('webgl2', report({ floatRenderTargets: clipped }), { antialias })).toBe(
				FORMAT_CANVAS,
			);
		}
	});

	it('reaches the core with the canvas transparency and the anti-aliasing mode', () => {
		const device = coreDevice('webgpu', report({}, small), { ...PLAIN, transparent: true });
		expect([device.sceneColor, device.transparent]).toEqual([FORMAT_RGBA16_FLOAT, true]);
		expect(coreDevice('webgl2', report({}), PLAIN).sceneColor).toBe(FORMAT_RGBA16_FLOAT);
		const codes = { none: C.ANTIALIAS_NONE, fxaa: C.ANTIALIAS_FXAA, msaa: C.ANTIALIAS_MSAA };
		for (const [antialias, code] of Object.entries(codes))
			expect(
				coreDevice('webgpu', report({}), { ...PLAIN, antialias: antialias as AntialiasMode })
					.antialias,
			).toBe(code);
	});

	it('tells the WebGPU core about transient attachments where the browser has them', () => {
		const withThem = report({});
		withThem.webgpu.transientAttachments = true;
		expect(coreDevice('webgpu', withThem, PLAIN).capabilities).toBe(
			C.CAPABILITY_TRANSIENT_ATTACHMENTS,
		);
		expect(coreDevice('webgpu', report({}), PLAIN).capabilities).toBe(0);
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

	it('stops at the sources an index list entry can name, however large the textures', () => {
		const large = coreDevice('webgl2', report({ maxTextureSize: 32768 }), PLAIN);
		expect(maxInstances(large)).toBe(C.LIMIT_WEBGL2_MAX_SOURCES);
		expect(C.LIMIT_WEBGL2_MAX_SOURCES).toBe(C.LIMIT_MATRICES_PER_TEXTURE_ROW * 16384);
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

describe('the warning past the rows that every device of a GPU path draws', () => {
	const smallWebGL2 = coreDevice('webgl2', report({ maxTextureSize: 2048 }), PLAIN);
	const largeWebGL2 = coreDevice('webgl2', report({ maxTextureSize: 16384 }), PLAIN);

	it('comes on WebGL2 past the limit of a device whose textures reach 2,048 pixels', () => {
		expect(maxInstances(smallWebGL2)).toBe(1_048_576);
		expect(portableMaxInstances(true)).toBe(maxInstances(smallWebGL2));
		expect(rowLimitWarning(1_048_576, true)).toBeUndefined();
		const warning = rowLimitWarning(1_048_577, true);
		expect(warning).toContain('1,048,577 objects and instance rows');
		expect(warning).toContain('textures reach only 2,048 pixels draw at most 1,048,576');
	});

	it('comes before a larger WebGL2 device reaches its own limit, where it can show', () => {
		const largeLimit = maxInstances(largeWebGL2);
		expect(largeLimit).toBe(C.LIMIT_WEBGL2_MAX_SOURCES);
		expect(rowLimitWarning(largeLimit, true)).toBeDefined();
		expect(rowLimitWarning(2_097_152, true)).toBeDefined();
	});

	it('comes on WebGPU past the limit of a device with the default storage binding', () => {
		const portable = webgpu(C.LIMIT_PORTABLE_STORAGE_BINDING_BYTES);
		expect(portableMaxInstances(false)).toBe(maxInstances(portable));
		expect(portableMaxInstances(false)).toBe(C.LIMIT_PORTABLE_MAX_SOURCES);
		expect(rowLimitWarning(C.LIMIT_PORTABLE_MAX_SOURCES, false)).toBeUndefined();
		expect(rowLimitWarning(C.LIMIT_PORTABLE_MAX_SOURCES + 1, false)).toContain(
			"devices with WebGPU's default limits draw at most 2,097,152",
		);
	});
});

describe('the depth mode', () => {
	const clipControl = report({ extensions: { EXT_clip_control: true } });

	it('is reversed on WebGPU, and on WebGL2 where the browser has EXT_clip_control', () => {
		expect(coreDevice('webgpu', report({}), PLAIN).depth).toBe('reversed');
		expect(coreDevice('webgl2', clipControl, PLAIN).depth).toBe('reversed');
		expect(coreDevice('webgl2', report({}), PLAIN).depth).toBe(DEPTH_WITHOUT_CLIP_CONTROL);
	});

	it('follows ?depth= on WebGL2, but never to reversed depth without EXT_clip_control', () => {
		for (const wanted of ['reversed', 'reversed-gl', 'standard'] as const)
			expect(coreDevice('webgl2', clipControl, { ...PLAIN, depth: wanted }).depth).toBe(wanted);
		expect(webgl2Depth(false, 'standard')).toBe('standard');
		expect(webgl2Depth(false, 'reversed-gl')).toBe('reversed-gl');
		expect(webgl2Depth(false, 'reversed')).toBe(DEPTH_WITHOUT_CLIP_CONTROL);
		expect(coreDevice('webgpu', report({}), { ...PLAIN, depth: 'standard' }).depth).toBe(
			'reversed',
		);
	});
});

describe('background compiles', () => {
	it('stay on unless ?compile=wait turns them off', () => {
		expect(coreDevice('webgl2', report({}), PLAIN).parallelCompile).toBe(true);
		const wait: DeviceOptions = { ...PLAIN, parallelCompile: false };
		expect(coreDevice('webgl2', report({}), wait).parallelCompile).toBe(false);
	});
});
