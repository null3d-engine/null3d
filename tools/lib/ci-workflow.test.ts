// Checks the CI workflow's job graph and shard lists. A typo in either breaks CI without failing
// any job: a job missing from ci-passed's needs never gates main, a job that skips on an answer
// ci-passed does not expect fails every docs-only run, and a shard missing from a matrix never runs
// its tests.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Step {
	name?: string;
	run?: string;
	env?: Record<string, string>;
}

interface Job {
	needs?: string | string[];
	if?: string;
	strategy?: { matrix?: Record<string, unknown> & { include?: Record<string, unknown>[] } };
	steps?: Step[];
}

const workflow = Bun.YAML.parse(
	readFileSync(join(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8'),
) as { jobs: Record<string, Job> };
const jobs = workflow.jobs;

const needsOf = (job: Job | undefined): string[] =>
	job?.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
const oneTo = (count: number) => Array.from({ length: count }, (_, i) => i + 1);
const jobNamed = (name: string): Job => {
	const job = jobs[name];
	if (!job) throw new Error(`the workflow has no job ${name}`);
	return job;
};
const matrixOf = (name: string) => jobNamed(name).strategy?.matrix ?? {};

describe("CI's workflow", () => {
	it('gates main on every job through ci-passed', () => {
		const gated = needsOf(jobs['ci-passed']).sort();
		// The jobs that run after ci-passed act on its answer, so they cannot be among its needs.
		const others = Object.keys(jobs)
			.filter((name) => name !== 'ci-passed' && !needsOf(jobs[name]).includes('ci-passed'))
			.sort();
		expect(gated).toEqual(others);
	});

	it("lets a job skip only on the changes job's answer that ci-passed allows", () => {
		const step = jobNamed('ci-passed').steps?.find(({ name }) => name === 'Every job passed');
		const gate = Object.fromEntries(
			[...(step?.run ?? '').matchAll(/"([\w-]+)": "(\w+)"/g)].map(([, job, answer]) => [
				job,
				answer,
			]),
		);
		for (const name of needsOf(jobs['ci-passed'])) {
			const answer = /needs\.changes\.outputs\.(\w+) == 'true'/.exec(jobNamed(name).if ?? '')?.[1];
			expect(gate[name], name).toBe(answer);
		}
	});

	it('runs every shard of each numbered matrix once', () => {
		for (const [name, key] of [
			['browser', 'shard'],
			['browser-alone', 'shard'],
			['real-browsers', 'shard'],
			['size-parts', 'part'],
		] as const) {
			const shards = matrixOf(name)[key] as number[];
			expect(shards, name).toEqual(oneTo(shards.length));
		}
		expect(matrixOf('real-browsers').shards).toEqual([
			(matrixOf('real-browsers').shard as number[]).length,
		]);
	});

	it('gives each browser shard one weight', () => {
		const weights = jobNamed('browser')
			.steps?.map(({ env }) => env?.PWTEST_SHARD_WEIGHTS)
			.find(Boolean);
		expect(weights?.split(':').length).toBe((matrixOf('browser').shard as number[]).length);
	});

	it("splits the benchmark pages' parity tests into shards that each run once", () => {
		const parity = (matrixOf('bench').include ?? [])
			.map(({ tests }) => /^parity\.spec\.ts --shard=(\d+)\/(\d+)$/.exec(String(tests)))
			.filter((match) => match !== null)
			.map(([, index, count]) => [Number(index), Number(count)]);
		const count = parity[0]?.[1] ?? 0;
		expect(count).toBeGreaterThan(0);
		expect(parity.map(([index]) => index)).toEqual(oneTo(count));
		expect(parity.every(([, total]) => total === count)).toBe(true);
	});

	it("runs the shader build's determinism check in exactly one job", () => {
		const parts = (matrixOf('rust-tests').include ?? []).filter(
			({ shard }) => shard === 'determinism',
		);
		expect(parts).toHaveLength(1);
		expect(String(parts[0]?.tests)).toContain('--test build');
	});

	it('runs every shard of the shader compiler job once', () => {
		const shards = (matrixOf('shader-compiler').include ?? []).map(({ shard }) => String(shard));
		const count = Number(shards[0]?.split('/')[1]);
		expect(shards).toEqual(Array.from({ length: count }, (_, i) => `${i}/${count}`));
	});

	it('runs each shard of each sharded Rust test part once', () => {
		const shards = new Map<string, string[]>();
		for (const part of matrixOf('rust-tests').include ?? []) {
			if (part.shard === undefined) continue;
			const list = shards.get(String(part.tests)) ?? [];
			list.push(String(part.shard));
			shards.set(String(part.tests), list);
		}
		expect(shards.size).toBeGreaterThan(0);
		for (const [tests, list] of shards) {
			const numbered = list.filter((shard) => /^\d+\/\d+$/.test(shard));
			const count = Number(numbered[0]?.split('/')[1]);
			expect(numbered.sort(), tests).toEqual(
				Array.from({ length: count }, (_, i) => `${i}/${count}`).sort(),
			);
		}
	});
});
