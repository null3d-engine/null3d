// Points git at this repository's tracked hooks folder. Git keeps one hooks path for a repository,
// shared by every worktree of it, and a tracked folder is checked out in every worktree, so one
// install covers them all. `bun install` runs this from its prepare step, in place of the husky
// command that wrote a folder git ignores.
//
// Git resolves a relative hooks path against the directory it runs a hook in, which is the root of
// the working tree. `.githooks` therefore means each worktree's own copy of the tracked folder.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The tracked folder whose files git calls, one for each hook name. */
export const HOOKS_DIR = '.githooks';
/** The tracked folder holding the hook bodies that the dispatchers run. */
export const BODY_DIR = '.husky';

/** True when the environment asks for no git hooks, as CI's jobs and the release job do. */
export function hooksOff(): boolean {
	return process.env.HUSKY === '0';
}

/**
 * Makes the tracked folder the repository's hooks path, and returns the path it set. Returns null
 * when the environment asks for no hooks, or when this tree has no such folder, which is how a
 * branch from before the folder looks.
 */
export function installHooks(root: string): string | null {
	if (hooksOff() || !existsSync(join(root, HOOKS_DIR))) return null;
	const result = spawnSync('git', ['config', 'core.hooksPath', HOOKS_DIR], {
		cwd: root,
		encoding: 'utf8',
	});
	if (result.status !== 0)
		throw new Error(
			`could not make ${HOOKS_DIR} the hooks path: ${result.stderr.trim() || `git exited with ${result.status}`}`,
		);
	return HOOKS_DIR;
}

if (import.meta.main) installHooks(process.cwd());
