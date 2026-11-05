// The CDN build's helpers: the hash that lets a second run write nothing, the sizes that the tool
// prints, the package imports that the add-ons' copies make relative, and the two entries that the
// build makes from code whose build constants no bundler defined.
import { describe, expect, it } from 'bun:test';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	CDN_ADDONS,
	CDN_DEV_ENTRY,
	CDN_ENTRY,
	cdnSourcesHash,
	constantsDefined,
	filesNamingConstants,
	packageEntries,
	packageImportsMadeRelative,
	shownSize,
	splitEntries,
} from './cdn';

/** A checkout with the folders that the hash reads, and one source file. */
function checkout(source: string): string {
	const root = mkdtempSync(join(tmpdir(), 'null3d-cdn-'));
	for (const folder of ['src', 'dist/wasm', 'vendor', 'levels'])
		mkdirSync(join(root, 'packages/engine', folder), { recursive: true });
	writeFileSync(join(root, 'packages/engine/src/index.ts'), source);
	return root;
}

describe('the CDN build', () => {
	it('carries every public package that builds on the engine', () => {
		// A page with no build step can load only the add-ons that the build carries, and the docs
		// promise every foundation add-on there.
		const packages = join(import.meta.dirname, '../../packages');
		const addOns = readdirSync(packages)
			.filter((name) => {
				try {
					const manifest = JSON.parse(
						readFileSync(join(packages, name, 'package.json'), 'utf8'),
					) as {
						private?: boolean;
						peerDependencies?: Record<string, string>;
					};
					return manifest.private !== true && '@null3d/engine' in (manifest.peerDependencies ?? {});
				} catch {
					return false;
				}
			})
			.sort();
		expect(addOns.length).toBeGreaterThan(0);
		expect([...CDN_ADDONS].sort()).toEqual(addOns);
	});

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

	it('names both entry points inside the folder', () => {
		expect(CDN_DEV_ENTRY).toBe('lib-dev/index.js');
	});
});

describe('package imports in the add-ons', () => {
	const entries = packageEntries(join(import.meta.dirname, '../..'));

	it('places every package entry that the manifests export', () => {
		expect(entries['@null3d/engine']).toBe('lib/index.js');
		expect(entries['@null3d/engine/stats']).toBe('lib/stats.js');
		expect(entries['@null3d/impostors']).toBe('addons/impostors/lib/index.js');
		expect(entries['@null3d/vegetation']).toBe('addons/vegetation/lib/index.js');
		expect(entries['@null3d/engine/levels-planner']).toBe('levels/planner.js');
	});

	it('makes the engine and other add-ons relative, and leaves other text alone', () => {
		// A worker reads no import map, so an add-on that imports another by name must reach it by
		// its place in the build.
		const text = [
			"import { createEngine } from '@null3d/engine';",
			"import { bakeImpostorAtlas } from '@null3d/impostors';",
			"throw new Error('@null3d/water: a band needs a tile above 0 meters');",
			"import { compile } from '@null3d/vite-plugin';",
		].join('\n');
		expect(
			packageImportsMadeRelative(text, 'addons/vegetation/lib/render/material.js', entries),
		).toBe(
			[
				"import { createEngine } from '../../../../lib/index.js';",
				"import { bakeImpostorAtlas } from '../../../impostors/lib/index.js';",
				"throw new Error('@null3d/water: a band needs a tile above 0 meters');",
				"import { compile } from '@null3d/vite-plugin';",
			].join('\n'),
		);
	});
});

/** The code of a small build, as the package builds write it, whose constants nothing defined. */
const FIXTURE: Readonly<Record<string, string>> = {
	'lib/index.js': "export * from './page/engine.js';\nimport './generated/gpu.js';\n",
	'lib/page/engine.js': [
		"import { DEV, URL_SWITCHES } from '../shared/dev.js';",
		"import { add } from '../math/vec.js';",
		"import { table } from '../generated/gpu.js';",
		"const worker = new URL('../workers/worker.js', import.meta.url);",
		"const wasm = new URL('../../dist/wasm/single/null3d_bg.wasm', import.meta.url);",
		'export { DEV, URL_SWITCHES, add, table, worker, wasm };',
	].join('\n'),
	'lib/shared/dev.js': [
		"export const DEV = typeof __NULL3D_DEV__ === 'undefined' ? true : __NULL3D_DEV__;",
		"export const URL_SWITCHES = typeof __NULL3D_URL_SWITCHES__ === 'undefined' ? DEV : __NULL3D_URL_SWITCHES__;",
	].join('\n'),
	'lib/workers/worker.js': "import { DEV } from '../shared/dev.js';\nexport { DEV };\n",
	'lib/math/vec.js': 'export const add = 1;\n',
	'lib/stats.js': "export { add } from './math/vec.js';\n",
	'lib/generated/gpu.js': "import { p } from './paragraphs.js';\nexport const table = p;\n",
	'lib/generated/paragraphs.js': 'export const p = 1;\n',
	'dist/wasm/single/null3d_bg.wasm': 'wasm',
	'addons/terrain/lib/index.js': [
		"import { DEV } from '../../../lib/index.js';",
		"import { material } from './terrain.wgsl-material-0.js';",
		"const wasm = new URL('../dist/terrain.wasm', import.meta.url);",
		'export { DEV, material, wasm };',
	].join('\n'),
	'addons/terrain/lib/terrain.wgsl-material-0.js': "export const material = 'shader';\n",
	'addons/terrain/dist/terrain.wasm': 'wasm',
};

/** A build folder that holds the fixture's files, and any others given. */
function build(extra: Readonly<Record<string, string>> = {}): string {
	const out = mkdtempSync(join(tmpdir(), 'null3d-cdn-build-'));
	for (const [path, text] of Object.entries({ ...FIXTURE, ...extra })) {
		mkdirSync(dirname(join(out, path)), { recursive: true });
		writeFileSync(join(out, path), text);
	}
	return out;
}

const PRODUCTION = { __NULL3D_DEV__: false, __NULL3D_URL_SWITCHES__: false } as const;

/** The fixture's files that pages import. */
const ENTRIES = ['lib/index.js', 'lib/stats.js', 'addons/terrain/lib/index.js'];

describe('the two entries', () => {
	it('defines each constant as a bundler would', () => {
		expect(constantsDefined("typeof __NULL3D_DEV__ === 'undefined'", PRODUCTION)).toBe(
			"typeof false === 'undefined'",
		);
		expect(constantsDefined('x__NULL3D_DEV__', PRODUCTION)).toBe('x__NULL3D_DEV__');
	});

	it('leaves no file of either entry reading an undefined constant', async () => {
		const out = build();
		expect(filesNamingConstants(out)).toEqual(['lib/shared/dev.js']);
		splitEntries(out, PRODUCTION, ENTRIES);
		expect(filesNamingConstants(out)).toEqual([]);
		const production = await import(join(out, 'lib/shared/dev.js'));
		expect([production.DEV, production.URL_SWITCHES]).toEqual([false, false]);
		const development = await import(join(out, 'lib-dev/shared/dev.js'));
		expect([development.DEV, development.URL_SWITCHES]).toEqual([true, true]);
	});

	it('copies only the files that reach a constant, and shares the rest', () => {
		const out = build();
		const { devFiles } = splitEntries(out, PRODUCTION, ENTRIES);
		const dev = (path: string) => existsSync(join(out, path));
		// Each file that names a constant, imports one that does, or loads one as a worker differs.
		for (const path of [
			'lib-dev/index.js',
			'lib-dev/page/engine.js',
			'lib-dev/shared/dev.js',
			'lib-dev/workers/worker.js',
			'addons/terrain/lib-dev/index.js',
			// A public entry that reaches no constant still has its address in both entries.
			'lib-dev/stats.js',
		])
			expect(dev(path)).toBe(true);
		// The shader modules and plain code run the same in both entries, so one copy serves both.
		for (const path of [
			'lib-dev/generated/gpu.js',
			'lib-dev/generated/paragraphs.js',
			'lib-dev/math/vec.js',
			'addons/terrain/lib-dev/terrain.wgsl-material-0.js',
		])
			expect(dev(path)).toBe(false);
		expect(devFiles).toBe(6);
	});

	it('points each copy at the copies that differ and at the shared files', () => {
		const out = build();
		splitEntries(out, PRODUCTION, ENTRIES);
		const read = (path: string) => readFileSync(join(out, path), 'utf8');
		expect(read('lib-dev/index.js')).toContain("from './page/engine.js'");
		expect(read('lib-dev/index.js')).toContain("import '../lib/generated/gpu.js'");
		const engine = read('lib-dev/page/engine.js');
		expect(engine).toContain("from '../shared/dev.js'");
		expect(engine).toContain("from '../../lib/math/vec.js'");
		expect(engine).toContain("from '../../lib/generated/gpu.js'");
		expect(engine).toContain("new URL('../workers/worker.js', import.meta.url)");
		expect(engine).toContain("new URL('../../dist/wasm/single/null3d_bg.wasm', import.meta.url)");
		const addon = read('addons/terrain/lib-dev/index.js');
		expect(addon).toContain("from '../../../lib-dev/index.js'");
		expect(addon).toContain("from '../lib/terrain.wgsl-material-0.js'");
		expect(addon).toContain("new URL('../dist/terrain.wasm', import.meta.url)");
		expect(read('lib-dev/stats.js')).toContain("from '../lib/math/vec.js'");
		// The production entry keeps its own addresses.
		expect(read('lib/page/engine.js')).toBe(FIXTURE['lib/page/engine.js'] as string);
	});

	it('lets the production entry read address switches for benchmark pages', async () => {
		const out = build();
		splitEntries(out, { __NULL3D_DEV__: false, __NULL3D_URL_SWITCHES__: true }, ENTRIES);
		const production = await import(join(out, 'lib/shared/dev.js'));
		expect([production.DEV, production.URL_SWITCHES]).toEqual([false, true]);
	});

	it('shares a public entry outside the code, such as the level planner', () => {
		const out = build({ 'levels/planner.js': 'export const plan = () => 1;\n' });
		splitEntries(out, PRODUCTION, [...ENTRIES, 'levels/planner.js']);
		expect(existsSync(join(out, 'levels-dev/planner.js'))).toBe(false);
		expect(readFileSync(join(out, 'levels/planner.js'), 'utf8')).toBe(
			'export const plan = () => 1;\n',
		);
	});

	it('refuses a constant outside the code, which no entry could define', () => {
		const out = build({ 'vendor/decoder.js': 'const dev = __NULL3D_DEV__;\n' });
		expect(() => splitEntries(out, PRODUCTION, ENTRIES)).toThrow(
			/vendor\/decoder\.js name a build constant/,
		);
	});
});
