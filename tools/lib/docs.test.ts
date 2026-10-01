import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { ERRORS } from '../../packages/engine/src/errors/codes.ts';
import type { ApiReference, ApiSymbol } from './api-docs';
import {
	API_END,
	API_START,
	checkDocs,
	frontMatterProblems,
	generateDocs,
	PAGES,
	pageList,
	placeholderPage,
	referenceProblems,
	tableMarkers,
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
])}\n# Docs\n\n<!-- null3d:page-list:start -->\n<!-- null3d:page-list:end -->\n`;
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
		expect(list).toContain('### Concepts');
		expect(list).toContain('a \\| b');
	});
});

describe('generateDocs', () => {
	it('rewrites placeholders, keeps written pages, and fills the index page list', () => {
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
		expect(out.get('docs/concepts/architecture.md')).toContain('This page will cover:');
		expect(out.get('docs/index.md')).toContain('[Handles](concepts/handles.md)');
		expect(out.get('docs/porting/threejs-mapping.md')).toContain('status: generated');
	});

	it('fails when the index page has no page-list markers', () => {
		const root = fixture({
			'docs/index.md': '# Docs\n',
			'docs/data/threejs-mapping.json': MAPPING,
		});
		expect(() => generateDocs(root, NO_API)).toThrow('page-list');
	});

	it("puts each export on its page's reference: a placeholder gains a section, a written page fills its markers", () => {
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
			'docs/api/scene.md': '<!-- null3d:placeholder -->\nold text',
			'docs/api/objects.md': writtenObjects(`${API_START}\nSTALE REFERENCE\n${API_END}`),
		});
		const out = generateDocs(root, { symbols: [SET_THING, THING], problems: [] });
		const scene = out.get('docs/api/scene.md') ?? '';
		expect(scene).toContain('No release has these APIs yet');
		expect(scene).toContain('## API reference\n\n### `setThing`');
		expect(scene).toContain('### `setThing`');
		const objects = out.get('docs/api/objects.md') ?? '';
		expect(objects).toContain(`${API_START}\n\n### `);
		expect(objects).toContain('### `Thing`');
		expect(objects).not.toContain('STALE REFERENCE');
		expect(objects).toContain('More text.');
		expect(out.get('docs/api/lights.md')).toContain('No release has this feature yet');
	});

	it('fails when a written page with exports has no reference markers', () => {
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
			'docs/api/objects.md': writtenObjects('No markers.'),
		});
		expect(() => generateDocs(root, { symbols: [THING], problems: [] })).toThrow('API reference');
	});
});

describe('the quality presets page', () => {
	const presetsPage = (body: string) =>
		`${renderFrontMatter([
			['id', 'concepts/quality-presets'],
			['title', 'Quality presets'],
			['status', 'experimental'],
			['since', '0.1'],
			['summary', 'Written.'],
		])}\n# Quality presets\n\n${body}\n`;
	const markers = (name: string, inner = '') => tableMarkers(name).join(`\n${inner}\n`);

	it("fills each of its tables from the engine's constants", () => {
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
			'docs/concepts/quality-presets.md': presetsPage(
				[
					markers('preset-devices'),
					markers('preset-ceilings'),
					markers('preset-settings', 'STALE TABLE'),
				].join('\n\nText between the tables.\n\n'),
			),
		});
		const page = generateDocs(root, NO_API).get('docs/concepts/quality-presets.md') ?? '';
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
			'| Far cascade updates (`farCascadeInterval`) | every 4th frame | every 3rd frame | every 2nd frame | every 2nd frame |',
		);
		expect(page).not.toContain('STALE TABLE');
		expect(page).toContain('Text between the tables.');
	});

	it('fails when the page lacks the markers of one of its tables', () => {
		const root = fixture({
			'docs/index.md': INDEX,
			'docs/data/threejs-mapping.json': MAPPING,
			'docs/concepts/quality-presets.md': presetsPage(markers('preset-devices')),
		});
		expect(() => generateDocs(root, NO_API)).toThrow('preset-ceilings');
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
