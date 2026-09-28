import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	checkLinkTree,
	classifyExternalStatus,
	extractLinks,
	headingAnchors,
	isOwnRepoUrl,
	isSkippedExternalUrl,
	linkedFiles,
	selfRepoPath,
	slugifyHeading,
	stripCode,
} from './links';

const repoRoot = join(import.meta.dir, '../..');

describe('slugifyHeading', () => {
	it('matches GitHub anchors for the heading shapes the docs use', () => {
		expect(slugifyHeading('Threads and the frame')).toBe('threads-and-the-frame');
		expect(slugifyHeading('WebGPU & WebGL2')).toBe('webgpu--webgl2');
		expect(slugifyHeading('Architecture: threads and the frame')).toBe(
			'architecture-threads-and-the-frame',
		);
	});

	it('drops emphasis and code markers but keeps their text', () => {
		expect(slugifyHeading('Using `createEngine`')).toBe('using-createengine');
		expect(slugifyHeading('**Bold** heading')).toBe('bold-heading');
	});
});

describe('headingAnchors', () => {
	it('collects every heading level, numbers repeats, and skips fenced blocks', () => {
		const anchors = headingAnchors(
			['# Top', '## Same', '## Same', '```', '## Not a heading', '```'].join('\n'),
		);
		expect(anchors).toEqual(new Set(['top', 'same', 'same-1']));
	});
});

describe('stripCode and extractLinks', () => {
	it('ignores links in fenced blocks, inline code and comments, and keeps line numbers', () => {
		const md = [
			'intro',
			'```sh',
			'open [not a link](http://localhost:5173)',
			'```',
			'see `[also not](nope.md)` and [real](concepts/handles.md).',
			'<!-- [hidden](gone.md) -->',
		].join('\n');
		expect(stripCode(md)).not.toContain('nope.md');
		expect(extractLinks(md)).toEqual([{ target: 'concepts/handles.md', line: 5 }]);
	});

	it('extracts images, several links per line, and HTML links and images', () => {
		const links = extractLinks(
			'![alt](x.png) then [a](a.md) and [b](b.md)\n<img src=".github/assets/logo.svg" alt="x" /> <a href="#top">top</a>',
		);
		expect(links.map((l) => l.target)).toEqual([
			'x.png',
			'a.md',
			'b.md',
			'.github/assets/logo.svg',
			'#top',
		]);
	});
});

describe('target classification', () => {
	it('recognizes links into this repository', () => {
		expect(selfRepoPath('https://github.com/null3d-engine/null3d/blob/main/docs/index.md')).toBe(
			'docs/index.md',
		);
		expect(selfRepoPath('https://github.com/null3d-engine/null3d/tree/main/skills/')).toBe(
			'skills',
		);
		expect(selfRepoPath('https://github.com/null3d-engine/null3d/issues')).toBeNull();
		expect(selfRepoPath('https://github.com/other/repo/blob/main/x.md')).toBeNull();
	});

	it('recognizes the GitHub pages of this repository, which are never probed', () => {
		expect(
			isOwnRepoUrl('https://github.com/null3d-engine/null3d/actions/workflows/ci.yml/badge.svg'),
		).toBe(true);
		expect(isOwnRepoUrl('https://github.com/null3d-engine/null3d/issues')).toBe(true);
		expect(isOwnRepoUrl('https://github.com/null3d-engine/null3d.git')).toBe(true);
		expect(isOwnRepoUrl('https://github.com/null3d-engine/null3d-assets')).toBe(false);
	});

	it('skips example hosts and blocks only on definitive statuses', () => {
		expect(isSkippedExternalUrl('http://localhost:5173/')).toBe(true);
		expect(isSkippedExternalUrl('https://my-mac.local:5173/')).toBe(true);
		expect(isSkippedExternalUrl('https://api.example.com/x')).toBe(true);
		expect(isSkippedExternalUrl('https://threejs.org')).toBe(false);
		expect(classifyExternalStatus(404)).toBe('broken');
		expect(classifyExternalStatus(410)).toBe('broken');
		expect(classifyExternalStatus(200)).toBe('ok');
		expect(classifyExternalStatus(302)).toBe('ok');
		expect(classifyExternalStatus(403)).toBe('unreachable');
		expect(classifyExternalStatus(503)).toBe('unreachable');
	});
});

describe('checkLinkTree', () => {
	it('reports a missing page, a bad anchor, a bad relative path and an absolute path', () => {
		const files = new Map<string, string>([
			['docs/a.md', '# A\n\n## Real heading\n\n[gone](missing.md) [bad](b.md#nope)'],
			['docs/b.md', '# B\n\n[img](../assets/nope.png) [ok self](#b) [abs](/docs/a.md)'],
		]);
		const problems = checkLinkTree(files, () => false);
		expect(problems).toHaveLength(4);
		expect(problems[0]).toContain('docs/a.md:5 broken relative link missing.md');
		expect(problems[1]).toContain('broken anchor b.md#nope');
		expect(problems[2]).toContain('broken relative link ../assets/nope.png');
		expect(problems[3]).toContain('absolute link /docs/a.md');
	});

	it('accepts valid pages, anchors, same-file anchors and repository links that exist', () => {
		const files = new Map<string, string>([
			[
				'docs/a.md',
				'# A\n\n[b](b.md#real-heading) [self](#a) [repo](https://github.com/null3d-engine/null3d/blob/main/x.md)',
			],
			['docs/b.md', '# B\n\n## Real heading\n\ntext'],
		]);
		expect(checkLinkTree(files, () => true)).toEqual([]);
	});
});

describe('the repository', () => {
	it('has no broken internal links in the docs, the README or AGENTS.md', () => {
		const files = linkedFiles(repoRoot);
		expect(files.size).toBeGreaterThan(70);
		expect(checkLinkTree(files, (p) => existsSync(join(repoRoot, p)))).toEqual([]);
	});
});
