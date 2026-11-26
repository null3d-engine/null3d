import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sameModel, withGenerator } from './glb-bytes.ts';

/** A small file that the asset tool wrote, as the repository holds it. */
const MODEL = readFileSync(
	join(import.meta.dirname, '../pages/assets/models/converted/pyramid-stl.glb'),
);

/** The generator that a GLB file names, read from its JSON chunk. */
function generatorOf(bytes: Uint8Array): string {
	const length = Buffer.from(bytes).readUInt32LE(12);
	return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))).asset.generator;
}

describe('the GLB comparison that leaves out the generator', () => {
	it("keeps every byte of a file when it sets the file's own generator", () => {
		expect(withGenerator(MODEL, generatorOf(MODEL)).equals(MODEL)).toBe(true);
	});

	it('writes a generator of another length, and keeps the file whole', () => {
		const longer = withGenerator(MODEL, 'null3D asset tool 10.20.30-beta.4');
		expect(generatorOf(longer)).toBe('null3D asset tool 10.20.30-beta.4');
		expect(longer.length % 4).toBe(0);
		expect(longer.readUInt32LE(8)).toBe(longer.length);
		expect(withGenerator(longer, generatorOf(MODEL)).equals(MODEL)).toBe(true);
	});

	it('finds two files the same when only their generators differ', () => {
		expect(sameModel(withGenerator(MODEL, 'null3D asset tool 9.9.9'), MODEL)).toBe(true);
	});

	it('finds two files different when a byte of their data differs', () => {
		const changed = Buffer.from(MODEL);
		changed[changed.length - 1] = (changed[changed.length - 1] as number) ^ 1;
		expect(sameModel(changed, MODEL)).toBe(false);
	});

	it('compares bytes that hold no GLB file as they are', () => {
		expect(sameModel(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
		expect(sameModel(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
	});
});
