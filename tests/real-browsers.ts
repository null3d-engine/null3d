// Runs a plan of test pages in real browsers that Playwright cannot drive, through the runner page:
// browser apps on this Mac, browsers on an Android phone connected by USB, and runner pages that
// wait on tablets and phones on the local network. It starts the dev server, lets one browser per
// device run at a time, then judges every result and prints a summary. From the repository root:
//   bun tests/real-browsers.ts Safari Firefox
//   bun tests/real-browsers.ts --allow-no-webgpu --android chrome,brave --lan ipad-safari,ipad-brave
// Options:
//   --plan <name>       the plan to run: checks, the default, or parity
//   --allow-no-webgpu   a browser without WebGPU skips the WebGPU pages instead of failing them
//   --allow-no-webgl2   a browser without WebGL2 skips the WebGL2 pages instead of failing them
//   --android <list>    browsers on the Android phone: chrome, chrome-beta, brave, firefox, samsung
//   --lan <list>        names of runner pages that wait on the local network, as device-browser,
//                       such as ipad-safari; pages on one device take turns
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	type BenchResult,
	comparisonLines,
	type SummaryRow,
	summarizeRuns,
	summaryTable,
} from '../bench/lib/report.ts';
import { forwardPort, openOnPhone, phoneModel } from './lib/adb.ts';
import { type Check, judge, type MissingAllowed, NONE_MISSING, PLANS } from './lib/plans.ts';
import { RUNS_DIR } from './lib/report-collector.ts';
import {
	batchTimeoutMs,
	type ItemResult,
	type PlanItem,
	type Runner,
	readDevice,
	readResult,
	runName,
	setTurns,
	turnBatches,
	waitForRunners,
	writePlan,
} from './lib/runs.ts';
import { HTTP_PORT, startServer } from './lib/server.ts';

export interface Options {
	plan: string;
	/** GPU paths a browser may lack, whose pages it then skips. */
	missing: MissingAllowed;
	/** macOS app names, such as Safari. */
	mac: string[];
	android: string[];
	lan: string[];
}

const USAGE =
	'usage: bun tests/real-browsers.ts [--plan <name>] [--allow-no-webgpu] [--allow-no-webgl2] [--android <browsers>] [--lan <runners>] [<macOS app>...]';

export function parseArgs(args: readonly string[]): Options {
	const missing = { ...NONE_MISSING };
	const options: Options = { plan: 'checks', missing, mac: [], android: [], lan: [] };
	const list = (value: string | undefined) => (value ?? '').split(',').filter(Boolean);
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === '--allow-no-webgpu') missing.webgpu = true;
		else if (arg === '--allow-no-webgl2') missing.webgl2 = true;
		else if (arg === '--plan') options.plan = args[++i] ?? '';
		else if (arg === '--android') options.android = list(args[++i]);
		else if (arg === '--lan') options.lan = list(args[++i]);
		else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}\n${USAGE}`);
		else options.mac.push(arg);
	}
	if (!PLANS[options.plan])
		throw new Error(`no plan named ${options.plan}; plans: ${Object.keys(PLANS).join(', ')}`);
	return options;
}

/** How a runner starts: an app on this Mac, a browser on the phone, or a page that waits on the network. */
type Launch = { kind: 'mac'; app: string } | { kind: 'android'; browser: string } | { kind: 'lan' };

type LaunchedRunner = Runner & { launch: Launch };

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function runnersOf(options: Options): LaunchedRunner[] {
	const runners: LaunchedRunner[] = options.mac.map((app) => ({
		name: `mac-${slug(app)}`,
		device: 'mac',
		launch: { kind: 'mac', app },
	}));
	if (options.android.length > 0) {
		const phone = slug(phoneModel());
		forwardPort(HTTP_PORT);
		for (const browser of options.android)
			runners.push({
				name: `${phone}-${browser}`,
				device: phone,
				launch: { kind: 'android', browser },
			});
	}
	for (const name of options.lan.map(slug))
		runners.push({ name, device: name.split('-')[0] as string, launch: { kind: 'lan' } });
	return runners;
}

/** The benchmark summary of one runner's results, or undefined when the plan has no benchmarks. */
function benchSummary(
	items: readonly PlanItem<Check>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const groups = new Map<string, { scene: string; kind: string; results: BenchResult[] }>();
	for (const item of items) {
		if (item.check.kind !== 'bench') continue;
		const { scene, page } = item.check;
		const result = resultOf(item.id);
		const group = groups.get(`${scene} ${page}`) ?? { scene, kind: page, results: [] };
		if (result?.ok) group.results.push(result as unknown as BenchResult);
		groups.set(`${scene} ${page}`, group);
	}
	if (groups.size === 0) return undefined;
	const rows: SummaryRow[] = [...groups.values()]
		.filter((g) => g.results.length > 0)
		.map(({ scene, kind, results }) => ({ scene, kind, summary: summarizeRuns(results) }));
	return [summaryTable(rows), '', ...comparisonLines(rows)].join('\n');
}

/** Time a macOS app may take to open the runner page before its turn counts as failed. */
const OPEN_TIMEOUT_MS = 60_000;

/**
 * Opens the runner page in a macOS app and says whether it did. A launch that hangs, as behind a
 * first-launch prompt on a machine that nobody watches, fails after a minute instead of stopping
 * the whole run.
 */
function openApp(app: string, url: string): boolean {
	try {
		execFileSync('open', ['-a', app, url], { timeout: OPEN_TIMEOUT_MS });
		return true;
	} catch (e) {
		console.log(`${app} did not open the runner page: ${(e as Error).message.split('\n')[0]}`);
		return false;
	}
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const runners = runnersOf(options);
	if (runners.length === 0) throw new Error(USAGE);
	const launches = new Map(runners.map((runner) => [runner.name, runner.launch]));
	const makeItems = PLANS[options.plan] as NonNullable<(typeof PLANS)[string]>;

	const local = await startServer();
	const lan = options.lan.length > 0 ? await startServer(true) : undefined;
	const run = runName(options.plan);
	const plan = writePlan(run, makeItems());
	if (lan) {
		console.log(
			`On each tablet or phone, open ${lan.url}/tests/pages/runner.html?listen&runner=<name>`,
		);
		console.log(
			`with <name> one of ${options.lan.map(slug).join(', ')}. A waiting page runs each new run when its turn comes.`,
		);
	}
	try {
		for (const batch of turnBatches(runners)) {
			setTurns(run, batch);
			const opened: string[] = [];
			for (const name of batch) {
				const launch = launches.get(name) as Launch;
				const url = `${local.url}/tests/pages/runner.html?run=${run}&runner=${name}`;
				if (launch.kind === 'mac') {
					if (openApp(launch.app, url)) opened.push(name);
				} else {
					if (launch.kind === 'android') openOnPhone(launch.browser, url);
					else console.log(`${name}: its turn now; bring its runner page to the front.`);
					opened.push(name);
				}
			}
			await waitForRunners(run, opened, batchTimeoutMs(plan), (name) =>
				console.log(`${name}: finished`),
			);
		}
	} finally {
		setTurns(run, []);
		local.stop();
		lan?.stop();
	}

	let failures = 0;
	const summary: Record<string, { pass: number; skip: number; fail: number }> = {};
	for (const { name } of runners) {
		const counts = { pass: 0, skip: 0, fail: 0 };
		summary[name] = counts;
		if (!readDevice(run, name)) {
			counts.fail++;
			failures++;
			console.log(`FAIL  ${name}: the runner page never started`);
			continue;
		}
		const context = {
			resultOf: (id: string) => readResult(run, name, id),
			imageDir: join(RUNS_DIR, run, name),
		};
		for (const item of plan.items) {
			const result = readResult(run, name, item.id);
			const verdict = result
				? judge(item.check, result, options.missing, context)
				: ['no result; the runner stopped before this page'];
			if (verdict === 'skip') {
				counts.skip++;
				console.log(`skip  ${name}: ${item.id}, no WebGPU`);
			} else if (verdict.length === 0) {
				counts.pass++;
				console.log(`pass  ${name}: ${item.id}`);
			} else {
				counts.fail++;
				console.log(`FAIL  ${name}: ${item.id}: ${verdict.join('; ')}`);
			}
		}
		failures += counts.fail;
	}
	writeFileSync(join(RUNS_DIR, run, 'summary.json'), JSON.stringify(summary, null, '\t'));
	for (const { name } of runners) {
		const table = benchSummary(plan.items, (id) => readResult(run, name, id));
		if (table) console.log(`\n${name}\n${table}\n`);
	}
	for (const [name, counts] of Object.entries(summary))
		console.log(`${name}: ${counts.pass} passed, ${counts.skip} skipped, ${counts.fail} failed`);
	console.log(`results: ${join(RUNS_DIR, run)}`);
	process.exit(failures > 0 ? 1 : 0);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
