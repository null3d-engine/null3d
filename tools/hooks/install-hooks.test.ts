import { describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BODY_DIR, HOOKS_DIR, hookBodies, installHooks, SHIM_DIR } from './install-hooks';

const ROOT = join(import.meta.dirname, '..', '..');

/** The hooks path that git holds for `root`, or null when it holds none. */
function hooksPath(root: string): string | null {
	const result = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
		cwd: root,
		encoding: 'utf8',
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

/** A commit in `root`, with this machine's own git settings kept out of the way, and its output. */
function commitUnder(root: string): string {
	const result = spawnSync(
		'git',
		[
			'-c',
			'user.email=hooks@example.com',
			'-c',
			'user.name=a test',
			'-c',
			'commit.gpgsign=false',
			'commit',
			'--allow-empty',
			'-m',
			'a commit',
		],
		{ cwd: root, encoding: 'utf8' },
	);
	// Git writes what a hook printed to its own standard error, so the test reads both streams.
	return `${result.stdout}${result.stderr}`;
}

/** A repository with this repository's dispatchers, a body for each hook, and a file to commit. */
function scratch(): string {
	const root = mkdtempSync(join(tmpdir(), 'null3d-hooks-'));
	execFileSync('git', ['init', '--quiet'], { cwd: root });
	cpSync(join(ROOT, HOOKS_DIR), join(root, HOOKS_DIR), { recursive: true });
	for (const name of hookBodies(ROOT)) chmodSync(join(root, HOOKS_DIR, name), 0o755);
	mkdirSync(join(root, BODY_DIR), { recursive: true });
	// A commit runs the pre-commit hook and then the commit-msg one, so both need a body here.
	for (const name of hookBodies(ROOT))
		writeFileSync(join(root, BODY_DIR, name), '#!/bin/sh\necho BODY-RAN\n');
	writeFileSync(join(root, 'a file'), 'a line\n');
	return root;
}

describe('the tracked hooks folder', () => {
	it('holds a dispatcher for each hook body, and each forwards to the one script', () => {
		const names = hookBodies(ROOT);
		expect(names).toContain('pre-commit');
		for (const name of names) {
			const file = join(ROOT, HOOKS_DIR, name);
			expect(existsSync(file), `${HOOKS_DIR}/${name} is missing`).toBe(true);
			// Git calls the file itself, so it needs the executable bit.
			expect(statSync(file).mode & 0o111, `${HOOKS_DIR}/${name} is not executable`).not.toBe(0);
			expect(readFileSync(file, 'utf8'), `${HOOKS_DIR}/${name} does not forward`).toContain(
				'"$(dirname -- "$0")/run"',
			);
		}
	});

	it("is installed as the hooks path, with husky's folder beside it, and nothing under HUSKY=0", () => {
		const root = scratch();
		const before = process.env.HUSKY;
		try {
			process.env.HUSKY = '0';
			expect(installHooks(root)).toBeNull();
			expect(hooksPath(root)).toBeNull();
			delete process.env.HUSKY;
			expect(installHooks(root)).toBe(HOOKS_DIR);
			expect(hooksPath(root)).toBe(HOOKS_DIR);
			// Husky's folder holds a file for each body, runnable, forwarding to the one dispatcher.
			const shim = join(root, SHIM_DIR, 'pre-commit');
			expect(existsSync(shim)).toBe(true);
			expect(statSync(shim).mode & 0o111).not.toBe(0);
			expect(readFileSync(shim, 'utf8')).toContain('.githooks/run');
		} finally {
			if (before === undefined) delete process.env.HUSKY;
			else process.env.HUSKY = before;
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('runs the hook under the tracked path and under the path husky names', () => {
		const root = scratch();
		const before = process.env.HUSKY;
		try {
			// Every CI job sets husky's opt-out, and under it the install writes nothing and no hook
			// runs. The assertions here are that hooks do run, so this test drops the opt-out.
			delete process.env.HUSKY;
			installHooks(root);
			execFileSync('git', ['add', '-A'], { cwd: root });
			for (const path of [HOOKS_DIR, SHIM_DIR]) {
				execFileSync('git', ['config', 'core.hooksPath', path], { cwd: root });
				expect(commitUnder(root), `no hook ran under ${path}`).toContain('BODY-RAN');
			}
		} finally {
			if (before === undefined) delete process.env.HUSKY;
			else process.env.HUSKY = before;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
