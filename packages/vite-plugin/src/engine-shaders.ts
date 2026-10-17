// The engine's shader modules come from the release's asset, not from the package: the built set is
// hundreds of megabytes, which no npm package can carry. A project downloads one Brotli-compressed
// tar, checks it against the hash the installed package names, and unpacks it into a cache that the
// whole machine shares. A failed download falls back to building the modules locally, so this is an
// accelerator and never a dependency.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

/** What a release asset holds, and what the installed package says about it. */
export interface ShaderArtifact {
	/** The release tag, such as `v0.1.0`. */
	readonly tag: string;
	/** The asset's file name, such as `v0.1.0-shaders.tar.br`. */
	readonly file: string;
	/** The asset's address. */
	readonly url: string;
	/** The SHA-256 of the compressed asset, in lowercase hexadecimal. */
	readonly sha256: string;
}

/** The file in the engine package that names the release's asset. */
export const ARTIFACT_FILE = 'shader-artifact.json';

/** The folder that holds each unpacked set, one for each hash, inside the machine's cache. */
export function engineShadersRoot(): string {
	return join(
		process.env.NULL3D_BUILD_CACHE ?? join(homedir(), '.cache', 'null3d'),
		'engine-shaders',
	);
}

/**
 * A folder of the engine's generated modules to use as they are, named by `NULL3D_ENGINE_SHADERS`.
 * A build of the engine's sources writes the same modules to `packages/engine/src/generated`, so a
 * checkout that has them, and CI's package test, need neither the download nor a build.
 */
export const ENGINE_SHADERS_ENV = 'NULL3D_ENGINE_SHADERS';

/** The record of a set that a project may use: its hash and the files it holds. */
const MARKER = '.complete';

/** How the folder of an engine's modules is found: fetched from the release, or built here. */
export interface ShaderSources {
	/** The folder of the release asset's modules, or nothing when it cannot be had. */
	fetch(artifact: ShaderArtifact): Promise<string | undefined>;
	/** The folder of modules built from the engine's own sources. */
	build(): Promise<string | undefined>;
}

/** The answer for each engine package, so the download and the build happen once per build. */
const folders = new Map<string, Promise<string | undefined>>();

/**
 * The folder that holds one engine package's built shader modules. The release asset is used when
 * it can be had; otherwise the modules are built here, so a project without a network still works.
 */
export function engineShaderFolder(
	lib: string,
	sources: ShaderSources,
): Promise<string | undefined> {
	let folder = folders.get(lib);
	if (!folder) {
		folder = (async () => {
			const named = process.env[ENGINE_SHADERS_ENV];
			if (named) {
				const given = resolve(named);
				if (existsSync(join(given, 'shaders.ts'))) return given;
			}
			const artifact = readArtifact(lib);
			if (artifact) {
				const fetched = await sources.fetch(artifact);
				if (fetched) return fetched;
			}
			return sources.build();
		})();
		folders.set(lib, folder);
	}
	return folder;
}

/** Reads the artifact record beside an engine package's `lib` folder, or nothing when it has none. */
export function readArtifact(libFolder: string): ShaderArtifact | undefined {
	const path = join(libFolder, ARTIFACT_FILE);
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ShaderArtifact>;
		if (
			typeof parsed.tag === 'string' &&
			typeof parsed.file === 'string' &&
			typeof parsed.url === 'string' &&
			typeof parsed.sha256 === 'string' &&
			/^[a-f0-9]{64}$/.test(parsed.sha256)
		)
			return parsed as ShaderArtifact;
	} catch {
		// No record, or one that cannot be read: the caller builds the modules locally instead.
	}
	return undefined;
}

/**
 * The folder that holds the modules of `artifact`, downloading and unpacking them when the cache
 * has none. It returns nothing when the download fails or the bytes do not match the hash, and the
 * caller then builds the modules itself.
 */
export async function ensureEngineShaders(
	artifact: ShaderArtifact,
	report: (message: string) => void,
): Promise<string | undefined> {
	const folder = join(engineShadersRoot(), artifact.sha256);
	if (existsSync(join(folder, MARKER))) return folder;
	try {
		report(`null3D: fetching the engine's shaders from ${artifact.url}`);
		const response = await fetch(artifact.url, { redirect: 'follow' });
		if (!response.ok) throw new Error(`the server answered ${response.status}`);
		const compressed = Buffer.from(await response.arrayBuffer());
		const digest = createHash('sha256').update(compressed).digest('hex');
		if (digest !== artifact.sha256)
			throw new Error(`the bytes hash to ${digest}, not ${artifact.sha256}`);
		unpackInto(folder, brotliDecompressSync(compressed));
		return folder;
	} catch (error) {
		report(
			`null3D: could not fetch the engine's shaders (${(error as Error).message}). Building them from the engine's sources instead, which takes longer.`,
		);
		return undefined;
	}
}

/**
 * Writes the files of a tar's bytes into `folder`, which appears whole or not at all: the files go
 * to a folder beside it first, and one rename puts them in place. A file whose name leaves the
 * folder is refused, so an archive can never write outside it.
 */
export function unpackInto(folder: string, tar: Buffer): void {
	const staging = `${folder}.incoming-${process.pid}`;
	rmSync(staging, { recursive: true, force: true });
	mkdirSync(staging, { recursive: true });
	try {
		for (const entry of tarEntries(tar)) {
			const target = join(staging, entry.name);
			if (!target.startsWith(`${staging}/`) && target !== staging)
				throw new Error(`the archive holds ${entry.name}, which leaves its folder`);
			if (entry.directory) {
				mkdirSync(target, { recursive: true });
				continue;
			}
			mkdirSync(join(target, '..'), { recursive: true });
			writeFileSync(target, entry.bytes);
		}
		writeFileSync(join(staging, MARKER), '');
		rmSync(folder, { recursive: true, force: true });
		mkdirSync(join(folder, '..'), { recursive: true });
		renameSync(staging, folder);
	} catch (error) {
		rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}

/** One file or folder of a tar archive. */
export interface TarEntry {
	/** The path inside the archive, with `/` between its parts. */
	readonly name: string;
	/** The file's bytes, empty for a folder. */
	readonly bytes: Buffer;
	/** True for a folder: an entry whose type names one, or one whose name ends with `/`. */
	readonly directory: boolean;
}

const BLOCK = 512;

/** The number in a tar header field: octal digits and spaces, or empty for zero. */
function octal(header: Buffer, offset: number, length: number): number {
	const text = header
		.subarray(offset, offset + length)
		.toString('ascii')
		.replace(/\0.*$/, '')
		.trim();
	return text === '' ? 0 : Number.parseInt(text, 8);
}

/** The text in a tar header field, up to its first zero byte. */
function text(header: Buffer, offset: number, length: number): string {
	const field = header.subarray(offset, offset + length);
	const end = field.indexOf(0);
	return field.subarray(0, end < 0 ? field.length : end).toString('utf8');
}

/**
 * The entries of a tar archive, in its order. The reader takes the ustar form, with the long name
 * in the prefix field, and skips the entry kinds that the release does not use.
 */
export function* tarEntries(tar: Buffer): Generator<TarEntry> {
	let at = 0;
	while (at + BLOCK <= tar.length) {
		const header = tar.subarray(at, at + BLOCK);
		// Two zero blocks end an archive; a block that cannot hold a name ends it too.
		if (header.every((byte) => byte === 0)) return;
		const name = text(header, 0, 100);
		if (name === '') return;
		const size = octal(header, 124, 12);
		const type = String.fromCharCode(header[156] ?? 0);
		const prefix = text(header, 345, 155);
		const full = prefix === '' ? name : `${prefix}/${name}`;
		const start = at + BLOCK;
		const end = start + size;
		if (end > tar.length) throw new Error(`the archive ends inside ${full}`);
		const directory = type === '5' || full.endsWith('/');
		const bytes = directory ? Buffer.alloc(0) : tar.subarray(start, end);
		yield { name: full.replace(/^\.\//, '').replace(/\/$/, ''), bytes, directory };
		at = end + ((BLOCK - (size % BLOCK)) % BLOCK);
	}
}
