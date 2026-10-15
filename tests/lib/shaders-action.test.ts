import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ACTION = join(import.meta.dirname, '../../.github/actions/shaders/action.yml');

/// The script of the action's step that records the shader build in the job summary.
function recordStep(): string {
	const parsed = Bun.YAML.parse(readFileSync(ACTION, 'utf8')) as {
		runs: { steps: { name?: string; run?: string }[] };
	};
	const step = parsed.runs.steps.find((one) => one.name === 'Record the shader build');
	if (!step?.run) throw new Error('the shader cache action has no step that records the build');
	return step.run;
}

/// Runs that step over the given build log, as the workflow's shell runs it, and returns the
/// exit status together with the summary it wrote.
function record(log: string): { status: number | null; summary: string } {
	const dir = mkdtempSync(join(tmpdir(), 'shader-record-'));
	try {
		writeFileSync(join(dir, 'shader-build.log'), log);
		const summary = join(dir, 'summary.md');
		writeFileSync(summary, '');
		const run = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', recordStep()], {
			env: {
				...process.env,
				RUNNER_TEMP: dir,
				GITHUB_STEP_SUMMARY: summary,
				STARTED: String(Math.floor(Date.now() / 1000) - 60),
				OUTCOME: 'success',
				RESTORED: 'shaders-Linux-inputs',
				ENTRIES: join(dir, 'entries', 'stamp'),
				MODULES: join(dir, 'modules', 'inputs'),
			},
		});
		return { status: run.status, summary: readFileSync(summary, 'utf8') };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

describe('the shader cache action', () => {
	// The step records a build that already decided the job's outcome, so it reports what the log
	// holds and never fails the job. A log that lacks the compiled-and-reused line is a build that
	// the shared cache answered in full, which compiles nothing and prints no such line.
	it('records a build the shared cache answered without failing the job', () => {
		const { status, summary } = record(
			'the shader modules came from the shared cache (/home/runner/.cache/null3d/shader-modules)\n',
		);
		expect(status).toBe(0);
		expect(summary).toContain('the shared cache held the whole module set');
	});

	it('records the counts of a build that compiled', () => {
		const { status, summary } = record('The shader build compiled 12 entries and reused 3.\n');
		expect(status).toBe(0);
		expect(summary).toContain('compiled 12 entries and reused 3');
	});

	it('reports a log with no summary line without failing the job', () => {
		const { status, summary } = record('building the shader compiler and the asset tool\n');
		expect(status).toBe(0);
		expect(summary).toContain('no summary line');
	});
});
