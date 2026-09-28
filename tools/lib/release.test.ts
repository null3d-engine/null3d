import { describe, expect, it } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixture } from './fixture';
import {
	applyOverride,
	computeBump,
	extractReleaseNotes,
	nextVersion,
	type PageStatus,
	type ParsedCommit,
	parseCommit,
	prependChangelog,
	readVersion,
	releaseProblems,
	renderChangelog,
	type VersionCopy,
	versionCopies,
	writeVersion,
} from './release';

const repoRoot = join(import.meta.dir, '../..');
const commit = (subject: string, body = '', hash = 'abc1234') =>
	parseCommit({ subject, body, hash });

describe('parseCommit', () => {
	it('reads the type, scope and description', () => {
		expect(commit('feat(engine): add setScale')).toMatchObject({
			type: 'feat',
			scope: 'engine',
			description: 'add setScale',
			breaking: false,
			pr: null,
		});
		expect(commit('fix: keep frames paced')).toMatchObject({ type: 'fix', scope: null });
		expect(commit('FEAT: shout').type).toBe('feat');
	});

	it('takes the pull request number off the description', () => {
		expect(commit('feat(tools): add releases (#12)')).toMatchObject({
			description: 'add releases',
			pr: 12,
		});
		expect(commit('Bump the pins (#9)')).toMatchObject({
			type: '',
			description: 'Bump the pins',
			pr: 9,
		});
	});

	it('finds a breaking change from the marker or a footer', () => {
		expect(commit('feat!: drop a call').breaking).toBe(true);
		expect(commit('feat: drop a call', 'BREAKING CHANGE: gone').breaking).toBe(true);
		expect(commit('feat: drop a call', 'BREAKING-CHANGE: gone').breaking).toBe(true);
	});
});

describe('versions', () => {
	it('bumps a patch for any conventional commit, and never more by itself', () => {
		expect(computeBump([])).toBe('none');
		expect(computeBump([commit('Plain subject')])).toBe('none');
		expect(computeBump([commit('fix: a')])).toBe('patch');
		expect(computeBump([commit('feat: a'), commit('feat!: b')])).toBe('patch');
	});

	it('lets the person releasing choose a minor or major bump', () => {
		expect(applyOverride('patch', 'auto')).toBe('patch');
		expect(applyOverride('patch', 'minor')).toBe('minor');
		expect(applyOverride('none', 'major')).toBe('major');
	});

	it('counts from 0.0.0, so the first automatic release is 0.0.1', () => {
		expect(nextVersion('0.0.0', 'patch')).toBe('0.0.1');
		expect(nextVersion('0.0.3', 'minor')).toBe('0.1.0');
		expect(nextVersion('0.4.2', 'major')).toBe('1.0.0');
		expect(nextVersion('1.2.3', 'patch')).toBe('1.2.4');
	});

	it('refuses a missing bump and a version that is not plain', () => {
		expect(() => nextVersion('0.0.1', 'none')).toThrow('"none"');
		expect(() => nextVersion('v0.1.0', 'patch')).toThrow('Not a plain');
	});
});

describe('renderChangelog', () => {
	const commits: ParsedCommit[] = [
		commit('fix(engine): keep frames paced (#3)'),
		commit('feat(tools): add releases (#2)'),
		commit('feat!: rename the scene call (#4)'),
		commit('ci: cache the toolchain'),
		commit('Plain subject'),
	];

	it('groups commits by type, with breaking changes first and empty sections left out', () => {
		const out = renderChangelog({
			version: '0.0.2',
			date: '2026-10-01',
			commits,
			previousTag: null,
		});
		expect(out).toStartWith('## 0.0.2 - 2026-10-01\n');
		const order = ['### Breaking changes', '### Features', '### Bug fixes', '### Other'].map((h) =>
			out.indexOf(h),
		);
		expect(order.every((i, n) => i > 0 && (n === 0 || i > (order[n - 1] ?? 0)))).toBe(true);
		expect(out).not.toContain('### Performance');
		expect(out).toContain('- **engine:** keep frames paced (#3)');
		expect(out).toContain('- cache the toolchain');
		expect(out).toContain('- Plain subject');
	});

	it('links pull requests and the comparison when it knows the repository', () => {
		const repoUrl = 'https://github.com/o/r';
		const first = renderChangelog({
			version: '0.0.1',
			date: 'd',
			commits,
			previousTag: null,
			repoUrl,
		});
		expect(first).toContain('([#2](https://github.com/o/r/pull/2))');
		expect(first).toContain('**Full changelog**: https://github.com/o/r/commits/0.0.1');
		const next = renderChangelog({
			version: '0.0.2',
			date: 'd',
			commits,
			previousTag: '0.0.1',
			repoUrl,
		});
		expect(next).toContain('https://github.com/o/r/compare/0.0.1...0.0.2');
	});

	it('says so when a release has no entries', () => {
		expect(
			renderChangelog({ version: '0.0.2', date: 'd', commits: [], previousTag: '0.0.1' }),
		).toContain('_No notable changes._');
	});
});

describe('the changelog file', () => {
	const file = prependChangelog(
		prependChangelog('', '## 0.0.1 - d\n\n- first\n'),
		'## 0.0.10 - d\n\n- tenth\n',
	);

	it('keeps the newest release at the top', () => {
		expect(file).toBe('# Changelog\n\n## 0.0.10 - d\n\n- tenth\n\n## 0.0.1 - d\n\n- first\n');
	});

	it("reads one version's notes, and never a longer version that starts the same", () => {
		expect(extractReleaseNotes(file, '0.0.10')).toBe('- tenth');
		expect(extractReleaseNotes(file, '0.0.1')).toBe('- first');
		expect(extractReleaseNotes(file, '0.0.2')).toBeNull();
	});
});

describe('releaseProblems', () => {
	const pages: PageStatus[] = [
		{ id: 'concepts/lighting', status: 'planned', since: '0.1' },
		{ id: 'concepts/assets', status: 'planned', since: '0.2' },
		{ id: 'guides/video-textures', status: 'planned', since: 'after 1.0' },
		{ id: 'api/engine', status: 'experimental', since: '0.1' },
	];
	const roadmap = '# x\n\n## Roadmap\n\n| Release | What it adds |\n';

	it('lets patch releases through, roadmap and planned pages included', () => {
		expect(releaseProblems('0.0.4', pages, roadmap)).toEqual([]);
		expect(releaseProblems('0.1.3', pages, roadmap)).toEqual([]);
	});

	it('refuses a minor release while a page it ships is still planned', () => {
		expect(releaseProblems('0.1.0', pages, roadmap)).toEqual([
			'docs/concepts/lighting.md is still planned, and 0.1.0 ships its feature (since 0.1)',
		]);
		expect(releaseProblems('0.2.0', pages, roadmap)).toHaveLength(2);
	});

	it('refuses a public release, from 1.0 on, while the README has the roadmap', () => {
		const shipped = pages.filter((p) => p.status !== 'planned');
		expect(releaseProblems('1.0.0', shipped, roadmap)).toEqual([
			'README.md still has the roadmap, which is internal; remove it before the public 1.0.0 release',
		]);
		expect(releaseProblems('1.2.1', shipped, 'Everything else planned, by version')).toHaveLength(
			1,
		);
		expect(releaseProblems('1.0.0', shipped, '# x\n')).toEqual([]);
	});
});

describe('version copies', () => {
	it('rewrites every kind of copy in place', () => {
		const root = fixture({
			'packages/engine/package.json': '{\n\t"name": "e",\n\t"version": "0.0.0"\n}\n',
			'packages/engine/src/index.ts': "export const VERSION = '0.0.0';\n",
			'Cargo.toml':
				'[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "0.0.0"\n',
			'crates/core/Cargo.toml': '[package]\nname = "demo-core"\nversion.workspace = true\n',
			'Cargo.lock':
				'[[package]]\nname = "demo-core"\nversion = "0.0.0"\n\n[[package]]\nname = "other"\nversion = "0.0.0"\n',
			'.claude-plugin/marketplace.json':
				'{ "plugins": [{ "version": "0.0.0", "source": { "path": ".claude", "ref": "0.0.0" } }] }\n',
		});
		for (const copy of versionCopies(root)) {
			const path = join(root, copy.path);
			writeFileSync(path, writeVersion(readFileSync(path, 'utf8'), copy, '0.1.0'));
		}
		const read = (path: string) => readFileSync(join(root, path), 'utf8');
		expect(read('packages/engine/package.json')).toContain('"version": "0.1.0"');
		expect(read('packages/engine/src/index.ts')).toBe("export const VERSION = '0.1.0';\n");
		expect(read('Cargo.toml')).toContain('[workspace.package]\nversion = "0.1.0"');
		expect(read('Cargo.lock')).toContain('name = "demo-core"\nversion = "0.1.0"');
		expect(read('Cargo.lock')).toContain('name = "other"\nversion = "0.0.0"');
		expect(read('.claude-plugin/marketplace.json')).toBe(
			'{ "plugins": [{ "version": "0.1.0", "source": { "path": ".claude", "ref": "0.1.0" } }] }\n',
		);
		const [copy] = versionCopies(root);
		expect(() => writeVersion('no version here', copy as VersionCopy, '0.0.1')).toThrow(
			'has no version',
		);
	});

	it('finds every copy in the repository, and they all agree', () => {
		const copies = versionCopies(repoRoot);
		const paths = new Set(copies.map((c) => c.path));
		for (const path of [
			'packages/engine/package.json',
			'packages/engine/src/index.ts',
			'Cargo.toml',
			'Cargo.lock',
			'.claude-plugin/marketplace.json',
		])
			expect(paths.has(path)).toBe(true);
		const found = copies.map((c) => ({
			path: c.path,
			version: readVersion(readFileSync(join(repoRoot, c.path), 'utf8'), c),
		}));
		const engine = found.find((f) => f.path === 'packages/engine/package.json')?.version;
		expect(found.filter((f) => f.version === null || f.version !== engine)).toEqual([]);
	});
});
