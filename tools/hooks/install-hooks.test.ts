import { describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BODY_DIR, HOOKS_DIR, installHooks } from './install-hooks';

const ROOT = join(import.meta.dirname, '..', '..');

/** The hooks this repository runs: a body file in `.husky/`, without husky's own folder. */
function hookNames(): string[] {
	return readdirSync(join(ROOT, BODY_DIR), { withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => entry.name)
		.sort();
}

/** The hooks path that git holds for `root`, or null when it holds none. */
function hooksPath(root: string): string | null {
	const result = spawnSync('git', ['config', '--get', 'core.hooksPath'], {
		cwd: root,
		encoding: 'utf8',
	});
	return result.status === 0 ? result.stdout.trim() : null;
}

describe('the tracked hooks folder', () => {
	it('holds a dispatcher for each hook body, and each forwards to the one script', () => {
		const names = hookNames();
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

	it('is installed as the hooks path, and not asked for under HUSKY=0', () => {
		const root = mkdtempSync(join(tmpdir(), 'null3d-install-hooks-'));
		const before = process.env.HUSKY;
		try {
			execFileSync('git', ['init', '--quiet'], { cwd: root });
			mkdirSync(join(root, HOOKS_DIR), { recursive: true });
			process.env.HUSKY = '0';
			expect(installHooks(root)).toBeNull();
			expect(hooksPath(root)).toBeNull();
			delete process.env.HUSKY;
			expect(installHooks(root)).toBe(HOOKS_DIR);
			expect(hooksPath(root)).toBe(HOOKS_DIR);
		} finally {
			if (before === undefined) delete process.env.HUSKY;
			else process.env.HUSKY = before;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
