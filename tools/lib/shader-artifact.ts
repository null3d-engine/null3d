// The built shader set as one release asset, and the record that the engine package carries so that
// the Vite plugin can find and verify it. The asset is a tar of the shader modules at the archive
// root, Brotli-compressed at the highest quality. Every field of each tar header is fixed and the
// names are sorted, so the same module set always gives the same bytes and the same SHA-256.
//
// The tar uses GNU long-name entries for the module names that ustar's 100-byte name field cannot
// hold. Those names are flat, so a ustar prefix cannot carry them. GNU tar, bsdtar and the tar
// libraries that plugins use read the long-name entry.
import { createHash } from 'node:crypto';
import {
	createReadStream,
	createWriteStream,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { constants, createBrotliCompress } from 'node:zlib';
import { isShaderModule, MODULE_DIR } from './shader-modules';

/** A tar block, and the size of each field of its header. */
const BLOCK = 512;
/** The name that a GNU long-name entry carries, before the real entry's header. */
const LONG_NAME = '././@LongLink';

/** The file name of a release's shader set. */
export function shaderArtifactFile(tag: string): string {
	return `${tag}-shaders.tar.br`;
}

/** The address from which a release serves its shader set. */
export function shaderArtifactUrl(repo: string, tag: string, file: string): string {
	return `https://github.com/${repo}/releases/download/${tag}/${file}`;
}

/** What the engine package records about the release's shader set. */
export interface ShaderArtifact {
	readonly tag: string;
	readonly file: string;
	readonly url: string;
	readonly sha256: string;
}

/**
 * The record that the engine package carries. It gives the fields in a fixed order, so the file's
 * text depends only on its values.
 */
export function shaderArtifactRecord(options: {
	readonly tag: string;
	readonly repo: string;
	readonly sha256: string;
}): ShaderArtifact {
	const file = shaderArtifactFile(options.tag);
	if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(options.tag))
		throw new Error(`the tag "${options.tag}" is not a version or a branch name`);
	if (!/^[^/\s]+\/[^/\s]+$/.test(options.repo))
		throw new Error(`the repository "${options.repo}" is not in the form owner/name`);
	if (!/^[0-9a-f]{64}$/.test(options.sha256))
		throw new Error(`the SHA-256 "${options.sha256}" is not 64 lowercase hexadecimal digits`);
	return {
		tag: options.tag,
		file,
		url: shaderArtifactUrl(options.repo, options.tag, file),
		sha256: options.sha256,
	};
}

/** Writes the record as one line, which is the form that the plugin's schema reads. */
export function writeShaderArtifact(path: string, record: ShaderArtifact): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(record)}\n`);
}

/** The SHA-256 of a file, in lowercase hexadecimal. */
export function hashFile(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** The names of the shader modules in this checkout, in the order that the archive holds them. */
export function shaderModuleNames(root: string): string[] {
	return readdirSync(join(root, MODULE_DIR)).filter(isShaderModule).sort();
}

/** An octal field of a tar header: its digits, then the terminator byte. */
function octal(value: number, width: number): string {
	const digits = value.toString(8);
	if (digits.length > width - 1) throw new Error(`${value} does not fit a ${width}-byte tar field`);
	return `${digits.padStart(width - 1, '0')}\0`;
}

/** A name in the two fields of a header: a flat name, or one that a slash splits. */
function headerName(name: string): { name: string; prefix: string } {
	if (Buffer.byteLength(name) <= 100) return { name, prefix: '' };
	for (let at = name.indexOf('/'); at !== -1; at = name.indexOf('/', at + 1)) {
		const prefix = name.slice(0, at);
		const rest = name.slice(at + 1);
		if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(rest) <= 100)
			return { name: rest, prefix };
	}
	return { name, prefix: '' };
}

/**
 * A tar header with every value that a build's tree does not decide fixed: the owner and the group
 * are zero, the modification time is the epoch, and the device numbers are zero. The mode is the
 * file's own, as GNU tar records it without a mode option. A name too long for the field keeps its
 * first 100 bytes here and travels in a long-name entry before this header.
 */
function tarHeader(name: string, size: number, mode: number, type = '0'): Buffer {
	const header = Buffer.alloc(BLOCK);
	const split = headerName(name);
	header.write(split.name.slice(0, 100), 0, 100, 'utf8');
	header.write(octal(mode, 8), 100, 8, 'latin1');
	header.write(octal(0, 8), 108, 8, 'latin1');
	header.write(octal(0, 8), 116, 8, 'latin1');
	header.write(octal(size, 12), 124, 12, 'latin1');
	header.write(octal(0, 12), 136, 12, 'latin1');
	// The checksum sums the header with its own field read as spaces.
	header.write('        ', 148, 8, 'latin1');
	header.write(type, 156, 1, 'latin1');
	header.write('ustar\0', 257, 6, 'latin1');
	header.write('00', 263, 2, 'latin1');
	header.write(split.prefix, 345, 155, 'utf8');
	let sum = 0;
	for (const byte of header) sum += byte;
	header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'latin1');
	return header;
}

/** The zero bytes that fill a block past `size` bytes of data. */
function padding(size: number): Buffer {
	const rest = size % BLOCK;
	return rest === 0 ? Buffer.alloc(0) : Buffer.alloc(BLOCK - rest);
}

/** The header of one file, and the long-name entry that a name over 100 bytes needs. */
function* fileHeader(name: string, size: number, mode: number): Generator<Buffer> {
	if (Buffer.byteLength(name) > 100) {
		const long = Buffer.from(`${name}\0`, 'utf8');
		yield tarHeader(LONG_NAME, long.length, 0o644, 'L');
		yield long;
		yield padding(long.length);
	}
	yield tarHeader(name, size, mode);
}

/**
 * Writes the tar of the shader modules in `root` into `out` and returns its SHA-256. The stream is
 * compressed as it is built, so a set of hundreds of megabytes never rests in memory.
 */
export async function createShaderArchive(root: string, out: string): Promise<string> {
	mkdirSync(dirname(out), { recursive: true });
	const folder = join(root, MODULE_DIR);
	const names = shaderModuleNames(root);
	if (names.length === 0) throw new Error(`${MODULE_DIR} holds no shader modules`);
	const hash = createHash('sha256');
	const hasher = new Transform({
		transform(chunk: Buffer, _encoding, done) {
			hash.update(chunk);
			done(null, chunk);
		},
	});
	const blocks = async function* (): AsyncGenerator<Buffer> {
		for (const name of names) {
			const path = join(folder, name);
			const stat = statSync(path);
			for (const block of fileHeader(name, stat.size, stat.mode & 0o777)) yield block;
			// A file's data fills whole blocks, and its header already names its true size.
			for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 }))
				yield chunk as Buffer;
			const rest = padding(stat.size);
			if (rest.length > 0) yield rest;
		}
		// The archive ends with two empty blocks.
		yield Buffer.alloc(BLOCK * 2);
	};
	await pipeline(
		Readable.from(blocks()),
		createBrotliCompress({
			params: {
				[constants.BROTLI_PARAM_QUALITY]: 11,
				[constants.BROTLI_PARAM_LGWIN]: 22,
			},
		}),
		hasher,
		createWriteStream(out),
	);
	return hash.digest('hex');
}
