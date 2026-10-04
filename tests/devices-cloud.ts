// Runs a plan of the device runner on BrowserStack Automate's real phones, tablets and desktops,
// with no setup in a browser: it picks a tier of the device cloud list, checks each device against
// Automate's list of devices and the account's plan, then starts the device runner, which opens a
// session per device through BrowserStack Local and ends it when the device's turn ends. Devices
// whose browsers may lack core WebGPU run in a run of their own, with --allow-no-webgpu.
// BrowserStack Local must run on this Mac, and the dev server must answer HTTPS with a certificate
// for bs-local.com, as the device guide's Automate section says. From the repository root:
//   bun run devices:cloud --tier A
//   bun run devices:cloud --tier A,B --parallel 2 --plan smoke
//   bun run devices:cloud --only bsiphone17-safari,bspixel10-chrome
//   bun run devices:cloud --only bspixel10-chrome -- --only capabilities,restarts-pipelined
//   bun run devices:cloud --tier B --check
//   bun run devices:cloud --tier A --part 2/3
// Options:
//   --tier <list>     the tiers to run, A, B or A,B; A by default
//   --only <names>    only these runners of the list, from any tier
//   --parallel <n>    at most n sessions at once; by default, as many as the plan has free
//   --part <i>/<n>    only the i-th of n parts of the picked devices, each a run of its own, so a
//                     long tier runs as several shorter commands
//   --plan <name>     the device runner's plan, smoke by default
//   --check           check the credentials, the plan and the devices, print the runs, and stop
//   -- <options>      options after -- go to the device runner as they are
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
	type AutomatePlan,
	automateApi,
	deviceProblems,
	parallelSessions,
	readCredentials,
} from './lib/browserstack.ts';
import { CLOUD_DEVICES, type CloudDevice, type CloudTier } from './lib/browserstack-devices.ts';
import { deviceText } from './lib/cloud-sessions.ts';
import { readShard, runName, SHARD_FORMAT, type Shard } from './lib/runs.ts';

const USAGE =
	'usage: bun run devices:cloud [--tier A|B|A,B] [--only <runners>] [--part <i>/<n>] [--parallel <n>] [--plan <name>] [--check] [-- <device runner options>]';

const TIERS: readonly CloudTier[] = ['A', 'B'];

export interface CloudOptions {
	tiers: CloudTier[];
	only?: string[];
	/** The one part of the picked devices to run, when given. */
	part?: Shard;
	parallel?: number;
	plan: string;
	check: boolean;
	/** Options that go to the device runner as they are. */
	passOn: string[];
}

export function parseCloudArgs(args: readonly string[]): CloudOptions {
	const options: CloudOptions = { tiers: ['A'], plan: 'smoke', check: false, passOn: [] };
	const list = (value: string | undefined) => (value ?? '').split(',').filter(Boolean);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === '--') {
			options.passOn = args.slice(i + 1);
			break;
		}
		if (arg === '--tier') {
			const tiers = list(args[++i]?.toUpperCase());
			if (tiers.length === 0 || tiers.some((tier) => !TIERS.includes(tier as CloudTier)))
				throw new Error(`--tier: use ${TIERS.join(', ')} or both, as A,B\n${USAGE}`);
			options.tiers = tiers as CloudTier[];
		} else if (arg === '--only') options.only = list(args[++i]);
		else if (arg === '--part') {
			const part = readShard(args[++i]);
			if (!part) throw new Error(`--part: use ${SHARD_FORMAT}\n${USAGE}`);
			options.part = part;
		} else if (arg === '--parallel') {
			const n = Number(args[++i]);
			if (!(Number.isSafeInteger(n) && n >= 1))
				throw new Error(`--parallel: use a whole number of at least 1\n${USAGE}`);
			options.parallel = n;
		} else if (arg === '--plan') options.plan = args[++i] ?? '';
		else if (arg === '--check') options.check = true;
		else
			throw new Error(`unknown option ${arg}; put the device runner's options after --\n${USAGE}`);
	}
	if (options.only?.length === 0) throw new Error(`--only: name some runners\n${USAGE}`);
	if (!options.plan) throw new Error(`--plan: name a plan\n${USAGE}`);
	return options;
}

/**
 * The devices that the options pick, in the list's order: those --only names, or the tiers'. With
 * --part, only that part of them: the parts follow the list's order, and their sizes differ by at
 * most one device.
 */
export function pickDevices(
	options: Pick<CloudOptions, 'tiers' | 'only' | 'part'>,
	devices: readonly CloudDevice[] = CLOUD_DEVICES,
): CloudDevice[] {
	const unknown = (options.only ?? []).filter((name) => !devices.some((d) => d.runner === name));
	if (unknown.length > 0)
		throw new Error(
			`the device cloud list (tests/lib/browserstack-devices.ts) has no runner ${unknown.join(', ')}`,
		);
	const picked = devices.filter((device) =>
		options.only ? options.only.includes(device.runner) : options.tiers.includes(device.tier),
	);
	if (!options.part) return picked;
	const { index, count } = options.part;
	const edge = (i: number) => Math.floor((i * picked.length) / count);
	return picked.slice(edge(index - 1), edge(index));
}

/** One run of the device runner: devices that share the --allow-no-webgpu setting. */
export interface CloudRun {
	allowNoWebgpu: boolean;
	devices: CloudDevice[];
}

/**
 * The runs for these devices: those that must have core WebGPU first, then those that may lack
 * it, since the device runner's --allow-no-webgpu applies to a whole run.
 */
export function cloudRuns(devices: readonly CloudDevice[]): CloudRun[] {
	return [false, true]
		.map((allowNoWebgpu) => ({
			allowNoWebgpu,
			devices: devices.filter((device) => (device.allowNoWebgpu === true) === allowNoWebgpu),
		}))
		.filter((run) => run.devices.length > 0);
}

/** The device runner's arguments for one run. */
export function runnerArgs(
	run: CloudRun,
	options: Pick<CloudOptions, 'plan' | 'passOn'>,
	parallel: number,
	build: string,
): string[] {
	return [
		join(import.meta.dirname, 'real-browsers.ts'),
		'--plan',
		options.plan,
		...(run.allowNoWebgpu ? ['--allow-no-webgpu'] : []),
		'--cloud',
		run.devices.map((device) => device.runner).join(','),
		'--parallel',
		String(parallel),
		'--cloud-build',
		build,
		...options.passOn,
	];
}

/** The account's plan and the devices, as lines to print before the runs. */
function planText(plan: AutomatePlan, parallel: number, runs: readonly CloudRun[]): string {
	const lines = [
		`BrowserStack ${plan.automate_plan}: ${plan.parallel_sessions_running} of ${plan.parallel_sessions_max_allowed} parallel sessions in use; this run opens at most ${parallel} at once.`,
	];
	for (const run of runs) {
		lines.push(
			run.allowNoWebgpu ? 'Run with --allow-no-webgpu:' : 'Run where core WebGPU must work:',
		);
		for (const device of run.devices)
			lines.push(
				`  ${device.runner}: ${deviceText(device)}${device.standIn ? ` (stands in: ${device.standIn})` : ''}`,
			);
	}
	return lines.join('\n');
}

/**
 * Runs the device runner with these arguments, and returns its exit code. A Ctrl-C reaches the
 * device runner too, which ends its sessions before it exits; this process waits for that.
 */
function runRunner(args: readonly string[]): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn('bun', args, { stdio: 'inherit' });
		child.once('exit', (code, signal) => resolve(code ?? (signal ? 130 : 1)));
	});
}

async function main(): Promise<void> {
	const options = parseCloudArgs(process.argv.slice(2));
	const devices = pickDevices(options);
	if (devices.length === 0) throw new Error(`no devices picked\n${USAGE}`);
	const api = automateApi(readCredentials());
	const [plan, listed] = await Promise.all([api.plan(), api.browsers()]);
	const problems = deviceProblems(devices, listed);
	if (problems.length > 0)
		throw new Error(
			`BrowserStack Automate lacks these devices; fix tests/lib/browserstack-devices.ts, or leave them out with --only:\n${problems.join('\n')}`,
		);
	const parallel = parallelSessions(plan, options.parallel);
	const runs = cloudRuns(devices);
	console.log(planText(plan, parallel, runs));
	if (options.check) return;
	const build = `null3D ${runName(options.plan)}`;
	console.log(`Build on BrowserStack's dashboard: ${build}\n`);
	let interrupted = false;
	// The device runner gets the same Ctrl-C and ends its sessions; this process waits for it.
	process.on('SIGINT', () => {
		interrupted = true;
	});
	let failed = 0;
	for (const run of runs) {
		if (interrupted) break;
		const code = await runRunner(runnerArgs(run, options, parallel, build));
		if (code !== 0) failed++;
	}
	process.exit(interrupted ? 130 : failed > 0 ? 1 : 0);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
