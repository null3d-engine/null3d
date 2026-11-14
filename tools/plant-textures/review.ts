// Review sheets of what a species' KTX2 files hold, decoded by the transcoder that the engine ships:
// each bark tile repeated four by four, the corner where four tiles meet at full size, and the leaf's
// layers over grey with their relief. The reviewer reads seams and leaf edges from them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { writePng } from '../../packages/cli/src/png.js';
import type { Built } from './build.ts';

/** The engine's transcoder build. */
const TRANSCODER = join(import.meta.dirname, '../../packages/engine/vendor/basis');

/** RGBA8 texels, rows top first. */
interface Image {
	readonly width: number;
	readonly height: number;
	readonly data: Uint8Array;
}

// biome-ignore lint/suspicious/noExplicitAny: the transcoder's module has no types of its own here
let transcoder: Promise<any> | undefined;

function loadTranscoder() {
	transcoder ??= (async () => {
		const start = (await import(pathToFileURL(join(TRANSCODER, 'basis_transcoder.mjs')).href))
			.default;
		const basis = await start({
			wasmBinary: readFileSync(join(TRANSCODER, 'basis_transcoder.wasm')),
		});
		basis.initializeBasis();
		return basis;
	})();
	return transcoder;
}

/**
 * Every mip level of every layer of a KTX2 file as RGBA8, rows top first as the source picture's:
 * the files store the picture's bottom row first.
 */
export async function decodeKtx2(bytes: Uint8Array): Promise<Image[][]> {
	const basis = await loadTranscoder();
	const file = new basis.KTX2File(bytes);
	try {
		if (!file.startTranscoding()) throw new Error('the transcoder could not start');
		const format = basis.transcoder_texture_format.cTFRGBA32.value;
		const layers = Math.max(1, file.getLayers());
		return Array.from({ length: layers }, (_, layer) =>
			Array.from({ length: file.getLevels() }, (_, level) => {
				const info = file.getImageLevelInfo(level, layer, 0);
				const width = info.origWidth;
				const height = info.origHeight;
				const out = new Uint8Array(file.getImageTranscodedSizeInBytes(level, layer, 0, format));
				if (!file.transcodeImage(out, level, layer, 0, format, 0, -1, -1))
					throw new Error(`level ${level} of layer ${layer} did not transcode`);
				const data = new Uint8Array(width * height * 4);
				for (let y = 0; y < height; y++)
					data.set(
						out.subarray((height - 1 - y) * width * 4, (height - y) * width * 4),
						y * width * 4,
					);
				return { width, height, data };
			}),
		);
	} finally {
		file.close();
		file.delete();
	}
}

/** An image of `size` texels a side that repeats a tile, sampled by the nearest texel. */
function repeat(tile: Image, size: number, repeats: number, offset = 0): Image {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const tx = Math.floor((((x + offset) * repeats * tile.width) / size) % tile.width);
			const ty = Math.floor((((y + offset) * repeats * tile.height) / size) % tile.height);
			data.set(
				tile.data.subarray((ty * tile.width + tx) * 4, (ty * tile.width + tx) * 4 + 4),
				(y * size + x) * 4,
			);
		}
	return { width: size, height: size, data };
}

/** The corner where four repeats of a tile meet, at full size. */
function corner(tile: Image, size: number): Image {
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++)
		for (let x = 0; x < size; x++) {
			const tx = (((x - size / 2) % tile.width) + tile.width) % tile.width;
			const ty = (((y - size / 2) % tile.height) + tile.height) % tile.height;
			data.set(
				tile.data.subarray((ty * tile.width + tx) * 4, (ty * tile.width + tx) * 4 + 4),
				(y * size + x) * 4,
			);
		}
	return { width: size, height: size, data };
}

/** A leaf layer over mid grey by its coverage. */
function overGrey(layer: Image): Image {
	const data = new Uint8Array(layer.data.length);
	for (let i = 0; i < layer.width * layer.height; i++) {
		const a = (layer.data[i * 4 + 3] as number) / 255;
		for (let c = 0; c < 3; c++)
			data[i * 4 + c] = Math.round((layer.data[i * 4 + c] as number) * a + 128 * (1 - a));
		data[i * 4 + 3] = 255;
	}
	return { width: layer.width, height: layer.height, data };
}

/** Images side by side, top aligned, on black. */
function row(images: readonly Image[]): Image {
	const width = images.reduce((sum, image) => sum + image.width, 0);
	const height = Math.max(...images.map((image) => image.height));
	const data = new Uint8Array(width * height * 4);
	for (let i = 3; i < data.length; i += 4) data[i] = 255;
	let left = 0;
	for (const image of images) {
		for (let y = 0; y < image.height; y++)
			data.set(
				image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
				(y * width + left) * 4,
			);
		left += image.width;
	}
	return { width, height, data };
}

function save(dir: string, name: string, image: Image): string {
	const file = join(dir, name);
	writePng(file, image);
	return file;
}

/** Writes the review sheets of a built species into `dir`, and returns their paths. */
export async function writeSheets(built: Built, dir: string): Promise<string[]> {
	const out: string[] = [];
	const file = (name: string) => built.files.get(name);
	for (const half of [false, true]) {
		const suffix = half ? '-half' : '';
		const bark = file(`bark-color${suffix}.ktx2`);
		const barkNormal = file(`bark-normal${suffix}.ktx2`);
		if (bark && barkNormal) {
			const colour = await decodeKtx2(bark);
			const normal = await decodeKtx2(barkNormal);
			colour.forEach((levels, layer) => {
				const tile = levels[0] as Image;
				out.push(
					save(dir, `${built.species}-bark${layer}${suffix}-4x4.png`, repeat(tile, 1024, 4)),
				);
				out.push(
					save(
						dir,
						`${built.species}-bark${layer}${suffix}-corner.png`,
						row([
							corner(tile, Math.min(512, tile.width)),
							corner((normal[layer] as Image[])[0] as Image, Math.min(512, tile.width)),
						]),
					),
				);
			});
		}
		const young = file(`young-color${suffix}.ktx2`);
		const youngNormal = file(`young-normal${suffix}.ktx2`);
		if (young && youngNormal) {
			const tile = ((await decodeKtx2(young))[0] as Image[])[0] as Image;
			const normal = ((await decodeKtx2(youngNormal))[0] as Image[])[0] as Image;
			out.push(
				save(
					dir,
					`${built.species}-young${suffix}-4x4.png`,
					row([repeat(tile, 1024, 4), repeat(normal, 1024, 4)]),
				),
			);
		}
		const leaf = file(`leaf-color${suffix}.ktx2`);
		const leafNormal = file(`leaf-normal${suffix}.ktx2`);
		if (leaf && leafNormal) {
			const layers = (await decodeKtx2(leaf)).map((levels) => overGrey(levels[0] as Image));
			const normal = ((await decodeKtx2(leafNormal))[0] as Image[])[0] as Image;
			out.push(save(dir, `${built.species}-leaf${suffix}.png`, row([...layers, normal])));
		}
	}
	return out;
}

/** Share of texels whose alpha is at or above half, at each mip level of each layer of a file. */
export async function coverageByLevel(bytes: Uint8Array): Promise<number[][]> {
	return (await decodeKtx2(bytes)).map((levels) =>
		levels.map((image) => {
			let n = 0;
			for (let i = 3; i < image.data.length; i += 4) if ((image.data[i] as number) >= 128) n++;
			return Math.round((n / (image.width * image.height)) * 10000) / 10000;
		}),
	);
}
