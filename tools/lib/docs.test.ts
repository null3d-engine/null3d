import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERRORS } from '../../packages/engine/src/errors/codes.ts';
import type { ApiReference, ApiSymbol } from './api-docs';
import {
	AREAS,
	checkDocs,
	frontMatterProblems,
	generateDocs,
	inventoryProblems,
	movesProblems,
	navigation,
	PAGES,
	type PageEntry,
	pageList,
	placementProblems,
	referenceLinkProblems,
	referenceProblems,
} from './docs';
import { fixture } from './fixture';
import { parseFrontMatter, renderFrontMatter, yamlString } from './frontmatter';

const repoRoot = join(import.meta.dir, '../..');

const MAPPING = JSON.stringify({
	statusLegend: { direct: 'Same.' },
	entries: [],
});
const INDEX = `${renderFrontMatter([
	['id', 'index'],
	['title', 'Docs'],
	['summary', 'The docs.'],
])}\n# Docs\n\nSee [All pages](pages.md).\n`;
const NO_API: ApiReference = { symbols: [], problems: [] };
const SET_THING: ApiSymbol = {
	name: 'setThing',
	kind: 'function',
	page: 'api/scene',
	signature: 'function setThing(): void',
	summary: 'Sets the thing.',
	extends: [],
	members: [],
};
const THING: ApiSymbol = { ...SET_THING, name: 'Thing', page: 'api/objects' };
const writtenObjects = (body: string) =>
	`${renderFrontMatter([
		['id', 'api/objects'],
		['title', 'Objects'],
		['summary', 'Written.'],
	])}\n# Objects\n\n${body}\n\nMore text.\n`;

describe('front matter', () => {
	it('quotes values YAML would misread, and leaves plain words bare', () => {
		expect(yamlString('stable')).toBe('stable');
		expect(yamlString('after 1.0')).toBe('after 1.0');
		expect(yamlString('0.1')).toBe('"0.1"');
		expect(yamlString('Page API: createEngine')).toBe('"Page API: createEngine"');
		expect(yamlString('yes')).toBe('"yes"');
	});

	it("round-trips every inventory page's title and summary through front matter", () => {
		for (const page of PAGES) {
			const data = page.generated
				? page
				: parseFrontMatter(readFileSync(join(repoRoot, `docs/${page.id}.md`), 'utf8'))?.data;
			const fields = { id: page.id, title: String(data?.title), summary: String(data?.summary) };
			expect(parseFrontMatter(renderFrontMatter(Object.entries(fields)))?.data).toEqual(fields);
		}
	});

	it('rejects invalid YAML', () => {
		expect(() => parseFrontMatter('---\ntitle: Page API: createEngine\n---\n')).toThrow();
	});
});

/** The written handles page, with optional labels in its front matter. */
function writtenHandles(labels: [string, string][] = []): string {
	return `${renderFrontMatter([['id', 'concepts/handles'], ['title', 'Handles'], ...labels, ['summary', 'S']])}
# Handles
`;
}

describe('frontMatterProblems', () => {
	const inventory = new Set(['concepts/handles']);
	it('accepts a page with no labels, and one with labels the owner chose', () => {
		expect(frontMatterProblems('docs/concepts/handles.md', writtenHandles(), inventory)).toEqual(
			[],
		);
		expect(
			frontMatterProblems(
				'docs/concepts/handles.md',
				writtenHandles([
					['status', 'experimental'],
					['since', '1.2'],
				]),
				inventory,
			),
		).toEqual([]);
	});

	it('reports a wrong id, a bad label, a bad generated mark and a page outside the inventory', () => {
		const text = renderFrontMatter([
			['id', 'concepts/other'],
			['title', 'T'],
			['status', 'done'],
			['since', 'soon'],
			['generated', 'maybe'],
			['summary', 'S'],
		]);
		const problems = frontMatterProblems('docs/concepts/other.md', text, inventory);
		expect(problems.join('\n')).toContain('status "done"');
		expect(
			frontMatterProblems(
				'docs/concepts/handles.md',
				writtenHandles([['status', 'planned']]),
				inventory,
			).join('\n'),
		).toContain('status "planned" is not allowed');
		expect(problems.join('\n')).toContain('since "soon"');
		expect(problems.join('\n')).toContain('generated must be true');
		expect(problems.join('\n')).toContain('not in the inventory');
		expect(frontMatterProblems('docs/concepts/x.md', text, inventory).join('\n')).toContain(
			'id is "concepts/other"',
		);
	});

	it('takes a generated page that the inventory leaves out', () => {
		const text = renderFrontMatter([
			['id', 'concepts/other'],
			['title', 'T'],
			['generated', true],
			['summary', 'S'],
		]);
		expect(frontMatterProblems('docs/concepts/other.md', text, inventory)).toEqual([]);
	});
});

describe('navigation', () => {
	it('places every inventory page but the home once, under its area and group', () => {
		const nav = navigation();
		const ids = nav.flatMap((a) => a.groups.flatMap((g) => g.pages));
		expect(ids.sort()).toEqual(
			PAGES.map((p) => p.id)
				.filter((id) => id !== 'index')
				.sort(),
		);
		expect(nav.map((a) => a.id)).toEqual(AREAS.map((a) => a.id));
		const concepts = nav.find((a) => a.id === 'concepts');
		expect(concepts?.groups[0]?.title).toBe('How the engine runs');
		expect(nav.find((a) => a.id === 'cookbook')?.groups).toEqual([
			{ title: null, pages: ['cookbook/index'] },
		]);
	});

	it('finds no problem with the inventory', () => {
		expect(inventoryProblems()).toEqual([]);
	});

	it('reports a missing group, a wrong group, an empty group and a title on a written page', () => {
		const areas = [
			{ id: 'concepts', title: 'Concepts', groups: ['One', 'Two'] },
			{ id: 'cookbook', title: 'Cookbook' },
		];
		const pages = [
			{ id: 'concepts/a' },
			{ id: 'concepts/b', group: 'Three' },
			{ id: 'cookbook/index', group: 'One' },
			{ id: 'concepts/c', group: 'One', title: 'C', summary: 'S' } as PageEntry,
			{ id: 'other/d' },
		];
		expect(inventoryProblems(pages, areas)).toEqual([
			'concepts/a needs a group of concepts: One, Two',
			'concepts/b needs a group of concepts: One, Two',
			'cookbook/index has a group, but cookbook has no groups',
			'concepts/c is a written page; its title and summary belong in its front matter',
			'other/d is in no area of AREAS',
			'the group Two of concepts has no pages',
		]);
	});
});

describe('pageList', () => {
	it('lists each area and group in navigation order and links pages relative to docs/', () => {
		const nav = [
			{
				id: 'concepts',
				title: 'Concepts',
				groups: [{ title: 'First', pages: ['concepts/architecture', 'concepts/handles'] }],
			},
			{ id: 'cookbook', title: 'Cookbook', groups: [{ title: null, pages: ['cookbook/index'] }] },
		];
		const info = (id: string, title: string, summary: string) =>
			[id, { id, title, summary }] as const;
		const list = pageList(
			nav,
			new Map([
				info('concepts/handles', 'Handles', 'a | b'),
				info('concepts/architecture', 'Architecture', 'x'),
				info('cookbook/index', 'Cookbook', 'y'),
			]),
		);
		expect(list.indexOf('concepts/architecture.md')).toBeLessThan(
			list.indexOf('concepts/handles.md'),
		);
		expect(list).toContain('## Concepts\n\n### First\n\n| Page |');
		expect(list).toContain('## Cookbook\n\n| Page |');
		expect(list).toContain('a \\| b');
	});
});

describe('movesProblems', () => {
	const isPage = (id: string) => ['concepts/new', 'concepts/newest'].includes(id);
	it('accepts an empty file and moves that lead to a page, through a chain', () => {
		expect(movesProblems('{}\n', isPage)).toEqual([]);
		expect(
			movesProblems('{"concepts/old":"concepts/new","concepts/older":"concepts/old"}', isPage),
		).toEqual([]);
	});

	it('reports a missing file, a dead end, an old ID that is a page again, and a removed entry', () => {
		expect(movesProblems(null, isPage)[0]).toContain('is missing');
		expect(movesProblems('{"concepts/old":"concepts/gone"}', isPage)[0]).toContain(
			'leads to concepts/gone',
		);
		expect(movesProblems('{"concepts/new":"concepts/newest"}', isPage)[0]).toContain(
			'is a page again',
		);
		expect(movesProblems('{}', isPage, '{"concepts/old":"concepts/new"}')).toEqual([
			'docs/moves.json: the entry for concepts/old was removed; keep it',
		]);
	});
});

describe('placementProblems', () => {
	it('reports a generated page that the inventory does not place', () => {
		const generated = new Map(
			PAGES.filter((p) => p.generated).map((p) => [`docs/${p.id}.md`, ''] as const),
		);
		expect(placementProblems(generated)).toEqual([]);
		generated.set('docs/concepts/stray.md', '');
		generated.set('docs/errors/E1101.md', '');
		generated.set('docs/api/reference/scene.md', '');
		expect(placementProblems(generated)).toEqual([
			'concepts/stray is generated, but the inventory does not place it',
		]);
	});
});

describe('generateDocs', () => {
	it('keeps written pages, writes no page that is missing, and lists every page', () => {
		const written = `${renderFrontMatter([
			['id', 'concepts/handles'],
			['title', 'Handles'],
			['summary', 'Written.'],
		])}\n# Handles\n`;
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
			'docs/concepts/handles.md': written,
		});
		const out = generateDocs(root, NO_API);
		expect(out.has('docs/concepts/handles.md')).toBe(false);
		expect(out.has('docs/index.md')).toBe(false);
		expect(out.has('docs/concepts/architecture.md')).toBe(false);
		const pages = out.get('docs/pages.md') ?? '';
		expect(pages).toContain('generated: true');
		expect(pages).toContain('[Handles](concepts/handles.md)');
		expect(pages).toContain('## Concepts');
		expect(pages).toContain('### How the engine runs');
		expect(pages).not.toContain('(index.md) |');
		expect(JSON.parse(out.get('docs/nav.json') ?? '{}').areas[0].id).toBe('getting-started');
		expect(out.get('docs/porting/threejs-mapping.md')).toContain('generated: true');
	});

	it("puts each export on its page's reference page, and writes none for a page that is missing", () => {
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
			'docs/api/objects.md': writtenObjects('[The API reference](reference/objects.md).'),
		});
		const out = generateDocs(root, { symbols: [SET_THING, THING], problems: [] });
		expect(out.has('docs/api/scene.md')).toBe(false);
		expect(out.has('docs/api/reference/scene.md')).toBe(false);
		expect(out.has('docs/api/objects.md')).toBe(false);
		const reference = out.get('docs/api/reference/objects.md') ?? '';
		expect(reference).toContain('id: api/reference/objects');
		expect(reference).toContain('generated: true');
		expect(reference).toContain('# Objects: API reference');
		expect(reference).toContain('## `Thing`');
		expect(reference).toContain('[Objects](../objects.md)');
		expect(out.get('docs/pages.md')).not.toContain('api/reference/');
	});
});

describe('referenceLinkProblems', () => {
	it('fails when a written API page does not link to its reference page', () => {
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
			'docs/api/objects.md': writtenObjects('Written.'),
		});
		const generated = generateDocs(root, { symbols: [THING], problems: [] });
		const page = (body: string) => new Map([['docs/api/objects.md', writtenObjects(body)]]);
		expect(referenceLinkProblems(page('No link.'), generated)).toEqual([
			'docs/api/objects.md must link to its API reference, (reference/objects.md)',
		]);
		expect(referenceLinkProblems(page('[It](reference/objects.md).'), generated)).toEqual([]);
	});
});

describe('the quality preset tables', () => {
	it("are a generated page of tables from the engine's constants", () => {
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
		});
		const page = generateDocs(root, NO_API).get('docs/concepts/quality-preset-tables.md') ?? '';
		expect(page).toContain('generated: true');
		expect(page).toContain('## Starting preset of each device');
		expect(page).toContain('| Phone | coarse | under 600 CSS pixels | Low |');
		expect(page).toContain('| Desktop or laptop | fine | any | High |');
		expect(page).toContain('A memory reading under 4 GB lowers the starting preset by one.');
		expect(page).toContain("| WebGPU's compatibility mode | Medium |");
		expect(page).toContain(
			'| Pixel ratio cap (`maxPixelRatio`) | 1.5 | 2 | 2 | none | during play |',
		);
		expect(page).toContain(
			'| Anti-aliasing (`antialias`) | FXAA | MSAA 4x | MSAA 4x | MSAA 4x | at the start |',
		);
		expect(page).toContain(
			'| Far cascade updates (`farCascadeInterval`) | every 4th frame | every 3rd frame | every 2nd frame | every 2nd frame | during play |',
		);
		expect(page).toContain(
			"| Target frame rate | The display's refresh rate, at most 60 frames per second unless `targetFps` asks for more |",
		);
		expect(page).toContain('| Measurement of each preset | 500 ms |');
	});
});

describe('referenceProblems', () => {
	it('adds a page tag that names no inventory page to the reader problems', () => {
		const api = { symbols: [{ ...SET_THING, page: 'api/nope' }], problems: ['x has no summary'] };
		expect(referenceProblems(api)).toEqual([
			'API reference: x has no summary',
			'API reference: setThing names the page api/nope, which is not in the inventory',
		]);
	});
});

describe('error pages', () => {
	it('generate one page per code and an index that lists every code', () => {
		const out = generateDocs(repoRoot);
		const index = out.get('docs/errors/index.md') ?? '';
		for (const code of Object.keys(ERRORS)) {
			expect(out.get(`docs/errors/${code}.md`)).toContain(`# ${code}: `);
			expect(index).toContain(`[${code}](${code}.md)`);
		}
		expect(parseFrontMatter(index)?.data.generated).toBe(true);
	});
});

describe('the repository docs', () => {
	it('pass the docs check', () => {
		expect(checkDocs(repoRoot)).toEqual([]);
	});
});
