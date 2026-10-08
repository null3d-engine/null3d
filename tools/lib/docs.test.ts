import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { ERRORS } from '../../packages/engine/src/errors/codes.ts';
import type { ApiReference, ApiSymbol } from './api-docs';
import {
	checkDocs,
	frontMatterProblems,
	generateDocs,
	PAGES,
	pageList,
	placeholderPage,
	referenceLinkProblems,
	referenceProblems,
} from './docs';
import { fixture } from './fixture';
import { parseFrontMatter, renderFrontMatter, yamlString } from './frontmatter';

const repoRoot = join(import.meta.dir, '../..');

const MAPPING = JSON.stringify({
	statusLegend: { direct: 'Same.' },
	sinceLegend: { '0.1': 'the core renderer' },
	entries: [],
});
const INDEX = `${renderFrontMatter([
	['id', 'index'],
	['title', 'Docs'],
	['status', 'experimental'],
	['since', '0.1'],
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
		['status', 'experimental'],
		['since', '0.1'],
		['summary', 'Written.'],
	])}\n# Objects\n\n${body}\n\nMore text.\n`;

describe('front matter', () => {
	it('quotes values YAML would misread, and leaves plain words bare', () => {
		expect(yamlString('planned')).toBe('planned');
		expect(yamlString('after 1.0')).toBe('after 1.0');
		expect(yamlString('0.1')).toBe('"0.1"');
		expect(yamlString('Page API: createEngine')).toBe('"Page API: createEngine"');
		expect(yamlString('yes')).toBe('"yes"');
	});

	it('round-trips every inventory page through a placeholder', () => {
		for (const page of PAGES) {
			const data = parseFrontMatter(placeholderPage(page))?.data;
			expect(data).toEqual({
				id: page.id,
				title: page.title,
				status: 'planned',
				since: page.since,
				summary: page.summary,
			});
		}
	});

	it('rejects invalid YAML', () => {
		expect(() => parseFrontMatter('---\ntitle: Page API: createEngine\n---\n')).toThrow();
	});
});

describe('frontMatterProblems', () => {
	const inventory = new Set(['concepts/handles']);
	it('accepts a valid page', () => {
		expect(
			frontMatterProblems(
				'docs/concepts/handles.md',
				placeholderPage(PAGES.find((p) => p.id === 'concepts/handles')!),
				inventory,
			),
		).toEqual([]);
	});

	it('reports a wrong id, a bad status, a bad version and a page outside the inventory', () => {
		const text = renderFrontMatter([
			['id', 'concepts/other'],
			['title', 'T'],
			['status', 'done'],
			['since', 'soon'],
			['summary', 'S'],
		]);
		const problems = frontMatterProblems('docs/concepts/other.md', text, inventory);
		expect(problems.join('\n')).toContain('status "done"');
		expect(problems.join('\n')).toContain('since "soon"');
		expect(problems.join('\n')).toContain('not in the inventory');
		expect(frontMatterProblems('docs/concepts/x.md', text, inventory).join('\n')).toContain(
			'id is "concepts/other"',
		);
	});
});

describe('pageList', () => {
	it('groups pages by area in inventory order and links them relative to docs/', () => {
		const list = pageList([
			{
				id: 'concepts/handles',
				title: 'Handles',
				status: 'planned',
				since: '0.1',
				summary: 'a | b',
			},
			{
				id: 'concepts/architecture',
				title: 'Architecture',
				status: 'planned',
				since: '0.1',
				summary: 'x',
			},
		]);
		expect(list.indexOf('concepts/architecture.md')).toBeLessThan(
			list.indexOf('concepts/handles.md'),
		);
		expect(list).toContain('## Concepts');
		expect(list).toContain('a \\| b');
	});
});

describe('generateDocs', () => {
	it('rewrites placeholders, keeps written pages, and lists every page', () => {
		const written = `${renderFrontMatter([
			['id', 'concepts/handles'],
			['title', 'Handles'],
			['status', 'planned'],
			['since', '0.1'],
			['summary', 'Written.'],
		])}\n# Handles\n`;
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
			'docs/concepts/handles.md': written,
			'docs/concepts/architecture.md': '<!-- null3d:placeholder -->\nold text',
		});
		const out = generateDocs(root, NO_API);
		expect(out.has('docs/concepts/handles.md')).toBe(false);
		expect(out.has('docs/index.md')).toBe(false);
		expect(out.get('docs/concepts/architecture.md')).toContain('This page will cover:');
		const pages = out.get('docs/pages.md') ?? '';
		expect(pages).toContain('status: generated');
		expect(pages).toContain('[Handles](concepts/handles.md)');
		expect(pages).toContain('## Concepts');
		expect(pages).not.toContain('(index.md) |');
		expect(out.get('docs/porting/threejs-mapping.md')).toContain('status: generated');
	});

	it("puts each export on its page's reference: a placeholder gains a section, a written page gets a reference page", () => {
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
			'docs/api/scene.md': '<!-- null3d:placeholder -->\nold text',
			'docs/api/objects.md': writtenObjects('[The API reference](reference/objects.md).'),
		});
		const out = generateDocs(root, { symbols: [SET_THING, THING], problems: [] });
		const scene = out.get('docs/api/scene.md') ?? '';
		expect(scene).toContain('No release has these APIs yet');
		expect(scene).toContain('## API reference\n\n### `setThing`');
		expect(out.has('docs/api/objects.md')).toBe(false);
		const reference = out.get('docs/api/reference/objects.md') ?? '';
		expect(reference).toContain('id: api/reference/objects');
		expect(reference).toContain('status: generated');
		expect(reference).toContain('# Objects and transforms: API reference');
		expect(reference).toContain('## `Thing`');
		expect(reference).toContain('[Objects and transforms](../objects.md)');
		expect(out.get('docs/api/lights.md')).toContain('No release has this feature yet');
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
		expect(page).toContain('status: generated');
		expect(page).toContain('## Starting preset of each device');
		expect(page).toContain('| Phone | coarse | under 600 CSS pixels | Low |');
		expect(page).toContain('| Desktop or laptop | fine | any | High |');
		expect(page).toContain('A memory reading under 4 GB lowers the starting preset by one.');
		expect(page).toContain("| WebGPU's compatibility mode | Medium |");
		expect(page).toContain(
			'| Pixel ratio cap (`maxPixelRatio`) | 1.5 | 2 | 2 | none | during play | built |',
		);
		expect(page).toContain(
			'| Anti-aliasing (`antialias`) | FXAA | MSAA 4x | MSAA 4x | MSAA 4x | at the start | built |',
		);
		expect(page).toContain(
			'| Far cascade updates (`farCascadeInterval`) | every 4th frame | every 3rd frame | every 2nd frame | every 2nd frame | during play | built |',
		);
		expect(page).toContain(
			"| Target frame rate | The display's refresh rate, at most 60 frames per second |",
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
		expect(parseFrontMatter(index)?.data.status).toBe('generated');
	});
});

describe('the repository docs', () => {
	it('pass the docs check', () => {
		expect(checkDocs(repoRoot)).toEqual([]);
	});
});
