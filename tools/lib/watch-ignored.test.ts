import { describe, expect, test } from 'bun:test';
import { watchIgnored } from './watch-ignored.ts';

const ignores = (root: string, path: string) =>
	watchIgnored(root).some((pattern) => new Bun.Glob(pattern).match(path));

describe('watchIgnored', () => {
	const repo = '/work/null3d';
	const worktree = `${repo}/.claude/worktrees/feature`;

	test('a worktree under the repository watches its own files', () => {
		expect(ignores(worktree, `${worktree}/examples/decals/sketch.ts`)).toBe(false);
		expect(ignores(worktree, `${worktree}/packages/engine/src/index.ts`)).toBe(false);
	});

	test('a worktree skips its own build output and tool folders', () => {
		expect(ignores(worktree, `${worktree}/target/debug/build.log`)).toBe(true);
		expect(ignores(worktree, `${worktree}/test-results/run/trace.zip`)).toBe(true);
		expect(ignores(worktree, `${worktree}/.claude/skills/null3d/SKILL.md`)).toBe(true);
		expect(ignores(worktree, `${worktree}/.internal/plan/notes.md`)).toBe(true);
	});

	test('the repository skips the worktrees under its .claude folder', () => {
		expect(ignores(repo, `${worktree}/examples/decals/sketch.ts`)).toBe(true);
		expect(ignores(repo, `${repo}/examples/decals/sketch.ts`)).toBe(false);
		expect(ignores(repo, `${repo}/.dev/benchmarks.md`)).toBe(true);
	});
});
