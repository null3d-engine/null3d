// Runs the Mac part of M1's exit gate and writes its record: the image test manifest on the Mac's
// GPU and on SwiftShader, the parity check, the budgets, the docs checks, the release version, the
// gate commit's workflows, M0's desktop speed target, S3, S1-cells and S4 against three.js, the
// allocation check and the soak on S4, and the time to first frame. Each step runs one of the
// repository's own commands, one after another, so the timing steps never overlap. The record goes
// to target/gate/<run>/: `gate.md` and `gate.json`, with each step's full output in `<step>.log`.
// The phone, the tablet, and Safari and Firefox on the Mac run through the device runner, apart
// from this command. From the repository root:
//   bun run gate
//   bun run gate --quick                  fewer and shorter benchmark runs, for a rehearsal
//   bun run gate --only parity,budgets    the named steps only
//   bun run gate --skip soak-s4           every step but the named ones
//   bun run gate --list                   print the steps and their commands
import { execFileSync, spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { runName } from '../tests/lib/runs.ts';
import { REPO_ROOT } from '../tests/lib/server.ts';
import {
	commandText,
	type GateRecord,
	type GateStep,
	gateMarkdown,
	gateSteps,
	REPOSITORY,
	type StepRecord,
} from './lib/gate';

const git = (...args: string[]) =>
	execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' }).trim();

/** Runs a step's command, writing its output to the log as it comes, and returns the output. */
function runStep(step: GateStep, logFile: string): Promise<{ output: string; exitCode: number }> {
	return new Promise((resolve) => {
		const [program, ...args] = step.command;
		const log = createWriteStream(logFile);
		let output = '';
		const child = spawn(program as string, args, {
			cwd: REPO_ROOT,
			env: { ...process.env, ...step.env },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const take = (chunk: Buffer) => {
			output += chunk.toString();
			log.write(chunk);
		};
		child.stdout.on('data', take);
		child.stderr.on('data', take);
		child.on('error', (error) => {
			take(Buffer.from(`\n${error.message}\n`));
			log.end(() => resolve({ output, exitCode: 1 }));
		});
		child.on('close', (code) => log.end(() => resolve({ output, exitCode: code ?? 1 })));
	});
}

/** The steps that the options pick, in the gate's order. */
function pickSteps(steps: GateStep[], only?: string, skip?: string): GateStep[] {
	const ids = new Set(steps.map((step) => step.id));
	const names = (list: string | undefined) => {
		const picked = (list ?? '').split(',').filter(Boolean);
		const unknown = picked.filter((id) => !ids.has(id));
		if (unknown.length > 0)
			throw new Error(`no step named ${unknown.join(', ')}; the steps are ${[...ids].join(', ')}`);
		return new Set(picked);
	};
	const onlyIds = names(only);
	const skipIds = names(skip);
	return steps.filter(
		(step) => (onlyIds.size === 0 || onlyIds.has(step.id)) && !skipIds.has(step.id),
	);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			quick: { type: 'boolean', default: false },
			only: { type: 'string' },
			skip: { type: 'string' },
			list: { type: 'boolean', default: false },
		},
	});
	const commit = git('rev-parse', 'HEAD');
	const steps = pickSteps(gateSteps({ commit, quick: values.quick }), values.only, values.skip);
	if (values.list) {
		for (const step of steps)
			console.log(
				`${step.id} (item ${step.item}${step.timed ? ', timed' : ''}): ${commandText(step)}`,
			);
		return;
	}
	let mainHead = '';
	try {
		mainHead = execFileSync('gh', ['api', `repos/${REPOSITORY}/commits/main`, '--jq', '.sha'], {
			encoding: 'utf8',
		}).trim();
	} catch {
		console.warn("could not read main's head from GitHub");
	}
	const dir = join(REPO_ROOT, 'target/gate', runName('gate'));
	mkdirSync(dir, { recursive: true });
	const record: GateRecord = {
		commit,
		onMain: mainHead === commit,
		dirty: git('status', '--porcelain').length > 0,
		quick: values.quick,
		startedAt: new Date().toISOString(),
		steps: [],
	};
	const save = () => {
		writeFileSync(join(dir, 'gate.json'), JSON.stringify(record, null, '\t'));
		writeFileSync(join(dir, 'gate.md'), gateMarkdown(record));
	};
	for (const step of steps) {
		console.log(
			`${step.id}${step.timed ? ' (timing run: keep other heavy work off the Mac)' : ''}: ${commandText(step)}`,
		);
		const started = performance.now();
		const log = join(dir, `${step.id}.log`);
		const { output, exitCode } = await runStep(step, log);
		const { figure, verdict } = step.read({ output, exitCode, root: REPO_ROOT });
		const done: StepRecord = {
			id: step.id,
			item: step.item,
			what: step.what,
			command: commandText(step),
			seconds: Math.round((performance.now() - started) / 1000),
			figure,
			verdict,
			log: relative(dir, log),
		};
		record.steps.push(done);
		save();
		console.log(`  ${verdict}: ${figure}`);
	}
	console.log(`\n${gateMarkdown(record)}\nrecord: ${relative(REPO_ROOT, dir)}`);
	if (record.steps.some((step) => step.verdict === 'fail')) process.exitCode = 1;
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
