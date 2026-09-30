// KTX2 files in a live engine, in every thread mode on both GPU paths: each file becomes the
// compressed format that the device's features allow, the GPU memory counts its blocks, and the
// calls that must fail give their codes. ?compression= limits the families, as on a device with
// one of them or none. The KTX2 loader, the transcoder's worker and the transcoder download once,
// when the first KTX2 file loads, and a page without KTX2 files downloads none of them.
import { expect, type Page, test } from '@playwright/test';
import { ENGINE_MODES, modeProblems, type ReportedMode } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';

interface Made {
	format: string;
	colorSpace: string;
	size: [number, number, number];
	bytes: number;
}

interface Ktx2Result {
	error?: string;
	mode: ReportedMode;
	features: string[];
	recorded: { textures: Made[]; memoryBytes: number; codes: Record<string, string> };
}

type Family = 'astc' | 'bc' | 'etc2';

/** The WebGPU feature and the WebGL2 extension of each compressed family. */
const FAMILIES: Record<Family, readonly string[]> = {
	astc: ['texture-compression-astc', 'WEBGL_compressed_texture_astc'],
	bc: ['texture-compression-bc', 'EXT_texture_compression_bptc'],
	etc2: ['texture-compression-etc2', 'WEBGL_compressed_texture_etc'],
};

/**
 * The formats of the ETC1S file and of the UASTC file with alpha on a device with `families`:
 * ETC1S data goes to ETC2, BC7 or ASTC first, in that order, and UASTC data to ASTC, BC7 or ETC2.
 */
function expectedFormats(families: readonly Family[]): [etc1s: string, uastc: string] {
	const format: Record<Family, [string, string]> = {
		astc: ['astc-4x4-unorm', 'astc-4x4-unorm'],
		bc: ['bc7-rgba-unorm', 'bc7-rgba-unorm'],
		etc2: ['etc2-rgb8unorm', 'etc2-rgba8unorm'],
	};
	const first = (order: Family[]) => order.find((family) => families.includes(family));
	const etc1s = first(['etc2', 'bc', 'astc']);
	const uastc = first(['astc', 'bc', 'etc2']);
	return [etc1s ? format[etc1s][0] : 'rgba8unorm', uastc ? format[uastc][1] : 'rgba8unorm'];
}

/** GPU bytes of `levels` mip levels of a texture of one layer. */
function textureBytes(format: string, width: number, height: number, levels: number): number {
	const block = format === 'etc2-rgb8unorm' ? 8 : 16;
	let bytes = 0;
	for (let level = 0; level < levels; level++) {
		const [w, h] = [Math.max(1, width >> level), Math.max(1, height >> level)];
		bytes += format === 'rgba8unorm' ? w * h * 4 : Math.ceil(w / 4) * Math.ceil(h / 4) * block;
	}
	return bytes;
}

/**
 * The files of the KTX2 loader and the transcoder, by their addresses on the dev server and in a
 * production build, which adds a hash to each name.
 */
const KTX2_FILES: Record<string, RegExp> = {
	loader: /\/scene\/ktx2\.ts$|\/ktx2-[\w-]{8}\.js$/,
	worker: /\/transcoder-worker(-[\w-]{8})?\.js$/,
	glue: /\/basis_transcoder(-[\w-]{8})?\.js$/,
	wasm: /\/basis_transcoder(-[\w-]{8})?\.wasm$/,
};

/** Records the address of every request that the page and its workers make. */
function recordRequests(page: Page): string[] {
	const urls: string[] = [];
	page.context().on('request', (request) => urls.push(new URL(request.url()).pathname));
	return urls;
}

/** How many of the requests fetched each file of the KTX2 loader and the transcoder. */
function ktx2Downloads(urls: readonly string[]): Record<string, number> {
	return Object.fromEntries(
		Object.entries(KTX2_FILES).map(([file, path]) => [
			file,
			urls.filter((url) => path.test(url)).length,
		]),
	);
}

/**
 * Loads the KTX2 page with the switches in `query`, and checks what its textures recorded against
 * the device's compressed families, or the `allowed` ones among them. Returns the page's result
 * and requests.
 */
async function checkTextures(
	page: Page,
	query: string,
	allowed?: readonly Family[],
): Promise<{ result: Ktx2Result; requests: string[] }> {
	const requests = recordRequests(page);
	await page.goto(`ktx2-files.html?${query}`);
	const result = await pageResult<Ktx2Result>(page, 60_000);
	expect(result.error).toBeUndefined();
	const { textures, memoryBytes, codes } = result.recorded;

	// Two ETC1S files, the UASTC file with alpha, the ramp of partial blocks, and the ETC1S file
	// with level 0 alone.
	const families = (Object.keys(FAMILIES) as Family[]).filter(
		(family) =>
			FAMILIES[family].some((name) => result.features.includes(name)) &&
			(!allowed || allowed.includes(family)),
	);
	const [etc1s, uastc] = expectedFormats(families);
	expect(textures.map((t) => t.format)).toEqual([etc1s, etc1s, uastc, 'rgba8unorm', etc1s]);
	expect(textures.map((t) => t.colorSpace)).toEqual(['srgb', 'srgb', 'srgb', 'linear', 'srgb']);
	expect(textures.map((t) => t.size)).toEqual([
		[64, 64, 1],
		[64, 64, 1],
		[64, 64, 1],
		[30, 20, 1],
		[64, 64, 1],
	]);
	const levels = [7, 7, 7, 5, 1];
	expect(textures.map((t) => t.bytes)).toEqual(
		textures.map((t, k) => textureBytes(t.format, t.size[0], t.size[1], levels[k] ?? 0)),
	);
	// A production build has no development checks, so flipY: true loads the ETC1S file once more,
	// with its rows as the file holds them.
	const production = test.info().project.name === 'production build';
	expect(codes).toEqual({
		broken: 'E1412',
		flipY: production ? 'none' : 'E1208',
		update: 'E1208',
	});
	// A compressed texture has an array of its own. Textures of RGBA8 share an array of four
	// layers by size, format and mip levels.
	const arrays = new Map<string, number>();
	for (const t of production ? [...textures, textures[0] as Made] : textures) {
		const compressed = t.format !== 'rgba8unorm';
		const key = compressed ? String(arrays.size) : `${t.colorSpace} ${t.size} ${t.bytes}`;
		arrays.set(key, compressed ? t.bytes : 4 * t.bytes);
	}
	expect(memoryBytes).toBe([...arrays.values()].reduce((sum, bytes) => sum + bytes, 0));
	return { result, requests };
}

for (const gpu of ['webgpu', 'webgl2'] as const) {
	for (const mode of ENGINE_MODES)
		test(`KTX2 files become the device's compressed formats, on ${gpu}, ${mode.name}`, async ({
			page,
		}) => {
			const { result, requests } = await checkTextures(page, `gpu=${gpu}&${mode.query}`);
			expect(modeProblems(result.mode, mode)).toEqual([]);
			// One thread loads the files, so each part downloads once for all six.
			expect(ktx2Downloads(requests)).toEqual({ loader: 1, worker: 1, glue: 1, wasm: 1 });
		});
	// Each family alone, as on a device that has only it, and none, as on a device without any.
	for (const family of ['astc', 'bc', 'etc2', 'none'] as const)
		test(`?compression=${family} keeps KTX2 files to its formats, on ${gpu}`, async ({ page }) => {
			const allowed = family === 'none' ? [] : [family];
			await checkTextures(page, `gpu=${gpu}&compression=${family}`, allowed);
		});
}

// The engine test page, whose start the startup benchmark times, loads no KTX2 file.
for (const mode of ENGINE_MODES)
	test(`a page without KTX2 files downloads no part of the KTX2 loader or the transcoder, ${mode.name}`, async ({
		page,
	}) => {
		const requests = recordRequests(page);
		await page.goto(`engine.html?gpu=webgl2&seconds=1&${mode.query}`);
		const result = await pageResult<{ error?: string }>(page, 30_000);
		expect(result.error).toBeUndefined();
		expect(requests.some((path) => /\/null3d_bg(-[\w-]+)?\.wasm$/.test(path))).toBe(true);
		expect(ktx2Downloads(requests)).toEqual({ loader: 0, worker: 0, glue: 0, wasm: 0 });
	});
