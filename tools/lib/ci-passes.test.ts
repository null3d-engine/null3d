import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
	type CacheRefs,
	heldKeys,
	type MatrixEntry,
	moduleHashes,
	passedJobs,
	passKeys,
	workflowMatrices,
} from './ci-passes';

const ROOT = join(import.meta.dirname, '../..');
const HASHES = {
	'rust-shaders': 'S',
	'rust-workspace': 'W',
	'shader-compiler': 'C',
	plugin: 'P',
	'plugin-tests': 'T',
};
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
	it('writes the keys that the jobs wrote before, so that their passes still count', () => {
		expect(passKeys(MATRICES, HASHES, { '1/4': 'M' })).toEqual({
			'rust-tests': {
				'ci-1': 'passed-v2-ci-1-count:1/4-W',
				'shader-determinism': 'passed-v2-shader-determinism-determinism-S',
			},
			'shader-compiler': { '1': 'passed-v4-shader-compiler-0/20-C' },
			'shader-compiler-plugin': {
				'test:shader-compiler:plugin':
					'passed-v2-shader-compiler-plugin-test:shader-compiler:plugin-P-T',
				'test:shader-compiler:pack-1/4':
					'passed-v2-shader-compiler-plugin-test:shader-compiler:pack-1/4-P-M',
			},
		});
	});

	it('refuses a missing hash, and a job that the workflow lists no parts of', () => {
		const { plugin: _, ...without } = HASHES;
		expect(() => passKeys(MATRICES, without, {})).toThrow(/no hash named plugin/);
		expect(() => passKeys({ ...MATRICES, 'shader-compiler': [] }, HASHES, {})).toThrow(
			/no parts of shader-compiler/,
		);
	});

	it("gives every part of the workflow's pass-keyed jobs a key of its own", () => {
		const matrices = workflowMatrices(ROOT);
		const modules = moduleHashes(ROOT, matrices['shader-compiler-plugin'] ?? []);
		const keys = passKeys(matrices, HASHES, modules);
		for (const [job, parts] of Object.entries(keys)) {
			expect(Object.keys(parts), job).toHaveLength(matrices[job]?.length ?? -1);
			expect(new Set(Object.values(parts)).size, job).toBe(Object.keys(parts).length);
		}
		// Each share of the packing test keys on a hash of its own share of the modules.
		expect(new Set(Object.values(modules)).size).toBe(Object.keys(modules).length);
		expect(Object.keys(modules).length).toBeGreaterThan(1);
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
