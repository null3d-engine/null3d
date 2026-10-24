// Type checks every TypeScript project of the repository. The projects run at the same time, since
// each checks the engine's source again and one after another they took minutes.
// Each keeps TypeScript's incremental record under target/typecheck, so a check after a small change
// checks again only the files that the change reaches. A project's output prints whole when it ends,
// and the command fails when any project fails. `bun run typecheck` runs it after the shader build.
//   bun tools/typecheck.ts
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** Every project that the check covers, by its folder or its config file. */
export const PROJECTS = [
	'tsconfig.json',
	'packages/engine',
	'packages/engine/tsconfig.test.json',
	'packages/controls',
	'packages/controls/tsconfig.test.json',
	'packages/geometry',
	'packages/geometry/tsconfig.test.json',
	'packages/impostors',
	'packages/impostors/tsconfig.test.json',
	'packages/particles',
	'packages/particles/tsconfig.test.json',
	'packages/splats',
	'packages/splats/tsconfig.test.json',
	'packages/terrain',
	'packages/terrain/tsconfig.test.json',
	'packages/vegetation',
	'packages/vegetation/tsconfig.test.json',
	'packages/three-compat',
	'packages/three-compat/tsconfig.test.json',
	'packages/water',
	'packages/water/tsconfig.test.json',
	'packages/cli',
	'tests/pages',
	'tests/fixtures/project',
	'tests/fixtures/typed-uniforms',
	'examples',
	'examples/tsconfig.test.json',
	'bench',
	'bench/tsconfig.node.json',
] as const;

/**
 * The most projects that run at once. Each holds the engine's program, a few hundred megabytes, and
 * several checkouts on one machine often check at the same time, so the count stays below the core
 * count of a large machine.
 */
const MOST_AT_ONCE = 8;

/** Where each project keeps its incremental record, outside git. */
const RECORDS = join(ROOT, 'target/typecheck');

/** The file of a project's incremental record, named after the project. */
export const recordOf = (project: string): string =>
	join(RECORDS, `${project.replace(/\.json$/, '').replace(/[/.]/g, '-')}.tsbuildinfo`);

/** How a project's check ended: its output and whether it passed. */
interface Checked {
	project: string;
	passed: boolean;
	output: string;
	seconds: number;
}

/** Checks one project, and gives back its output whole. */
function check(project: string): Promise<Checked> {
	const started = performance.now();
	return new Promise((resolve) => {
		const child = spawn(
			join(ROOT, 'node_modules/.bin/tsc'),
			['-p', project, '--incremental', '--tsBuildInfoFile', recordOf(project)],
			{ cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
		);
		let output = '';
		child.stdout.on('data', (chunk) => {
			output += chunk;
		});
		child.stderr.on('data', (chunk) => {
			output += chunk;
		});
		const end = (passed: boolean, more = '') =>
			resolve({
				project,
				passed,
				output: output + more,
				seconds: (performance.now() - started) / 1000,
			});
		child.once('error', (error) => end(false, error.message));
		child.once('close', (code) => end(code === 0));
	});
}

/** Checks every project, as many at once as `jobs`, and gives back each result in the list's order. */
export async function checkAll(
	projects: readonly string[] = PROJECTS,
	jobs = Math.min(availableParallelism(), MOST_AT_ONCE),
	onChecked?: (result: Checked) => void,
): Promise<Checked[]> {
	mkdirSync(RECORDS, { recursive: true });
	const results = new Array<Checked>(projects.length);
	let next = 0;
	const worker = async () => {
		for (let at = next++; at < projects.length; at = next++) {
			const result = await check(projects[at] as string);
			results[at] = result;
			onChecked?.(result);
		}
	};
	await Promise.all(Array.from({ length: Math.min(jobs, projects.length) }, worker));
	return results;
}

if (import.meta.main) {
	const started = performance.now();
	const results = await checkAll(PROJECTS, undefined, (result) => {
		console.log(
			`${result.passed ? 'PASS' : 'FAIL'}  ${result.project} (${result.seconds.toFixed(1)} s)`,
		);
		if (!result.passed) process.stdout.write(result.output);
	});
	const failed = results.filter((result) => !result.passed);
	const seconds = ((performance.now() - started) / 1000).toFixed(1);
	if (failed.length > 0) {
		console.error(
			`${failed.length} of ${results.length} TypeScript projects failed, in ${seconds} s`,
		);
		process.exit(1);
	}
	console.log(`${results.length} TypeScript projects pass, in ${seconds} s`);
}
