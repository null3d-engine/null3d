// Points git at this repository's tracked hooks folder, and writes the folder that husky's name
// pointed at, so that both names work. Git keeps one hooks path for a repository, shared by every
// worktree of it, and a tracked folder is checked out in every worktree, so one install covers them
// all. `bun install` runs this from its prepare step, in place of the husky command.
//
// Git resolves a relative hooks path against the directory it runs a hook in, which is the root of
// the working tree. `.githooks` therefore means each worktree's own copy of the tracked folder.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The tracked folder whose files git calls, one for each hook name. */
export const HOOKS_DIR = '.githooks';
/** The tracked folder holding the hook bodies that the dispatchers run. */
export const BODY_DIR = '.husky';
/**
 * The folder that husky's name points at. This install writes it too, so a hooks path that still
 * names it runs the same dispatcher. A tree that a later install touched, an older tree that ran
 * husky's own install, and this one therefore all work, whichever of the two names git holds.
 */
export const SHIM_DIR = '.husky/_';

/**
 * The text of a file in the shim folder: it runs the one dispatcher with the hook's own name. A shim
 * sits one folder deeper than a file of the tracked folder, so it climbs one more level.
 */
const SHIM_TEXT =
	'#!/bin/sh\nexec "$(dirname -- "$0")/../../.githooks/run" "$(basename -- "$0")" "$@"\n';

/** True when the environment asks for no git hooks, as CI's jobs and the release job do. */
export function hooksOff(): boolean {
	return process.env.HUSKY === '0';
}

/** The hooks this repository runs: a body file in the body folder, without the shim folder. */
export function hookBodies(root: string): string[] {
	return readdirSync(join(root, BODY_DIR), { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
}

/** Writes an executable file, and the folders above it. */
function writeExecutable(path: string, text: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, text, { mode: 0o755 });
}

/**
 * Writes the shim folder, one file for each hook, each forwarding to the dispatcher of the tracked
 * folder. Husky's folder ignores itself, so a checkout never lists the shims as untracked files.
 */
function writeShims(root: string, names: readonly string[]): void {
	for (const name of names) writeExecutable(join(root, SHIM_DIR, name), SHIM_TEXT);
	writeFileSync(join(root, SHIM_DIR, '.gitignore'), '*\n');
}

/**
 * Makes the tracked folder the repository's hooks path, writes the shim folder that husky's name
 * points at, and returns the path it set. Returns null when the environment asks for no hooks, or
 * when this tree has no tracked folder, which is how a branch from before it looks.
 */
export function installHooks(root: string): string | null {
	if (hooksOff() || !existsSync(join(root, HOOKS_DIR))) return null;
	if (existsSync(join(root, BODY_DIR))) writeShims(root, hookBodies(root));
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
