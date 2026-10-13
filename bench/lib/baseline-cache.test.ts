import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	baselinesToPrune,
	cachedBaseline,
	IN_USE_MS,
	KEPT_BASELINES,
	readPreparedBaseline,
} from './baseline-cache';
import { sourcesStamp } from './serve';

const HOUR = 60 * 60 * 1000;

describe('the prepared baselines that the cache removes', () => {
	const now = 1_000 * HOUR;
	const entries = (count: number, ageMs: (index: number) => number) =>
		Array.from({ length: count }, (_, index) => ({
			name: `commit-${index}`,
			usedMs: now - ageMs(index),
		}));

	test('keeps every one while it holds no more than it keeps', () => {
		expect(
			baselinesToPrune(
				entries(KEPT_BASELINES, (i) => 100 * HOUR + i),
				now,
			),
		).toEqual([]);
	});

	test('removes the ones used longest ago past the kept number', () => {
		const old = entries(KEPT_BASELINES + 2, (i) => (i + 3) * HOUR);
		expect(baselinesToPrune(old.reverse(), now)).toEqual([
			`commit-${KEPT_BASELINES}`,
			`commit-${KEPT_BASELINES + 1}`,
		]);
	});

	test('keeps one that a check used lately, past the kept number', () => {
		const recent = entries(KEPT_BASELINES + 1, (i) => (i * IN_USE_MS) / (2 * KEPT_BASELINES));
		expect(baselinesToPrune(recent, now)).toEqual([]);
	});
});

describe('a prepared baseline in the cache', () => {
	test('counts only when its record names the commit', () => {
		const cache = mkdtempSync(join(tmpdir(), 'null3d-baselines-'));
		try {
			expect(cachedBaseline('abc', cache)).toBeNull();
			mkdirSync(join(cache, 'abc'));
			expect(readPreparedBaseline(join(cache, 'abc'))).toBeNull();
			const record = { commit: 'abc', subject: 'a commit', switches: ['governor=off'] };
			writeFileSync(join(cache, 'abc', 'baseline.json'), JSON.stringify(record));
			expect(cachedBaseline('abc', cache)).toBe(join(cache, 'abc'));
			expect(readPreparedBaseline(join(cache, 'abc'))).toEqual(record);
			mkdirSync(join(cache, 'def'));
			writeFileSync(join(cache, 'def', 'baseline.json'), JSON.stringify(record));
			expect(cachedBaseline('def', cache)).toBeNull();
		} finally {
			rmSync(cache, { recursive: true, force: true });
		}
	});
});

describe("the stamp of a checkout's sources", () => {
	test('changes with a change that git sees, a new file and the engine build, and only then', () => {
		const root = mkdtempSync(join(tmpdir(), 'null3d-stamp-'));
		// The user's own git settings, such as commit signing and hooks, stay out of the test.
		const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
		const git = (...args: string[]) =>
			execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=t@t', ...args], {
				env,
			});
		try {
			git('init', '--quiet');
			writeFileSync(join(root, 'page.ts'), 'one');
			writeFileSync(join(root, '.gitignore'), 'packages/engine/dist\n');
			git('add', '.');
			git('commit', '--quiet', '-m', 'one');
			const clean = sourcesStamp(root);
			expect(sourcesStamp(root)).toBe(clean);
			writeFileSync(join(root, 'page.ts'), 'two');
			const edited = sourcesStamp(root);
			expect(edited).not.toBe(clean);
			writeFileSync(join(root, 'page.ts'), 'one');
			expect(sourcesStamp(root)).toBe(clean);
			writeFileSync(join(root, 'new.ts'), 'new');
			expect(sourcesStamp(root)).not.toBe(clean);
			rmSync(join(root, 'new.ts'));
			mkdirSync(join(root, 'packages/engine/dist'), { recursive: true });
			writeFileSync(join(root, 'packages/engine/dist/core.wasm'), 'core');
			expect(sourcesStamp(root)).not.toBe(clean);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
