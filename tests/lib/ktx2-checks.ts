// Checks of the KTX2 test page's result, shared by the Playwright tests and the real-browser runner:
// each file becomes the compressed format that the device's features allow, the GPU memory counts
// its blocks, and the calls that must fail give their codes.
import type { CompressionFamily } from '../../packages/engine/src/page/switches.ts';
import type { ReportedMode } from './engine-checks.ts';

/** One texture that the page's sketch made from a KTX2 file. */
export interface Ktx2Texture {
	format: string;
	colorSpace: string;
	size: [number, number, number];
	bytes: number;
}

export interface Ktx2Result {
	mode: ReportedMode;
	/** The GPU path's features, with each WebGL2 extension that the engine asked for by name. */
	features: string[];
	recorded: { textures: Ktx2Texture[]; memoryBytes: number; codes: Record<string, string> };
}

/**
 * The WebGPU feature and the WebGL2 extension of each compressed family, written out here rather
 * than taken from the engine, so a wrong name in the engine fails the check.
 */
const FAMILIES: Record<CompressionFamily, readonly string[]> = {
	astc: ['texture-compression-astc', 'WEBGL_compressed_texture_astc'],
	bc: ['texture-compression-bc', 'EXT_texture_compression_bptc'],
	etc2: ['texture-compression-etc2', 'WEBGL_compressed_texture_etc'],
};

/**
 * The page's textures, in the order the sketch loads them: the ETC1S file twice, the UASTC file
 * with alpha, the ramp whose size takes no compressed format, and the ETC1S file without its mip
 * levels. Each gives its data, color space, size and mip levels.
 */
const TEXTURES = [
	{ data: 'etc1s', colorSpace: 'srgb', size: [64, 64, 1], levels: 7 },
	{ data: 'etc1s', colorSpace: 'srgb', size: [64, 64, 1], levels: 7 },
	{ data: 'uastc', colorSpace: 'srgb', size: [64, 64, 1], levels: 7 },
	{ data: 'ramp', colorSpace: 'linear', size: [30, 20, 1], levels: 5 },
	{ data: 'etc1s', colorSpace: 'srgb', size: [64, 64, 1], levels: 1 },
] as const;

/**
 * The compressed families that the device reported, by WebGPU feature or WebGL2 extension, of
 * those that `allowed` names when it is given.
 */
export function deviceFamilies(
	features: readonly string[],
	allowed?: readonly CompressionFamily[],
): CompressionFamily[] {
	return (Object.keys(FAMILIES) as CompressionFamily[]).filter(
		(family) =>
			FAMILIES[family].some((name) => features.includes(name)) &&
			(!allowed || allowed.includes(family)),
	);
}

/**
 * The formats of the ETC1S file and of the UASTC file with alpha on a device with `families`:
 * ETC1S data goes to ETC2, BC7 or ASTC first, in that order, and UASTC data to ASTC, BC7 or ETC2.
 */
function expectedFormats(
	families: readonly CompressionFamily[],
): Record<'etc1s' | 'uastc', string> {
	const format: Record<CompressionFamily, [etc1s: string, uastc: string]> = {
		astc: ['astc-4x4-unorm', 'astc-4x4-unorm'],
		bc: ['bc7-rgba-unorm', 'bc7-rgba-unorm'],
		etc2: ['etc2-rgb8unorm', 'etc2-rgba8unorm'],
	};
	const first = (order: CompressionFamily[]) => order.find((family) => families.includes(family));
	const etc1s = first(['etc2', 'bc', 'astc']);
	const uastc = first(['astc', 'bc', 'etc2']);
	return {
		etc1s: etc1s ? format[etc1s][0] : 'rgba8unorm',
		uastc: uastc ? format[uastc][1] : 'rgba8unorm',
	};
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

/** A list for a problem's text. */
const listed = (values: readonly unknown[]) => values.map(String).join(', ');

/**
 * What is wrong with a result of the KTX2 page; empty when nothing is. The page ran with the
 * device's compressed families, or with the `allowed` ones among them, as `?compression=` limits
 * them. A `production` build has no development checks, so `flipY: true` loads the ETC1S file once
 * more, with its rows as the file holds them, where a development build throws E1208.
 */
export function ktx2Problems(
	result: Ktx2Result,
	{ allowed, production = false }: { allowed?: readonly CompressionFamily[]; production?: boolean },
): string[] {
	const { textures, memoryBytes, codes } = result.recorded;
	if (textures.length !== TEXTURES.length)
		return [`the page made ${textures.length} textures, not ${TEXTURES.length}`];
	const formats = expectedFormats(deviceFamilies(result.features, allowed));
	const problems: string[] = [];
	const compare = (what: string, got: readonly unknown[], expected: readonly unknown[]) => {
		if (listed(got) !== listed(expected))
			problems.push(`the ${what} are ${listed(got)}, not ${listed(expected)}`);
	};
	compare(
		'formats',
		textures.map((t) => t.format),
		TEXTURES.map(({ data }) => (data === 'ramp' ? 'rgba8unorm' : formats[data])),
	);
	compare(
		'color spaces',
		textures.map((t) => t.colorSpace),
		TEXTURES.map((t) => t.colorSpace),
	);
	compare(
		'sizes',
		textures.map((t) => t.size.join(' x ')),
		TEXTURES.map((t) => t.size.join(' x ')),
	);
	compare(
		'GPU bytes',
		textures.map((t) => t.bytes),
		textures.map((t, k) => textureBytes(t.format, t.size[0], t.size[1], TEXTURES[k]?.levels ?? 0)),
	);
	const expectedCodes = { broken: 'E1412', flipY: production ? 'none' : 'E1208', update: 'E1208' };
	for (const [call, code] of Object.entries(expectedCodes))
		if (codes[call] !== code) problems.push(`the ${call} call gave ${codes[call]}, not ${code}`);
	// A compressed texture has an array of its own. Textures of RGBA8 share an array of four
	// layers by size, format and mip levels.
	const arrays = new Map<string, number>();
	for (const t of production ? [...textures, textures[0] as Ktx2Texture] : textures) {
		const compressed = t.format !== 'rgba8unorm';
		const key = compressed ? String(arrays.size) : `${t.colorSpace} ${t.size} ${t.bytes}`;
		arrays.set(key, compressed ? t.bytes : 4 * t.bytes);
	}
	const expectedMemory = [...arrays.values()].reduce((sum, bytes) => sum + bytes, 0);
	if (memoryBytes !== expectedMemory)
		problems.push(`the textures take ${memoryBytes} GPU bytes, not ${expectedMemory}`);
	return problems;
}

/** The formats that the ETC1S and UASTC files became, for a run's notes. */
export function ktx2FormatsNote(result: Ktx2Result, tier: string): string {
	const [etc1s, , uastc] = result.recorded.textures;
	if (!etc1s || !uastc) return `KTX2 on ${tier}: the page made no textures`;
	const families = deviceFamilies(result.features);
	return `KTX2 on ${tier}: ETC1S became ${etc1s.format}, UASTC ${uastc.format} (compressed families: ${families.length > 0 ? families.join(', ') : 'none'})`;
}
