// The Mac part of M1's exit gate as a list of steps: each step's command, the gate item it
// measures, how to read its figure from the output, and how to judge it. Everything here is pure,
// so `bench/gate.ts` runs the steps and the tests check the readers on fixed output.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ownShareOfThree, type SummaryRow } from './report';

/** A step's result: it passed or failed its rule, or it only records a figure. */
export type Verdict = 'pass' | 'fail' | 'recorded';

/** What a step left behind, for its reader and its judge. */
export interface StepOutput {
	/** stdout and stderr, in order. */
	output: string;
	exitCode: number;
	/** The repository's root, which the paths in the output are relative to. */
	root: string;
}

/** A step's figure and verdict. */
export interface StepResult {
	figure: string;
	verdict: Verdict;
}

export interface GateStep {
	id: string;
	/** The exit gate item it measures. */
	item: string;
	/** What it measures, in plain words. */
	what: string;
	/** The program and its arguments. */
	command: readonly string[];
	env?: Readonly<Record<string, string>>;
	/** A timing run, which needs the Mac to itself. */
	timed: boolean;
	/** Reads the figure and judges it. */
	read(out: StepOutput): StepResult;
}

/** Pass on a zero exit code, fail otherwise. */
const byExit = (out: StepOutput): Verdict => (out.exitCode === 0 ? 'pass' : 'fail');

/** Fail on a nonzero exit code, otherwise only record the figure. */
const recordUnlessFailed = (out: StepOutput): Verdict => (out.exitCode === 0 ? 'recorded' : 'fail');

/** The lines of the output that match the pattern, joined, or a fallback. */
function linesMatching(output: string, pattern: RegExp, fallback = 'no figure in the output') {
	const lines = output
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => pattern.test(line));
	return lines.length > 0 ? lines.join('; ') : fallback;
}

/**
 * A check's figure: "no problems", or the first line that names a problem. The package manager's
 * own closing line, which only repeats the exit code, does not count.
 */
export function checkFigure({ output, exitCode }: Pick<StepOutput, 'output' | 'exitCode'>): string {
	if (exitCode === 0) return 'no problems';
	const problem = output
		.split('\n')
		.map((line) => line.trim())
		.find((line) => /error|fail|does not|missing/i.test(line) && !/^error: script /.test(line));
	return problem ?? `exit ${exitCode}, see the log`;
}

/** Playwright's closing counts, such as "334 passed" or "2 failed, 330 passed". */
export function playwrightCounts(output: string): string {
	const counts = ['failed', 'flaky', 'skipped', 'did not run', 'passed'].flatMap((word) => {
		const match = output.match(new RegExp(`^\\s*(\\d+) ${word}\\b`, 'm'));
		return match ? [`${match[1]} ${word}`] : [];
	});
	return counts.length > 0 ? counts.join(', ') : 'no test counts in the output';
}

/** The parity command's closing count, such as "46 of 46 comparisons pass". */
export function parityCount(output: string): string {
	return (
		output.match(/(\d+) of (\d+) comparisons pass/)?.[0] ?? 'no comparison count in the output'
	);
}

/** The size report's lines that give a share of a budget. */
export function budgetLines(output: string): string {
	return linesMatching(output, /% of budget$/).replace(/ {2,}/g, ' ');
}

/** The folder that a benchmark run printed, relative to the repository's root. */
export function benchFolder(output: string): string | null {
	return output.match(/^results: (\S+)$/m)?.[1] ?? null;
}

/** The share of three.js that the desktop target allows for null3D's own work. */
export const DESKTOP_TARGET_SHARE = 0.5;

/**
 * The desktop target from a run's summary rows: null3D's own work on its busiest thread in S1 on
 * WebGPU, as a share of three.js's faster renderer's own work.
 */
export function desktopTarget(rows: readonly SummaryRow[]): StepResult {
	const of = (kind: string) => rows.find((row) => row.scene === 's1' && row.kind === kind)?.summary;
	const share = ownShareOfThree(
		of('null3d-webgpu'),
		[of('threejs-webgpu'), of('threejs-webgl')],
		of('scene-code'),
	);
	if (!share) return { figure: 'S1 lacks a page that the share needs', verdict: 'fail' };
	const percent = (share.share * 100).toFixed(1);
	return {
		figure: `S1 on WebGPU: null3D's own work ${share.null3dMs.toFixed(3)} ms, three.js's ${share.threeMs.toFixed(3)} ms (scene code ${share.sceneCodeMs.toFixed(3)} ms): ${percent}% of three.js, target at most ${DESKTOP_TARGET_SHARE * 100}%`,
		verdict: share.share <= DESKTOP_TARGET_SHARE ? 'pass' : 'fail',
	};
}

/** Reads the summary rows of the benchmark run that the output names. */
function benchRows(out: StepOutput): SummaryRow[] | null {
	const folder = benchFolder(out.output);
	if (!folder) return null;
	try {
		return JSON.parse(readFileSync(join(out.root, folder, 'summary.json'), 'utf8')) as SummaryRow[];
	} catch {
		return null;
	}
}

/** The comparison lines of a benchmark report, such as "s3: null3d on WebGPU takes 21% of ...". */
export function comparisonFigure(output: string): string {
	return linesMatching(output, /^[a-z0-9-]+: null3d(?:'s own work)? on /);
}

/** The version that the release command prints. */
export function releaseVersion(output: string): string | null {
	return output.match(/^version: (\S+)/m)?.[1] ?? null;
}

/** The version that M1's release must be. */
export const GATE_VERSION = '0.1.0';

/**
 * The workflows that must pass on the gate commit, each with the events whose runs count. Main's
 * own CI run after the merge runs every job, and so does a run started by hand (D-99). A run of a
 * pull request tested other code: GitHub's merge of it into an older main. Any run of the
 * benchmarks counts.
 */
export const GATE_WORKFLOWS: readonly { name: string; events?: readonly string[] }[] = [
	{ name: 'CI', events: ['push', 'workflow_dispatch'] },
	{ name: 'Benchmarks' },
];

/** One workflow run of a commit, as `gh run list --json` gives it. */
interface WorkflowRun {
	workflowName: string;
	event: string;
	status: string;
	conclusion: string;
}

/** Judges the newest counted run of each gate workflow on the commit. */
export function workflowResult(output: string): StepResult {
	let runs: WorkflowRun[];
	try {
		runs = JSON.parse(output.slice(output.indexOf('['))) as WorkflowRun[];
	} catch {
		return { figure: 'no workflow runs in the output', verdict: 'fail' };
	}
	// gh lists the newest run first.
	const states = GATE_WORKFLOWS.map(({ name, events }) => {
		const run = runs.find((r) => r.workflowName === name && (!events || events.includes(r.event)));
		const state = !run ? 'no run' : run.status === 'completed' ? run.conclusion : run.status;
		return { name, state };
	});
	return {
		figure: states.map(({ name, state }) => `${name}: ${state}`).join(', '),
		verdict: states.every(({ state }) => state === 'success') ? 'pass' : 'fail',
	};
}

/** The repository whose workflows judge the gate commit. */
export const REPOSITORY = 'null3d-engine/null3d';

/** Options that shorten the timing steps, for a rehearsal of the gate. */
export interface GateOptions {
	/** The commit whose workflow runs the gate reads. */
	commit: string;
	/** Fewer and shorter benchmark runs than the protocol's; the record says so. */
	quick: boolean;
}

/** The Mac's steps of the exit gate, in the order they run. */
export function gateSteps({ commit, quick }: GateOptions): GateStep[] {
	const protocol = quick ? ['--runs', '1', '--seconds', '10'] : [];
	const benchRun = (args: readonly string[]) => [
		'bun',
		'run',
		'bench:run',
		'--',
		...args,
		...protocol,
	];
	return [
		{
			id: 'workflows',
			item: '1, 3',
			what: 'CI (the manifest on SwiftShader on all three tiers, in all thread modes and a production build) and the benchmark job on the gate commit',
			command: [
				'gh',
				'run',
				'list',
				'--repo',
				REPOSITORY,
				'--commit',
				commit,
				'--json',
				'workflowName,event,status,conclusion',
			],
			timed: false,
			read: (out) =>
				out.exitCode === 0 ? workflowResult(out.output) : { figure: 'gh failed', verdict: 'fail' },
		},
		{
			id: 'images-gpu',
			item: '1',
			what: "The image test manifest in Chrome on the Mac's GPU, on all three tiers",
			command: ['bun', 'run', 'test:images'],
			timed: false,
			read: (out) => ({ figure: playwrightCounts(out.output), verdict: byExit(out) }),
		},
		{
			id: 'images-swiftshader',
			item: '1',
			what: "The image test manifest in CI's SwiftShader setup, on all three tiers",
			command: ['bun', 'run', 'test:images'],
			env: { CI: '1' },
			timed: false,
			read: (out) => ({ figure: playwrightCounts(out.output), verdict: byExit(out) }),
		},
		{
			id: 'parity',
			item: '2',
			what: "The parity scenes against their three.js twins, in Chrome on the Mac's GPU, on core WebGPU and WebGL2",
			command: ['bun', 'run', 'parity', '--', '--tier', 'webgpu,webgl2'],
			timed: false,
			read: (out) => ({ figure: parityCount(out.output), verdict: byExit(out) }),
		},
		{
			id: 'budgets',
			item: '4',
			what: "Each core WebAssembly build within 600 KB after Brotli, and the engine's JavaScript per thread mode within its budget",
			command: ['bun', 'run', 'build'],
			timed: false,
			read: (out) => ({ figure: budgetLines(out.output), verdict: byExit(out) }),
		},
		...(
			[
				['docs', 'docs:check', 'The docs checks: generated pages, links and the command list'],
				['docs-style', 'docs:style', 'The writing rules in all published Markdown'],
				['skills', 'skills:check', 'The skills check; CI runs the skill validator'],
			] as const
		).map(
			([id, script, what]): GateStep => ({
				id,
				item: '6',
				what,
				command: ['bun', 'run', script],
				timed: false,
				read: (out) => ({ figure: checkFigure(out), verdict: byExit(out) }),
			}),
		),
		{
			id: 'release',
			item: '6',
			what: `The release command prints ${GATE_VERSION} and does not refuse`,
			command: ['bun', 'run', 'release', '--', '--release-type', 'minor'],
			timed: false,
			read: (out) => {
				const version = releaseVersion(out.output);
				return {
					figure: version ? `version ${version}` : 'no version in the output',
					verdict: out.exitCode === 0 && version === GATE_VERSION ? 'pass' : 'fail',
				};
			},
		},
		{
			id: 'desktop-target',
			item: '3',
			what: "M0's desktop target with M1's renderer: S1's own CPU time per frame on the busiest thread at most 50% of three.js, Chrome, WebGPU",
			command: benchRun(['--scenes', 's1']),
			timed: true,
			read: (out) => {
				const rows = benchRows(out);
				if (out.exitCode !== 0 || !rows)
					return { figure: 'the benchmark run left no summary', verdict: 'fail' };
				return desktopTarget(rows);
			},
		},
		{
			id: 'scenes',
			item: '3',
			what: 'S3, S1-cells and S4 on the Mac against their three.js twins, recorded',
			command: benchRun([
				'--scenes',
				's3,s1-cells,s4',
				'--pages',
				'null3d-webgpu,null3d-webgl2,threejs-webgpu,threejs-webgl,scene-code',
			]),
			timed: true,
			read: (out) => ({ figure: comparisonFigure(out.output), verdict: recordUnlessFailed(out) }),
		},
		...(['webgpu', 'webgl2'] as const).map(
			(gpu): GateStep => ({
				id: `allocation-s4-${gpu}`,
				item: '4',
				what: `No per-frame allocation in S4 on ${gpu === 'webgpu' ? 'WebGPU' : 'WebGL2'}`,
				command: ['bun', 'run', 'bench:allocation', '--', '--scene', 's4', '--gpu', gpu],
				timed: true,
				read: (out) => ({
					figure: linesMatching(out.output, /bytes per frame$|^pass$|^FAIL/),
					verdict: byExit(out),
				}),
			}),
		),
		{
			id: 'soak-s4',
			item: '4',
			what: 'The soak on S4 in Chrome: no heap or WebAssembly memory growth',
			command: [
				'bun',
				'run',
				'bench:soak',
				'--',
				'--scene',
				's4',
				...(quick ? ['--minutes', '3'] : []),
			],
			timed: true,
			read: (out) => ({
				figure: linesMatching(out.output, /^After the |^FAIL/),
				verdict: byExit(out),
			}),
		},
		{
			id: 'startup',
			item: '5 (T-28)',
			what: 'Time to first frame of the engine test page, cold and warm, on Slow 4G and at full speed',
			command: [
				'bun',
				'run',
				'bench:startup',
				'--',
				'--loads',
				'cold,warm',
				'--network',
				'slow-4g,full',
				...(quick ? ['--runs', '1'] : []),
			],
			timed: true,
			read: (out) => ({
				figure: linesMatching(out.output, /^\| pipelined \|/),
				verdict: recordUnlessFailed(out),
			}),
		},
	];
}

/** One step's place in the record. */
export interface StepRecord {
	id: string;
	item: string;
	what: string;
	command: string;
	seconds: number;
	figure: string;
	verdict: Verdict;
	log: string;
}

/** The whole run's record. */
export interface GateRecord {
	commit: string;
	/** Whether the commit is main's head, which the gate must run on. */
	onMain: boolean;
	/** Whether the checkout had changes that are not in the commit. */
	dirty: boolean;
	quick: boolean;
	startedAt: string;
	steps: StepRecord[];
}

/** The command as one line of shell, with its environment. */
export function commandText(step: Pick<GateStep, 'command' | 'env'>): string {
	const env = Object.entries(step.env ?? {}).map(([name, value]) => `${name}=${value} `);
	return `${env.join('')}${step.command.join(' ')}`;
}

/** The record as Markdown: the commit, then a row for each step. */
export function gateMarkdown(record: GateRecord): string {
	const failed = record.steps.filter((step) => step.verdict === 'fail');
	const lines = [
		`# M1 exit gate, Mac part`,
		'',
		`Commit ${record.commit}${record.onMain ? ", main's head" : ", not main's head"}${record.dirty ? ', with uncommitted changes' : ''}. Started ${record.startedAt}.`,
		...(record.quick
			? [
					'',
					'Quick run: fewer and shorter benchmark runs than the protocol asks for, so the timings do not count for the gate.',
				]
			: []),
		'',
		failed.length === 0
			? 'Every step passed or was recorded.'
			: `${failed.length} of ${record.steps.length} steps failed: ${failed.map((step) => step.id).join(', ')}.`,
		'',
		'| Step | Gate item | Result | Figure | Minutes | Command |',
		'| --- | --- | --- | --- | --- | --- |',
		...record.steps.map(
			(step) =>
				`| ${step.id} | ${step.item} | ${step.verdict} | ${step.figure.replaceAll('|', '\\|')} | ${(step.seconds / 60).toFixed(1)} | \`${step.command}\` |`,
		),
		'',
		"Each step's full output is in the log beside this file.",
	];
	return `${lines.join('\n')}\n`;
}
