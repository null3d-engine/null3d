import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	REGISTRY_FILE,
	registrySource,
	SPECIES_DIR,
	SPECIES_PAGE,
	speciesFolders,
	speciesPage,
	vegetationRegistryFiles,
} from './vegetation-registry';

const ROOT = join(import.meta.dirname, '../..');

/** A repository of species folders in a temporary directory. */
function fixture(folders: Record<string, readonly string[]>): string {
	const root = mkdtempSync(join(tmpdir(), 'vegetation-registry-'));
	for (const [folder, files] of Object.entries(folders)) {
		const dir = join(root, SPECIES_DIR, folder);
		mkdirSync(dir, { recursive: true });
		for (const file of files) writeFileSync(join(dir, file), '');
	}
	return root;
}

describe('the vegetation species registry', () => {
	it('lists every species folder with an entry, sorted, and leaves out the underscored ones', () => {
		const root = fixture({
			'silver-birch': ['index.ts', 'record.ts', 'hooks.ts'],
			'common-alder': ['index.ts', 'record.ts'],
			_template: ['index.ts', 'record.ts'],
			_stub: ['index.ts', 'record.ts'],
			'half-made': ['record.ts'],
		});
		try {
			const folders = speciesFolders(root);
			expect(folders).toEqual([
				{ id: 'common-alder', hooks: false },
				{ id: 'silver-birch', hooks: true },
			]);
			const source = registrySource(folders);
			expect(source).toContain("\t'common-alder': () => import('./common-alder/index'),");
			expect(source).toContain("\t'silver-birch': () => import('./silver-birch/index'),");
			expect(source).toContain("\t'silver-birch': () => import('./silver-birch/hooks'),");
			expect(source).not.toContain('common-alder/hooks');
			expect(source).not.toContain('_template');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('writes a species page that says when no species ships', () => {
		const page = speciesPage(ROOT, []);
		expect(page).toContain('status: generated');
		expect(page).toContain('The add-on ships no species yet.');
	});

	it('matches the folders in the repository, and the page lists every species', () => {
		// The install step, the git hooks and `bun run docs` write both files. A species folder added
		// without them shows here.
		const files = vegetationRegistryFiles(ROOT);
		expect(readFileSync(join(ROOT, REGISTRY_FILE), 'utf8')).toBe(files.get(REGISTRY_FILE) ?? '');
		const page = files.get(SPECIES_PAGE) ?? '';
		for (const folder of speciesFolders(ROOT)) expect(page).toContain(`\`${folder.id}\``);
	});
});
