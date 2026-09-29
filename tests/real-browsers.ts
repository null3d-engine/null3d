// Runs a plan of test pages in real browsers that Playwright cannot drive, through the runner page:
// browser apps on this Mac, browsers on an Android phone connected by USB, and runner pages that
// wait on tablets and phones on the local network. It starts the dev server, lets one browser per
// device run at a time, then judges every result and prints a summary. On an Android phone it reads
// the phone's heat through the run, and adds to each result the heat that the page ran in.
// From the repository root:
//   bun tests/real-browsers.ts Safari Firefox
//   bun tests/real-browsers.ts --allow-no-webgpu --android chrome,brave --lan ipad-safari,ipad-brave
//   bun tests/real-browsers.ts --plan scale --allow-no-webgpu --android chrome
//   bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --n 250000
//   bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --n 300000 --jobs 2,4,6,8
//   bun tests/real-browsers.ts --plan memory --android chrome --lan ipad-safari
// Options:
//   --plan <name>       the plan to run: checks (the default), parity, bench, memory, which loads
//                       the engine page 20 times at each shared memory maximum from 256 to 4096 MiB,
//                       or scale, which finds the largest S1 count at which three.js holds 30
//                       frames per second
//   --allow-no-webgpu   a browser without WebGPU skips the WebGPU pages instead of failing them
//   --allow-no-webgl2   a browser without WebGL2 skips the WebGL2 pages instead of failing them
//   --n <count>         the instance count of the bench plan's pages
//   --runs <count>      fresh runs of each bench plan page, the protocol's 5 by default, or loads
//                       at each maximum of the memory plan, 20 by default; 0 there runs only the
//                       counts of how many engines fit at once
//   --jobs <list>       job worker counts, such as 2,4,6,8: the bench plan then runs null3D's two
//                       GPU paths at each count instead of its usual pages
//   --pages <list>      the bench plan's page kinds, such as null3d-webgl2,null3d-webgl2-low
//   --scenes <list>     the bench plan's scenes: s1, s1-static, s2; the default is s1
//   --shields on|off    the state of Brave's Shields for the dev server's site, which the runner
//                       cannot read: it goes into each Brave result and the run's summary
//   --android <list>    browsers on the Android phone: chrome, chrome-beta, brave, firefox, samsung
//   --lan <list>        names of runner pages that wait on the local network, as device-browser,
//                       such as ipad-safari; pages on one device take turns
// Before a run on a phone or tablet, the runner prints a checklist of the device settings that
// results depend on.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	BENCH_PAGE_KINDS,
	type BenchPageKind,
	isNull3dPage,
	PARITY_SCENES,
	type ParityScene,
	parseStoredBaselines,
	readJobCounts,
	STORED_BASELINES_FILE,
	type StoredBaselines,
} from '../bench/lib/parity.ts';
import { forwardPort, openOnPhone, phoneModel } from './lib/adb.ts';
import { HeatLog, type HeatSample, type HeatSummary, heatText, summarizeHeat } from './lib/heat.ts';
import {
	benchSummary,
	judge,
	type MissingAllowed,
	memorySummary,
	NO_RESULT,
	NONE_MISSING,
	PLANS,
} from './lib/plans.ts';
import { RUNS_DIR } from './lib/report-collector.ts';
import {
	addToResult,
	type ItemResult,
	type Runner,
	readDevice,
	readResult,
	receivedAt,
	runName,
	setTurns,
	turnBatches,
	waitForRunners,
	writePlan,
	writeRunnerFile,
} from './lib/runs.ts';
import {
	afterCount,
	drawnFps,
	HOLD_FPS,
	holdsRate,
	NEW_SEARCH,
	nextCount,
	SCALE_PLAN,
	SCALE_RENDERERS,
	type ScaleSearch,
	scaleItem,
} from './lib/scale.ts';
import { type DevServer, HTTP_PORT, REPO_ROOT, startServer } from './lib/server.ts';

export interface Options {
	plan: string;
	/** GPU paths a browser may lack, whose pages it then skips. */
	missing: MissingAllowed;
	/** The instance count of the bench plan's pages, when given. */
	count?: number;
	/** Fresh runs of each bench plan page, or loads at each memory maximum, when given. */
	runs?: number;
	/** Job worker counts for the bench plan, when given. */
	jobs?: number[];
	/** The bench plan's page kinds, when given. */
	pages?: BenchPageKind[];
	/** The bench plan's scenes, when given. */
	scenes?: ParityScene[];
	/** The state of Brave's Shields for the dev server's site, when given. */
	shields?: ShieldsState;
	/** macOS app names, such as Safari. */
	mac: string[];
	android: string[];
	lan: string[];
}

const USAGE =
	'usage: bun tests/real-browsers.ts [--plan <name>] [--allow-no-webgpu] [--allow-no-webgl2] [--n <count>] [--runs <count>] [--jobs <counts>] [--pages <kinds>] [--scenes <scenes>] [--shields on|off] [--android <browsers>] [--lan <runners>] [<macOS app>...]';

/** The states of Brave's Shields that --shields takes. */
const SHIELDS_STATES = ['on', 'off'] as const;
export type ShieldsState = (typeof SHIELDS_STATES)[number];

/** The plans the runner knows: the fixed plans, and the phone-scale search. */
const PLAN_NAMES = [...Object.keys(PLANS), SCALE_PLAN];

export function parseArgs(args: readonly string[]): Options {
	const missing = { ...NONE_MISSING };
	const options: Options = { plan: 'checks', missing, mac: [], android: [], lan: [] };
	const list = (value: string | undefined) => (value ?? '').split(',').filter(Boolean);
	const known = <T extends string>(flag: string, values: string[], allowed: readonly T[]): T[] => {
		const unknown = values.filter((v) => !(allowed as readonly string[]).includes(v));
		if (values.length === 0 || unknown.length > 0)
			throw new Error(`${flag}: use some of ${allowed.join(', ')}\n${USAGE}`);
		return values as T[];
	};
	const oneOf = <T extends string>(
		flag: string,
		value: string | undefined,
		allowed: readonly T[],
	) => {
		if (!(allowed as readonly string[]).includes(value ?? ''))
			throw new Error(`${flag}: use ${allowed.join(' or ')}\n${USAGE}`);
		return value as T;
	};
	const wholeNumber = (flag: string, value: string | undefined, least = 1) => {
		const n = Number(value);
		if (!(Number.isSafeInteger(n) && n >= least))
			throw new Error(`${flag}: use a whole number of at least ${least}\n${USAGE}`);
		return n;
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === '--allow-no-webgpu') missing.webgpu = true;
		else if (arg === '--allow-no-webgl2') missing.webgl2 = true;
		else if (arg === '--n') options.count = wholeNumber(arg, args[++i]);
		else if (arg === '--runs') options.runs = wholeNumber(arg, args[++i], 0);
		else if (arg === '--jobs') options.jobs = readJobCounts(args[++i]);
		else if (arg === '--pages') options.pages = known(arg, list(args[++i]), BENCH_PAGE_KINDS);
		else if (arg === '--scenes') options.scenes = known(arg, list(args[++i]), PARITY_SCENES);
		else if (arg === '--shields') options.shields = oneOf(arg, args[++i], SHIELDS_STATES);
		else if (arg === '--plan') options.plan = args[++i] ?? '';
		else if (arg === '--android') options.android = list(args[++i]);
		else if (arg === '--lan') options.lan = list(args[++i]);
		else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}\n${USAGE}`);
		else options.mac.push(arg);
	}
	if (!PLAN_NAMES.includes(options.plan))
		throw new Error(`no plan named ${options.plan}; plans: ${PLAN_NAMES.join(', ')}`);
	// The memory plan still counts the room at each maximum without loads; other plans need runs.
	if (options.runs === 0 && options.plan !== 'memory')
		throw new Error(`--runs 0 works with --plan memory only\n${USAGE}`);
	for (const [flag, given] of [
		['--jobs', options.jobs],
		['--pages', options.pages],
		['--scenes', options.scenes],
	] as const)
		if (given && options.plan !== 'bench')
			throw new Error(`${flag} works with --plan bench only\n${USAGE}`);
	const other = options.jobs && options.pages?.filter((kind) => !isNull3dPage(kind));
	if (other && other.length > 0)
		throw new Error(
			`--jobs: job workers belong to null3D pages only; leave out ${other.join(', ')}`,
		);
	return options;
}

/** True when a runner's name says it runs Brave, such as sm-s926b-brave or ipad-brave. */
const namesBrave = (runner: string) => runner.includes('brave');

/**
 * What to check on each phone and tablet before a run, as lines to print: the settings that change
 * results, which the runner cannot read. Brave's Shields are one of them, and --shields records
 * their state.
 */
export function deviceChecklist(
	runners: readonly string[],
	shields: ShieldsState | undefined,
): string[] {
	const lines = [
		'Before the run, check each phone and tablet:',
		'- The display runs at a fixed refresh rate, such as 60 Hz. On a Galaxy phone, set Motion smoothness to Standard. On an iPad, turn on Limit Frame Rate.',
		'- Low Power Mode and battery saver are off.',
		'- The screen brightness is fixed, with automatic brightness off.',
		'- The device has rested and is cool. Nobody touches it during the run.',
	];
	if (shields)
		lines.push(`- Brave's Shields are ${shields} for this site, as --shields ${shields} records.`);
	else if (runners.some(namesBrave))
		lines.push(
			"- Brave's Shields are in the state you want to test. Add --shields on or --shields off to record it.",
		);
	return lines;
}

/**
 * The Shields state to record with a runner's results: the --shields state on Brave, or null when
 * the run gave none, and undefined in other browsers. A runner is Brave by its name, or when its
 * runner page found Brave's own object on `navigator`.
 */
export function braveShieldsOf(
	runner: string,
	device: Record<string, unknown> | undefined,
	shields: ShieldsState | undefined,
): ShieldsState | null | undefined {
	if (!namesBrave(runner) && device?.brave !== true) return undefined;
	return shields ?? null;
}

/** Brave's Shields state, as the run's summary gives it. */
export const shieldsText = (state: ShieldsState | null) =>
	`Brave Shields ${state ?? 'not recorded'}`;

/** One runner's outcome in the run's summary. */
export interface RunnerSummary {
	pass: number;
	skip: number;
	fail: number;
	/** Brave only: the state of its Shields, or null when the run did not record it. */
	braveShields?: ShieldsState | null;
}

/** A runner's line in the run's summary: its counts, and on Brave the state of its Shields. */
export function summaryLine(runner: string, summary: RunnerSummary): string {
	const counts = `${runner}: ${summary.pass} passed, ${summary.skip} skipped, ${summary.fail} failed`;
	return summary.braveShields === undefined
		? counts
		: `${counts}; ${shieldsText(summary.braveShields)}`;
}

/** How a runner starts: an app on this Mac, a browser on the phone, or a page that waits on the network. */
type Launch = { kind: 'mac'; app: string } | { kind: 'android'; browser: string } | { kind: 'lan' };

type LaunchedRunner = Runner & { launch: Launch };

type Launches = ReadonlyMap<string, Launch>;

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

/** Opens a run's runner page for each of these runners, and returns the ones that opened. */
function openRunners(
	names: readonly string[],
	launches: Launches,
	run: string,
	baseUrl: string,
): string[] {
	const opened: string[] = [];
	for (const name of names) {
		const launch = launches.get(name) as Launch;
		const url = `${baseUrl}/tests/pages/runner.html?run=${run}&runner=${name}`;
		if (launch.kind === 'mac') {
			if (openApp(launch.app, url)) opened.push(name);
		} else {
			if (launch.kind === 'android') openOnPhone(launch.browser, url);
			else console.log(`${name}: its turn now; bring its runner page to the front.`);
			opened.push(name);
		}
	}
	return opened;
}

/** Reports a runner page that stopped sending results, as when its tab closes. */
const reportQuiet = (name: string, seconds: number) =>
	console.log(`${name}: sent nothing for ${seconds} s, so its runner page has stopped`);

/** The runner among these that runs on the Android phone, whose heat the run reads. */
const phoneRunner = (names: readonly string[], launches: Launches) =>
	names.find((name) => launches.get(name)?.kind === 'android');

/**
 * Adds to each of a runner's results the heat from the previous result, or from the runner page's
 * start, to its own. Returns each item's heat.
 */
function addHeat(
	run: string,
	runner: string,
	ids: readonly string[],
	samples: readonly HeatSample[],
): Map<string, HeatSummary> {
	const byItem = new Map<string, HeatSummary>();
	let from = receivedAt(readDevice(run, runner));
	for (const id of ids) {
		const result = readResult(run, runner, id);
		const to = receivedAt(result);
		if (!result || from === undefined || to === undefined) continue;
		const heat = summarizeHeat(samples, from, to);
		if (heat) {
			byItem.set(id, heat);
			writeRunnerFile(run, runner, id, { ...result, heat });
		}
		from = to;
	}
	return byItem;
}

/** The heat through all of a runner's readings, as one line. */
function wholeHeatText(samples: readonly HeatSample[]): string | undefined {
	const first = samples[0];
	const last = samples.at(-1);
	const heat = first && last && summarizeHeat(samples, first.at, last.at);
	return heat ? heatText(heat) : undefined;
}

/**
 * Runs a fixed plan: each batch of runners at once, one browser per device, while the phone's heat
 * is read. Judges each result and prints a summary; returns the number of failures.
 */
async function runPlan(
	options: Options,
	runners: readonly LaunchedRunner[],
	launches: Launches,
	local: DevServer,
): Promise<number> {
	const makeItems = PLANS[options.plan] as NonNullable<(typeof PLANS)[string]>;
	const run = runName(options.plan);
	const plan = writePlan(
		run,
		makeItems({
			count: options.count,
			runs: options.runs,
			jobs: options.jobs,
			pages: options.pages,
			scenes: options.scenes,
		}),
	);
	const heatReadings = new Map<string, HeatSample[]>();
	try {
		for (const batch of turnBatches(runners)) {
			setTurns(run, batch);
			const phone = phoneRunner(batch, launches);
			const log = phone === undefined ? undefined : new HeatLog();
			log?.start();
			try {
				await waitForRunners(plan, openRunners(batch, launches, run, local.url), {
					onFinish: (name) => console.log(`${name}: finished`),
					onQuiet: reportQuiet,
				});
			} finally {
				if (phone !== undefined && log) heatReadings.set(phone, await log.stop());
			}
		}
	} finally {
		setTurns(run, []);
	}
	const heatByRunner = new Map<string, Map<string, HeatSummary>>();
	for (const [name, samples] of heatReadings) {
		writeRunnerFile(run, name, 'heat', samples);
		heatByRunner.set(
			name,
			addHeat(
				run,
				name,
				plan.items.map((item) => item.id),
				samples,
			),
		);
	}

	let failures = 0;
	const summary: Record<string, RunnerSummary> = {};
	// For a device without both of three.js's renderers, the parity check falls back to these.
	const storedPath = join(REPO_ROOT, STORED_BASELINES_FILE);
	const storedBaselines: StoredBaselines = existsSync(storedPath)
		? parseStoredBaselines(readFileSync(storedPath, 'utf8'))
		: {};
	for (const { name } of runners) {
		const device = readDevice(run, name);
		const braveShields = braveShieldsOf(name, device, options.shields);
		const counts: RunnerSummary = {
			pass: 0,
			skip: 0,
			fail: 0,
			...(braveShields !== undefined && { braveShields }),
		};
		summary[name] = counts;
		if (!device) {
			counts.fail++;
			failures++;
			console.log(`FAIL  ${name}: the runner page never started`);
			continue;
		}
		const context = {
			resultOf: (id: string) => readResult(run, name, id),
			imageDir: join(RUNS_DIR, run, name),
			storedBaselines,
		};
		for (const item of plan.items) {
			const result = readResult(run, name, item.id);
			const notes: string[] = [];
			const note = (text: string) => notes.push(text);
			const verdict = result
				? judge(item.check, result, options.missing, { ...context, note })
				: [NO_RESULT];
			// Facts the runner page could not record go into the result itself.
			const facts = {
				...(braveShields !== undefined && { braveShields }),
				...(notes.length > 0 && { notes }),
			};
			if (Object.keys(facts).length > 0) addToResult(run, name, item.id, facts);
			if (verdict === 'skip') {
				counts.skip++;
				console.log(`skip  ${name}: ${item.id}, no WebGPU`);
				continue;
			}
			if (verdict.length === 0) {
				counts.pass++;
				console.log(`pass  ${name}: ${item.id}`);
			} else {
				counts.fail++;
				console.log(`FAIL  ${name}: ${item.id}: ${verdict.join('; ')}`);
			}
			for (const text of notes) console.log(`      note: ${text}`);
			const heat = heatByRunner.get(name)?.get(item.id);
			if (heat && item.check.kind === 'bench') console.log(`      heat: ${heatText(heat)}`);
		}
		failures += counts.fail;
	}
	writeFileSync(join(RUNS_DIR, run, 'summary.json'), JSON.stringify(summary, null, '\t'));
	for (const { name } of runners) {
		const resultOf = (id: string) => readResult(run, name, id);
		for (const table of [benchSummary(plan.items, resultOf), memorySummary(plan.items, resultOf)])
			if (table) console.log(`\n${name}\n${table}\n`);
		const heat = wholeHeatText(heatReadings.get(name) ?? []);
		if (heat) console.log(`${name}, heat through the run: ${heat}`);
	}
	for (const [name, counts] of Object.entries(summary)) console.log(summaryLine(name, counts));
	console.log(`results: ${join(RUNS_DIR, run)}`);
	return failures;
}

/** One count that the phone-scale search tried on a runner. */
interface ScaleStep {
	renderer: string;
	count: number;
	/** The run that tried it, and its result's name there. */
	run: string;
	id: string;
	/** Frames per second drawn, or null when the page failed. */
	fps: number | null;
	held: boolean;
	error?: string;
	heat?: HeatSummary;
}

const objects = (count: number) => `${count.toLocaleString('en-US')} objects`;

/** Whether a search has tried a count yet. */
const searched = ({ held, dropped }: ScaleSearch) => held > 0 || dropped !== null;

/** What the search found with one of three.js's renderers, in one line. */
function answerText(renderer: string, { held, dropped }: ScaleSearch): string {
	if (held === 0)
		return `three.js ${renderer} does not hold ${HOLD_FPS} frames per second even at ${objects(dropped ?? 0)}`;
	if (dropped === null)
		return `three.js ${renderer} holds ${HOLD_FPS} frames per second up to ${objects(held)}, the most the search tries`;
	return `three.js ${renderer} holds ${HOLD_FPS} frames per second up to ${objects(held)}, and drops below at ${objects(dropped)}`;
}

/**
 * Searches each runner in turn for the largest S1 count at which three.js holds the rate, with each
 * renderer that the browser can run, one count per run. The larger count of the two renderers is the
 * device's phone scale. Returns the number of runners without an answer.
 */
async function runScale(
	options: Options,
	runners: readonly LaunchedRunner[],
	launches: Launches,
	local: DevServer,
): Promise<number> {
	const base = runName(SCALE_PLAN);
	let failures = 0;
	for (const runner of runners) {
		const name = runner.name;
		const log = launches.get(name)?.kind === 'android' ? new HeatLog() : undefined;
		const steps: ScaleStep[] = [];
		const answers: { renderer: string; search: ScaleSearch }[] = [];
		let braveShields: ShieldsState | null | undefined;
		log?.start();
		try {
			for (const [page, renderer] of SCALE_RENDERERS) {
				let search = NEW_SEARCH;
				for (let count = nextCount(search); count !== null; count = nextCount(search)) {
					const run = `${base}-${name}-${steps.length + 1}`;
					const item = scaleItem(page, count);
					const plan = writePlan(run, [item]);
					setTurns(run, [name]);
					await waitForRunners(plan, openRunners([name], launches, run, local.url), {
						onQuiet: reportQuiet,
					});
					const result = readResult(run, name, item.id);
					const verdict = result
						? judge(item.check, result, options.missing)
						: ['no result; the runner page stopped or never started'];
					if (verdict === 'skip') {
						console.log(`${name}: three.js ${renderer}: this browser cannot run it`);
						break;
					}
					const failed = verdict.length > 0;
					const step: ScaleStep = {
						renderer,
						count,
						run,
						id: item.id,
						fps: failed ? null : drawnFps(result as ItemResult),
						held: !failed && holdsRate(result as ItemResult),
						...(failed && { error: verdict.join('; ') }),
					};
					steps.push(step);
					console.log(
						`${name}: three.js ${renderer} at ${objects(count)}: ${step.fps === null ? `failed: ${step.error}` : `${step.fps.toFixed(1)} frames per second`}`,
					);
					// A page that fails at the first count shows that the browser cannot run it at all.
					if (failed && !searched(search)) break;
					search = afterCount(search, count, step.held);
				}
				if (searched(search)) answers.push({ renderer, search });
			}
		} finally {
			setTurns(base, []);
			const samples = log ? await log.stop() : [];
			const first = steps[0];
			braveShields = braveShieldsOf(name, first && readDevice(first.run, name), options.shields);
			for (const step of steps) {
				if (log) step.heat = addHeat(step.run, name, [step.id], samples).get(step.id);
				if (braveShields !== undefined) addToResult(step.run, name, step.id, { braveShields });
			}
			writeRunnerFile(base, name, 'scale', {
				answers,
				steps,
				heat: samples,
				...(braveShields !== undefined && { braveShields }),
			});
		}
		const best = answers
			.filter(({ search }) => search.held > 0)
			.sort((a, b) => b.search.held - a.search.held)[0];
		for (const { renderer, search } of answers)
			console.log(`${name}: ${answerText(renderer, search)}.`);
		const heat = wholeHeatText(log?.samples ?? []);
		if (heat) console.log(`${name}, heat through the search: ${heat}`);
		if (braveShields !== undefined) console.log(`${name}: ${shieldsText(braveShields)}`);
		if (best) {
			console.log(
				`${name}: phone scale ${objects(best.search.held)}, with three.js's ${best.renderer} renderer. Run the benchmark at it with --plan bench --n ${best.search.held}.`,
			);
		} else {
			failures++;
			console.log(
				`FAIL  ${name}: the search found no count at which three.js holds ${HOLD_FPS} frames per second`,
			);
		}
	}
	console.log(`results: ${join(RUNS_DIR, base)}`);
	return failures;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const runners = runnersOf(options);
	if (runners.length === 0) throw new Error(USAGE);
	const launches = new Map(runners.map((runner) => [runner.name, runner.launch]));
	if (options.android.length > 0 || options.lan.length > 0) {
		const names = runners.map((runner) => runner.name);
		console.log(`${deviceChecklist(names, options.shields).join('\n')}\n`);
	}

	const local = await startServer();
	const lan = options.lan.length > 0 ? await startServer(true) : undefined;
	if (lan) {
		console.log(
			`On each tablet or phone, open ${lan.url}/tests/pages/runner.html?listen&runner=<name>`,
		);
		console.log(
			`with <name> one of ${options.lan.map(slug).join(', ')}. A waiting page runs each new run when its turn comes.`,
		);
	}
	let failures: number;
	try {
		failures =
			options.plan === SCALE_PLAN
				? await runScale(options, runners, launches, local)
				: await runPlan(options, runners, launches, local);
	} finally {
		local.stop();
		lan?.stop();
	}
	process.exit(failures > 0 ? 1 : 0);
}

if (import.meta.main) {
	main().catch((e) => {
		console.error(`error: ${(e as Error).message}`);
		process.exit(1);
	});
}
