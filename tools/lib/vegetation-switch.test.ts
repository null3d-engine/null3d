// The vegetation add-on's list of files names every file outside its packages that reaches it: a
// file that imports the add-on, or imports a file of the list, belongs to the list. A file missing
// from it would bring the add-on back into the commands that leave it out.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { isVegetationFile, VEGETATION_FILES, VEGETATION_PACKAGES } from './vegetation-switch.ts';

const ROOT = join(import.meta.dirname, '..', '..');

/** The folders whose code the repository's commands read. */
const SCANNED = ['tests', 'tools', 'bench', 'examples', 'packages'];

/** Every import specifier of a source file: static, re-exported and dynamic. */
function specifiers(text: string): string[] {
	const found: string[] = [];
	for (const match of text.matchAll(
		/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]|new URL\(\s*['"]([^'"]+)['"],\s*import\.meta\.url/g,
	))
		found.push((match[1] ?? match[2]) as string);
	return found;
}

/** The add-on's package names, which an import names directly. */
const ADDON = new RegExp(`^@null3d/(${VEGETATION_PACKAGES.join('|')})(/|$)`);

describe('the vegetation add-on files', () => {
	it('name every file outside the packages that reaches the add-on', () => {
		const files = SCANNED.flatMap((folder) =>
			[...new Bun.Glob(`${folder}/**/*.{ts,tsx,js,mjs,html}`).scanSync({ cwd: ROOT })].filter(
				(path) => !path.includes('node_modules/') && !path.includes('/dist/'),
			),
		);
		const reaching = new Set(files.filter((path) => isVegetationFile(path)));
		const imports = new Map(
			files
				.filter((path) => !reaching.has(path))
				.map((path) => [path, specifiers(readFileSync(join(ROOT, path), 'utf8'))] as const),
		);
		const outside: string[] = [];
		let grew = true;
		while (grew) {
			grew = false;
			for (const [path, list] of imports) {
				const hit = list.find((spec) => {
					if (ADDON.test(spec)) return true;
					if (!spec.startsWith('.')) return false;
					const target = relative(
						ROOT,
						normalize(join(ROOT, dirname(path), spec.split('?')[0] as string)),
					);
					return isVegetationFile(target) || reaching.has(target);
				});
				if (!hit) continue;
				outside.push(`${path} imports ${hit}`);
				reaching.add(path);
				imports.delete(path);
				grew = true;
			}
		}
		expect(outside).toEqual([]);
		// Reading every source file of the repository takes a few seconds.
	}, 60_000);

	it('are left out of the type check projects that CI checks, and checked in their own', () => {
		// The configs are JSON with comments, so the check reads each glob as a quoted string.
		const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
		const [pages, root] = [read('tests/pages/tsconfig.json'), read('tsconfig.json')];
		const [pagesOwn, rootOwn] = [
			read('tests/pages/tsconfig.vegetation.json'),
			read('tsconfig.vegetation.json'),
		];
		for (const glob of VEGETATION_FILES) {
			const inPages = glob.startsWith('tests/pages/');
			const name = inPages ? glob.slice('tests/pages/'.length) : glob;
			expect([glob, (inPages ? pages : root).includes(`"${name}"`)]).toEqual([glob, true]);
			const stem = name.replace(/(\/\*\*|\.\*|\*)$/, '');
			expect([glob, (inPages ? pagesOwn : rootOwn).includes(`"${stem}`)]).toEqual([glob, true]);
		}
	});

	it('are left out of the lint, whose by-hand run takes them back', () => {
		// `bun run test:vegetation` lints them with these entries taken out of a copy of the config.
		const lint = readFileSync(join(ROOT, 'biome.json'), 'utf8');
		for (const entry of [
			...VEGETATION_PACKAGES.map((name) => `packages/${name}`),
			...VEGETATION_FILES,
		])
			expect([entry, lint.includes(`"!${entry}"`)]).toEqual([entry, true]);
	});
});
