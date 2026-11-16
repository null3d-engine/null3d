import { describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
	type CacheRefs,
	heldKeys,
	jobDefinitions,
	type MatrixEntry,
	moduleHashes,
	passedJobs,
	passKeys,
	workflowMatrices,
} from './ci-passes';
import { fixture } from './fixture';

const ROOT = join(import.meta.dirname, '../..');
const HASHES = {
	'rust-shaders': 'S',
	'rust-workspace': 'W',
	'shader-compiler': 'C',
	plugin: 'P',
	'plugin-tests': 'T',
};
const DEFINITIONS = { 'rust-tests': 'R', 'shader-compiler': 'D', 'shader-compiler-plugin': 'G' };
const MATRICES: Record<string, MatrixEntry[]> = {
	'rust-tests': [
		{ id: 'ci-1', partition: 'count:1/4' },
		{ id: 'shader-determinism', shard: 'determinism' },
	],
	'shader-compiler': [{ part: 1, shard: '0/20' }],
	'shader-compiler-plugin': [
		{ script: 'test:shader-compiler:plugin' },
		{ script: 'test:shader-compiler:pack', share: '1/4' },
	],
};

describe('passKeys', () => {
	it("keys each part on the hashes of the files that it reads, then on its job's definition", () => {
		expect(passKeys(MATRICES, HASHES, { '1/4': 'M' }, DEFINITIONS)).toEqual({
			'rust-tests': {
				'ci-1': 'passed-v2-ci-1-count:1/4-W-R',
				'shader-determinism': 'passed-v2-shader-determinism-determinism-S-R',
			},
			'shader-compiler': { '1': 'passed-v4-shader-compiler-0/20-C-D' },
			'shader-compiler-plugin': {
				'test:shader-compiler:plugin':
					'passed-v2-shader-compiler-plugin-test:shader-compiler:plugin-P-T-G',
				'test:shader-compiler:pack-1/4':
					'passed-v2-shader-compiler-plugin-test:shader-compiler:pack-1/4-P-M-G',
			},
		});
	});

	it('refuses a missing hash, and a job that the workflow lists no parts of', () => {
		const { plugin: _, ...without } = HASHES;
		expect(() => passKeys(MATRICES, without, {}, DEFINITIONS)).toThrow(/no hash named plugin/);
		expect(() => passKeys(MATRICES, HASHES, {}, {})).toThrow(/no definition of rust-tests/);
		expect(() => passKeys({ ...MATRICES, 'shader-compiler': [] }, HASHES, {}, DEFINITIONS)).toThrow(
			/no parts of shader-compiler/,
		);
	});

	it("gives every part of the workflow's pass-keyed jobs a key of its own", () => {
		const matrices = workflowMatrices(ROOT);
		const modules = moduleHashes(ROOT, matrices['shader-compiler-plugin'] ?? []);
		const keys = passKeys(matrices, HASHES, modules, jobDefinitions(ROOT));
		for (const [job, parts] of Object.entries(keys)) {
			expect(Object.keys(parts), job).toHaveLength(matrices[job]?.length ?? -1);
			expect(new Set(Object.values(parts)).size, job).toBe(Object.keys(parts).length);
		}
		// Each share of the packing test keys on a hash of its own share of the modules.
		expect(new Set(Object.values(modules)).size).toBe(Object.keys(modules).length);
		expect(Object.keys(modules).length).toBeGreaterThan(1);
	});
});

describe('jobDefinitions', () => {
	it("changes with a job's commands, but not with a comment or another job's change", () => {
		const workflow = (command: string, comment: string) => `jobs:
  rust-tests:
    # ${comment}
    runs-on: ubuntu-latest
    steps:
      - run: ${command}
  shader-compiler:
    steps:
      - run: cargo test
  shader-compiler-plugin:
    steps:
      - run: bun test
`;
		const definitions = (command: string, comment: string) => {
			const root = fixture({ '.github/workflows/ci.yml': workflow(command, comment) });
			try {
				return jobDefinitions(root);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		};
		const before = definitions('cargo nextest run --profile ci', 'the tests');
		expect(definitions('cargo nextest run --profile ci', 'every test')).toEqual(before);
		const after = definitions('cargo nextest run --profile ci --no-fail-fast', 'the tests');
		expect(after['rust-tests']).not.toBe(before['rust-tests']);
		expect(after['shader-compiler']).toBe(before['shader-compiler']);
		expect(after['shader-compiler-plugin']).toBe(before['shader-compiler-plugin']);
	});

	it("changes with what a repository action that the job runs holds, and only that job's", () => {
		const definitions = (setting: string, comment: string, script: string) => {
			const root = fixture({
				'.github/workflows/ci.yml': `jobs:
  rust-tests:
    steps:
      - uses: ./.github/actions/settings
      - run: cargo nextest run
  shader-compiler:
    steps:
      - run: cargo test
  shader-compiler-plugin:
    steps:
      - run: bun test
`,
				'.github/actions/settings/action.yml': `# ${comment}
runs:
  using: composite
  steps:
    - uses: ./.github/actions/settings-inner
`,
				'.github/actions/settings-inner/action.yml': `runs:
  using: composite
  steps:
    - shell: bash
      run: echo '${setting}' >> .cargo/config.toml
`,
				'.github/actions/settings-inner/write.sh': script,
			});
			try {
				return jobDefinitions(root);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		};
		const before = definitions('opt-level = 3', 'the settings', 'echo a\n');
		// A comment in an action's file does not count, as one in the workflow does not.
		expect(definitions('opt-level = 3', 'every setting', 'echo a\n')).toEqual(before);
		// A nested action's definition, and a script beside it, each count.
		for (const after of [
			definitions('opt-level = 1', 'the settings', 'echo a\n'),
			definitions('opt-level = 3', 'the settings', 'echo b\n'),
		]) {
			expect(after['rust-tests']).not.toBe(before['rust-tests']);
			expect(after['shader-compiler']).toBe(before['shader-compiler']);
			expect(after['shader-compiler-plugin']).toBe(before['shader-compiler-plugin']);
		}
	});
});

describe('heldKeys', () => {
	const refsOf: CacheRefs = async (key) =>
		({
			'on-this-branch': ['refs/heads/m3-start'],
			'on-main': ['refs/heads/main'],
			'on-another-branch': ['refs/heads/fix/other'],
		})[key] ?? [];

	it("holds a key saved on the run's own ref or the default branch, as the cache action restores", async () => {
		const keys = ['on-this-branch', 'on-main', 'on-another-branch', 'nowhere'];
		const held = await heldKeys(keys, ['refs/heads/m3-start', 'refs/heads/main'], refsOf);
		expect([...held].sort()).toEqual(['on-main', 'on-this-branch']);
	});

	it('counts a key whose lookup fails as no pass, so that its part runs', async () => {
		const failing: CacheRefs = async () => {
			throw new Error('HTTP 502');
		};
		expect((await heldKeys(['on-main'], ['refs/heads/main'], failing)).size).toBe(0);
	});
});

describe('passedJobs', () => {
	it('names a job only when every one of its parts passed', () => {
		const keys = { whole: { a: 'k1', b: 'k2' }, half: { a: 'k3', b: 'k4' } };
		expect(passedJobs(keys, new Set(['k1', 'k2', 'k3']))).toEqual(['whole']);
	});
});
