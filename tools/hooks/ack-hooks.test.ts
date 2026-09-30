import { describe, expect, it } from 'bun:test';
import {
	checkCommitMessage as checkDocs,
	DOCS_ACK_RULE,
	docBearingFiles,
	effectiveMessage,
	isExemptCommit,
} from './check-docs-ack';
import { audienceOf, isStyleChecked, subjectOf } from './check-docs-style';
import { unstagedPaths } from './check-generated';
import { touchesRust } from './check-rust';
import { checkCommitMessage as checkSkills, skillBearingFiles } from './check-skills-ack';
import { checkAck, findAckValue } from './commit-ack';

describe('docBearingFiles', () => {
	it('flags engine code, package source and binaries, skills, tools, benchmarks and commands', () => {
		const files = [
			'crates/null3d-core/src/handles.rs',
			'packages/engine/src/scene.ts',
			'packages/cli/bin/null3d.js',
			'skills/null3d-develop/SKILL.md',
			'tools/gen-docs.ts',
			'tools/hooks/check-docs-ack.ts',
			'bench/allocation.ts',
			'bench/pages/scene-code/harness.ts',
			'tests/real-browsers.ts',
			'tests/lib/plans.ts',
			'package.json',
		];
		expect(docBearingFiles(files)).toEqual(files);
	});

	it('exempts docs, tests, test pages, CI settings and root prose', () => {
		expect(
			docBearingFiles([
				'docs/concepts/handles.md',
				'crates/null3d-core/tests/handles.rs',
				'packages/engine/test/scene.test.ts',
				'tools/hooks/ack-hooks.test.ts',
				'bench/lib/report.test.ts',
				'bench/tests/pages.spec.ts',
				'tests/lib/runs.test.ts',
				'tests/image/uploads.spec.ts',
				'tests/pages/uploads.ts',
				'packages/engine/package.json',
				'.github/workflows/ci.yml',
				'README.md',
				'AGENTS.md',
			]),
		).toEqual([]);
	});
});

describe('rules that gained paths later', () => {
	it('judge a commit by the paths the rule covered when it was authored', () => {
		const message = 'feat(bench): add a check\n\nTask: M0-C3';
		const files = ['bench/allocation.ts'];
		expect(checkAck(message, files, DOCS_ACK_RULE, '2026-09-27T23:00:00+08:00').ok).toBe(true);
		expect(checkAck(message, files, DOCS_ACK_RULE, '2026-09-28T09:30:00+08:00').ok).toBe(false);
		expect(checkAck(message, files, DOCS_ACK_RULE).ok).toBe(false);
		expect(
			checkAck(message, ['packages/engine/src/index.ts'], DOCS_ACK_RULE, '2026-01-01').ok,
		).toBe(false);
	});
});

describe('skillBearingFiles', () => {
	it('flags the public API, the shader library, the mapping and the skills', () => {
		const files = [
			'packages/engine/src/scene.ts',
			'crates/null3d-shaders/wgsl/noise.wgsl',
			'docs/data/threejs-mapping.json',
			'skills/null3d-port-threejs/references/materials.md',
		];
		expect(skillBearingFiles(files)).toEqual(files);
		expect(skillBearingFiles(['crates/null3d-core/src/handles.rs', 'docs/api/scene.md'])).toEqual(
			[],
		);
	});
});

describe('message parsing', () => {
	it('strips comment lines and everything below the scissors line', () => {
		const raw = [
			'feat: add thing',
			'',
			'# Please enter the commit message',
			'body line',
			'# ------------------------ >8 ------------------------',
			'diff --git a/x b/x',
		].join('\n');
		const msg = effectiveMessage(raw);
		expect(msg).toContain('body line');
		expect(msg).not.toContain('Please enter');
		expect(msg).not.toContain('diff --git');
	});

	it('exempts merge, revert and fixup commits', () => {
		expect(isExemptCommit('Merge branch main into feature')).toBe(true);
		expect(isExemptCommit('Revert "feat: add thing"')).toBe(true);
		expect(isExemptCommit('fixup! feat: add thing')).toBe(true);
		expect(isExemptCommit('feat: add thing')).toBe(false);
	});

	it('finds a trailer case-insensitively and trims it', () => {
		expect(findAckValue('feat: x\n\ndocs-checked:  updated docs/a.md  ', 'Docs-Checked')).toBe(
			'updated docs/a.md',
		);
		expect(findAckValue('feat: x\n\nbody', 'Docs-Checked')).toBeNull();
	});
});

describe('the two rules', () => {
	const code = ['packages/engine/src/scene.ts'];

	it('reject a code commit with no trailer, and bare values', () => {
		expect(checkDocs('feat: add setScale', code).ok).toBe(false);
		expect(checkSkills('feat: add setScale', code).ok).toBe(false);
		for (const value of ['yes', 'n/a', 'done', 'ok', 'checked!']) {
			expect(checkDocs(`feat: x\n\nDocs-Checked: ${value}`, code).ok).toBe(false);
		}
	});

	it('accept meaningful trailers', () => {
		const msg =
			'feat: add setScale\n\nDocs-Checked: updated docs/api/objects.md\nSkills-Checked: updated api-quickref.md';
		expect(checkDocs(msg, code).ok).toBe(true);
		expect(checkSkills(msg, code).ok).toBe(true);
	});

	it('pass docs-only commits and merges without trailers', () => {
		expect(checkDocs('docs: fix typo', ['docs/concepts/handles.md']).ok).toBe(true);
		expect(checkSkills('docs: fix typo', ['docs/concepts/handles.md']).ok).toBe(true);
		expect(checkDocs('Merge branch main', code).ok).toBe(true);
	});
});

describe('unstagedPaths', () => {
	it('lists paths whose working tree differs from the index, including untracked files', () => {
		const porcelain = [
			'M  docs/staged.md',
			' M docs/unstaged.md',
			'MM docs/both.md',
			'?? docs/new.md',
			'',
		].join('\n');
		expect(unstagedPaths(porcelain)).toEqual(['docs/unstaged.md', 'docs/both.md', 'docs/new.md']);
	});
});

describe('touchesRust', () => {
	it('flags Rust source, Cargo files and Rust settings', () => {
		expect(touchesRust(['crates/null3d-core/src/lib.rs'])).toBe(true);
		expect(touchesRust(['Cargo.lock'])).toBe(true);
		expect(touchesRust(['crates/null3d-wasm/Cargo.toml'])).toBe(true);
		expect(touchesRust(['clippy.toml'])).toBe(true);
		expect(touchesRust(['docs/index.md', 'tools/gen-docs.ts'])).toBe(false);
	});
});

describe('the docs style hook', () => {
	it('checks every published Markdown file, and nothing generated for Claude Code', () => {
		for (const path of [
			'README.md',
			'AGENTS.md',
			'CHANGELOG.md',
			'docs/guides/performance.md',
			'skills/demo/SKILL.md',
			'skills/demo/references/notes.md',
			'packages/cli/README.md',
			'.dev/devices.md',
			'.dev/decisions/D-01-gpu-layer.md',
		])
			expect(isStyleChecked(path)).toBe(true);
		for (const path of [
			'.claude/skills/demo/SKILL.md',
			'skills/demo/evals/evals.json',
			'packages/engine/src/README.md',
			'tools/gen-docs.ts',
			'.internal/plan/notes.md',
			'.dev/notes/draft.md',
		])
			expect(isStyleChecked(path)).toBe(false);
	});

	it('treats AGENTS.md, the maintainer guides and the decision records as contributor files', () => {
		expect(audienceOf('AGENTS.md')).toBe('contributors');
		expect(audienceOf('.dev/benchmarks.md')).toBe('contributors');
		expect(audienceOf('.dev/decisions/D-01-gpu-layer.md')).toBe('contributors');
		expect(audienceOf('README.md')).toBe('users');
	});

	it('reads the subject line, which becomes a changelog entry', () => {
		expect(subjectOf('feat(tools): add a check\n\nBody.\n# comment')).toBe(
			'feat(tools): add a check',
		);
		expect(subjectOf('Merge branch main')).toBeNull();
		expect(subjectOf('# only a comment\n')).toBeNull();
	});
});
