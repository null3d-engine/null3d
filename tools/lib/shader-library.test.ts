import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { checkDocsStyle } from './docs-style';
import { fixture } from './fixture';
import { parseFrontMatter } from './frontmatter';
import {
	LIBRARY_DIR,
	libraryPage,
	PUBLIC_MODULES,
	parseModule,
	readLibrary,
} from './shader-library';

const repoRoot = join(import.meta.dir, '../..');

const MODULE = `#define_import_path null3d::demo
#import null3d::math

// Demo helpers: one of each kind of item. A second sentence.

/// The answer.
const ANSWER: f32 = 42.0;

/// A pair of values.
struct Pair {
    /// The first value.
    first: f32,
    /// The second value.
    second: f32,
}

// A section comment, which the page leaves out.

/// Adds the two values of a pair.
fn add(
    p: Pair,
    scale: f32,
) -> f32 {
    return (p.first + p.second) * scale;
}
`;

describe('parseModule', () => {
	it('reads the summary, then each item with its declaration and doc comment', () => {
		const problems: string[] = [];
		const module = parseModule('demo', 'lib/demo.wgsl', MODULE, problems);
		expect(problems).toEqual([]);
		expect(module.name).toBe('null3d::demo');
		expect(module.summary).toBe('Demo helpers: one of each kind of item. A second sentence.');
		expect(module.items.map((item) => [item.kind, item.name, item.doc])).toEqual([
			['const', 'ANSWER', 'The answer.'],
			['struct', 'Pair', 'A pair of values.'],
			['fn', 'add', 'Adds the two values of a pair.'],
		]);
		expect(module.items[0]?.declaration).toBe('const ANSWER: f32 = 42.0;');
		expect(module.items[1]?.declaration).toBe(
			'struct Pair {\n    first: f32,\n    second: f32,\n}',
		);
		expect(module.items[1]?.fields).toEqual([
			{ name: 'first', doc: 'The first value.' },
			{ name: 'second', doc: 'The second value.' },
		]);
		expect(module.items[2]?.declaration).toBe('fn add(p: Pair, scale: f32) -> f32');
	});

	it('reports items and fields without doc comments, and a module without a summary', () => {
		const problems: string[] = [];
		const text = MODULE.replace('/// The answer.\n', '')
			.replace('    /// The second value.\n', '')
			.replace('// Demo helpers: one of each kind of item. A second sentence.\n', '');
		parseModule('demo', 'lib/demo.wgsl', text, problems);
		expect(problems).toEqual([
			'lib/demo.wgsl:5: const ANSWER has no /// doc comment',
			'lib/demo.wgsl:8: field Pair.second has no /// doc comment',
			'lib/demo.wgsl: the module has no comment that describes it',
		]);
	});
});

describe('readLibrary', () => {
	it('asks for a decision on a module that neither list names', () => {
		const root = fixture({
			[`${LIBRARY_DIR}/math.wgsl`]: MODULE.replace('null3d::demo', 'null3d::math'),
			[`${LIBRARY_DIR}/extra.wgsl`]: '#define_import_path null3d::extra\n',
		});
		const { problems } = readLibrary(root);
		expect(problems).toContain(
			`${LIBRARY_DIR}/extra.wgsl: add the module to PUBLIC_MODULES or INTERNAL_MODULES in tools/lib/shader-library.ts`,
		);
		expect(problems).toContain(`${LIBRARY_DIR}/noise.wgsl is missing`);
	});

	it("reads every public module of the repository's library without problems", () => {
		const { modules, problems } = readLibrary(repoRoot);
		expect(problems).toEqual([]);
		expect(modules.map((m) => m.name)).toEqual(PUBLIC_MODULES.map((name) => `null3d::${name}`));
		for (const module of modules) expect(module.items.length).toBeGreaterThan(0);
	});
});

describe('libraryPage', () => {
	it('lists each module with a link to its section, and each item under a heading', () => {
		const module = parseModule('demo', 'lib/demo.wgsl', MODULE, []);
		const page = libraryPage([module], 'Shader library', 'The modules.');
		expect(parseFrontMatter(page)?.data).toMatchObject({
			id: 'shaders/library',
			status: 'experimental',
		});
		expect(page).toContain(
			'| [`null3d::demo`](#null3ddemo) | Demo helpers: one of each kind of item. |',
		);
		expect(page).toContain('## `null3d::demo`');
		expect(page).toContain('### `add`\n\n```wgsl\nfn add(p: Pair, scale: f32) -> f32\n```');
		expect(page).toContain('- `first`: The first value.');
		expect(page).not.toContain('section comment');
	});

	it("follows the writing rules for the repository's library", () => {
		const page = libraryPage(readLibrary(repoRoot).modules, 'Shader library', 'The modules.');
		expect(checkDocsStyle(page).filter((finding) => finding.severity === 'error')).toEqual([]);
	});
});
