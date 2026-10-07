import { describe, expect, it } from 'bun:test';
import * as C from '../generated/core';
import {
	FORMAT_CANVAS,
	FORMAT_RG11B10_UFLOAT,
	FORMAT_RGBA16_FLOAT,
	PERMUTATION_DRAW_INDEX,
	PERMUTATION_HALF,
	PERMUTATION_TONE_MAP,
} from '../generated/gpu';
import type { Tier } from '../render/renderer';
import {
	type AntialiasMode,
	type CoreDevice,
	coreDevice,
	DEPTH_WITHOUT_CLIP_CONTROL,
	type DeviceOptions,
	type DeviceReport,
	effectsOutput,
	maxCanvasSize,
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
	freshShaders: false,
	sceneColor: FORMAT_RGBA16_FLOAT,
	antialias: C.ANTIALIAS_MSAA,
	effectsSceneColor: FORMAT_RGBA16_FLOAT,
	effectsAntialias: C.ANTIALIAS_MSAA,
	occlusionTargets: true,
	transparent: false,
	shaderBits: 0,
	cellCulling: true,
	depthPrepass: false,
	vertexSkinning: false,
	indexInstances: false,
	shadowDepthBits: 16,
	largeWorld: false,
	gpuOcclusion: false,
});

/** A WebGL2 device that draws RGBA16F targets with the engine's MSAA. */
const HDR_TARGETS = {
	rgba16f: { complete: true, readsBack: true, samples: C.LIMIT_MSAA_SAMPLES },
};

/** A report whose WebGL2 part has these fields, and whose WebGPU adapter has these features. */
function report(webgl2: Partial<DeviceReport['webgl2']>, features: string[] = []): DeviceReport {
	return {
		webgpu: { limits: {}, features, transientAttachments: false },
		webgl2: {
			extensions: {},
			maxTextureSize: 4096,
			maxRenderbufferSize: 4096,
			maxViewportDims: [4096, 4096],
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
	freshShaders: false,
	compression: undefined,
	cells: true,
	vertexSkinning: false,
	indexInstances: false,
	shadowDepthBits: 16,
	hdr: true,
	half: undefined,
	antialias: 'msaa',
	transparent: false,
	depthPrepass: false,
	largeWorld: false,
	gpuOcclusion: false,
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

describe('coreDevice on WebGPU', () => {
	it("flags each compressed texture family among the adapter's features", () => {
		const features = ['texture-compression-bc', 'timestamp-query', 'texture-compression-astc'];
		expect(coreDevice('webgpu', report({}, features), PLAIN).capabilities).toBe(
			C.CAPABILITY_TEXTURE_BC | C.CAPABILITY_TEXTURE_ASTC,
		);
		expect(coreDevice('webgpu', report({}), PLAIN).capabilities).toBe(0);
	});

	it('keeps only the families that ?compression= names', () => {
		const all = ['texture-compression-bc', 'texture-compression-etc2', 'texture-compression-astc'];
		const limited = (compression: ('astc' | 'bc' | 'etc2')[]) =>
			coreDevice('webgpu', report({}, all), { ...PLAIN, compression }).capabilities;
		expect(limited(['bc'])).toBe(C.CAPABILITY_TEXTURE_BC);
		expect(limited(['etc2', 'astc'])).toBe(C.CAPABILITY_TEXTURE_ETC2 | C.CAPABILITY_TEXTURE_ASTC);
		expect(limited([])).toBe(0);
		const bcOnly = report({}, ['texture-compression-bc']);
		expect(coreDevice('webgpu', bcOnly, { ...PLAIN, compression: ['astc'] }).capabilities).toBe(0);
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

describe('maxCanvasSize', () => {
	it("keeps to each WebGPU feature level's default texture limit", () => {
		expect(maxCanvasSize('webgpu', report({}))).toBe(8192);
		expect(maxCanvasSize('webgpu-compat', report({}))).toBe(4096);
	});

	it("takes WebGL2's smallest texture, renderbuffer or viewport limit", () => {
		const large: Partial<DeviceReport['webgl2']> = {
			maxTextureSize: 16384,
			maxRenderbufferSize: 16384,
			maxViewportDims: [16384, 16384],
		};
		expect(maxCanvasSize('webgl2', report(large))).toBe(16384);
		expect(maxCanvasSize('webgl2', report({ ...large, maxTextureSize: 8192 }))).toBe(8192);
		expect(maxCanvasSize('webgl2', report({ ...large, maxRenderbufferSize: 8192 }))).toBe(8192);
		expect(maxCanvasSize('webgl2', report({ ...large, maxViewportDims: [16384, 4096] }))).toBe(
			4096,
		);
	});

	it('counts a missing WebGL2 limit as the least that WebGL2 allows', () => {
		const missing = report({
			maxTextureSize: null,
			maxRenderbufferSize: null,
			maxViewportDims: null,
		});
		expect(maxCanvasSize('webgl2', missing)).toBe(C.LIMIT_WEBGL2_MIN_TEXTURE_SIZE);
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

	it('flags each compressed texture family whose extension the context turned on', () => {
		const extensions = {
			WEBGL_compressed_texture_astc: true,
			WEBGL_compressed_texture_etc: true,
			EXT_texture_compression_bptc: false,
			WEBGL_compressed_texture_s3tc: true,
		};
		expect(coreDevice('webgl2', report({ extensions }), PLAIN).capabilities).toBe(
			C.CAPABILITY_TEXTURE_ASTC | C.CAPABILITY_TEXTURE_ETC2,
		);
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

	it('culls by grid cell on both paths unless ?cells=off asks it not to', () => {
		const off: DeviceOptions = { ...PLAIN, cells: false };
		for (const tier of ['webgl2', 'webgpu'] as const) {
			expect(coreDevice(tier, report({}), PLAIN).cellCulling).toBe(true);
			expect(coreDevice(tier, report({}), off).cellCulling).toBe(false);
		}
	});

	it('draws the depth prepass on WebGPU where the options ask for it', () => {
		const on: DeviceOptions = { ...PLAIN, depthPrepass: true };
		for (const tier of ['webgpu', 'webgpu-compat'] as const) {
			expect(coreDevice(tier, report({}), PLAIN).depthPrepass).toBe(false);
			expect(coreDevice(tier, report({}), on).depthPrepass).toBe(true);
		}
	});

	it('reads instances by index only on core WebGPU, where ?instances=index asks for it', () => {
		const on: DeviceOptions = { ...PLAIN, indexInstances: true };
		expect(coreDevice('webgpu', report({}), PLAIN).indexInstances).toBe(false);
		expect(coreDevice('webgpu', report({}), on).indexInstances).toBe(true);
		for (const tier of ['webgpu-compat', 'webgl2'] as const) {
			expect(coreDevice(tier, report({}), on).indexInstances).toBe(false);
		}
	});

	it('culls in two phases on WebGPU where the options ask for it', () => {
		const on: DeviceOptions = { ...PLAIN, gpuOcclusion: true };
		for (const tier of ['webgpu', 'webgpu-compat'] as const) {
			expect(coreDevice(tier, report({}), PLAIN).gpuOcclusion).toBe(false);
			expect(coreDevice(tier, report({}), on).gpuOcclusion).toBe(true);
		}
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

describe('the permutation bits that a device fixes', () => {
	it('hold the draw index where WebGL2 has multi-draw, and nothing on WebGPU with HDR', () => {
		const multiDraw = report({ extensions: { WEBGL_multi_draw: true } });
		expect(coreDevice('webgl2', multiDraw, PLAIN).shaderBits).toBe(PERMUTATION_DRAW_INDEX);
		expect(coreDevice('webgl2', report({}), PLAIN).shaderBits).toBe(0);
		expect(coreDevice('webgpu', multiDraw, PLAIN).shaderBits).toBe(0);
	});

	it('hold tone mapping in the shader on the 8-bit path', () => {
		const multiDraw = report({ extensions: { WEBGL_multi_draw: true }, floatRenderTargets: null });
		const both = PERMUTATION_DRAW_INDEX | PERMUTATION_TONE_MAP;
		expect(coreDevice('webgl2', multiDraw, PLAIN).shaderBits).toBe(both);
		expect(coreDevice('webgl2', report({}), { ...PLAIN, hdr: false }).shaderBits).toBe(
			PERMUTATION_TONE_MAP,
		);
		expect(coreDevice('webgpu-compat', report({}), PLAIN).shaderBits).toBe(PERMUTATION_TONE_MAP);
		// Compatibility mode draws HDR color with one sample per pixel.
		const fxaa: DeviceOptions = { ...PLAIN, antialias: 'fxaa' };
		expect(coreDevice('webgpu-compat', report({}), fxaa).shaderBits).toBe(0);
	});

	it('hold half precision only where ?half=on asks for it and the device can draw it', () => {
		const half: DeviceOptions = { ...PLAIN, half: true };
		const f16 = report({}, ['shader-f16']);
		expect(coreDevice('webgpu', f16, half).shaderBits).toBe(PERMUTATION_HALF);
		expect(coreDevice('webgpu-compat', f16, half).shaderBits).toBe(
			PERMUTATION_TONE_MAP | PERMUTATION_HALF,
		);
		expect(coreDevice('webgpu', report({}), half).shaderBits).toBe(0);
		expect(coreDevice('webgl2', report({}), half).shaderBits).toBe(PERMUTATION_HALF);
		for (const tier of ['webgpu', 'webgl2'] as const) {
			expect(coreDevice(tier, f16, PLAIN).shaderBits).toBe(0);
			expect(coreDevice(tier, f16, { ...PLAIN, half: false }).shaderBits).toBe(0);
		}
	});
});

describe('background compiles', () => {
	it('stay on unless ?compile=wait turns them off', () => {
		expect(coreDevice('webgl2', report({}), PLAIN).parallelCompile).toBe(true);
		const wait: DeviceOptions = { ...PLAIN, parallelCompile: false };
		expect(coreDevice('webgl2', report({}), wait).parallelCompile).toBe(false);
	});
});

describe('effectsOutput', () => {
	const small = ['rg11b10ufloat-renderable'];
	const effects = (tier: Tier, device: DeviceReport, options: Partial<DeviceOptions> = {}) =>
		effectsOutput(tier, device, { ...PLAIN, ...options });

	it('keeps the start on the HDR path', () => {
		expect(effects('webgpu', report({}, small))).toEqual({
			sceneColor: FORMAT_RG11B10_UFLOAT,
			antialias: 'msaa',
		});
		expect(effects('webgl2', report({}))).toEqual({
			sceneColor: FORMAT_RGBA16_FLOAT,
			antialias: 'msaa',
		});
	});

	it('moves the 8-bit path of MSAA to HDR color with FXAA', () => {
		expect(effects('webgpu-compat', report({}, small))).toEqual({
			sceneColor: FORMAT_RG11B10_UFLOAT,
			antialias: 'fxaa',
		});
		expect(effects('webgpu-compat', report({}), { transparent: true })).toEqual({
			sceneColor: FORMAT_RGBA16_FLOAT,
			antialias: 'fxaa',
		});
		const fewSamples = { rgba16f: { ...HDR_TARGETS.rgba16f, samples: 2 } };
		expect(effects('webgl2', report({ floatRenderTargets: fewSamples }))).toEqual({
			sceneColor: FORMAT_RGBA16_FLOAT,
			antialias: 'fxaa',
		});
		const device = coreDevice('webgpu-compat', report({}), PLAIN);
		expect([device.sceneColor, device.effectsSceneColor]).toEqual([
			FORMAT_CANVAS,
			FORMAT_RGBA16_FLOAT,
		]);
		expect(device.effectsAntialias).toBe(C.ANTIALIAS_FXAA);
	});

	it('stays on the 8-bit path where the device has no HDR target, or the page turns HDR off', () => {
		const clipped = { rgba16f: { ...HDR_TARGETS.rgba16f, readsBack: false } };
		expect(effects('webgl2', report({ floatRenderTargets: clipped }))).toEqual({
			sceneColor: FORMAT_CANVAS,
			antialias: 'msaa',
		});
		expect(effects('webgpu-compat', report({}), { hdr: false })).toEqual({
			sceneColor: FORMAT_CANVAS,
			antialias: 'msaa',
		});
	});
});
