import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { transcodeTestFiles } from '../../../../tools/lib/basis-transcoder';
import BASIS, { type BasisModule } from '../../vendor/basis/basis_transcoder.mjs';
import {
	CAPABILITY_MULTI_DRAW,
	CAPABILITY_TEXTURE_ASTC,
	CAPABILITY_TEXTURE_BC,
	CAPABILITY_TEXTURE_ETC2,
} from '../generated/core';
import { serveTasks, type TaskAnswer, type TaskRequest, type TaskSource } from '../workers/tasks';
import {
	type Ktx2Header,
	type Ktx2Target,
	ktx2Target,
	ktx2TooLarge,
	loadKtx2,
	readKtx2Header,
	transcodedBytes,
} from './ktx2';
import type { Textures } from './textures';

const ENGINE = join(import.meta.dir, '../..');
const VENDOR = join(ENGINE, 'vendor/basis');
const TEXTURES = join(ENGINE, '../../tests/pages/assets/textures');

/** The test page's KTX2 files, which Basis Universal 2.50 wrote. */
const file = (name: string) => new Uint8Array(readFileSync(join(TEXTURES, `${name}.ktx2`)));

/**
 * The engine's build of the Basis Universal v2.50 transcoder (tag v2_50, commit 9bebe16), which
 * tools/build-basis-transcoder.ts makes with Emscripten 4.0.15, by SHA-256.
 */
const ENGINE_BUILD = {
	'basis_transcoder.mjs': '137585ecc38fd9ec6b0e9ba327424764f309e032e5ec286ea30db031b2151636',
	'basis_transcoder.wasm': '104b8d3804a1d2f832d986b7657ab153d6635d27275a0fcc56d26a9767ad1e4f',
};

/**
 * What the official v2.50 build (the folder webgl/transcoder/build) writes for each test file and
 * each format that the engine asks for, every mip level in turn, by SHA-256.
 */
const OFFICIAL_OUTPUT: Record<string, string> = {
	'quarters-etc1s.ktx2/cTFASTC_4x4_RGBA':
		'fbeb66dd5d9d269870472622c85a96c8af43840f8f41c35bbb53a4ec2de2b53c',
	'quarters-etc1s.ktx2/cTFBC7_RGBA':
		'2ca4314aa94054aff3f96cb1259de822d0a311bea102bc51e599bd60cdfc94df',
	'quarters-etc1s.ktx2/cTFETC1_RGB':
		'04d6fe88b23c72988da9d2c8640eeecfc3e56a829680f4d20cb0fdb00e3254ca',
	'quarters-etc1s.ktx2/cTFETC2_RGBA':
		'ed4e3b4e3a55ab31413f94e239dbc9b28e54d8f04b3d74840f5d38901e9b3aa2',
	'quarters-etc1s.ktx2/cTFRGBA32':
		'dd3b6698b71e639ed2fa1659c710f24624813f92dc129c2b9d1dec3ae62ff66f',
	'quarters-hdr.ktx2/cTFBC6H': '70abc5f2b1be18d4b7fcc72fc3fcbfea5c592d797465ebcb87565ec3e12e0f5a',
	'quarters-hdr.ktx2/cTFRGB_9E5':
		'c9facdadcbe39d60511fc2e67c41a86e919988a7721945c83fe5149181c49c2a',
	'quarters-uastc.ktx2/cTFASTC_4x4_RGBA':
		'c6198fe79470251443477568f60d7b7d930462a50772a2a4ec6c633a9055b772',
	'quarters-uastc.ktx2/cTFBC7_RGBA':
		'ed962d0d9da70f09fdd8c6a08d2761396638527f9b1667169eb0c3782ef4b5dd',
	'quarters-uastc.ktx2/cTFETC1_RGB':
		'a4981197bf8d0539fe772baf07464297e393ee9c9ee3c68a7eef4e3fe86cefb8',
	'quarters-uastc.ktx2/cTFETC2_RGBA':
		'8e84364535054dba79a4604b2071e9e29171df19e3816dc036324ba0368e807e',
	'quarters-uastc.ktx2/cTFRGBA32':
		'0fb254e628dee6349b7a0a7b57a728f866a4a8a3f7f813ed81a452bf7149b753',
	'ramp-uastc.ktx2/cTFASTC_4x4_RGBA':
		'352185a692895adea6dbf04d3f5aeaf0728de08a2ecd4c18fff4d6599bbf6576',
	'ramp-uastc.ktx2/cTFBC7_RGBA': '66777f7be4dc84c85a37785a1021ab7872e5cfa96933349509ce1d84ca62c5ec',
	'ramp-uastc.ktx2/cTFETC1_RGB': 'cd9b2b21d37219fe77efdcaf141869b0efec03f741a83546436f81cffb1b1f7d',
	'ramp-uastc.ktx2/cTFETC2_RGBA':
		'd1139e4ea650943d94e310b1d5db742bf7c8e07217b2854bfe0171a6e3f9fc6a',
	'ramp-uastc.ktx2/cTFRGBA32': '3502ba9658e36663c5c4340978ebe15caa25bc15e12a218c0d504389136d3927',
};

/** The transcoder in Bun, with the calls that only these tests make. */
// biome-ignore lint/suspicious/noExplicitAny: the module's types cover only what the engine calls
async function loadBasis(): Promise<any> {
	const basis = await (BASIS as unknown as (options: object) => Promise<BasisModule>)({
		wasmBinary: readFileSync(join(VENDOR, 'basis_transcoder.wasm')),
	});
	basis.initializeBasis();
	return basis;
}

/** A copy of a file with one 32-bit word of its header changed. */
function withWord(bytes: Uint8Array, at: number, value: number): Uint8Array {
	const copy = bytes.slice();
	new DataView(copy.buffer).setUint32(at, value, true);
	return copy;
}

describe('readKtx2Header', () => {
	test('reads the size, the mip levels, the codec, alpha and the color space', () => {
		const base = { width: 64, height: 64, layers: 1, levels: 7, colorSpace: 'srgb' };
		expect(readKtx2Header(file('quarters-etc1s'))).toEqual({
			...base,
			codec: 'etc1s',
			alpha: false,
		} as Ktx2Header);
		expect(readKtx2Header(file('quarters-uastc'))).toEqual({
			...base,
			codec: 'uastc',
			alpha: true,
		} as Ktx2Header);
		expect(readKtx2Header(file('ramp-uastc'))).toEqual({
			width: 30,
			height: 20,
			layers: 1,
			levels: 5,
			codec: 'uastc',
			alpha: false,
			colorSpace: 'linear',
		});
		// UASTC HDR data names ASTC 4x4 HDR as its Vulkan format, and its values are linear.
		expect(readKtx2Header(file('quarters-hdr'))).toEqual({
			...base,
			codec: 'uastc-hdr',
			alpha: false,
			colorSpace: 'linear',
		});
	});

	test('agrees with the transcoder on every file', async () => {
		const basis = await loadBasis();
		for (const name of ['quarters-etc1s', 'quarters-uastc', 'ramp-uastc', 'quarters-hdr']) {
			const bytes = file(name);
			const header = readKtx2Header(bytes);
			const ktx2 = new basis.KTX2File(bytes);
			expect([
				ktx2.getWidth(),
				ktx2.getHeight(),
				Math.max(1, ktx2.getLayers()),
				ktx2.getLevels(),
				ktx2.isETC1S() ? 'etc1s' : ktx2.isHDR() ? 'uastc-hdr' : 'uastc',
				ktx2.getHasAlpha(),
				ktx2.isSRGB() ? 'srgb' : 'linear',
			]).toEqual([
				header.width,
				header.height,
				header.layers,
				header.levels,
				header.codec,
				header.alpha,
				header.colorSpace,
			]);
			ktx2.close();
			ktx2.delete();
		}
	});

	test('refuses files that the engine does not load, and says why', () => {
		const etc1s = file('quarters-etc1s');
		const refuses = (bytes: Uint8Array, reason: string) =>
			expect(() => readKtx2Header(bytes)).toThrow(reason);
		refuses(new Uint8Array(100), 'does not start with a KTX2 header');
		refuses(etc1s.slice(0, 60), 'does not start with a KTX2 header');
		refuses(withWord(etc1s, 12, 43), 'Vulkan format 43');
		refuses(withWord(etc1s, 28, 4), 'a 3D texture');
		refuses(withWord(etc1s, 36, 6), 'a cube map');
		refuses(withWord(etc1s, 44, 2), 'not in BasisLZ');
		const dfd = new DataView(etc1s.buffer).getUint32(48, true);
		const model = etc1s.slice();
		model[dfd + 12] = 168;
		refuses(model, 'color model 168');
		// Only UASTC HDR data may name the ASTC HDR format, and only with no supercompression or
		// Zstandard's.
		refuses(withWord(etc1s, 12, 1000066000), 'Vulkan format 1000066000');
		refuses(withWord(file('quarters-hdr'), 44, 1), 'supercompression scheme 1');
	});
});

describe('ktx2Target', () => {
	const opaque = { width: 64, height: 64, alpha: false };
	const ETC1S = { ...opaque, codec: 'etc1s' } as const;
	const UASTC = { ...opaque, codec: 'uastc' } as const;
	const HDR = { ...opaque, codec: 'uastc-hdr' } as const;
	const ALL = CAPABILITY_TEXTURE_ASTC | CAPABILITY_TEXTURE_BC | CAPABILITY_TEXTURE_ETC2;
	const format = (capabilities: number, header: Parameters<typeof ktx2Target>[1]) =>
		ktx2Target(capabilities, header).format;

	test('turns UASTC into ASTC, then BC7, then ETC2, and ETC1S into ETC2, then BC7, then ASTC', () => {
		// Each set of features: a Mac or a phone with ASTC, ETC2 and maybe BC, a desktop GPU with
		// BC alone, a device with one of the others, and a device with none.
		const devices: [number, Ktx2Target['format'], Ktx2Target['format']][] = [
			[ALL, 'astc-4x4-unorm', 'etc2-rgb8unorm'],
			[CAPABILITY_TEXTURE_ASTC | CAPABILITY_TEXTURE_ETC2, 'astc-4x4-unorm', 'etc2-rgb8unorm'],
			[CAPABILITY_TEXTURE_BC | CAPABILITY_TEXTURE_ETC2, 'bc7-rgba-unorm', 'etc2-rgb8unorm'],
			[CAPABILITY_TEXTURE_BC | CAPABILITY_TEXTURE_ASTC, 'astc-4x4-unorm', 'bc7-rgba-unorm'],
			[CAPABILITY_TEXTURE_BC, 'bc7-rgba-unorm', 'bc7-rgba-unorm'],
			[CAPABILITY_TEXTURE_ETC2, 'etc2-rgb8unorm', 'etc2-rgb8unorm'],
			[CAPABILITY_TEXTURE_ASTC, 'astc-4x4-unorm', 'astc-4x4-unorm'],
			[CAPABILITY_MULTI_DRAW, 'rgba8unorm', 'rgba8unorm'],
			[0, 'rgba8unorm', 'rgba8unorm'],
		];
		for (const [capabilities, uastc, etc1s] of devices)
			expect([format(capabilities, UASTC), format(capabilities, ETC1S)]).toEqual([uastc, etc1s]);
	});

	test('keeps alpha in ETC2, and takes RGBA8 for a size of partial blocks', () => {
		const etc2 = CAPABILITY_TEXTURE_ETC2;
		expect(ktx2Target(etc2, { ...ETC1S, alpha: true })).toEqual({
			transcoder: 'cTFETC2_RGBA',
			format: 'etc2-rgba8unorm',
		});
		expect(ktx2Target(etc2, UASTC).transcoder).toBe('cTFETC1_RGB');
		expect(format(ALL, { ...UASTC, width: 30 })).toBe('rgba8unorm');
		expect(format(ALL, { ...ETC1S, height: 18 })).toBe('rgba8unorm');
	});

	test('on WebGL2, takes BC7 first wherever the device has BC, as desktop drivers may emulate the rest', () => {
		// A desktop whose driver offers every family, as Mesa on Linux does, and one with BC alone.
		for (const capabilities of [ALL, CAPABILITY_TEXTURE_BC | CAPABILITY_TEXTURE_ETC2])
			for (const header of [UASTC, ETC1S, { ...ETC1S, alpha: true }])
				expect(ktx2Target(capabilities, header, true)).toEqual({
					transcoder: 'cTFBC7_RGBA',
					format: 'bc7-rgba-unorm',
				});
		// A phone's WebGL2 has no BC, and WebGPU offers each family only where the GPU has it.
		const phone = CAPABILITY_TEXTURE_ASTC | CAPABILITY_TEXTURE_ETC2;
		expect([ktx2Target(phone, UASTC, true).format, ktx2Target(phone, ETC1S, true).format]).toEqual([
			'astc-4x4-unorm',
			'etc2-rgb8unorm',
		]);
		expect(ktx2Target(ALL, ETC1S, false).format).toBe('etc2-rgb8unorm');
		expect(ktx2Target(ALL, { ...ETC1S, width: 30 }, true).format).toBe('rgba8unorm');
	});

	test('turns UASTC HDR into BC6H where the device has BC, and into shared-exponent floats elsewhere', () => {
		const bc6h: Ktx2Target = { transcoder: 'cTFBC6H', format: 'bc6h-rgb-ufloat' };
		const rgb9e5: Ktx2Target = { transcoder: 'cTFRGB_9E5', format: 'rgb9e5ufloat' };
		for (const webgl2 of [false, true]) {
			expect(ktx2Target(ALL, HDR, webgl2)).toEqual(bc6h);
			expect(ktx2Target(CAPABILITY_TEXTURE_BC, HDR, webgl2)).toEqual(bc6h);
			// A phone has ASTC and ETC2, and neither path has their HDR formats.
			expect(ktx2Target(CAPABILITY_TEXTURE_ASTC | CAPABILITY_TEXTURE_ETC2, HDR, webgl2)).toEqual(
				rgb9e5,
			);
			expect(ktx2Target(0, HDR, webgl2)).toEqual(rgb9e5);
			expect(ktx2Target(ALL, { ...HDR, width: 30 }, webgl2)).toEqual(rgb9e5);
		}
	});

	test("a Mesa desktop's WebGL2, which offers ETC2 and ASTC it decodes in software, gets neither", () => {
		// Mesa on Linux reports BC, ETC2 and ASTC alike. The choice reads only these formats, never
		// the GPU's name, which some browsers hide.
		for (const header of [UASTC, ETC1S, { ...ETC1S, alpha: true }, HDR])
			expect(ktx2Target(ALL, header, true).format).not.toMatch(/^(etc2|astc)-/);
	});
});

describe('ktx2TooLarge', () => {
	const header = { width: 2048, height: 1024, layers: 1, levels: 12 };

	test('lets through a file within every limit', () => {
		expect(ktx2TooLarge(header, 'rgba8unorm', 2048)).toBeUndefined();
		expect(ktx2TooLarge({ ...header, layers: 2 }, 'bc7-rgba-unorm', 4096)).toBeUndefined();
	});

	test("refuses sides past the device's limit, too many layers or levels, and too many bytes", () => {
		expect(ktx2TooLarge(header, 'rgba8unorm', 1024)).toBe(
			"it is 2048 x 1024 texels, larger than the 1024 a side that this device's textures hold",
		);
		expect(ktx2TooLarge({ ...header, layers: 257 }, 'bc7-rgba-unorm', 4096)).toContain(
			'257 layers, more than the 256',
		);
		expect(ktx2TooLarge({ ...header, levels: 13 }, 'bc7-rgba-unorm', 4096)).toContain(
			'13 mip levels, more than the 12',
		);
		expect(ktx2TooLarge({ ...header, layers: 48 }, 'rgba8unorm', 4096)).toBe(
			'its texels take 513 MiB as rgba8unorm, more than the 256 MiB that one texture may hold',
		);
		// Shared-exponent floats take 4 bytes a texel, and BC6H a byte.
		expect(ktx2TooLarge({ ...header, layers: 48 }, 'rgb9e5ufloat', 4096)).toContain('513 MiB');
		expect(ktx2TooLarge({ ...header, layers: 48 }, 'bc6h-rgb-ufloat', 4096)).toBeUndefined();
	});

	test('a file larger than the device takes is refused before the transcoder starts', async () => {
		const Worker = globalThis.Worker;
		let started = 0;
		globalThis.Worker = class {
			constructor() {
				started++;
				throw new Error('the transcoder started');
			}
		} as unknown as typeof globalThis.Worker;
		try {
			// A 16 KB file that says it holds 16,384 x 16,384 texels.
			const huge = withWord(withWord(file('quarters-etc1s'), 20, 16384), 24, 16384);
			const textures = { capabilities: 0, webgl2: false, maxSize: 4096 } as Textures;
			const refused = loadKtx2(
				textures,
				huge.buffer as ArrayBuffer,
				new URL('https://example.com/huge.ktx2'),
				{},
				'assets.loadTexture',
				(code, message) => Object.assign(new Error(message), { code }) as never,
			);
			await expect(refused).rejects.toMatchObject({
				code: 'E1412',
				message:
					"assets.loadTexture() could not load https://example.com/huge.ktx2 as a KTX2 texture: it is 16384 x 16384 texels, larger than the 4096 a side that this device's textures hold.",
			});
			expect(started).toBe(0);
		} finally {
			globalThis.Worker = Worker;
		}
	});
});

describe('the transcoder', () => {
	test('writes the bytes that the engine counts for every format, level and file', async () => {
		const basis = await loadBasis();
		const targets = [
			['cTFASTC_4x4_RGBA', 'astc-4x4-unorm'],
			['cTFBC7_RGBA', 'bc7-rgba-unorm'],
			['cTFETC1_RGB', 'etc2-rgb8unorm'],
			['cTFETC2_RGBA', 'etc2-rgba8unorm'],
			['cTFRGBA32', 'rgba8unorm'],
		] as const;
		const hdrTargets = [
			['cTFBC6H', 'bc6h-rgb-ufloat'],
			['cTFRGB_9E5', 'rgb9e5ufloat'],
		] as const;
		for (const name of ['quarters-etc1s', 'quarters-uastc', 'ramp-uastc', 'quarters-hdr']) {
			const bytes = file(name);
			const { width, height, levels, codec } = readKtx2Header(bytes);
			const ktx2 = new basis.KTX2File(bytes);
			expect(ktx2.startTranscoding()).toBeTruthy();
			for (const [transcoder, format] of codec === 'uastc-hdr' ? hdrTargets : targets) {
				const code = basis.transcoder_texture_format[transcoder].value;
				let written = 0;
				for (let level = 0; level < levels; level++)
					written += ktx2.getImageTranscodedSizeInBytes(level, 0, 0, code);
				expect(written).toBe(transcodedBytes(format, width, height, levels, 1));
			}
			ktx2.close();
			ktx2.delete();
		}
	});

	test("the task transcodes every level into one buffer, and names each failure's stage", async () => {
		const module = await WebAssembly.compile(readFileSync(join(VENDOR, 'basis_transcoder.wasm')));
		const answers: TaskAnswer[] = [];
		const source: TaskSource = {
			onmessage: null,
			postMessage: (answer) => answers.push(answer),
		};
		const tasks = serveTasks(source);
		const send = (request: TaskRequest) =>
			source.onmessage?.(new MessageEvent('message', { data: request }));
		const uastc = file('quarters-uastc');
		send({
			id: 1,
			task: 'ktx2',
			modules: [['basis', module]],
			input: { file: uastc.buffer, format: 'cTFASTC_4x4_RGBA', levels: 7, layers: 1 },
		});
		const broken = file('quarters-etc1s').slice(0, 300);
		send({
			id: 2,
			task: 'ktx2',
			input: { file: broken.buffer, format: 'cTFETC1_RGB', levels: 7, layers: 1 },
		});
		send({ id: 3, task: 'draco', input: {} });
		await tasks.whenIdle(() => answers.length === 3);
		const byId = (id: number) => answers.find((answer) => answer.id === id);
		expect(((byId(1) as { output: ArrayBuffer }).output as ArrayBuffer).byteLength).toBe(
			transcodedBytes('astc-4x4-unorm', 64, 64, 7, 1),
		);
		expect(byId(2)).toEqual({
			id: 2,
			failed: { stage: 'run', message: 'the transcoder could not start on the file' },
		});
		expect(byId(3)).toEqual({
			id: 3,
			failed: { stage: 'load', message: 'the engine has no task draco' },
		});
	});

	test('is the build that tools/build-basis-transcoder.ts makes, and makes no code from strings', () => {
		for (const [name, sha256] of Object.entries(ENGINE_BUILD))
			expect(
				createHash('sha256')
					.update(readFileSync(join(VENDOR, name)))
					.digest('hex'),
			).toBe(sha256);
		// A Content-Security-Policy without 'unsafe-eval' blocks code made from strings.
		expect(readFileSync(join(VENDOR, 'basis_transcoder.mjs'), 'utf8')).not.toMatch(
			/new Function|\beval\(/,
		);
	});

	test("writes the official build's bytes for every test file and every format the engine uses", async () => {
		const written = await transcodeTestFiles(
			join(VENDOR, 'basis_transcoder.mjs'),
			join(VENDOR, 'basis_transcoder.wasm'),
		);
		expect(Object.fromEntries(written)).toEqual(OFFICIAL_OUTPUT);
	});
});
