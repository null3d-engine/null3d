// KTX2 files of the sample content's images, for pages that load textures as a shipped scene does.
// The dev server and the preview server serve the KTX2 file of a pinned PNG or JPEG image under
// /sample-textures/ with the image's own path. Each file is the asset tool's encoding of the image,
// as `bunx @null3d/cli assets optimize` encodes a texture of its kind: a NormalGL map as a normal
// map in UASTC, a Color map as sRGB color in ETC1S, and any other map as linear data in ETC1S, all
// with mip levels. The tool's encoder writes the same bytes on every machine, so the files need no
// copy in the repository or in the sample content. The first request of a file encodes it into the
// shared samples cache, keyed by the image's SHA-256, its kind and the encoder's module, and later
// requests read it from there.
//
// /sample-textures/city.json lists the city scene's textures: the color, normal and roughness maps
// of each ambientCG texture set, the three textures of each of its materials. It encodes the files
// that the cache lacks first, on one thread per core. Each address in the list carries the file's
// key, so the browser may keep each file for good, as it keeps the hashed files of a production
// build.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { ENCODER_FILES, encodeTexture } from '../../packages/cli/src/assets/encoder.js';
import { encoderPool } from '../../packages/cli/src/assets/encoder-pool.js';
import { MAX_TEXTURE_SIDE } from '../../packages/cli/src/assets/images.js';
import { codecFor } from '../../packages/cli/src/assets/textures.js';
import { SAMPLE_TEXTURES_LIST, SAMPLE_TEXTURES_URL, SAMPLES_URL } from './sample-url';
import {
	readSampleManifest,
	type SampleFile,
	sampleFileFor,
	samplesCacheRoot,
	samplesDir,
} from './samples';

/** The maps of each city material, by the end of their file names. */
const CITY_MAPS = /_(Color|NormalGL|Roughness)\.(jpg|png)$/;

/** The folder of the city's texture sets in the sample content. */
const CITY_SETS = 'sources/materials/ambientcg/';

type Kind = 'color' | 'data' | 'normal';

/** What a map holds, from its file name, which sets how it encodes. */
export function kindOf(path: string): Kind {
	if (/_NormalGL\.\w+$/.test(path)) return 'normal';
	if (/_Color\.\w+$/.test(path)) return 'color';
	return 'data';
}

/** The cache folder of the encoded files, beside the pinned commits' folders. */
function cacheDir(): string {
	return join(samplesCacheRoot(), 'textures');
}

let encoderHash: string | undefined;

/** A hash of the encoder's module, which changes when its output may change. */
function moduleHash(): string {
	encoderHash ??= createHash('sha256').update(readFileSync(ENCODER_FILES.wasm)).digest('hex');
	return encoderHash;
}

/** A source image's key: its SHA-256, its kind and the encoder. */
function keyOf(source: SampleFile): string {
	return createHash('sha256')
		.update(`${source.sha256}:${kindOf(source.path)}:${moduleHash()}`)
		.digest('hex')
		.slice(0, 32);
}

const cachedPath = (source: SampleFile) => join(cacheDir(), `${keyOf(source)}.ktx2`);

/** Writes a file through a name of this process's own, so two servers never mix their bytes. */
function writeCached(path: string, bytes: Uint8Array): void {
	mkdirSync(cacheDir(), { recursive: true });
	const partial = `${path}.${process.pid}`;
	writeFileSync(partial, bytes);
	renameSync(partial, path);
}

/** The encoder's job for a source image. */
function jobOf(root: string, source: SampleFile) {
	const kind = kindOf(source.path);
	return {
		bytes: new Uint8Array(readFileSync(join(samplesDir(root), source.path))),
		mimeType: source.path.endsWith('.png') ? 'image/png' : 'image/jpeg',
		kind,
		codec: codecFor(kind, 'size'),
		maxSide: MAX_TEXTURE_SIDE,
	} as const;
}

/**
 * The KTX2 file of the pinned image that `url` names under the sample textures' prefix, encoded on
 * the first request, or null when the address names no pinned PNG or JPEG image.
 */
export async function sampleTextureFile(
	root: string,
	url: string,
): Promise<{ bytes: Uint8Array; key: string } | null> {
	if (!url.startsWith(SAMPLE_TEXTURES_URL)) return null;
	const source = sampleFileFor(root, SAMPLES_URL + url.slice(SAMPLE_TEXTURES_URL.length));
	if (!source || !/\.(jpg|png)$/i.test(source.path)) return null;
	const path = cachedPath(source);
	if (existsSync(path)) return { bytes: readFileSync(path), key: keyOf(source) };
	const { ktx2 } = await encodeTexture(jobOf(root, source));
	writeCached(path, ktx2);
	return { bytes: ktx2, key: keyOf(source) };
}

/** The city scene's maps in the pinned manifest. */
export function cityMaps(root: string): SampleFile[] {
	return readSampleManifest(root)
		.assets.filter(({ dir }) => `${dir}/`.startsWith(CITY_SETS))
		.flatMap(({ files }) => files.filter(({ path }) => CITY_MAPS.test(path)));
}

/**
 * The addresses of the city scene's textures, each with its key, after encoding the files that the
 * cache lacks on one thread per core.
 */
export async function cityTextures(root: string): Promise<string[]> {
	const maps = cityMaps(root);
	const missing = maps.filter((source) => !existsSync(cachedPath(source)));
	if (missing.length > 0) {
		const pool = encoderPool(Math.max(1, availableParallelism() - 1));
		try {
			await Promise.all(
				missing.map(async (source) => {
					const { ktx2 } = await pool.encode(jobOf(root, source));
					writeCached(cachedPath(source), ktx2);
				}),
			);
		} finally {
			await pool.close();
		}
	}
	return maps.map((source) => `${SAMPLE_TEXTURES_URL}${source.path}?v=${keyOf(source)}`);
}

function fail(res: ServerResponse, status: number, text: string): void {
	res.statusCode = status;
	res.setHeader('Content-Type', 'text/plain; charset=utf-8');
	res.end(text);
}

/** Serves the sample content's KTX2 files, as this module's header says. */
export function sampleTexturesServer(root: string): Plugin {
	const serve: Connect.NextHandleFunction = async (req, res: ServerResponse, next) => {
		if (!req.url?.startsWith(SAMPLE_TEXTURES_URL)) return next();
		const url = req.url.split(/[?#]/)[0] ?? '';
		try {
			if (url === SAMPLE_TEXTURES_LIST) {
				const textures = await cityTextures(root);
				res.setHeader('Content-Type', 'application/json');
				res.setHeader('Cache-Control', 'no-cache');
				res.end(JSON.stringify({ textures }));
				return;
			}
			const file = await sampleTextureFile(root, url);
			if (!file) {
				fail(res, 404, `${req.url} names no pinned image: run bun run samples:fetch`);
				return;
			}
			const tag = `"${file.key}"`;
			res.setHeader('ETag', tag);
			res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
			if (req.headers['if-none-match'] === tag) {
				res.statusCode = 304;
				res.end();
				return;
			}
			res.setHeader('Content-Type', 'image/ktx2');
			res.setHeader('Content-Length', file.bytes.byteLength);
			res.end(file.bytes);
		} catch (error) {
			fail(res, 500, `${req.url}: ${error instanceof Error ? error.message : String(error)}`);
		}
	};
	return {
		name: 'null3d-sample-textures',
		configureServer: (server) => void server.middlewares.use(serve),
		configurePreviewServer: (server) => void server.middlewares.use(serve),
	};
}
