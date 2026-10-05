// Sample content: the models, textures, environments and colour grading tables that tests,
// benchmarks and demos load. The files live in the sample-assets repository, because they are too
// large for this one. The lock pins one commit of it, and a byte-exact copy of that commit's
// manifest lists each file's size, SHA-256, licence and attribution. `bun run samples:fetch`
// downloads the commit once into a cache outside the repository, which every copy of the
// repository shares, and checks each file against the manifest. Playwright loads this file as a
// CommonJS module, so it finds the repository's root from the working folder, not from its own path.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	createReadStream,
	createWriteStream,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import type { ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, posix } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import type { Connect, Plugin } from 'vite';
import { SAMPLES_URL } from './sample-url';

export { SAMPLES_URL, sampleUrl } from './sample-url';

/** The pinned commit of the sample-assets repository. */
export const LOCK_PATH = 'tools/samples/lock.json';
/** The copy of the pinned commit's manifest. */
export const MANIFEST_PATH = 'tools/samples/manifest.json';
/** Licences that sample content may use: CC0 and CC BY, which allow redistribution and commercial use. */
export const ACCEPTED_LICENCES = /^(CC0-1\.0|CC-BY-[34]\.0)$/;
/** The file in a cached copy that records the hash of the manifest it passed. */
const VERIFIED = '.null3d-verified';

export interface SampleLock {
	/** The sample-assets repository, as owner/name on GitHub. */
	repository: string;
	/** The pinned commit, in full. */
	commit: string;
	/** The release archive of processed files that the asset tool builds from the pinned sources. None yet. */
	processed: null | { tag: string; url: string; sha256: string };
}

export interface SampleFile {
	path: string;
	bytes: number;
	sha256: string;
}

export interface SampleAsset {
	id: string;
	title: string;
	purpose: string;
	authors: { name: string; role?: string; license?: string }[];
	license: string[];
	source: string;
	fetched: string;
	changes: string;
	dir: string;
	files: SampleFile[];
}

export interface SampleManifest {
	version: number;
	licenses: Record<string, { name: string; url: string; file: string }>;
	assets: SampleAsset[];
}

/** The repository's root: the nearest folder at or above `start` that holds the lock. */
export function repositoryRoot(start = process.cwd()): string {
	for (let dir = start; ; dir = dirname(dir)) {
		if (existsSync(join(dir, LOCK_PATH))) return dir;
		if (dirname(dir) === dir) throw new Error(`No ${LOCK_PATH} at or above ${start}`);
	}
}

export function readLock(root: string): SampleLock {
	return JSON.parse(readFileSync(join(root, LOCK_PATH), 'utf8'));
}

export function readSampleManifest(root: string): SampleManifest {
	return JSON.parse(readFileSync(join(root, MANIFEST_PATH), 'utf8'));
}

export function sha256(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The cache that holds one folder per pinned commit: `NULL3D_SAMPLES_DIR` when it is set, or
 * `null3d/samples` in the user's cache folder (`XDG_CACHE_HOME`, or `~/.cache`).
 */
export function samplesCacheRoot(env: Record<string, string | undefined> = process.env): string {
	if (env.NULL3D_SAMPLES_DIR) return env.NULL3D_SAMPLES_DIR;
	return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'null3d', 'samples');
}

/** The folder that holds the pinned commit's files once `bun run samples:fetch` has run. */
export function samplesDir(root: string, env = process.env): string {
	return join(samplesCacheRoot(env), readLock(root).commit);
}

let manifestFiles: Map<string, SampleFile> | undefined;

/** Every file of the pinned manifest, by its path. */
function pinnedFiles(root: string): Map<string, SampleFile> {
	manifestFiles ??= new Map(
		readSampleManifest(root).assets.flatMap((a) => a.files.map((f) => [f.path, f] as const)),
	);
	return manifestFiles;
}

/**
 * The full path of a sample file, such as `sources/khronos/Fox/glTF-Binary/Fox.glb`, for code that
 * runs in Bun or Node. Name the file with a string literal, so the sample check can read it.
 */
export function samplePath(path: string): string {
	const root = repositoryRoot();
	if (!pinnedFiles(root).has(path)) throw new Error(`${path} is not in ${MANIFEST_PATH}`);
	const full = join(samplesDir(root), path);
	if (!existsSync(full)) throw new Error(`${path} is missing: run bun run samples:fetch`);
	return full;
}

/** Problems with a cached copy: a manifest that differs from the pinned copy, or a missing or changed file. */
export function verifyFiles(
	dir: string,
	manifest: SampleManifest,
	manifestText: Uint8Array,
): string[] {
	const problems: string[] = [];
	const theirs = join(dir, 'manifest.json');
	if (!existsSync(theirs) || sha256(readFileSync(theirs)) !== sha256(manifestText)) {
		problems.push(`manifest.json differs from ${MANIFEST_PATH}`);
	}
	for (const file of manifest.assets.flatMap((a) => a.files)) {
		const full = join(dir, file.path);
		if (!existsSync(full)) problems.push(`${file.path}: missing`);
		else if (statSync(full).size !== file.bytes) problems.push(`${file.path}: size differs`);
		else if (sha256(readFileSync(full)) !== file.sha256)
			problems.push(`${file.path}: SHA-256 differs`);
	}
	return problems;
}

/**
 * Downloads the pinned commit into the cache, unless a checked copy is already there, and returns
 * its folder. The download goes to a staging folder first, so a failed or concurrent fetch never
 * leaves a half-written copy in place. `verify` hashes a cached copy's files again.
 */
export async function fetchSamples(
	root: string,
	{ verify = false, log = console.log }: { verify?: boolean; log?: (line: string) => void } = {},
): Promise<string> {
	const lock = readLock(root);
	const manifestText = readFileSync(join(root, MANIFEST_PATH));
	const manifest: SampleManifest = JSON.parse(manifestText.toString('utf8'));
	const manifestHash = sha256(manifestText);
	const cache = samplesCacheRoot();
	const dir = join(cache, lock.commit);
	const marker = join(dir, VERIFIED);
	if (existsSync(marker) && readFileSync(marker, 'utf8') === manifestHash && !verify) return dir;
	if (existsSync(dir)) {
		const problems = verifyFiles(dir, manifest, manifestText);
		if (problems.length === 0) {
			writeFileSync(marker, manifestHash);
			return dir;
		}
		log(
			`The cached copy failed its check (${problems[0]}, ${problems.length} in all). Downloading it again.`,
		);
		rmSync(dir, { recursive: true, force: true });
	}
	const files = manifest.assets.flatMap((a) => a.files);
	const megabytes = files.reduce((sum, f) => sum + f.bytes, 0) / 1e6;
	log(
		`Downloading ${lock.repository} at ${lock.commit.slice(0, 12)}: ${files.length} files, ${megabytes.toFixed(0)} MB.`,
	);
	mkdirSync(cache, { recursive: true });
	const staging = mkdtempSync(join(cache, `.${lock.commit.slice(0, 12)}-`));
	try {
		const url = `https://codeload.github.com/${lock.repository}/tar.gz/${lock.commit}`;
		const response = await fetch(url);
		if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
		const archive = join(staging, 'sources.tar.gz');
		await pipeline(Readable.fromWeb(response.body as ReadableStream), createWriteStream(archive));
		const tree = join(staging, 'tree');
		mkdirSync(tree);
		const tar = spawnSync('tar', ['-xzf', archive, '-C', tree, '--strip-components=1'], {
			encoding: 'utf8',
		});
		if (tar.status !== 0) throw new Error(`tar failed: ${tar.stderr || tar.error}`);
		const problems = verifyFiles(tree, manifest, manifestText);
		if (problems.length > 0) {
			throw new Error(
				`The download failed its check:\n${problems.map((p) => `- ${p}`).join('\n')}`,
			);
		}
		writeFileSync(join(tree, VERIFIED), manifestHash);
		try {
			renameSync(tree, dir);
		} catch (error) {
			// Another fetch that ran at the same time finished first, and its copy passed the same check.
			if (!existsSync(join(dir, VERIFIED))) throw error;
		}
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
	log(`Checked ${files.length} files against ${MANIFEST_PATH}.`);
	return dir;
}

/** Pins another commit: copies its manifest and records it in the lock. `ref` is a commit or a branch. */
export async function pinSamples(root: string, ref: string): Promise<string> {
	const lock = readLock(root);
	const api = `https://api.github.com/repos/${lock.repository}/commits/${ref}`;
	const resolved = await fetch(api, { headers: { Accept: 'application/vnd.github.sha' } });
	if (!resolved.ok) throw new Error(`${api}: HTTP ${resolved.status}`);
	const commit = (await resolved.text()).trim();
	const url = `https://raw.githubusercontent.com/${lock.repository}/${commit}/manifest.json`;
	const response = await fetch(url);
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	writeFileSync(join(root, MANIFEST_PATH), new Uint8Array(await response.arrayBuffer()));
	writeFileSync(join(root, LOCK_PATH), `${JSON.stringify({ ...lock, commit }, null, '\t')}\n`);
	manifestFiles = undefined;
	return commit;
}

/** A sample file that code names with `samplePath` or `sampleUrl`; `path` is null when the name is not a string literal. */
export interface NamedSample {
	file: string;
	line: number;
	path: string | null;
}

/** Folders whose code may name sample files. */
const SCANNED = ['tests', 'bench', 'examples', 'tools', 'packages'];
const SKIPPED_FOLDERS = new Set([
	'node_modules',
	'dist',
	'target',
	'generated',
	'test-results',
	'playwright-report',
	'vendor',
]);
/** This module and its tests, which name sample files only to describe and test the check. */
const SKIPPED_FILES = new Set([
	'tools/lib/samples.ts',
	'tools/lib/samples.test.ts',
	'tools/lib/sample-url.ts',
]);
const CODE = /\.(ts|js|mjs|html)$/;
/** A `samplePath` or `sampleUrl` call, with the path when it is a string literal. */
const NAME_CALL = /\bsample(?:Path|Url)\(\s*(?:(['"`])([^'"`$\n]*)\1)?/g;
/** A module that imports a sample model optimized, such as `'/samples/sources/a.glb?optimized'`. */
const OPTIMIZED_IMPORT = /(['"])\/samples\/([^'"?\n]+)\?optimized\1/g;

/** Every sample file that the repository's code names, with where it names it. */
export function namedSamples(root: string, folders = SCANNED): NamedSample[] {
	const out: NamedSample[] = [];
	const visit = (rel: string) => {
		for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
			const path = posix.join(rel, entry.name);
			if (entry.isDirectory()) {
				if (!SKIPPED_FOLDERS.has(entry.name)) visit(path);
			} else if (CODE.test(entry.name) && !SKIPPED_FILES.has(path)) {
				const text = readFileSync(join(root, path), 'utf8');
				const named = [...text.matchAll(NAME_CALL), ...text.matchAll(OPTIMIZED_IMPORT)].sort(
					(a, b) => a.index - b.index,
				);
				for (const match of named) {
					const line = text.slice(0, match.index).split('\n').length;
					out.push({ file: path, line, path: match[2] ?? null });
				}
			}
		}
	};
	for (const folder of folders) if (existsSync(join(root, folder))) visit(folder);
	return out;
}

/** What makes an asset unfit to ship: a licence outside CC0 and CC BY, or a missing attribution field. */
function assetProblems(manifest: SampleManifest, asset: SampleAsset): string[] {
	const problems: string[] = [];
	for (const id of asset.license) {
		if (!ACCEPTED_LICENCES.test(id) || !manifest.licenses[id])
			problems.push(`${asset.id}: licence ${id} is not accepted`);
	}
	if (asset.license.length === 0) problems.push(`${asset.id}: no licence`);
	if (asset.authors.length === 0) problems.push(`${asset.id}: no author`);
	for (const field of ['title', 'source', 'changes'] as const) {
		if (!asset[field]?.trim()) problems.push(`${asset.id}: no ${field}`);
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(asset.fetched)) problems.push(`${asset.id}: no fetch date`);
	for (const file of asset.files) {
		if (!/^[0-9a-f]{64}$/.test(file.sha256)) problems.push(`${file.path}: no SHA-256`);
	}
	return problems;
}

/** Problems with the pinned manifest as a whole: every asset needs an accepted licence, its attribution and checksums. */
export function manifestProblems(manifest: SampleManifest): string[] {
	return manifest.assets.flatMap((asset) => assetProblems(manifest, asset));
}

/**
 * The sample check: each file that code names is in the pinned manifest, with a checksum, and
 * belongs to an asset with an accepted licence and the attribution that the sample-assets README
 * prints from the manifest.
 */
export function sampleProblems(manifest: SampleManifest, named: readonly NamedSample[]): string[] {
	const owners = new Map(manifest.assets.flatMap((a) => a.files.map((f) => [f.path, a] as const)));
	const problems: string[] = [];
	for (const { file, line, path } of named) {
		const where = `${file}:${line}`;
		if (path === null) {
			problems.push(
				`${where}: name the sample file with a string literal, so this check can read it`,
			);
			continue;
		}
		const asset = owners.get(path);
		if (!asset) {
			problems.push(
				`${where}: ${path} is not in ${MANIFEST_PATH}; add it to the sample-assets repository and pin it with bun run samples:fetch --pin main`,
			);
			continue;
		}
		problems.push(...assetProblems(manifest, asset).map((p) => `${where}: ${p}`));
	}
	return problems;
}

const CONTENT_TYPES: Record<string, string> = {
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.ktx2': 'image/ktx2',
	'.cube': 'text/plain; charset=utf-8',
	'.3dl': 'text/plain; charset=utf-8',
	'.obj': 'text/plain; charset=utf-8',
	'.mtl': 'text/plain; charset=utf-8',
};

/** The pinned file that a sample address names, or null when the address names no pinned file. */
export function sampleFileFor(root: string, url: string): SampleFile | null {
	if (!url.startsWith(SAMPLES_URL)) return null;
	try {
		const path = decodeURIComponent(url.slice(SAMPLES_URL.length).split(/[?#]/)[0] ?? '');
		return pinnedFiles(root).get(path) ?? null;
	} catch {
		return null;
	}
}

/**
 * The cached file that a module imports optimized, as `/samples/<path>?optimized`, with the query
 * kept for the null3D plugin, which runs the asset tool on it. Null for any other import. Throws,
 * with what to do, for a file that the manifest does not pin or that the cache lacks.
 */
export function optimizedSampleFile(root: string, id: string): string | null {
	if (!id.startsWith(SAMPLES_URL) || !id.endsWith('?optimized')) return null;
	const path = id.slice(SAMPLES_URL.length, -'?optimized'.length);
	if (!pinnedFiles(root).has(path)) throw new Error(`${path} is not in ${MANIFEST_PATH}`);
	const full = join(samplesDir(root), path);
	if (!existsSync(full)) throw new Error(`${path} is missing: run bun run samples:fetch`);
	return `${full}?optimized`;
}

/**
 * Serves the pinned sample files under `/samples/` on the dev server and the preview server. Only
 * files in the pinned manifest are served, from the shared cache. The SHA-256 is the entity tag, so
 * a browser revalidates each file and never keeps one from an earlier pin. A module may also import
 * a pinned model as `/samples/<path>?optimized`: the import resolves to the cached file, and the
 * null3D plugin optimizes it as it does a model of the project.
 */
export function samplesServer(root: string): Plugin {
	const serve: Connect.NextHandleFunction = (req, res: ServerResponse, next) => {
		if (!req.url?.startsWith(SAMPLES_URL)) return next();
		const file = sampleFileFor(root, req.url);
		const full = file && join(samplesDir(root), file.path);
		if (!full || !existsSync(full)) {
			res.statusCode = 404;
			res.setHeader('Content-Type', 'text/plain; charset=utf-8');
			res.end(
				file
					? `${file.path} is missing: run bun run samples:fetch`
					: `${req.url} is not a pinned sample file`,
			);
			return;
		}
		const tag = `"${file.sha256}"`;
		res.setHeader('ETag', tag);
		res.setHeader('Cache-Control', 'no-cache');
		if (req.headers['if-none-match'] === tag) {
			res.statusCode = 304;
			res.end();
			return;
		}
		res.setHeader(
			'Content-Type',
			CONTENT_TYPES[extname(full).toLowerCase()] ?? 'application/octet-stream',
		);
		res.setHeader('Content-Length', file.bytes);
		createReadStream(full).pipe(res);
	};
	return {
		name: 'null3d-samples',
		// Before Vite's own resolver, which would look for the address under the project's root.
		enforce: 'pre',
		resolveId(id) {
			try {
				return optimizedSampleFile(root, id);
			} catch (error) {
				return this.error((error as Error).message);
			}
		},
		configureServer: (server) => void server.middlewares.use(serve),
		configurePreviewServer: (server) => void server.middlewares.use(serve),
	};
}
