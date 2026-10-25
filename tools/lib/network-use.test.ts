import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scaledBudget } from '../../tests/lib/run-budget.ts';
import { fixture } from './fixture.ts';
import { allowedHost, FETCH_SITES, networkProblems } from './network-use.ts';

const ROOT = join(import.meta.dir, '../..');

/** The scan reads every shipped source file, which a loaded machine does slowly past the 5 s default. */
const REPOSITORY_SCAN_MS = scaledBudget(60_000);

describe('allowedHost', () => {
	test('accepts a recorded host and its subdomains', () => {
		expect(allowedHost('example.com')).toContain('error messages');
		expect(allowedHost('cdn.example.com')).toContain('error messages');
		expect(allowedHost('github.com')).toContain('link');
		expect(allowedHost('localhost:51234')).toContain('this machine');
	});

	test('ignores the punctuation that a sentence or a template puts after a host', () => {
		expect(allowedHost('example.com.')).toBeDefined();
		expect(allowedHost('cdn.example.com;')).toBeDefined();
		expect(allowedHost('127.0.0.1:8080')).toBeDefined();
	});

	test('refuses a host that the record does not name', () => {
		expect(allowedHost('analytics.example.net')).toBeUndefined();
		expect(allowedHost('notexample.com')).toBeUndefined();
	});
});

describe('networkProblems', () => {
	test('accepts a recorded call site and its example addresses', () => {
		const root = fixture({
			'packages/engine/src/page/engine.ts':
				'fetch(one).catch(() => {}); fetch(two).catch(() => {});',
			'packages/engine/src/errors/codes.ts': "const text = 'see https://example.com/a.png.';",
		});
		expect(networkProblems(root).problems).toEqual([]);
	});

	test('refuses a fetch call in a file that the record does not name', () => {
		const root = fixture({
			'packages/terrain/src/index.ts': 'const response = await fetch(url);',
		});
		expect(networkProblems(root).problems.join('\n')).toContain(
			'packages/terrain/src/index.ts: calls fetch',
		);
	});

	test('refuses a second call site in a recorded file', () => {
		const root = fixture({
			'packages/engine/src/page/engine.ts': 'fetch(a); fetch(b); fetch(c);',
		});
		expect(networkProblems(root).problems.join('\n')).toContain(
			'has 3 fetch calls, and network-use.ts records 2',
		);
	});

	test('refuses a telemetry or socket API in shipped code', () => {
		const root = fixture({
			'packages/engine/src/page/engine.ts':
				'fetch(a); navigator.sendBeacon(url, text); new WebSocket(url);',
		});
		const problems = networkProblems(root).problems.join('\n');
		expect(problems).toContain('uses sendBeacon');
		expect(problems).toContain('uses WebSocket');
	});

	test('refuses a call through the global object, or a script importer', () => {
		const root = fixture({
			'packages/engine/src/page/engine.ts': 'fetch(a); fetch(b); globalThis.fetch(c);',
			'packages/terrain/src/index.ts': 'window.fetch(a); self.fetch(b); importScripts(url);',
		});
		const problems = networkProblems(root).problems.join('\n');
		expect(problems).toContain('packages/engine/src/page/engine.ts: has 3 fetch calls');
		expect(problems).toContain('packages/terrain/src/index.ts: calls fetch');
		expect(problems).toContain('packages/terrain/src/index.ts: uses importScripts');
	});

	test('refuses a socket address that the record does not name', () => {
		const root = fixture({
			'packages/engine/src/page/engine.ts':
				"fetch(url); const hub = 'wss://push.example.net/live';",
		});
		expect(networkProblems(root).problems.join('\n')).toContain('names wss://push.example.net');
	});

	test('refuses an address whose host the record does not name', () => {
		const root = fixture({
			'packages/engine/src/page/engine.ts':
				"fetch(url); const ping = 'https://analytics.example.net/collect';",
		});
		expect(networkProblems(root).problems.join('\n')).toContain(
			'names https://analytics.example.net',
		);
	});

	test('reads the CLI, the packages and the example add-ons, and skips tests', () => {
		const root = fixture({
			'packages/cli/bin/null3d.js': 'console.log(1);',
			'packages/terrain/src/index.test.ts': 'fetch(url);',
			'packages/engine/src/generated/shaders.js': 'fetch(url);',
			'examples/addons/lens-kit/index.ts': 'new XMLHttpRequest();',
		});
		const { problems, files } = networkProblems(root);
		expect(files).toBe(2);
		expect(problems.join('\n')).toContain('examples/addons/lens-kit/index.ts: uses XMLHttpRequest');
	});
});

describe('the repository', () => {
	test(
		'ships no network call beyond the recorded ones',
		() => {
			const { problems, calls } = networkProblems(ROOT);
			expect(problems).toEqual([]);
			expect(calls).toBe(Object.values(FETCH_SITES).reduce((total, site) => total + site.count, 0));
		},
		REPOSITORY_SCAN_MS,
	);

	test('states the promise, and the build switch, on the network use page', () => {
		const page = readFileSync(join(ROOT, 'docs/getting-started/network-use.md'), 'utf8');
		expect(page).toContain('sends nothing to any server');
		expect(page).toContain('NULL3D_ENGINE_SHADERS');
	});
});
