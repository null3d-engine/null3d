// The texture folders of the vegetation add-on's species. Each folder under textures/ is one
// species', which the textures tool writes from the reference set at its pinned commit: the KTX2
// files of both sets and a manifest that lists every output with its size and hash. This test holds
// each manifest to its folder and its files, so a file that changed without the tool shows.
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The species folders' parent. */
const TEXTURES = join(import.meta.dirname, '..', 'textures');

/** What this test reads of a manifest. */
interface Manifest {
	readonly format: number;
	readonly species: string;
	readonly outputs: readonly {
		readonly file: string;
		readonly sha256: string;
		readonly bytes: number;
	}[];
}

/** The species folders, sorted, or none before the first species ships its textures. */
function folders(): string[] {
	if (!existsSync(TEXTURES)) return [];
	return readdirSync(TEXTURES, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

describe('the species texture folders', () => {
	it('hold a manifest each, which names its folder and every file in it by size and hash', () => {
		for (const folder of folders()) {
			const dir = join(TEXTURES, folder);
			const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
			expect(manifest.format, folder).toBe(1);
			expect(manifest.species, folder).toBe(folder);
			for (const output of manifest.outputs) {
				const bytes = readFileSync(join(dir, output.file));
				expect(bytes.length, `${folder}/${output.file}`).toBe(output.bytes);
				expect(createHash('sha256').update(bytes).digest('hex'), `${folder}/${output.file}`).toBe(
					output.sha256,
				);
			}
		}
	});
});
