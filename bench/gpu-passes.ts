// The per-pass split of a page's GPU time: the GPU check judges a frame as a whole, so when S4 at
// High gets slower it names no part of the frame that pays. This runs the same two-build comparison
// as the check on that one page and prints each pass's GPU time per frame in both builds, the
// difference and the share of the baseline, with the largest increase last. It reads the per-pass
// figures from the comparison's record, where every null3D page publishes the parts of the frame
// that the browser times.
//
// Usage:
//   bun run bench:gpu-passes --prepare     (CPU only: the builds)
//   bun run bench:gpu-passes --measure     (the timing, on a quiet Mac)
//   bun run bench:gpu-passes               (both)
//   bun run bench:gpu-passes --base ../main-built --no-build
//
// Options:
//   --prepare        only prepare: build this checkout, its pages and the baseline
//   --measure        only measure; it fails when a build that it needs is missing or older than
//                    the sources, and names the step that makes it
//   --base <dir>     a built checkout, or a prepared baseline, to compare with. The default is the
//                    shared cache's prepared baseline of this branch's merge base with origin/main
//   --no-build       prepare without bun run build of this checkout first
//   --runs <n>       rounds of the page in each build; the default is 3
//   --seconds <n>    warm-up and measured time of each run; the default is 4
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../tests/lib/server.ts';
import { refuseInQuietWindow } from '../tools/lib/quiet-window.ts';
import {
	type BuildsOptions,
	type GpuCheckSteps,
	prepareBuilds,
	preparedBaseDir,
	runComparison,
} from './gpu-check';
import type { BuildRun, ComparisonRecord } from './lib/compare';
import { GPU_CHECK_PAGE } from './lib/gpu-check';
import { type PassRun, passChanges, passTable, splitRefusal } from './lib/gpu-passes';
import type { BenchResult } from './lib/report';
import { benchPagesFresh, comparePagesDir } from './lib/serve';

/** The page whose passes the split compares: S4's textured materials. */
export const SPLIT_SCENE = 's4';
/** The preset of the page's runs: the desktop's high preset. */
export const SPLIT_PRESET = 'high';
/** The step that makes the builds, as a command, for the messages that name it. */
const PREPARE = 'bun run bench:gpu-passes -- --prepare';
const DEFAULT_RUNS = 3;
const DEFAULT_SECONDS = 4;
/** The comparison needs this many rounds of a page in each build, or more. */
const MIN_RUNS = 3;

export interface GpuPassesOptions extends BuildsOptions {
	steps: GpuCheckSteps;
	runs: number;
	seconds: number;
}

export function parseGpuPassesArgs(args: readonly string[]): GpuPassesOptions {
	const options: GpuPassesOptions = {
		steps: 'both',
		base: null,
		build: true,
		runs: DEFAULT_RUNS,
		seconds: DEFAULT_SECONDS,
	};
	const steps = new Set<GpuCheckSteps>();
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const value = () => args[++i] ?? '';
		if (arg === '--prepare') steps.add('prepare');
		else if (arg === '--measure') steps.add('measure');
		else if (arg === '--base') options.base = value();
		else if (arg === '--no-build') options.build = false;
		else if (arg === '--runs') options.runs = Number(value());
		else if (arg === '--seconds') options.seconds = Number(value());
		else throw new Error(`unknown option ${arg}`);
	}
	if (steps.size === 1) options.steps = [...steps][0] as GpuCheckSteps;
	if (options.base === '') throw new Error('--base: name a built checkout');
	if (!(Number.isInteger(options.runs) && options.runs >= MIN_RUNS))
		throw new Error(`--runs: use a whole number of ${MIN_RUNS} or more, the comparison's least`);
	if (!(options.seconds > 0)) throw new Error('--seconds: use a number above 0');
	return options;
}

/** A run's per-pass GPU times, which the protocol's figures do not declare. */
interface StatsWithPasses {
	gpuPassMs?: { name: string; ms: { median: number } }[] | null;
}

/** The passes that a run timed, in the frame's order. */
const passesOf = (result: BenchResult): PassRun['passes'] => {
	const stats = result.stats as StatsWithPasses | undefined;
	return (stats?.gpuPassMs ?? []).map(({ name, ms }) => ({ name, ms: ms.median }));
};

/** The split's page's runs, and why any run of it gave no figures. */
function pageRuns(results: readonly BuildRun[]): { runs: PassRun[]; failed: string[] } {
	const runs: PassRun[] = [];
	const failed: string[] = [];
	for (const { build, round, result } of results) {
		if (!result.ok) {
			failed.push(`${build} round ${round}: ${result.error ?? 'no message'}`);
			continue;
		}
		runs.push({ build, round, passes: passesOf(result) });
	}
	return { runs, failed };
}

/** Times the page in both builds, and prints the table of its passes. */
function measure(options: GpuPassesOptions): void {
	const base = preparedBaseDir(options, PREPARE);
	if (!benchPagesFresh(REPO_ROOT, comparePagesDir('new')))
		throw new Error(
			`this checkout's pages are not built from its sources as they are: run ${PREPARE}`,
		);
	const folder = runComparison(base, [
		'--scenes',
		SPLIT_SCENE,
		'--pages',
		GPU_CHECK_PAGE,
		'--runs',
		String(options.runs),
		'--seconds',
		String(options.seconds),
		'--switches',
		`preset=${SPLIT_PRESET}`,
	]);
	const record = JSON.parse(readFileSync(join(folder, 'runs.json'), 'utf8')) as ComparisonRecord;
	const refusal = splitRefusal(record.measurementChanges);
	if (refusal) {
		for (const line of refusal) console.error(line);
		process.exitCode = 1;
		return;
	}
	const results = record.results.filter(
		(run) => run.scene === SPLIT_SCENE && run.kind === GPU_CHECK_PAGE,
	);
	const { runs, failed } = pageRuns(results);
	if (failed.length > 0)
		console.error(`${failed.length} of ${results.length} runs failed: ${failed.join('; ')}`);
	const rows = passChanges(runs);
	if (rows.every((row) => row.deltaMs === null))
		throw new Error(
			runs.every((run) => run.passes.length === 0)
				? 'no run gave per-pass GPU time: the browser may have no GPU timer, or the builds publish none'
				: 'no pass has GPU time from both builds',
		);
	console.log(
		`GPU time per pass: ${SPLIT_SCENE} at ${SPLIT_PRESET}, ${options.runs} runs of each build.`,
	);
	console.log(`baseline: ${record.commits.baseline}`);
	console.log(`new: ${record.commits.new}`);
	console.log(
		'Each figure is a median over the runs that timed the pass; the change is the difference against the baseline.',
	);
	console.log();
	for (const line of passTable(rows)) console.log(line);
}

async function main(): Promise<void> {
	refuseInQuietWindow('The GPU pass split');
	const options = parseGpuPassesArgs(process.argv.slice(2));
	if (options.steps !== 'measure') await prepareBuilds(options);
	if (options.steps !== 'prepare') measure(options);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
