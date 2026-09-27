import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
	checkDocs,
	frontMatterProblems,
	generateDocs,
	PAGES,
	pageList,
	placeholderPage,
} from './docs';
import { fixture } from './fixture';
import { parseFrontMatter, renderFrontMatter, yamlString } from './frontmatter';

const repoRoot = join(import.meta.dir, '../..');

const MAPPING = JSON.stringify({
	statusLegend: { direct: 'Same.' },
	sinceLegend: { '0.1': 'milestone M1' },
	entries: [],
});
const INDEX = `${renderFrontMatter([
	['id', 'index'],
	['title', 'Docs'],
	['status', 'experimental'],
	['since', '0.1'],
	['summary', 'The docs.'],
])}\n# Docs\n\n<!-- sokko3d:page-list:start -->\n<!-- sokko3d:page-list:end -->\n`;

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
			'docs/concepts/architecture.md': '<!-- sokko3d:placeholder -->\nold text',
		});
		const out = generateDocs(root);
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
		expect(() => generateDocs(root)).toThrow('page-list');
	});
});

describe('the repository docs', () => {
	it('pass the docs check', () => {
		expect(checkDocs(repoRoot)).toEqual([]);
	});
});
