// The CDN build's helpers: the hash that lets a second run write nothing, and the sizes that the
// tool prints.
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CDN_ENTRY, cdnSourcesHash, shownSize } from './cdn';

/** A checkout with the folders that the hash reads, and one source file. */
function checkout(source: string): string {
	const root = mkdtempSync(join(tmpdir(), 'null3d-cdn-'));
	for (const folder of ['src', 'dist/wasm', 'vendor'])
		mkdirSync(join(root, 'packages/engine', folder), { recursive: true });
	writeFileSync(join(root, 'packages/engine/src/index.ts'), source);
	return root;
}

describe('the CDN build', () => {
	it('names the engine entry point inside the folder', () => {
		expect(CDN_ENTRY).toBe('lib/index.js');
	});

	it('gives a size in the unit that keeps it short', () => {
		expect(shownSize(512)).toBe('512 B');
		expect(shownSize(2048)).toBe('2.0 KB');
		expect(shownSize(3 * 1024 * 1024)).toBe('3.0 MB');
		expect(shownSize(2 * 1024 ** 3)).toBe('2.00 GB');
	});

	it('hashes the files it copies and builds from, so a change rewrites the build', () => {
		const root = checkout('export {};\n');
		const first = cdnSourcesHash(root);
		expect(cdnSourcesHash(root)).toBe(first);
		// The same folder hashes the same, so a second run writes nothing.
		writeFileSync(join(root, 'packages/engine/dist/wasm/single.wasm'), 'wasm');
		expect(cdnSourcesHash(root)).not.toBe(first);
		// A changed source gives another hash, so the next run copies the build again.
		const changed = checkout('export const load = 1;\n');
		expect(cdnSourcesHash(changed)).not.toBe(first);
	});
});
