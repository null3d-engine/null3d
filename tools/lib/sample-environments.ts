// Environment maps of the sample content's HDR images, for tests and benchmarks that light scenes
// with them. The dev server and the preview server serve the map of a pinned HDR file under
// /sample-environments/ with the file's own path: the asset tool's output for that file, at its
// default size and format, as `bunx @null3d/cli assets env` writes it. The tool writes the same
// bytes on every machine, so the map needs no copy in the repository or in the sample content. The
// first request builds it, in about 5 s, into the shared samples cache, keyed by the source's
// SHA-256 and the tool's module, and later requests read it from there.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Connect, Plugin } from 'vite';
import { ASSET_FORMATS_URL, environmentMap } from '../../packages/cli/src/assets/formats.js';
import { SAMPLE_ENVIRONMENTS_URL, SAMPLES_URL } from './sample-url';
import { sampleFileFor, samplesCacheRoot, samplesDir } from './samples';

/** The cache folder of the built maps, beside the pinned commits' folders. */
function cacheDir(): string {
	return join(samplesCacheRoot(), 'environments');
}

let toolHash: string | undefined;

/** A hash of the asset tool's module, which changes when its output may change. */
function moduleHash(): string {
	toolHash ??= createHash('sha256').update(readFileSync(ASSET_FORMATS_URL)).digest('hex');
	return toolHash;
}

/**
 * The environment map of the pinned HDR file that `url` names under the sample environments'
 * prefix, built on the first request, or null when the address names no pinned `.hdr` or `.exr`
 * file.
 */
let builtinRoom: Uint8Array | undefined;

export function sampleEnvironmentFile(root: string, url: string): Uint8Array | null {
	if (!url.startsWith(SAMPLE_ENVIRONMENTS_URL)) return null;
	// The asset tool's map of the built-in room, the reference of the room's generator on devices.
	if (url === `${SAMPLE_ENVIRONMENTS_URL}builtin/room.ktx2`) {
		builtinRoom ??= environmentMap({ builtin: 'room' }, { size: 256, format: 'rgb9e5ufloat' });
		return builtinRoom;
	}
	const source = sampleFileFor(root, SAMPLES_URL + url.slice(SAMPLE_ENVIRONMENTS_URL.length));
	if (!source || !/\.(hdr|exr)$/i.test(source.path)) return null;
	const key = createHash('sha256').update(`${source.sha256}:${moduleHash()}`).digest('hex');
	const cached = join(cacheDir(), `${key.slice(0, 32)}.ktx2`);
	if (existsSync(cached)) return readFileSync(cached);
	const hdr = readFileSync(join(samplesDir(root), source.path));
	const map = environmentMap({ file: hdr }, { size: 256, format: 'rgb9e5ufloat' });
	mkdirSync(cacheDir(), { recursive: true });
	// Each server writes its own file first, so two servers that build at once never mix bytes.
	const partial = `${cached}.${process.pid}`;
	writeFileSync(partial, map);
	renameSync(partial, cached);
	return map;
}

/** Serves the sample content's environment maps, as this module's header says. */
export function sampleEnvironmentsServer(root: string): Plugin {
	const serve: Connect.NextHandleFunction = (req, res: ServerResponse, next) => {
		if (!req.url?.startsWith(SAMPLE_ENVIRONMENTS_URL)) return next();
		let map: Uint8Array | null;
		try {
			map = sampleEnvironmentFile(root, req.url.split(/[?#]/)[0] ?? '');
		} catch (error) {
			res.statusCode = 500;
			res.setHeader('Content-Type', 'text/plain; charset=utf-8');
			res.end(`${req.url}: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		if (!map) {
			res.statusCode = 404;
			res.setHeader('Content-Type', 'text/plain; charset=utf-8');
			res.end(`${req.url} names no pinned .hdr or .exr sample file: run bun run samples:fetch`);
			return;
		}
		res.setHeader('Content-Type', 'image/ktx2');
		res.setHeader('Content-Length', map.byteLength);
		res.setHeader('Cache-Control', 'no-cache');
		res.end(map);
	};
	return {
		name: 'null3d-sample-environments',
		configureServer: (server) => void server.middlewares.use(serve),
		configurePreviewServer: (server) => void server.middlewares.use(serve),
	};
}
