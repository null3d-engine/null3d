import { describe, expect, it } from 'bun:test';
import {
	checkCommitMessage as checkDocs,
	docBearingFiles,
	effectiveMessage,
	isExemptCommit,
} from './check-docs-ack';
import { unstagedPaths } from './check-generated';
import { touchesRust } from './check-rust';
import { checkCommitMessage as checkSkills, skillBearingFiles } from './check-skills-ack';
import { findAckValue } from './commit-ack';

describe('docBearingFiles', () => {
	it('flags engine code, package source and binaries, and skills', () => {
		const files = [
			'crates/sokko3d-core/src/handles.rs',
			'packages/engine/src/scene.ts',
			'packages/cli/bin/sokko3d.js',
			'skills/sokko3d-develop/SKILL.md',
		];
		expect(docBearingFiles(files)).toEqual(files);
	});

	it('exempts docs, tests, tools, CI settings and root prose', () => {
		expect(
			docBearingFiles([
				'docs/concepts/handles.md',
				'crates/sokko3d-core/tests/handles.rs',
				'packages/engine/test/scene.test.ts',
				'tools/gen-docs.ts',
				'.github/workflows/ci.yml',
				'README.md',
				'AGENTS.md',
			]),
		).toEqual([]);
	});
});

describe('skillBearingFiles', () => {
	it('flags the public API, the shader library, the mapping and the skills', () => {
		const files = [
			'packages/engine/src/scene.ts',
			'crates/sokko3d-shaders/wgsl/noise.wgsl',
			'docs/data/threejs-mapping.json',
			'skills/sokko3d-port-threejs/references/materials.md',
		];
		expect(skillBearingFiles(files)).toEqual(files);
		expect(skillBearingFiles(['crates/sokko3d-core/src/handles.rs', 'docs/api/scene.md'])).toEqual(
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
		expect(touchesRust(['crates/sokko3d-core/src/lib.rs'])).toBe(true);
		expect(touchesRust(['Cargo.lock'])).toBe(true);
		expect(touchesRust(['crates/sokko3d-wasm/Cargo.toml'])).toBe(true);
		expect(touchesRust(['clippy.toml'])).toBe(true);
		expect(touchesRust(['docs/index.md', 'tools/gen-docs.ts'])).toBe(false);
	});
});
