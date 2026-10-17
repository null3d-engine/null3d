import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';
import {
	createShaderArchive,
	hashFile,
	shaderArtifactFile,
	shaderArtifactRecord,
	shaderArtifactUrl,
	writeShaderArtifact,
} from './shader-artifact';
import { MODULE_DIR } from './shader-modules';

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A folder of shader modules, as the shader build writes them. */
function fixture(files: Readonly<Record<string, string>>): string {
	const root = mkdtempSync(join(tmpdir(), 'null3d-shader-artifact-'));
	roots.push(root);
	mkdirSync(join(root, MODULE_DIR), { recursive: true });
	for (const [name, text] of Object.entries(files))
		writeFileSync(join(root, MODULE_DIR, name), text);
	return root;
}

const BLOCK = 512;

/** The files of a tar, by their path at the archive root, read through GNU long-name entries. */
function tarFiles(bytes: Buffer): Map<string, Buffer> {
	const files = new Map<string, Buffer>();
	let long: string | null = null;
	for (let at = 0; at + BLOCK <= bytes.length; ) {
		const header = bytes.subarray(at, at + BLOCK);
		if (header.every((byte) => byte === 0)) break;
		const field = (start: number, length: number) =>
			header.toString('utf8', start, start + length).replace(/\0.*$/, '');
		const size = Number.parseInt(field(124, 12) || '0', 8);
		const type = String.fromCharCode(header[156] as number);
		const data = bytes.subarray(at + BLOCK, at + BLOCK + size);
		const prefix = field(345, 155);
		const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
		if (type === 'L') long = data.toString('utf8').replace(/\0$/, '');
		else if (type === '0') {
			files.set(long ?? name, Buffer.from(data));
			long = null;
		}
		at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;
	}
	return files;
}

const LONG = `shaders-${'area-lights-and-'.repeat(8)}wgsl.js`;

describe('the shader archive', () => {
	it('holds the shader modules at the root, and the same bytes for the same tree', async () => {
		const root = fixture({
			'shaders.ts': 'export const A = 1;\n',
			'shaders-wgsl.js': 'export const B = 2;\n',
			[LONG]: 'export const C = 3;\n',
			// The engine's generated constants modules are not shader modules, so the archive skips them.
			'core.ts': 'export const CORE = 1;\n',
			'gpu.ts': 'export const GPU = 1;\n',
		});
		const first = join(root, 'first.tar.br');
		const second = join(root, 'second.tar.br');
		const firstHash = await createShaderArchive(root, first);
		const secondHash = await createShaderArchive(root, second);
		expect(secondHash).toBe(firstHash);
		expect(readFileSync(second).equals(readFileSync(first))).toBe(true);

		const files = tarFiles(brotliDecompressSync(readFileSync(first)));
		expect([...files.keys()].sort()).toEqual(['shaders-wgsl.js', 'shaders.ts', LONG].sort());
		expect(files.get('shaders.ts')?.toString()).toBe('export const A = 1;\n');
		expect(files.get('shaders-wgsl.js')?.toString()).toBe('export const B = 2;\n');
		expect(files.get(LONG)?.toString()).toBe('export const C = 3;\n');
	});

	it('records the same name, address and hash that the release serves', () => {
		const record = shaderArtifactRecord({
			tag: '0.1.0',
			repo: 'null3d-engine/null3d',
			sha256: 'a'.repeat(64),
		});
		expect(record).toEqual({
			tag: '0.1.0',
			file: '0.1.0-shaders.tar.br',
			url: 'https://github.com/null3d-engine/null3d/releases/download/0.1.0/0.1.0-shaders.tar.br',
			sha256: 'a'.repeat(64),
		});
		expect(shaderArtifactFile('0.1.0')).toBe('0.1.0-shaders.tar.br');
		expect(shaderArtifactUrl('null3d-engine/null3d', '0.1.0', record.file)).toBe(record.url);
	});

	it('writes the record as one line, and hashes the archive it is given', async () => {
		const root = fixture({ 'shaders.ts': 'export {};\n' });
		const archive = join(root, '0.1.0-shaders.tar.br');
		const hash = await createShaderArchive(root, archive);
		const out = join(root, 'lib/shader-artifact.json');
		const record = shaderArtifactRecord({
			tag: '0.1.0',
			repo: 'null3d-engine/null3d',
			sha256: hashFile(archive),
		});
		writeShaderArtifact(out, record);
		expect(hashFile(archive)).toBe(hash);
		expect(readFileSync(out, 'utf8')).toBe(`${JSON.stringify(record)}\n`);
		expect(statSync(out).size).toBe(JSON.stringify(record).length + 1);
	});

	it('refuses a hash that is not 64 hexadecimal digits, and a repository without an owner', () => {
		expect(() =>
			shaderArtifactRecord({ tag: '0.1.0', repo: 'null3d-engine/null3d', sha256: 'abc' }),
		).toThrow('64 lowercase hexadecimal digits');
		expect(() =>
			shaderArtifactRecord({ tag: '0.1.0', repo: 'null3d', sha256: 'a'.repeat(64) }),
		).toThrow('owner/name');
	});

	it('refuses a folder that holds no shader modules', async () => {
		const root = fixture({ 'core.ts': 'export {};\n' });
		await expect(createShaderArchive(root, join(root, 'out.tar.br'))).rejects.toThrow(
			'holds no shader modules',
		);
	});
});
