// The release asset's tar: the plugin reads it itself, so a header it misreads would leave a
// project with the wrong shaders or none. These tests build archives by hand and read them back.
import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readArtifact, tarEntries, unpackInto } from './engine-shaders.ts';

const folders: string[] = [];

function scratch(): string {
	const folder = mkdtempSync(join(tmpdir(), 'null3d-shaders-'));
	folders.push(folder);
	return folder;
}

afterEach(() => {
	for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** One tar header: the ustar form that GNU tar writes for these names. */
function header(name: string, size: number, type: string): Buffer {
	const block = Buffer.alloc(512);
	block.write(name, 0, 'utf8');
	block.write('0000644\0', 100, 'ascii');
	block.write('0000000\0', 108, 'ascii');
	block.write('0000000\0', 116, 'ascii');
	block.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
	block.write('00000000000\0', 136, 'ascii');
	block.write('        ', 148, 'ascii');
	block.write(type, 156, 'ascii');
	block.write('ustar\0', 257, 'ascii');
	block.write('00', 263, 'ascii');
	let sum = 0;
	for (const byte of block) sum += byte;
	block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
	return block;
}

/** One entry's header and data, padded to a block. */
function entry(name: string, data: Buffer, type: string): Buffer[] {
	const padding = (512 - (data.length % 512)) % 512;
	return [header(name, data.length, type), data, Buffer.alloc(padding)];
}

/**
 * A tar holding the given files, with the ending an archive needs. A name over 100 bytes goes in
 * the long-name entry of `long`'s kind before its file, and the file's own header holds it cut
 * short, as GNU tar and the release's archive write it.
 */
function tarOf(files: Readonly<Record<string, string>>, long: 'gnu' | 'pax' = 'gnu'): Buffer {
	const parts: Buffer[] = [];
	for (const [name, text] of Object.entries(files)) {
		if (Buffer.byteLength(name) > 100) {
			const record = (body: string) => {
				// A pax record's length counts its own digits.
				let length = body.length + 3;
				while (`${length} ${body}\n`.length !== length) length++;
				return `${length} ${body}\n`;
			};
			parts.push(
				...(long === 'gnu'
					? entry('././@LongLink', Buffer.from(`${name}\0`), 'L')
					: entry('PaxHeader', Buffer.from(record(`path=${name}`)), 'x')),
			);
		}
		parts.push(...entry(name.slice(0, 100), Buffer.from(text, 'utf8'), '0'));
	}
	parts.push(Buffer.alloc(1024));
	return Buffer.concat(parts);
}

describe('tarEntries', () => {
	it('reads every file with its bytes', () => {
		const entries = [...tarEntries(tarOf({ 'a.ts': 'one', 'b.js': 'two' }))];
		expect(entries.map((entry) => entry.name)).toEqual(['a.ts', 'b.js']);
		expect(entries.map((entry) => entry.bytes.toString('utf8'))).toEqual(['one', 'two']);
	});

	it('reads a file longer than one block', () => {
		const long = 'x'.repeat(1500);
		const [entry] = [...tarEntries(tarOf({ 'long.js': long }))];
		expect(entry?.bytes.toString('utf8')).toBe(long);
	});

	it('reads a name over 100 bytes from its long-name entry, GNU or pax', () => {
		const long = `shaders-${'area-lights-and-'.repeat(8)}glsl.js`;
		const sibling = `${long.slice(0, 100)}-other.js`;
		for (const kind of ['gnu', 'pax'] as const) {
			const entries = [
				...tarEntries(tarOf({ [long]: 'one', [sibling]: 'two', 'b.js': 'three' }, kind)),
			];
			expect(entries.map((entry) => entry.name)).toEqual([long, sibling, 'b.js']);
			expect(entries.map((entry) => entry.bytes.toString('utf8'))).toEqual(['one', 'two', 'three']);
		}
	});

	it('stops at the empty blocks that end an archive', () => {
		const tar = tarOf({ 'a.ts': 'one' });
		const withJunk = Buffer.concat([tar, Buffer.from('not a header')]);
		expect([...tarEntries(withJunk)].map((entry) => entry.name)).toEqual(['a.ts']);
	});
});

describe('unpackInto', () => {
	it('writes every file of the archive', () => {
		const folder = join(scratch(), 'set');
		unpackInto(folder, tarOf({ 'shaders.ts': 'main', 'shaders-wgsl.js': 'device' }));
		expect(readFileSync(join(folder, 'shaders.ts'), 'utf8')).toBe('main');
		expect(readFileSync(join(folder, 'shaders-wgsl.js'), 'utf8')).toBe('device');
	});

	it('writes each file with a long name under its whole name, and no long-name entry', () => {
		const folder = join(scratch(), 'set');
		const long = `shaders-${'coverage-and-'.repeat(9)}wgsl.js`;
		unpackInto(folder, tarOf({ [long]: 'device', 'shaders.ts': 'main' }));
		expect(readFileSync(join(folder, long), 'utf8')).toBe('device');
		expect(existsSync(join(folder, '@LongLink'))).toBe(false);
	});

	it('refuses a name that leaves the folder', () => {
		const folder = join(scratch(), 'set');
		expect(() => unpackInto(folder, tarOf({ '../escape.ts': 'no' }))).toThrow(/leaves its folder/);
	});
});

describe('readArtifact', () => {
	function record(value: unknown): string {
		const lib = scratch();
		writeFileSync(join(lib, 'shader-artifact.json'), JSON.stringify(value));
		return lib;
	}

	it('reads a record the release writes', () => {
		const artifact = readArtifact(
			record({
				tag: 'v0.1.0',
				file: 'v0.1.0-shaders.tar.br',
				url: 'https://example.test/v0.1.0-shaders.tar.br',
				sha256: 'a'.repeat(64),
			}),
		);
		expect(artifact?.tag).toBe('v0.1.0');
	});

	it('gives nothing for a missing record', () => {
		expect(readArtifact(scratch())).toBeUndefined();
	});

	it('gives nothing for a record whose hash is not a SHA-256', () => {
		const artifact = readArtifact(
			record({ tag: 'v0.1.0', file: 'f', url: 'https://example.test/f', sha256: 'abc' }),
		);
		expect(artifact).toBeUndefined();
	});
});
