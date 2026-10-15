import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './fixture';
import {
	applyOverride,
	type ChangelogOptions,
	computeBump,
	extractReleaseNotes,
	fitReleaseText,
	isReleaseCommit,
	nextVersion,
	notesProblems,
	type PageStatus,
	type ParsedCommit,
	packageFolders,
	parseCommit,
	prependChangelog,
	readCommits,
	readVersion,
	releaseProblems,
	renderChangelog,
	userWording,
	type VersionCopy,
	versionCopies,
	writeVersion,
} from './release';

const repoRoot = join(import.meta.dir, '../..');
const commit = (subject: string, body = '', hash = 'abc1234') =>
	parseCommit({ subject, body, hash });

/** The lines under a heading of the notes, up to the next heading of the same level. */
function extractSection(notes: string, heading: string): string {
	const rest = notes.slice(notes.indexOf(heading) + heading.length);
	const end = rest.indexOf('\n### ');
	return (end === -1 ? rest : rest.slice(0, end)).trim();
}

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
	const packages = ['engine', 'cli'];
	const commits: ParsedCommit[] = [
		commit('fix(engine): keep frames paced (#3)', '', 'a'.repeat(40)),
		commit('feat(tools): add releases (#2)', '', 'b'.repeat(40)),
		commit('feat!: rename the scene call (#4)', '', 'c'.repeat(40)),
		commit('ci: cache the toolchain', '', 'd'.repeat(40)),
		commit('Plain subject', '', 'e'.repeat(40)),
		commit('fix(render): clear the stripes', '', 'f'.repeat(40)),
	];
	const render = (list: readonly ParsedCommit[], extra: Partial<ChangelogOptions> = {}) =>
		renderChangelog({
			version: '0.0.2',
			date: '2026-10-01',
			commits: list,
			packages,
			previousTag: null,
			...extra,
		});

	it('groups commits by type, with breaking changes first and empty sections left out', () => {
		const out = render(commits);
		expect(out).toStartWith('## 0.0.2 - 2026-10-01\n');
		const order = [
			'### Breaking changes',
			'### Features',
			'### Bug fixes',
			'### Build and tooling',
			'### Other',
		].map((h) => out.indexOf(h));
		expect(order.every((i, n) => i > 0 && (n === 0 || i > (order[n - 1] ?? 0)))).toBe(true);
		expect(out).not.toContain('### Performance');
		expect(out).toContain('- Cache the toolchain (ddddddddd)');
		expect(out).toContain('- Plain subject (eeeeeeeee)');
	});

	it("puts each line under its package, and a part's scope under the package it belongs to", () => {
		const fixes = extractSection(render(commits), '### Bug fixes');
		expect(fixes).toBe(
			'#### @null3d/engine\n\n- Keep frames paced (#3, aaaaaaaaa)\n- Clear the stripes (fffffffff)',
		);
		expect(render([commit('feat(tools): add releases')])).toContain(
			'### Features\n\n#### Repository and tooling\n\n- Add releases',
		);
		expect(render([commit('docs: fix a link')])).toContain('### Documentation\n\n- Fix a link');
	});

	it('lists commits with the same words in one area once, with a link to each', () => {
		const out = render(
			[
				commit("feat(engine): switch a layer's clip", '', '839dc6e24'),
				commit("feat(engine): Switch a layer's clip", '', 'd64502690'),
				commit("feat(examples): switch a layer's clip", '', '945e5365d'),
			],
			{ repoUrl: 'https://github.com/o/r' },
		);
		expect(out).toContain(
			"- Switch a layer's clip ([839dc6e24](https://github.com/o/r/commit/839dc6e24), [d64502690](https://github.com/o/r/commit/d64502690))",
		);
		expect(out.match(/Switch a layer's clip/g)).toHaveLength(2);
	});

	it('keeps the scope of a part the notes do not know', () => {
		expect(render([commit('feat(widgets): add a dial')])).toContain(
			'#### Other parts\n\n- **widgets:** Add a dial',
		);
	});

	it('links commits, pull requests and the comparison when it knows the repository', () => {
		const repoUrl = 'https://github.com/o/r';
		const first = render(commits, { version: '0.0.1', repoUrl });
		expect(first).toContain(
			`([#2](https://github.com/o/r/pull/2), [bbbbbbbbb](https://github.com/o/r/commit/${'b'.repeat(40)}))`,
		);
		expect(first).toContain('**Full changelog**: https://github.com/o/r/commits/0.0.1');
		const next = render(commits, { previousTag: '0.0.1', repoUrl });
		expect(next).toContain('https://github.com/o/r/compare/0.0.1...0.0.2');
	});

	it('says so when a release has no entries', () => {
		expect(render([], { previousTag: '0.0.1' })).toContain('_No notable changes._');
	});
});

describe('userWording', () => {
	it("takes out the maintainers' task IDs, decision records and milestones", () => {
		const cases: [string, string][] = [
			['the EX8 HUD follow-ups', 'The HUD follow-ups'],
			['wire up M2-EX8 in the demo', 'Wire up in the demo'],
			[
				"split a long sentence in D-174's benchmarks bullet",
				'Split a long sentence in the benchmarks bullet',
			],
			['record D-174, the Apple GPU direct-draw path', 'Record the Apple GPU direct-draw path'],
			['bring D-19, D-20 and D-21 up to date', 'Bring the records up to date'],
			['bring decision records D-08 to D-13 up to date', 'Bring the records up to date'],
			['link D-133 to the showcase ruling D-132', 'Link the record to the showcase ruling'],
			['load the shaders of the GPU path (D-13)', 'Load the shaders of the GPU path'],
			['time S6 with culling off and on, for T-36', 'Time S6 with culling off and on'],
			['add the depth record row, which closes T-29', 'Add the depth record row'],
			["record M2's tier A smoke run", 'Record the tier A smoke run'],
			['record the gate and M2 rulings', 'Record the gate and rulings'],
		];
		for (const [description, wording] of cases) expect(userWording(description)).toBe(wording);
	});

	it('keeps names that share the form: chips, phones, formats, error codes and scenes', () => {
		for (const text of [
			'Run on the MacBook Pro M5 Max and the Apple M4',
			'Read every L1 coefficient',
			'Record the Tab A9+ and the M32 runs',
			'Load KTX2 files, and report E1405',
			'Time S6 on the S25',
		])
			expect(userWording(text)).toBe(text);
	});
});

describe('notesProblems', () => {
	it('names each line that breaks the writing rules, which the docs check holds the changelog to', () => {
		expect(notesProblems('### Features\n\n- Add a fast path\n')).toEqual([]);
		const problems = notesProblems('### Features\n\n- Rename to null3d\n- Reach a milestone\n');
		expect(problems).toHaveLength(2);
		expect(problems[0]).toStartWith('line 3: ');
	});
});

describe('fitReleaseText', () => {
	const notes = `## 1.0.0\n\n${Array.from({ length: 50 }, (_, n) => `- change ${n}`).join('\n')}\n`;

	it('leaves notes that fit unchanged', () => {
		expect(fitReleaseText(notes, notes.length, 'u')).toBe(notes);
	});

	it('cuts long notes at the end of a line and links the full list', () => {
		const fitted = fitReleaseText(notes, 300, 'https://x/CHANGELOG.md');
		expect(fitted.length).toBeLessThanOrEqual(300);
		expect(fitted).toMatch(/- change \d+\n\n_GitHub limits the length/);
		expect(fitted).toContain('[CHANGELOG.md](https://x/CHANGELOG.md)');
	});
});

describe('the notes of a history with branch merges', () => {
	// It runs many git commands and the release command, which take seconds on a busy machine.
	it('list every commit since the last release once, whichever branch brought it', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'null3d-release-notes-'));
		// The user's own git settings, such as commit signing and hooks, stay out of the test.
		const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
		const git = (...args: string[]) =>
			execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
				cwd: dir,
				env,
				encoding: 'utf8',
			}).trim();
		const commitOn = (subject: string) => {
			git('commit', '--quiet', '--allow-empty', '-m', subject);
			return git('rev-parse', 'HEAD');
		};
		try {
			git('init', '--quiet', '--initial-branch=main');
			writeFileSync(join(dir, 'README.md'), '# Fake\n');
			mkdirSync(join(dir, 'packages/engine'), { recursive: true });
			writeFileSync(join(dir, 'packages/engine/package.json'), '{ "version": "0.1.0" }\n');
			git('add', '.');
			commitOn('chore: start');
			commitOn('feat(engine): ship the first release');

			// A branch that starts before the release and lands after it.
			git('switch', '--quiet', '-c', 'late');
			const late = commitOn('fix(engine): keep frames paced');
			git('switch', '--quiet', 'main');
			git('tag', '0.1.0');
			const onMain = commitOn('perf(render): skip empty passes');

			// Two branches that land the same change under the same subject.
			git('switch', '--quiet', '-c', 'one');
			const firstCopy = commitOn('feat(engine): blend clips with inertia');
			git('switch', '--quiet', 'main');
			git('merge', '--quiet', '--no-ff', 'one', '-m', 'Merge branch one');
			git('switch', '--quiet', '-c', 'two', 'main~1');
			const docs = commitOn('docs(dev): record D-174, the probe');
			const secondCopy = commitOn('feat(engine): blend clips with inertia');
			git('merge', '--quiet', '--no-ff', 'main', '-m', 'Merge main into two');
			git('switch', '--quiet', 'main');
			git('merge', '--quiet', '--no-ff', 'two', '-m', 'Merge branch two');
			git('merge', '--quiet', '--no-ff', 'late', '-m', 'Merge branch late');
			commitOn('chore(release): 0.2.0');

			const commits: ParsedCommit[] = [];
			for await (const c of readCommits(dir, '0.1.0..HEAD'))
				if (!isReleaseCommit(c)) commits.push(c);
			expect(commits.map((c) => c.hash).sort()).toEqual(
				[late, onMain, firstCopy, secondCopy, docs].sort(),
			);

			const notes = renderChangelog({
				version: '0.2.0',
				date: 'd',
				commits,
				packages: packageFolders(dir),
				previousTag: '0.1.0',
			});
			expect(notes).not.toContain('Merge');
			expect(notes).not.toContain('Ship the first release');
			expect(notes).toContain('- Keep frames paced');
			expect(notes).toContain('- Skip empty passes');
			expect(notes).toContain('- Record the probe');
			const blended = notes.split('\n').filter((l) => l.includes('Blend clips with inertia'));
			expect(blended).toHaveLength(1);
			for (const hash of [firstCopy, secondCopy]) expect(blended[0]).toContain(hash.slice(0, 9));

			// The release command, run in the same history, prints the same notes.
			const printed = execFileSync('bun', [join(repoRoot, 'tools/release.ts')], {
				cwd: dir,
				env,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			});
			expect(printed).toStartWith('version: 0.1.1 (bump: patch, previous: 0.1.0)');
			const body = (text: string) => text.slice(text.indexOf('\n###')).trimEnd();
			expect(body(printed)).toBe(body(notes));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 30_000);

	it('fails when git cannot read the range', async () => {
		const read = async () => {
			for await (const _ of readCommits(repoRoot, 'no-such-tag..HEAD'));
		};
		await expect(read()).rejects.toThrow('git log no-such-tag..HEAD failed');
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

describe('the release guide', () => {
	// Packages that npm already holds, which need no first publish by hand.
	const onNpm = new Set(['cli']);

	it('names every public package, with its first publish by hand', () => {
		const guide = readFileSync(join(repoRoot, '.dev/releases.md'), 'utf8');
		const isPublic = (folder: string) =>
			JSON.parse(readFileSync(join(repoRoot, 'packages', folder, 'package.json'), 'utf8'))
				.private !== true;
		const missing = packageFolders(repoRoot)
			.filter(isPublic)
			.flatMap((folder) => [
				...(guide.includes(`| \`@null3d/${folder}\` |`) ? [] : [`${folder}: table row`]),
				...(onNpm.has(folder) ||
				guide.includes(`npm publish target/packages/null3d-${folder}-0.0.0.tgz`)
					? []
					: [`${folder}: first publish`]),
			]);
		expect(missing).toEqual([]);
	});
});
