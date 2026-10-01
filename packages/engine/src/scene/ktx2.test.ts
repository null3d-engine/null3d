import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	CAPABILITY_MULTI_DRAW,
	CAPABILITY_TEXTURE_ASTC,
	CAPABILITY_TEXTURE_BC,
	CAPABILITY_TEXTURE_ETC2,
} from '../generated/core';
import {
	type Ktx2Header,
	type Ktx2Target,
	ktx2Target,
	readKtx2Header,
	transcodedBytes,
} from './ktx2';

const ENGINE = join(import.meta.dir, '../..');
const VENDOR = join(ENGINE, 'vendor/basis');
const TEXTURES = join(ENGINE, '../../tests/pages/assets/textures');

/** The test page's KTX2 files, which basisu 2.50 wrote. */
const file = (name: string) => new Uint8Array(readFileSync(join(TEXTURES, `${name}.ktx2`)));

/**
 * The files of the official Basis Universal v2.50 build (tag v2_50, commit 9bebe16, the folder
 * webgl/transcoder/build), by SHA-256. The engine ships them unchanged.
 */
const OFFICIAL_BUILD = {
	'basis_transcoder.js': '720dd9bd09c7cada6d87f1b7b70cec713df04da88cd641ac3212559353834dc8',
	'basis_transcoder.wasm': 'a0f65d4a30ecb3269d01ead7d0a3477d2b0208146d083625a90623f473f6c139',
};

/** The transcoder in Bun, as its official build loads under Node. */
async function loadBasis() {
	const require = createRequire(import.meta.url);
	const basis = await require(join(VENDOR, 'basis_transcoder.js'))({
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
	});

	test('agrees with the transcoder on every file', async () => {
		const basis = await loadBasis();
		for (const name of ['quarters-etc1s', 'quarters-uastc', 'ramp-uastc']) {
			const bytes = file(name);
			const header = readKtx2Header(bytes);
			const ktx2 = new basis.KTX2File(bytes);
			expect([
				ktx2.getWidth(),
				ktx2.getHeight(),
				Math.max(1, ktx2.getLayers()),
				ktx2.getLevels(),
				ktx2.isETC1S() ? 'etc1s' : 'uastc',
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
		const hdr = etc1s.slice();
		hdr[dfd + 12] = 167;
		refuses(hdr, 'UASTC HDR data');
	});
});

describe('ktx2Target', () => {
	const opaque = { width: 64, height: 64, alpha: false };
	const ETC1S = { ...opaque, codec: 'etc1s' } as const;
	const UASTC = { ...opaque, codec: 'uastc' } as const;
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
		for (const name of ['quarters-etc1s', 'quarters-uastc', 'ramp-uastc']) {
			const bytes = file(name);
			const { width, height, levels } = readKtx2Header(bytes);
			const ktx2 = new basis.KTX2File(bytes);
			expect(ktx2.startTranscoding()).toBeTruthy();
			for (const [transcoder, format] of targets) {
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

	test("the worker transcodes every level into one buffer, and names each failure's stage", async () => {
		// The worker is a classic script: it runs here with a stand-in for its global scope.
		const posted: { id?: number; texels?: ArrayBuffer; stage?: string; error?: string }[] = [];
		const scope: Record<string, unknown> = {
			postMessage: (message: (typeof posted)[number]) => posted.push(message),
		};
		const require = createRequire(import.meta.url);
		const importScripts = (url: string) => {
			scope.BASIS = require(new URL(url).pathname);
		};
		const source = readFileSync(join(ENGINE, 'src/workers/transcoder-worker.js'), 'utf8');
		new Function('self', 'importScripts', source)(scope, importScripts);
		const send = (data: unknown) =>
			(scope.onmessage as (event: { data: unknown }) => void)({ data });
		const answer = async (count: number) => {
			while (posted.length < count) await new Promise((resolve) => setTimeout(resolve, 5));
			return posted[count - 1];
		};
		send({ glue: pathToFileURL(join(VENDOR, 'basis_transcoder.js')).href });
		send({
			module: await WebAssembly.compile(readFileSync(join(VENDOR, 'basis_transcoder.wasm'))),
		});
		const uastc = file('quarters-uastc');
		send({ id: 1, file: uastc.buffer, format: 'cTFASTC_4x4_RGBA', levels: 7, layers: 1 });
		expect((await answer(1))?.texels?.byteLength).toBe(
			transcodedBytes('astc-4x4-unorm', 64, 64, 7, 1),
		);
		const broken = file('quarters-etc1s').slice(0, 300);
		send({ id: 2, file: broken.buffer, format: 'cTFETC1_RGB', levels: 7, layers: 1 });
		expect(await answer(2)).toEqual({
			id: 2,
			stage: 'transcode',
			error: 'the transcoder could not start on the file',
		});
	});

	test('is the official Basis Universal v2.50 build, unchanged', () => {
		for (const [name, sha256] of Object.entries(OFFICIAL_BUILD))
			expect(
				createHash('sha256')
					.update(readFileSync(join(VENDOR, name)))
					.digest('hex'),
			).toBe(sha256);
	});
});
