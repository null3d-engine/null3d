// Runs a plan of test pages in real browsers that Playwright cannot drive, through the runner page:
// browser apps on this Mac or Linux machine, browsers on an Android phone connected by USB, runner pages that wait
// on tablets and phones on the local network, and sessions that it opens on a device cloud's real
// devices. It starts the dev server, lets one browser per device run at a time, then judges every
// result and prints a summary. On an Android phone it reads
// the phone's heat through the run, and adds to each result the heat that the page ran in. When a
// browser keeps refusing memory, the runner ends that browser's turn early, keeps the others going,
// and prints what to reset and the --only list that goes on with the run. In plans that time pages,
// the runner page measures the display's refresh rate before each page, and a rate that is low or
// changes through the run marks the run's timing figures as unreliable.
// From the repository root:
//   bun tests/real-browsers.ts Safari Firefox
//   bun tests/real-browsers.ts --allow-no-webgpu --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --allow-no-webgpu --allow-no-webgl2 --shard 1/2 Safari
//   bun tests/real-browsers.ts --plan scale --allow-no-webgpu --android chrome
//   bun tests/real-browsers.ts --plan scale --scenes s5 --allow-no-webgpu --android chrome
//   bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --n 250000
//   bun tests/real-browsers.ts --plan bench --allow-no-webgpu --android chrome --n 300000 --jobs 2,4,6,8
//   bun tests/real-browsers.ts --plan memory --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --plan startup --lan ipad-safari
//   bun tests/real-browsers.ts --plan depth --allow-no-webgpu --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --plan overload --allow-no-webgpu --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --plan skinning --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --plan skinning-webgpu --lan ipad-safari
//   bun tests/real-browsers.ts --plan animation --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --plan jitter --allow-no-webgpu --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --plan tab-memory --allow-no-webgpu --android chrome
//   bun tests/real-browsers.ts --plan tab-memory --lan ipad-safari --attended
//   bun tests/real-browsers.ts --plan soak --lan ipad-safari --minutes 30
//   bun tests/real-browsers.ts --plan warm-up-time --allow-no-webgpu --android chrome
//   bun tests/real-browsers.ts --plan governor --allow-no-webgpu --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --plan texture-cache --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --plan object-growth --cloud bsgalaxys25-chrome
//   bun tests/real-browsers.ts --plan occlusion-s6 --android chrome --lan ipad-safari
//   bun tests/real-browsers.ts --plan smoke --allow-no-webgpu --lan bsgalaxys25-samsung
//   bun tests/real-browsers.ts --plan smoke --cloud bsiphone17-safari,bspixel10-chrome --parallel 2
// Options:
//   --plan <name>       the plan to run: checks (the default), smoke, a tenth of the checks for a
//                       device in a cloud session of limited time, parity, bench, memory, which loads
//                       the engine page 20 times at each shared memory maximum from 256 to 4096 MiB,
//                       startup, which times cold and warm loads of the engine page's production
//                       build in each thread mode, depth, which runs the image test manifest's depth
//                       precision tests and counts the fighting pixels of surfaces 1 cm apart from
//                       1 m to 10 km in each depth mode, overload, which raises the GPU work of a
//                       scene until the GPU falls behind and compares the presented and completed
//                       rates on each GPU path, skinning, which times two ways to skin a crowd on
//                       WebGL2 with 1 to 4 shadow cascades: in every pass, or once per frame with
//                       transform feedback, skinning-webgpu, which times the same two ways on
//                       WebGPU, with a compute pass that skins once per frame, animation, which times the core's animation step on
//                       the job workers for crowds of 100 and 500 characters, jitter, which flies a
//                       camera past objects at the origin and 1,000 km and 6,378 km out on each GPU
//                       path, and compares each object's motion from frame to frame, governor, which runs the quality governor's stress
//                       test on each GPU path: every live step down and back up under a load,
//                       then a scene too heavy for the GPU whose frame rate the governor must bring
//                       back, tab-memory, which grows GPU textures, GPU buffers and a WebAssembly
//                       memory in steps until the browser closes the tab, soak, which loses the GPU
//                       on purpose in every thread mode and then plays S4 for many minutes on each
//                       GPU path, recording each GPU loss, warm-up-time, which times how long the
//                       pipelines of each benchmark scene and demo hold up the first frame, with
//                       fresh shaders and with compiled ones, or scale, which finds the largest
//                       count of S1's objects or S5's characters at which three.js holds 30
//                       frames per second, or texture-cache, which times first and repeat visits
//                       that load the city scene's 120 KTX2 textures, with the cache of
//                       transcoded textures off and on, or object-growth, which times the create
//                       calls that grow the scene's object tables, and the engine memory of a
//                       small scene, on each GPU path, or occlusion-s6, T-36, which times S6 on
//                       WebGL2 with software occlusion culling off and on in turns at the Low,
//                       Medium and High presets with two sizes of its buffer, and checks at
//                       stops along the route that it hides nothing that shows, or sky, which
//                       times each stage of a sky map's refresh and counts the frames from a sun
//                       move to the new light on each GPU path, or reflection, which times S1 with
//                       a reflection pass at a quarter and at half the render size against none
//   --allow-no-webgpu   a browser without WebGPU skips the WebGPU pages instead of failing them
//   --allow-no-webgl2   a browser without WebGL2 skips the WebGL2 pages instead of failing them
//   --n <count>         the instance count of the bench plan's pages
//   --runs <count>      fresh runs of each bench plan page, the protocol's 5 by default, loads at
//                       each maximum of the memory plan, 20 by default, where 0 runs only the
//                       counts of how many engines fit at once, cold and warm loads of each
//                       thread mode in the startup plan, 5 by default, rounds of the tab
//                       memory plan, 1 by default, loads of each scene with fresh shaders in
//                       the warm-up time plan, 2 by default, or runs of the texture cache plan's
//                       four loads, 5 by default, or loads of the object growth page on each GPU
//                       path, 3 by default
//   --jobs <list>       job worker counts, such as 2,4,6,8: the bench plan then runs null3D's two
//                       GPU paths at each count instead of its usual pages
//   --pages <list>      the bench plan's page kinds, such as null3d-webgl2,null3d-webgl2-low
//   --scenes <list>     the bench plan's scenes: s1, s1-static, s1-cells, s2, s3, s4, s5, s6; or the
//                       scale plan's: s1, s5. The default is s1
//   --seconds <n>       the bench plan's warm-up and measured seconds, each, instead of the
//                       protocol's 5 and 30; 300 gives the protocol's 10-minute sustained run.
//                       In the occlusion-s6 plan, each side's seconds in each round, 10 by default
//   --minutes <n>       the soak plan's minutes on each GPU path, 30 by default
//   --shard <i>/<n>     run only the i-th of n shards of a fixed plan, as CI does on each of its
//                       machines: the plan's items split evenly, and an item stays with the items
//                       whose results its check compares with. Each shard loads the capabilities
//                       page first, to skip the pages of the GPU paths that the device lacks
//   --only <ids>        run only these items of a fixed plan, such as the pages that failed in an
//                       earlier run, with the items whose results their checks compare with
//   --rounds <n>        run the items n times over, one round after another, to catch a fault
//                       that comes only now and then
//   --shields on|off    the state of Brave's Shields for the dev server's site, which the runner
//                       cannot read: it goes into each Brave result and the run's summary. No
//                       plan tests Brave any more; it runs only where a run names it
//   --switches <q>      page switches that every page of the plan gets, such as half=on or
//                       half=on&preset=ultra: the checks plan's image tests then compare the
//                       scene shaders at half precision with the usual references
//   --android <list>    browsers on the Android phone: chrome, chrome-beta, brave, firefox, samsung
//   --lan <list>        names of runner pages that wait on the local network, as device-browser,
//                       such as ipad-safari; pages on one device take turns
//   --cloud <list>      runners of the device cloud list (tests/lib/browserstack-devices.ts): each
//                       one's turn opens a BrowserStack Automate session on its device, through
//                       BrowserStack Local, and ends it when the turn ends; bun run devices:cloud
//                       picks them by tier
//   --parallel <n>      at most n runners at once, as a device cloud plan's parallel sessions
//                       allow; 1 by default with --cloud, and no limit without it
//   --cloud-build <name> the build that groups the run's sessions on the cloud's dashboard
//   --network-logs      the cloud keeps each session's network log, which the dashboard shows
//   --attended         someone is at the devices of --lan, so a plan whose pages end their tab,
//                       such as tab-memory, may run there: Safari stops reloading a tab that
//                       crashes again soon after the last crash, and only a person can reopen it
//   --front             browser apps on a Mac open in front, at the window size they choose. Without
//                       it, they open in the background, and Safari's and Firefox's runner windows
//                       move almost wholly past the main display's left edge, at a small size, or at
//                       their own size in timed plans
// In Safari, a page that fails with a refused memory, a lost GPU or context, or room for shared
// memory that did not come back runs once more in a new runner page after the run, and fails only
// if it fails again there. Each such rerun prints as RERUN and goes into the run's results.
// Before a run on a phone or tablet, the runner prints a checklist of the device settings that
// results depend on. After a fixed plan, it prints each browser's entry for the record of tested
// devices, from what the runner page found about its browser, device and GPU: the run's file and
// the folder where it goes. A runner whose name
// names one browser warns when its page ran in another.
import { execFileSync, spawn } from 'node:child_process';
import {
	copyFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
	BENCH_PAGE_KINDS,
	BENCH_SCENES,
	type BenchPageKind,
	type BenchScene,
	isNull3dPage,
	parseStoredBaselines,
	readJobCounts,
	readSwitches,
	STORED_BASELINES_FILE,
	type StoredBaselines,
} from '../bench/lib/parity.ts';
import {
	factsOf,
	RECORD_DIR,
	readRecord,
	recordFiles,
	runEntryText,
} from '../tools/lib/tested-devices.ts';
import { forwardPort, openOnPhone, phoneModel } from './lib/adb.ts';
import {
	type AppWindow,
	appWindow,
	frontApp,
	giveFocusBack,
	PARKED_APPS,
	parkWindow,
} from './lib/app-window.ts';
import { browserStackSessions, readCredentials } from './lib/browserstack.ts';
import { type CloudDevice, cloudDevice } from './lib/browserstack-devices.ts';
import type { CloudSessions } from './lib/cloud-sessions.ts';
import {
	browserMismatch,
	browserText,
	type DeviceFacts,
	detectBrowser,
	NO_FRAMES,
	type NoFramesRecord,
	noFramesText,
	testedDeviceEntry,
} from './lib/device-record.ts';
import { GPU_PATH_NAMES, type GpuPath, skippedPath, skippedPathsText } from './lib/gpu-paths.ts';
import { HeatLog, type HeatSample, type HeatSummary, heatText, summarizeHeat } from './lib/heat.ts';
import { clearCandidates } from './lib/images.ts';
import { buildsForLoads, prepareLoads } from './lib/load-server.ts';
import { objectGrowthSummary } from './lib/object-growth.ts';
import { occlusionS6Summary } from './lib/occlusion-s6.ts';
import {
	animationSummary,
	benchSummary,
	type Check,
	depthSummary,
	governorSummary,
	gpuPathOf,
	itemsNeeded,
	jitterSummary,
	judge,
	MEMORY_LIMIT_CHECKS,
	type MissingAllowed,
	memorySummary,
	NO_RESULT,
	NONE_MISSING,
	overloadSummary,
	PLANS,
	REPORT_ON_TOP_PLANS,
	skinningSummary,
	soakSummary,
	startupSummary,
	tabMemorySummary,
	warmUpTimeSummary,
	withGpuPaths,
} from './lib/plans.ts';
import { endTurnClaim, RUNS_DIR } from './lib/report-collector.ts';
import {
	addToResult,
	type ItemResult,
	inLanes,
	keepsRefusingMemory,
	OOM_WINDOW_PAGES,
	outOfMemory,
	PAGES_PER_TAB,
	type Plan,
	type PlanItem,
	type PlanPlace,
	pickItems,
	type Runner,
	readDevice,
	readResult,
	readShard,
	receivedAt,
	repeatItems,
	rerunsInNewTab,
	runName,
	SHARD_FORMAT,
	type Shard,
	setTurns,
	shardItems,
	slug,
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
	isScaleScene,
	NEW_SEARCH,
	nextCount,
	SCALE_COUNTS,
	SCALE_PLAN,
	SCALE_RENDERERS,
	SCALE_SCENES,
	type ScaleScene,
	type ScaleSearch,
	scaleItem,
} from './lib/scale.ts';
import {
	type DevServer,
	HTTP_PORT,
	HTTPS_PORT,
	onStopSignal,
	REPO_ROOT,
	startServer,
} from './lib/server.ts';
import { progressName, tabEndedResult } from './lib/tab-end.ts';
import { textureCacheSummary } from './lib/texture-cache.ts';

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
	/** The bench plan's or the scale plan's scenes, when given. */
	scenes?: BenchScene[];
	/** The bench plan's warm-up and measured seconds, each, when given. */
	seconds?: number;
	/** The soak plan's minutes on each GPU path, when given. */
	minutes?: number;
	/** The state of Brave's Shields for the dev server's site, when given. */
	shields?: ShieldsState;
	/** The one shard of a fixed plan to run, when given. */
	shard?: Shard;
	/** The ids of the only items of a fixed plan to run, when given. */
	only?: string[];
	/** How many times over to run the items, when given. */
	rounds?: number;
	/** Page switches that every page of the plan gets, joined by `&`, when given. */
	switches?: string;
	/** Someone is at the network devices, to reopen a runner page that a crash closed. */
	attended?: boolean;
	/** At most this many runners at once, when given. */
	parallel?: number;
	/** The build that groups a cloud run's sessions on the cloud's dashboard, when given. */
	cloudBuild?: string;
	/** The cloud keeps each session's network log, which slows the session's loads a little. */
	networkLogs?: boolean;
	/** Browser apps on a Mac open in front, at their own window size. */
	front?: boolean;
	/** Browser apps on this machine: macOS app names, such as Safari, or Linux commands' names, such as Firefox. */
	apps: string[];
	android: string[];
	lan: string[];
	/** Runners of the device cloud list, whose sessions the runner tool opens. */
	cloud: string[];
}

const USAGE =
	'usage: bun tests/real-browsers.ts [--plan <name>] [--allow-no-webgpu] [--allow-no-webgl2] [--n <count>] [--runs <count>] [--jobs <counts>] [--pages <kinds>] [--scenes <scenes>] [--seconds <n>] [--minutes <n>] [--shard <i>/<n>] [--only <ids>] [--rounds <n>] [--shields on|off] [--switches <q>] [--android <browsers>] [--lan <runners>] [--cloud <runners>] [--parallel <n>] [--cloud-build <name>] [--network-logs] [--attended] [--front] [<browser app>...]';

/** The states of Brave's Shields that --shields takes. */
const SHIELDS_STATES = ['on', 'off'] as const;
export type ShieldsState = (typeof SHIELDS_STATES)[number];

/** The plans the runner knows: the fixed plans, and the phone-scale search. */
const PLAN_NAMES = [...Object.keys(PLANS), SCALE_PLAN];

export function parseArgs(args: readonly string[]): Options {
	const missing = { ...NONE_MISSING };
	const options: Options = { plan: 'checks', missing, apps: [], android: [], lan: [], cloud: [] };
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
	const shard = (value: string | undefined): Shard => {
		const read = readShard(value);
		if (!read) throw new Error(`--shard: use ${SHARD_FORMAT}\n${USAGE}`);
		return read;
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] as string;
		if (arg === '--allow-no-webgpu') missing.webgpu = true;
		else if (arg === '--allow-no-webgl2') missing.webgl2 = true;
		else if (arg === '--n') options.count = wholeNumber(arg, args[++i]);
		else if (arg === '--runs') options.runs = wholeNumber(arg, args[++i], 0);
		else if (arg === '--jobs') options.jobs = readJobCounts(args[++i]);
		else if (arg === '--pages') options.pages = known(arg, list(args[++i]), BENCH_PAGE_KINDS);
		else if (arg === '--scenes') options.scenes = known(arg, list(args[++i]), BENCH_SCENES);
		else if (arg === '--seconds') options.seconds = wholeNumber(arg, args[++i]);
		else if (arg === '--minutes') options.minutes = wholeNumber(arg, args[++i]);
		else if (arg === '--shard') options.shard = shard(args[++i]);
		else if (arg === '--only') options.only = list(args[++i]);
		else if (arg === '--rounds') options.rounds = wholeNumber(arg, args[++i]);
		else if (arg === '--shields') options.shields = oneOf(arg, args[++i], SHIELDS_STATES);
		else if (arg === '--switches') options.switches = readSwitches(args[++i], arg);
		else if (arg === '--plan') options.plan = args[++i] ?? '';
		else if (arg === '--android') options.android = list(args[++i]);
		else if (arg === '--lan') options.lan = list(args[++i]);
		else if (arg === '--cloud') options.cloud = list(args[++i]);
		else if (arg === '--parallel') options.parallel = wholeNumber(arg, args[++i]);
		else if (arg === '--cloud-build') options.cloudBuild = args[++i];
		else if (arg === '--network-logs') options.networkLogs = true;
		else if (arg === '--attended') options.attended = true;
		else if (arg === '--front') options.front = true;
		else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}\n${USAGE}`);
		else options.apps.push(arg);
	}
	if (!PLAN_NAMES.includes(options.plan))
		throw new Error(`no plan named ${options.plan}; plans: ${PLAN_NAMES.join(', ')}`);
	for (const [flag, given] of [
		['--shard', options.shard],
		['--only', options.only],
		['--rounds', options.rounds],
	] as const)
		if (given && options.plan === SCALE_PLAN)
			throw new Error(
				`${flag} picks items of a fixed plan, so it does not work with --plan ${SCALE_PLAN}`,
			);
	if (options.only?.length === 0) throw new Error(`--only: name some items\n${USAGE}`);
	const unknownCloud = options.cloud.filter((name) => !cloudDevice(name));
	if (unknownCloud.length > 0)
		throw new Error(
			`--cloud: the device cloud list (tests/lib/browserstack-devices.ts) has no runner ${unknownCloud.join(', ')}`,
		);
	if (options.cloud.length > 0 && options.plan === SCALE_PLAN)
		throw new Error(`--cloud runs fixed plans only, not --plan ${SCALE_PLAN}\n${USAGE}`);
	// The memory plan still counts the room at each maximum without loads; other plans need runs.
	if (options.runs === 0 && options.plan !== 'memory')
		throw new Error(`--runs 0 works with --plan memory only\n${USAGE}`);
	for (const [flag, given] of [
		['--jobs', options.jobs],
		['--pages', options.pages],
		['--seconds', options.seconds],
	] as const)
		if (given && options.plan !== 'bench')
			throw new Error(`${flag} works with --plan bench only\n${USAGE}`);
	if (options.scenes && options.plan === SCALE_PLAN) {
		const other = options.scenes.filter((scene) => !isScaleScene(scene));
		if (other.length > 0)
			throw new Error(
				`--scenes: the scale plan searches ${SCALE_SCENES.join(' and ')} only; leave out ${other.join(', ')}`,
			);
	} else if (options.scenes && options.plan !== 'bench')
		throw new Error(`--scenes works with --plan bench or --plan ${SCALE_PLAN} only\n${USAGE}`);
	if (options.minutes && options.plan !== 'soak')
		throw new Error(`--minutes works with --plan soak only\n${USAGE}`);
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

/** The browser a runner page ran in: as the page detected it, or from its facts in an older run. */
const browserOf = (device: DeviceFacts) => device.browser ?? detectBrowser(device);

/**
 * Prints each runner's entry for the record of tested devices, for the runners whose page started:
 * the run's file, and the folder where it goes, or a new folder's README.
 */
function printRecordEntries(
	run: string,
	runners: readonly LaunchedRunner[],
	summary: Readonly<Record<string, RunnerSummary>>,
): void {
	const { rows } = readRecord(recordFiles(REPO_ROOT));
	const entries = runners.flatMap(({ name, launch }) => {
		const device = readDevice(run, name);
		const counts = summary[name];
		if (!device || !counts) return [];
		const entry = testedDeviceEntry({ run, launch: launch.kind, device, ...counts });
		return [runEntryText(rows, run, factsOf(entry.facts), entry.plans, entry.result)];
	});
	if (entries.length > 0)
		console.log(
			`\nEntries for the record of tested devices (${RECORD_DIR}/). Add the commit to the plans, and what the run found to the result:\n\n${entries.join('\n')}`,
		);
}

/** One runner's outcome in the run's summary. */
export interface RunnerSummary {
	pass: number;
	skip: number;
	fail: number;
	/** The browser that the runner page found itself in, with its version, when it started. */
	browser?: string;
	/** After a turn that ended early: the pages that never ran. */
	notRun?: number;
	/** Why the runner's turn ended early, and what to do before the next run. */
	endedEarly?: EndedEarly;
	/** In a timed plan: what was wrong with the display's refresh rate, which makes its figures unreliable. */
	unreliableTiming?: string;
	/** The GPU paths that the device lacks, whose pages its runner page skipped. */
	skippedPaths?: GpuPath[];
	/** Brave only: the state of its Shields, or null when the run did not record it. */
	braveShields?: ShieldsState | null;
}

/**
 * A runner's line in the run's summary: the browser its page ran in, its counts, on Brave the state
 * of its Shields, the GPU paths whose pages it skipped, why its turn ended early, and why its timing
 * figures are unreliable, where these apply.
 */
export function summaryLine(runner: string, summary: RunnerSummary): string {
	const browser = summary.browser ? ` (${summary.browser})` : '';
	const notRun = summary.notRun === undefined ? '' : `, ${summary.notRun} not run`;
	return [
		`${runner}${browser}: ${summary.pass} passed, ${summary.skip} skipped, ${summary.fail} failed${notRun}`,
		...(summary.braveShields === undefined ? [] : [shieldsText(summary.braveShields)]),
		...(summary.skippedPaths?.length ? [skippedPathsText(summary.skippedPaths)] : []),
		...(summary.endedEarly ? [`ended early: ${summary.endedEarly.reason}`] : []),
		...(summary.unreliableTiming ? [`timing figures unreliable: ${summary.unreliableTiming}`] : []),
	].join('; ');
}

/**
 * How a runner starts: an app on this Mac or Linux machine, a browser on the phone, a page that
 * waits on the network, or a session on a device cloud that opens a waiting page.
 */
type Launch =
	| AppLaunch
	| { kind: 'android'; browser: string }
	| { kind: 'lan' }
	| { kind: 'cloud'; device: CloudDevice };

type LaunchedRunner = Runner & { launch: Launch };

type Launches = ReadonlyMap<string, Launch>;

/** The kind of machine whose browser apps a run opens: a Mac, or a Linux machine such as CI's. */
type AppMachine = 'mac' | 'linux';

/** A browser app on this machine, and how its window opens on a Mac. */
type AppLaunch = { kind: AppMachine; app: string; window?: AppWindow };

/** The machine that this tool runs on, which opens its browser apps. */
function appMachine(): AppMachine {
	if (process.platform === 'darwin') return 'mac';
	if (process.platform === 'linux') return 'linux';
	throw new Error(`browser apps run on macOS or Linux, not on ${process.platform}`);
}

/** True for a runner that is a browser app on this machine. */
const isApp = (launch: Launch | undefined): launch is AppLaunch =>
	launch?.kind === 'mac' || launch?.kind === 'linux';

function runnersOf(options: Options): LaunchedRunner[] {
	const machine = options.apps.length > 0 ? appMachine() : 'mac';
	const timed = TIMED_PLANS.has(options.plan) || options.plan === SCALE_PLAN;
	const window = appWindow(options.front === true, Boolean(process.env.CI), timed);
	const runners: LaunchedRunner[] = options.apps.map((app) => ({
		name: `${machine}-${slug(app)}`,
		device: machine,
		launch: { kind: machine, app, ...(machine === 'mac' && { window }) },
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
	// Each cloud session runs on a device of its own, so cloud runners never wait for each other.
	for (const name of options.cloud)
		runners.push({ name, device: name, launch: { kind: 'cloud', device: cloudDevice(name)! } });
	return runners;
}

/** The device whose image references a runner compares with: a cloud device's model, when it has one. */
const imageDevice = (runner: LaunchedRunner) =>
	(runner.launch.kind === 'cloud' && runner.launch.device.model) || runner.device;

/** Time a macOS app may take to open the runner page before its turn counts as failed. */
const OPEN_TIMEOUT_MS = 60_000;

/** The apps whose runner window did not move in this run, which the tool told once. */
const unparked = new Set<string>();

/**
 * Opens the runner page in a browser app and says whether it did. On a Mac, a launch that hangs,
 * as behind a first-launch prompt on a machine that nobody watches, fails after a minute instead
 * of stopping the whole run. There the app opens in the background unless the run asks for the
 * front, and the runner window of an app that the tool can move goes almost wholly past the main
 * display's left edge. Should the app take focus all the same, the app in front before gets it back.
 * On Linux, the app's command by its name in lowercase opens the page: the first call starts the
 * browser, which keeps running, and a later call hands the page to it.
 */
function openApp({ app, window }: AppLaunch, url: string): boolean {
	try {
		if (process.platform === 'darwin') {
			const before = window?.background ? frontApp() : undefined;
			const background = window?.background ? ['-g'] : [];
			execFileSync('open', [...background, '-a', app, url], { timeout: OPEN_TIMEOUT_MS });
			const why =
				window?.park && PARKED_APPS.has(app) ? parkWindow(app, url, window.small) : undefined;
			if (why && !unparked.has(app)) {
				unparked.add(app);
				console.log(`${app}: its runner window stays where the app put it: ${why}`);
			}
			giveFocusBack(before);
		} else {
			const command = execFileSync('which', [slug(app)], { encoding: 'utf8' }).trim();
			spawn(command, [url], { detached: true, stdio: 'ignore' })
				.on('error', (e) => console.log(`${app} stopped: ${e.message}`))
				.unref();
		}
		return true;
	} catch (e) {
		console.log(`${app} did not open the runner page: ${(e as Error).message.split('\n')[0]}`);
		return false;
	}
}

/**
 * The address of a run's runner page for one runner, from the plan item at `from` when given. With
 * `tabs`, the runner page hands the run over before and after a page that runs in a runner page of
 * its own, since the tool then opens the next runner page.
 */
const runnerUrl = (baseUrl: string, run: string, runner: string, from?: number, tabs = false) =>
	`${baseUrl}/tests/pages/runner.html?run=${run}&runner=${runner}${from ? `&from=${from}` : ''}${tabs ? '&tabs' : ''}`;

/** Where cloud devices reach the dev server's HTTPS port, through BrowserStack Local. */
const CLOUD_URL = `https://bs-local.com:${HTTPS_PORT}`;

/** The address of the runner page that waits for its turn, on a device of the cloud. */
const cloudRunnerUrl = (runner: string) =>
	`${CLOUD_URL}/tests/pages/runner.html?listen&runner=${runner}`;

/** How long a cloud device's runner page may take to start after its session loads it. */
const CLOUD_START_MS = 180_000;

/**
 * Opens a run's runner page for each of these runners, and returns the ones that opened. A cloud
 * runner gets a session that opens its waiting runner page, which starts the run at its turn.
 */
async function openRunners(
	names: readonly string[],
	launches: Launches,
	run: string,
	baseUrl: string,
	cloud?: CloudSessions,
): Promise<string[]> {
	const opened: string[] = [];
	for (const name of names) {
		const launch = launches.get(name) as Launch;
		const url = runnerUrl(baseUrl, run, name, undefined, isApp(launch));
		if (isApp(launch)) {
			if (openApp(launch, url)) opened.push(name);
		} else if (launch.kind === 'cloud') {
			if (await cloud?.open(name, cloudRunnerUrl(name))) opened.push(name);
		} else {
			if (launch.kind === 'android') openOnPhone(launch.browser, url);
			else console.log(`${name}: its turn now; bring its runner page to the front.`);
			opened.push(name);
		}
	}
	return opened;
}

/** Reports a runner page that stopped sending results, as when its tab closes, and its page. */
function reportQuiet(name: string, seconds: number, at?: PlanPlace): false {
	const where = at ? ` on page ${at.index + 1}, ${at.item.id}` : '';
	console.log(`${name}: sent nothing for ${seconds} s${where}, so its runner page has stopped`);
	return false;
}

/** How many new runner pages the runner tool opens for one runner in one run. */
const MAX_REOPENS = 2;

/** Runs a command and returns its output, or a line that says why it failed. */
function output(command: string, args: string[], timeout = 10_000): string {
	try {
		return execFileSync(command, args, { timeout, encoding: 'utf8', maxBuffer: 256 << 20 });
	} catch (e) {
		return `(${command} failed: ${(e as Error).message.split('\n')[0]})`;
	}
}

/** How far back the Mac's log goes in the evidence of a quiet runner page. */
const QUIET_LOG_MINUTES = 6;
/** The most lines of the Mac's log that the evidence keeps, the newest ones. */
const QUIET_LOG_LINES = 20_000;

/**
 * Looks at the Mac when a runner page in one of its apps goes quiet, and returns what it found as
 * one line. It saves the evidence beside the run's results: a picture of the screen, the newest
 * lines of the log from WebKit, Safari and the kernel, and the crash reports written during the
 * run.
 */
function inspectMac(run: string, runner: string, count: number, since: number): string {
	const locked = /"CGSSessionScreenIsLocked"\s*=\s*Yes/.test(
		output('ioreg', ['-n', 'Root', '-d1']),
	);
	const pressure = output('memory_pressure', []).trim().split('\n').at(-1);
	const webContent = output('ps', ['-axo', 'rss=,command='])
		.split('\n')
		.filter((line) => line.includes('WebContent'))
		.map((line) => `${Math.round(Number.parseInt(line.trim(), 10) / 1024)} MB`);
	const prefix = join(RUNS_DIR, run, `${runner}-quiet-${count}`);
	output('screencapture', ['-x', `${prefix}.png`]);
	const log = output(
		'/usr/bin/log',
		[
			'show',
			'--last',
			`${QUIET_LOG_MINUTES}m`,
			'--style',
			'compact',
			'--predicate',
			'subsystem BEGINSWITH "com.apple.WebKit" OR process BEGINSWITH "com.apple.WebKit" OR process == "Safari" OR process == "kernel" OR process == "ReportCrash"',
		],
		60_000,
	);
	writeFileSync(`${prefix}-log.txt`, log.split('\n').slice(-QUIET_LOG_LINES).join('\n'));
	const crashes: string[] = [];
	for (const dir of [
		join(homedir(), 'Library/Logs/DiagnosticReports'),
		'/Library/Logs/DiagnosticReports',
	])
		try {
			for (const name of readdirSync(dir)) {
				const path = join(dir, name);
				const file = statSync(path);
				if (!file.isFile() || file.mtimeMs < since) continue;
				copyFileSync(path, `${prefix}-${name}`);
				crashes.push(name);
			}
		} catch {
			// Reports that the tool cannot read stay where they are.
		}
	return `screen ${locked ? 'locked' : 'not locked'}; ${pressure}; web content processes: ${webContent.join(', ') || 'none'}; crash reports: ${crashes.join(', ') || 'none'}; evidence in ${prefix}*`;
}

/**
 * Keeps the Mac's display awake while the runner lasts. Once the screen saver locks the screen,
 * Safari gives pages no animation frames, so every later page waits for a first frame that never
 * comes. The screen saver starts only while nothing keeps the display awake.
 */
function keepDisplayAwake(): void {
	if (process.platform !== 'darwin') return;
	const child = spawn('caffeinate', ['-d', '-i', '-w', String(process.pid)], {
		stdio: 'ignore',
		detached: true,
	});
	child.on('error', () => {});
	child.unref();
}

/**
 * Closes a run's runner page in Safari through AppleScript. Not in CI: there macOS asks whether the
 * tool may control Safari, and nobody can answer.
 */
function closeSafariRunner(run: string, runner: string): void {
	if (process.env.CI) return;
	const match = `run=${run}&runner=${runner}`;
	output('osascript', [
		'-e',
		`tell application "Safari" to close (every tab of every window whose URL contains "${match}")`,
	]);
}

/** How the runner tool replaces a quiet runner page, where it can. */
export interface Reopener {
	/**
	 * True when the tool can open a new runner page for this runner itself: after any quiet page, or
	 * only after a page that ended its tab, when `tabEnded` says so.
	 */
	canReopen(runner: string, tabEnded: boolean): boolean;
	/**
	 * Looks at the device when a runner page goes quiet for the `count`-th time in the run, and
	 * returns what it found as one line.
	 */
	inspect(runner: string, count: number): string;
	/**
	 * Opens a new runner page at the plan's item `from`, or, without it, at the first item without a
	 * result, and says whether it opened.
	 */
	reopen(runner: string, from?: number): boolean;
}

/**
 * Replaces a runner page that goes quiet on a page, and keeps the facts for the summary. A new
 * runner page starts at the page where the last one went quiet, so that page runs once more. A
 * page where a runner page goes quiet twice fails, and the new runner page starts at the page after
 * it. Each runner gets a few new runner pages per run; after that, a quiet runner page ends the
 * runner's turn. Runners that the tool cannot open itself are never replaced.
 */
export class QuietRecovery {
	private readonly reopens = new Map<string, number>();
	/** For each runner, how often its runner page went quiet on each page, by item ID. */
	private readonly stalls = new Map<string, Map<string, number>>();

	constructor(
		private readonly plan: Plan<unknown>,
		private readonly reopener: Reopener,
	) {}

	/** Handles a quiet runner page, and says whether a new one took its place. */
	readonly onQuiet = (name: string, seconds: number, at: PlanPlace | undefined): boolean => {
		reportQuiet(name, seconds, at);
		if (at?.item.endsTab) return this.tabEnded(name, at);
		if (!at || !this.reopener.canReopen(name, false)) return false;
		const reopens = this.reopens.get(name) ?? 0;
		console.log(`${name}: ${this.reopener.inspect(name, reopens + 1)}`);
		if (reopens >= MAX_REOPENS) {
			console.log(`${name}: its runner page stopped ${reopens + 1} times, so its turn ends`);
			return false;
		}
		const stalls = this.stalls.get(name) ?? new Map<string, number>();
		this.stalls.set(name, stalls);
		const times = (stalls.get(at.item.id) ?? 0) + 1;
		stalls.set(at.item.id, times);
		let from = at.index;
		if (times > 1) {
			writeRunnerFile(this.plan.run, name, at.item.id, {
				ok: false,
				error: `the runner page stopped answering on this page ${times} times, for ${seconds} s the last time`,
				receivedAt: new Date().toISOString(),
			});
			from++;
		}
		if (from >= this.plan.items.length) return false;
		this.reopens.set(name, reopens + 1);
		if (!this.reopener.reopen(name, from)) return false;
		console.log(
			`${name}: opened a new runner page at page ${from + 1}, ${this.plan.items[from]?.id}`,
		);
		return true;
	};

	/**
	 * Records a page that may end its tab, and went quiet, as a dead tab: its last progress becomes
	 * its result. A new runner page, where the tool can open one, goes on with the next page. These
	 * new pages do not count against the few that a runner gets for stopped pages.
	 */
	private tabEnded(name: string, at: PlanPlace): boolean {
		const progress = readResult(this.plan.run, name, progressName(at.item.id));
		writeRunnerFile(this.plan.run, name, at.item.id, tabEndedResult(progress, 'runner tool'));
		console.log(`${name}: the tab ended on ${at.item.id}, which that page may do`);
		if (at.index + 1 >= this.plan.items.length || !this.reopener.canReopen(name, true))
			return false;
		if (!this.reopener.reopen(name)) return false;
		console.log(`${name}: opened a new runner page, which goes on after ${at.item.id}`);
		return true;
	}

	/**
	 * Opens a new runner page at the plan's item `from`, where a runner page handed the run over
	 * because a page runs in a runner page of its own. These new pages do not count against the few
	 * that a runner gets for stopped pages.
	 */
	readonly onHandover = (name: string, from: number): boolean => {
		const item = this.plan.items[from];
		if (!item || !this.reopener.reopen(name, from)) return false;
		console.log(`${name}: opened a new runner page for ${item.id}`);
		return true;
	};

	/** The note for a page where a runner page went quiet once and a new one ran it again. */
	noteFor(name: string, id: string): string | undefined {
		return this.stalls.get(name)?.get(id) === 1
			? 'the runner page stopped answering on this page, and a new runner page ran it again'
			: undefined;
	}
}

/**
 * Replaces runner pages: in browser apps, it closes a quiet runner page in Safari, then opens a new
 * one in the app. Where the quiet page stays open, the new page's claim on the runner's results
 * stops it. On the Android phone, it opens a new runner page only after a page that ended its tab,
 * since the browser then shows its crash page in place of the runner page. Runner pages on the
 * local network are never replaced: Safari reloads a page that crashed by itself.
 */
function deviceReopener(run: string, launches: Launches, baseUrl: string): Reopener {
	const startedAt = Date.now();
	return {
		canReopen: (runner, tabEnded) => {
			const launch = launches.get(runner);
			return isApp(launch) || (launch?.kind === 'android' && tabEnded);
		},
		inspect: (runner, count) =>
			launches.get(runner)?.kind === 'mac'
				? inspectMac(run, runner, count, startedAt)
				: 'no evidence: the tool looks only at a Mac',
		reopen: (runner, from) => {
			const launch = launches.get(runner);
			const url = runnerUrl(baseUrl, run, runner, from, isApp(launch));
			if (launch?.kind === 'android') {
				openOnPhone(launch.browser, url);
				return true;
			}
			if (!isApp(launch)) return false;
			if (launch.app === 'Safari') closeSafariRunner(run, runner);
			return openApp(launch, url);
		},
	};
}

/** Device names as people write them, where a runner's name gives them in lowercase. */
const APPLE_DEVICES: Readonly<Record<string, string>> = { ipad: 'iPad', iphone: 'iPhone' };

/** A name of words joined by dashes as a person writes it: chrome-beta becomes Chrome Beta. */
const titled = (name: string) =>
	name
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');

/** A runner's browser and device, in the words of the person at the device. */
interface DeviceWords {
	app: string;
	place: string;
	/** The device's settings that change its display's refresh rate, as they would be when wrong. */
	rateSettings: string;
}

function deviceWords(runner: string, launch: Launch | undefined): DeviceWords {
	if (launch?.kind === 'mac')
		return { app: launch.app, place: 'this Mac', rateSettings: 'Low Power Mode is on' };
	if (launch?.kind === 'linux')
		return {
			app: launch.app,
			place: 'this Linux machine',
			rateSettings: 'its display runs at another rate',
		};
	if (launch?.kind === 'android')
		return {
			app: titled(launch.browser),
			place: 'the phone',
			rateSettings: 'Motion smoothness is not Standard, or battery saver is on',
		};
	if (launch?.kind === 'cloud')
		return {
			app: titled(launch.device.browser),
			place: `the cloud's ${launch.device.device ?? `${launch.device.os} ${launch.device.osVersion}`}`,
			rateSettings: "the cloud's display or power settings differ",
		};
	const [device = runner, ...browser] = runner.split('-');
	const apple = APPLE_DEVICES[device];
	return {
		app: titled(browser.join('-')) || 'the browser',
		place: `the ${apple ?? device}`,
		rateSettings: apple
			? 'Limit Frame Rate is off, or Low Power Mode or Reduce Motion is on'
			: 'a display or power setting changed',
	};
}

/**
 * What the person at a device does before the next run, after its browser kept refusing memory: a
 * new browser process gets its memory back. A runner page on the local network must also be in
 * front, where the device's browser lets it run.
 */
export function memoryResetText(
	runner: string,
	launch: Launch | undefined,
	only: string[],
): string {
	if (launch?.kind === 'cloud')
		return `Run it again with bun run devices:cloud --only ${runner} -- --only ${only.join(',')}, in a new session with a fresh browser`;
	const { app, place } = deviceWords(runner, launch);
	const front = launch?.kind === 'lan' ? ', bring the runner page to the front,' : ',';
	return `Quit and reopen ${app} on ${place}${front} then run again with --only ${only.join(',')}`;
}

/**
 * What to do after a runner page got no animation frames. A cloud session tried to bring the page
 * to the front when it opened, so a new session is the next try there.
 */
export function noFramesTodo(runner: string, launch: Launch | undefined): string {
	if (launch?.kind === 'cloud')
		return `The session could not bring the page to the front. Run it again with bun run devices:cloud --only ${runner} for a new session, or test this browser in BrowserStack Live, where a person holds the device`;
	const { app, place } = deviceWords(runner, launch);
	return `Bring the runner page to the front in ${app} on ${place}, keep the screen on, then run again`;
}

/** The display refresh rate that the device checklist asks for, in hertz. */
export const EXPECTED_REFRESH_HZ = 60;
/** The lowest refresh rate at which a run's timing figures still compare with other runs', in hertz. */
export const LOWEST_REFRESH_HZ = 55;
/** How far the refresh rate may change through one run, as a share of its highest reading. */
export const REFRESH_SPREAD = 0.1;

/**
 * The fixed plans that time frames or loads. Their figures depend on the display's refresh rate, so
 * the runner page measures it before each of their pages, as it does in the phone-scale search.
 */
export const TIMED_PLANS: ReadonlySet<string> = new Set([
	'bench',
	'startup',
	'governor',
	'skinning',
	'skinning-webgpu',
	'bloom',
	'bloom-sizes',
	'environment',
	'ao',
	'effects',
	'effects-joined',
	'occlusion',
	'gpu-occlusion',
	'occlusion-s6',
	'overload',
	'soak',
	'texture-cache',
	'reflection',
]);

/**
 * What was wrong with the display's refresh rate through a timed run, from the rates in hertz that
 * the runner page measured, or undefined when it held: too low a rate, or one that changed from page
 * to page, makes frame rates that do not compare with other runs'.
 */
export function refreshProblem(rates: readonly number[]): string | undefined {
	if (rates.length === 0) return undefined;
	const low = Math.min(...rates);
	const high = Math.max(...rates);
	if (low < LOWEST_REFRESH_HZ)
		return `the display ran at ${low} Hz (expected ${EXPECTED_REFRESH_HZ})`;
	if (high - low > REFRESH_SPREAD * high)
		return `the display's rate changed between ${low} and ${high} Hz through the run`;
	return undefined;
}

/** The display refresh rates, in hertz, that a runner page measured in a run: at its start and before each page. */
function refreshRates(
	run: string,
	runner: string,
	ids: readonly string[],
	device = readDevice(run, runner),
): number[] {
	return [device?.refreshRateHz, ...ids.map((id) => readResult(run, runner, id)?.runnerRefreshHz)]
		.map(Number)
		.filter((hz) => Number.isFinite(hz) && hz > 0);
}

/** The message for a runner whose display's refresh rate made its timing figures unreliable. */
export function refreshText(runner: string, launch: Launch | undefined, problem: string): string {
	const { place, rateSettings } = deviceWords(runner, launch);
	return `${runner}: ${problem}: ${place} is hot, or ${rateSettings}; let it cool and check its settings. Its timing figures in this run are unreliable.`;
}

/** Why the out-of-memory guard ended a runner's turn, and what to do before the next run. */
export interface EndedEarly {
	reason: string;
	/** The latest pages that failed for lack of memory, or the step that got no frames. */
	pages: string[];
	/** What the person at the device does next. */
	todo: string;
	/** The pages to run again: those without a result, and those that failed for lack of memory. */
	only: string[];
	endedAt: string;
}

/** The ids that --only takes for these plan items: a later round's items run as the first's. */
const onlyIds = (ids: readonly string[]) => [
	...new Set(ids.map((id) => id.replace(/-round-\d+$/, ''))),
];

/** A runner's result while its run goes on, or undefined while the dev server is still writing it. */
function storedResult(run: string, runner: string, id: string): ItemResult | undefined {
	try {
		return readResult(run, runner, id);
	} catch {
		return undefined;
	}
}

/** One of a runner's latest pages, as the out-of-memory guard sees it. */
interface LatestPage {
	id: string;
	/** The page's error when it failed for lack of memory. */
	outOfMemory?: string;
}

/**
 * Ends a runner's turn early when no later page can pass. That is so when its runner page got no
 * animation frames and stopped, as when the browser reports the page hidden. It is so too when the
 * browser keeps refusing memory: enough of its latest pages failed for lack of memory, as Safari
 * does after hours of runs, and only a new browser process helps. The guard reads each runner's
 * results as they come, in the plan's order, and skips the pages that push the memory limit on
 * purpose. `stop` ends the runner page's turn; the guard then records why, in the runner's results,
 * and prints what to do.
 */
export class TurnGuard {
	/** For each runner, the plan index of its next result to read, and its latest pages. */
	private readonly seen = new Map<string, { next: number; latest: LatestPage[] }>();
	/** The runners whose turn the guard ended, and why. */
	readonly ended = new Map<string, EndedEarly>();

	constructor(
		private readonly plan: Plan<Check>,
		private readonly launches: Launches,
		private readonly stop: (runner: string) => void,
	) {}

	/**
	 * Reads a runner's new results, and ends its turn when its runner page got no frames or its
	 * browser keeps refusing memory.
	 */
	readonly endTurn = (runner: string): boolean => {
		const { run, items } = this.plan;
		if (this.ended.has(runner)) return true;
		const noFrames = storedResult(run, runner, NO_FRAMES) as NoFramesRecord | undefined;
		if (noFrames) {
			this.record(runner, {
				reason: noFramesText(noFrames.visibility),
				pages: [noFrames.step],
				todo: noFramesTodo(runner, this.launches.get(runner)),
				only: [],
				endedAt: new Date().toISOString(),
			});
			return true;
		}
		const seen = this.seen.get(runner) ?? { next: 0, latest: [] };
		this.seen.set(runner, seen);
		while (seen.next < items.length) {
			const item = items[seen.next] as PlanItem<Check>;
			const result = storedResult(run, runner, item.id);
			if (!result) break;
			seen.next++;
			if (MEMORY_LIMIT_CHECKS.has(item.check.kind)) continue;
			seen.latest.push({
				id: item.id,
				...(outOfMemory(result) && { outOfMemory: String(result.error) }),
			});
			if (seen.latest.length > OOM_WINDOW_PAGES) seen.latest.shift();
			if (keepsRefusingMemory(seen.latest.map((page) => page.outOfMemory !== undefined))) {
				this.end(runner, seen.latest);
				return true;
			}
		}
		return false;
	};

	private end(runner: string, latest: readonly LatestPage[]): void {
		const failed = latest.filter((page) => page.outOfMemory !== undefined);
		const errors = [
			...new Set(
				failed.map((page) =>
					/\bE1109\b/.test(page.outOfMemory ?? '') ? 'E1109' : 'Out of memory',
				),
			),
		];
		const only = onlyIds(
			this.plan.items
				.filter((item) => {
					const result = storedResult(this.plan.run, runner, item.id);
					return !result || outOfMemory(result);
				})
				.map((item) => item.id),
		);
		this.record(runner, {
			reason: `the browser keeps refusing the engine's memory (${errors.join(' and ')} on ${failed.length} of its last ${latest.length} pages)`,
			pages: failed.map((page) => page.id),
			todo: memoryResetText(runner, this.launches.get(runner), only),
			only,
			endedAt: new Date().toISOString(),
		});
	}

	/** Ends a runner's turn, and records and prints why. */
	private record(runner: string, ended: EndedEarly): void {
		this.stop(runner);
		this.ended.set(runner, ended);
		writeRunnerFile(this.plan.run, runner, 'ended-early', ended);
		console.log(endedEarlyText(runner, ended));
	}
}

/** The message for a runner whose turn the guard ended. */
export const endedEarlyText = (runner: string, { reason, todo }: EndedEarly) =>
	`${runner}: ${reason}. ${todo}`;

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
 * A fixed plan's items with the command line's settings: the items that --only names, or only its
 * shard's items, the number of rounds over. With --switches, each item's page gets them after its
 * own. Undefined for the phone-scale search. Items whose pages end their tab run on a network device
 * only with --attended: a phone over USB gets a new runner page from the runner tool, but a
 * tablet's runner page that Safari did not reload stays closed.
 */
export function planItems(options: Options): PlanItem<Check>[] | undefined {
	const planned = PLANS[options.plan]?.({
		count: options.count,
		runs: options.runs,
		jobs: options.jobs,
		pages: options.pages,
		scenes: options.scenes,
		seconds: options.seconds,
		minutes: options.minutes,
	});
	if (!planned) return undefined;
	const { shard, only, rounds = 1, switches } = options;
	const all =
		switches === undefined
			? planned
			: planned.map((item) => ({
					...item,
					path: `${item.path}${item.path.includes('?') ? '&' : '?'}${switches}`,
				}));
	const needs = (item: PlanItem<Check>) => itemsNeeded(item.check);
	const items = only ? pickItems(all, only, needs) : all;
	if (options.lan.length > 0 && !options.attended && items.some((item) => item.endsTab))
		throw new Error(
			`the ${options.plan} plan crashes the tab on purpose, and after a crash soon after another, Safari on a tablet stops reloading the runner page; run it on --lan devices with --attended, while someone can reopen the page`,
		);
	if (!shard) return repeatItems(items, rounds);
	const part = shardItems(items, shard, needs);
	if (part.length === 0)
		throw new Error(
			`shard ${shard.index} of ${shard.count} has no items: the ${options.plan} plan has too few items for ${shard.count} shards`,
		);
	// Every shard loads the capabilities page first, so its runner page can skip the pages of the GPU
	// paths that the device lacks.
	const report = items.find((item) => item.check.kind === 'capabilities');
	return repeatItems(report && !part.includes(report) ? [report, ...part] : part, rounds);
}

/**
 * Runs a fixed plan: each batch of runners, one browser per device, at most --parallel runners at
 * once, while the phone's heat is read. A runner's turn starts as soon as a place frees. Each cloud
 * runner's session ends with its turn, and is marked passed or failed once the run is judged. Judges
 * each result and prints a summary; returns the number of failures.
 */
async function runPlan(
	options: Options,
	items: PlanItem<Check>[],
	runners: readonly LaunchedRunner[],
	launches: Launches,
	local: DevServer,
	cloud?: CloudSessions,
	rerun = false,
): Promise<PlanOutcome> {
	const run = runName(options.plan);
	const reruns = new Map<string, { item: PlanItem<Check>; verdict: string[] }[]>();
	const timed = TIMED_PLANS.has(options.plan);
	const paths = withGpuPaths(items, options.missing);
	const plan = writePlan(run, paths.items, {
		...(REPORT_ON_TOP_PLANS.has(options.plan) && { reportOnTop: true }),
		...(timed && { measureRefresh: true }),
		tabEvery: PAGES_PER_TAB,
		...paths.flags,
	});
	const recovery = new QuietRecovery(plan, deviceReopener(run, launches, local.url));
	let turns: string[] = [];
	// A runner whose turn ends leaves the turn list first, so a reloaded runner page does not start
	// the run again, and then loses its claim, so its runner page stops at its next result.
	const guard = new TurnGuard(plan, launches, (name) => {
		turns = turns.filter((turn) => turn !== name);
		setTurns(run, turns);
		endTurnClaim(run, name);
	});
	const heatReadings = new Map<string, HeatSample[]>();
	const parallel = options.parallel ?? (options.cloud.length > 0 ? 1 : Number.POSITIVE_INFINITY);
	// One runner's turn: it joins the turn list, its runner page opens, and the turn ends when the
	// page finishes, goes quiet, never starts, or loses its cloud session, or the guard ends it.
	const turn = async (name: string) => {
		turns = [...turns, name];
		setTurns(run, turns);
		const remote = launches.get(name)?.kind === 'cloud';
		try {
			await waitForRunners(plan, await openRunners([name], launches, run, local.url, cloud), {
				onFinish: (runner) => console.log(`${runner}: finished`),
				onQuiet: recovery.onQuiet,
				onHandover: recovery.onHandover,
				endTurn: (runner) => guard.endTurn(runner) || cloud?.lost(runner) === true,
				...(remote && {
					startMs: CLOUD_START_MS,
					onNoStart: (runner: string, seconds: number) =>
						console.log(`${runner}: its runner page did not start within ${seconds} s`),
				}),
			});
		} finally {
			turns = turns.filter((other) => other !== name);
			setTurns(run, turns);
			if (remote) await cloud?.close(name);
		}
	};
	try {
		for (const batch of turnBatches(runners)) {
			const phone = phoneRunner(batch, launches);
			const log = phone === undefined ? undefined : new HeatLog();
			log?.start();
			try {
				await inLanes(batch, parallel, turn);
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
	let imageFailures = 0;
	for (const runner of runners) {
		const { name } = runner;
		const device = readDevice(run, name);
		const braveShields = braveShieldsOf(name, device, options.shields);
		const endedEarly = guard.ended.get(name);
		const unreliableTiming = timed
			? refreshProblem(
					refreshRates(
						run,
						name,
						plan.items.map((item) => item.id),
						device,
					),
				)
			: undefined;
		const counts: RunnerSummary = {
			pass: 0,
			skip: 0,
			fail: 0,
			...(endedEarly && { notRun: 0, endedEarly }),
			...(unreliableTiming && { unreliableTiming }),
			...(braveShields !== undefined && { braveShields }),
		};
		summary[name] = counts;
		if (!device) {
			counts.fail++;
			failures++;
			console.log(`FAIL  ${name}: the runner page never started`);
			continue;
		}
		const browser = browserOf(device);
		counts.browser = browserText(browser);
		// A runner page without frames tested nothing after it stopped, which fails the run.
		if (readResult(run, name, NO_FRAMES)) {
			counts.fail++;
			console.log(
				`FAIL  ${name}: ${endedEarly?.reason ?? 'its runner page got no animation frames'}`,
			);
		}
		const mismatch = browserMismatch(name, browser);
		if (mismatch) console.log(`WARN  ${mismatch}`);
		const imagesOf = imageDevice(runner);
		const context = {
			resultOf: (id: string) => readResult(run, name, id),
			imageDir: join(RUNS_DIR, run, name),
			storedBaselines,
			runner: { name, device: imagesOf },
			braveShields,
		};
		// The images this runner saved for review in an earlier run are stale once this run is judged.
		clearCandidates({ runner: name, device: imagesOf });
		for (const item of plan.items) {
			const result = readResult(run, name, item.id);
			// The pages after a turn that the guard ended are listed once, in its message.
			if (!result && counts.notRun !== undefined) {
				counts.notRun++;
				continue;
			}
			const stall = recovery.noteFor(name, item.id);
			const notes: string[] = stall ? [stall] : [];
			const note = (text: string) => notes.push(text);
			const verdict = result
				? judge(item.check, result, options.missing, {
						...context,
						note,
						...(item.endsTab && { progress: readResult(run, name, progressName(item.id)) }),
					})
				: [NO_RESULT];
			// Facts the runner page could not record go into the result itself.
			const facts = {
				...(braveShields !== undefined && { braveShields }),
				...(notes.length > 0 && { notes }),
			};
			if (Object.keys(facts).length > 0) addToResult(run, name, item.id, facts);
			if (verdict === 'skip') {
				counts.skip++;
				const path = (result && skippedPath(result)) ?? gpuPathOf(item) ?? 'webgpu';
				const skipped = counts.skippedPaths ?? [];
				if (!skipped.includes(path)) counts.skippedPaths = [...skipped, path];
				console.log(`skip  ${name}: ${item.id}, no ${GPU_PATH_NAMES[path]}`);
				continue;
			}
			if (verdict.length === 0) {
				counts.pass++;
				console.log(`pass  ${name}: ${item.id}`);
			} else {
				counts.fail++;
				if (item.check.kind === 'image') imageFailures++;
				const again = !rerun && rerunsInNewTab(browser.name, verdict);
				if (again) reruns.set(name, [...(reruns.get(name) ?? []), { item, verdict }]);
				console.log(
					`FAIL  ${name}: ${item.id}: ${verdict.join('; ')}${again ? ' (RERUN: runs once more in a new runner page)' : ''}`,
				);
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
		const tables = [
			benchSummary,
			memorySummary,
			startupSummary,
			depthSummary,
			overloadSummary,
			skinningSummary,
			animationSummary,
			jitterSummary,
			tabMemorySummary,
			soakSummary,
			warmUpTimeSummary,
			governorSummary,
			textureCacheSummary,
			objectGrowthSummary,
			occlusionS6Summary,
		].map((summary) => summary(plan.items, resultOf));
		for (const table of tables) if (table) console.log(`\n${name}\n${table}\n`);
		// The frames that the bench plan's pages captured, which people look at after each run.
		const frames = join(RUNS_DIR, run, name, 'frames');
		if (existsSync(frames)) console.log(`${name}, captured frames to look at: ${frames}`);
		const heat = wholeHeatText(heatReadings.get(name) ?? []);
		if (heat) console.log(`${name}, heat through the run: ${heat}`);
	}
	for (const [name, counts] of Object.entries(summary)) console.log(summaryLine(name, counts));
	if (cloud) {
		for (const [name, counts] of Object.entries(summary))
			await cloud.mark(name, counts.fail === 0 && !counts.endedEarly, summaryLine(name, counts));
		console.log(`\nCloud sessions:\n${cloud.summary().join('\n')}`);
	}
	for (const [name, { unreliableTiming, endedEarly }] of Object.entries(summary)) {
		if (unreliableTiming) console.log(refreshText(name, launches.get(name), unreliableTiming));
		if (endedEarly) console.log(endedEarlyText(name, endedEarly));
	}
	printRecordEntries(run, runners, summary);
	console.log(`results: ${join(RUNS_DIR, run)}`);
	if (imageFailures > 0)
		console.log('Review the new and changed images with their diffs: bun run images:review');
	return { run, failures, reruns };
}

/** A plan's run: its name, its failures, and the failed pages that run once more, by runner. */
interface PlanOutcome {
	run: string;
	failures: number;
	reruns: Map<string, { item: PlanItem<Check>; verdict: string[] }[]>;
}

/**
 * Runs each page that failed in Safari in a way that kept memory explains once more, each in a new
 * runner page, and returns the run's failures: those of the first run, less the pages that passed
 * the second time. Each rerun is printed, and recorded in the first run's results as `reruns`, so
 * a fault that a second run hides stays in the record.
 */
async function rerunInNewTabs(
	outcome: PlanOutcome,
	options: Options,
	runners: readonly LaunchedRunner[],
	launches: Launches,
	local: DevServer,
	cloud?: CloudSessions,
): Promise<number> {
	let failures = outcome.failures;
	for (const [name, pages] of outcome.reruns) {
		const runner = runners.find((r) => r.name === name);
		if (!runner) continue;
		console.log(
			`\nRERUN ${name}: ${pages.length} pages failed in a way that memory Safari kept explains. Each runs once more in a new runner page, and fails only if it fails again: ${pages.map(({ item }) => item.id).join(', ')}`,
		);
		const items = pages.map(({ item }) => ({ ...item, ownTab: true as const }));
		const again = await runPlan(options, items, [runner], launches, local, cloud, true);
		failures += again.failures - pages.length;
		const record = {
			rerunIn: again.run,
			pages: pages.map(({ item, verdict }) => ({ id: item.id, firstVerdict: verdict })),
			failedAgain: again.failures,
		};
		writeRunnerFile(outcome.run, name, 'reruns', record);
		console.log(
			`RERUN ${name}: ${pages.length - again.failures} of ${pages.length} passed in a new runner page, ${again.failures} failed again (run ${again.run})`,
		);
	}
	return failures;
}

/** One count that the phone-scale search tried on a runner. */
interface ScaleStep {
	scene: ScaleScene;
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

/** A count of a scene's objects, such as 1,000 objects or 25 characters. */
const objects = (count: number, scene: ScaleScene) =>
	`${count.toLocaleString('en-US')} ${SCALE_COUNTS[scene].noun}`;

/** Whether a search has tried a count yet. */
const searched = ({ held, dropped }: ScaleSearch) => held > 0 || dropped !== null;

/** What the search found with one of three.js's renderers, in one line. */
function answerText(renderer: string, { held, dropped }: ScaleSearch, scene: ScaleScene): string {
	const where = `${scene.toUpperCase()}: three.js ${renderer}`;
	if (held === 0)
		return `${where} does not hold ${HOLD_FPS} frames per second even at ${objects(dropped ?? 0, scene)}`;
	if (dropped === null)
		return `${where} holds ${HOLD_FPS} frames per second up to ${objects(held, scene)}, the most the search tries`;
	return `${where} holds ${HOLD_FPS} frames per second up to ${objects(held, scene)}, and drops below at ${objects(dropped, scene)}`;
}

/**
 * Searches each runner in turn, scene by scene, for the largest count at which three.js holds the
 * rate, with each renderer that the browser can run, one count per run. The larger count of the two
 * renderers is the device's phone scale for the scene. Returns the number of scenes and runners
 * without an answer.
 */
async function runScale(
	options: Options,
	runners: readonly LaunchedRunner[],
	launches: Launches,
	local: DevServer,
): Promise<number> {
	const base = runName(SCALE_PLAN);
	const scenes = (options.scenes ?? ['s1']).filter(isScaleScene);
	let failures = 0;
	for (const runner of runners) {
		const name = runner.name;
		const log = launches.get(name)?.kind === 'android' ? new HeatLog() : undefined;
		const steps: ScaleStep[] = [];
		const answers: { scene: ScaleScene; renderer: string; search: ScaleSearch }[] = [];
		let braveShields: ShieldsState | null | undefined;
		let unreliableTiming: string | undefined;
		log?.start();
		try {
			for (const scene of scenes)
				for (const [page, renderer] of SCALE_RENDERERS) {
					let search = NEW_SEARCH;
					for (
						let count = nextCount(search, scene);
						count !== null;
						count = nextCount(search, scene)
					) {
						const run = `${base}-${name}-${steps.length + 1}`;
						const item = scaleItem(page, count, scene);
						const plan = writePlan(run, [item], { measureRefresh: true });
						setTurns(run, [name]);
						await waitForRunners(plan, await openRunners([name], launches, run, local.url), {
							onQuiet: reportQuiet,
						});
						const result = readResult(run, name, item.id);
						const verdict = result
							? judge(item.check, result, options.missing)
							: ['no result; the runner page stopped or never started'];
						if (verdict === 'skip') {
							console.log(
								`${name}: ${scene.toUpperCase()} on three.js ${renderer}: this browser cannot run it`,
							);
							break;
						}
						const failed = verdict.length > 0;
						const step: ScaleStep = {
							scene,
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
							`${name}: three.js ${renderer} at ${objects(count, scene)}: ${step.fps === null ? `failed: ${step.error}` : `${step.fps.toFixed(1)} frames per second`}`,
						);
						// A page that fails at the first count shows that the browser cannot run it at all.
						if (failed && !searched(search)) break;
						search = afterCount(search, count, step.held);
					}
					if (searched(search)) answers.push({ scene, renderer, search });
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
			unreliableTiming = refreshProblem(
				steps.flatMap((step) => refreshRates(step.run, name, [step.id])),
			);
			writeRunnerFile(base, name, 'scale', {
				answers,
				steps,
				heat: samples,
				...(braveShields !== undefined && { braveShields }),
				...(unreliableTiming && { unreliableTiming }),
			});
		}
		for (const { scene, renderer, search } of answers)
			console.log(`${name}: ${answerText(renderer, search, scene)}.`);
		const heat = wholeHeatText(log?.samples ?? []);
		if (heat) console.log(`${name}, heat through the search: ${heat}`);
		if (braveShields !== undefined) console.log(`${name}: ${shieldsText(braveShields)}`);
		if (unreliableTiming) console.log(refreshText(name, launches.get(name), unreliableTiming));
		for (const scene of scenes) {
			const best = answers
				.filter((answer) => answer.scene === scene && answer.search.held > 0)
				.sort((a, b) => b.search.held - a.search.held)[0];
			if (best) {
				const flags = scene === 's1' ? '' : ` --scenes ${scene}`;
				console.log(
					`${name}: ${scene.toUpperCase()}'s phone scale is ${objects(best.search.held, scene)}, with three.js's ${best.renderer} renderer. Run the benchmark at it with --plan bench${flags} --n ${best.search.held}.`,
				);
			} else {
				failures++;
				console.log(
					`FAIL  ${name}: the search found no count of ${scene.toUpperCase()} at which three.js holds ${HOLD_FPS} frames per second`,
				);
			}
		}
	}
	console.log(`results: ${join(RUNS_DIR, base)}`);
	return failures;
}

/**
 * The session manager for the run's cloud runners, with the account's credentials, or undefined
 * without cloud runners. The sessions belong to the build that --cloud-build names, or to one named
 * after the plan and the time.
 */
function cloudSessions(options: Options): CloudSessions | undefined {
	if (options.cloud.length === 0) return undefined;
	const build = options.cloudBuild ?? `null3D ${runName(options.plan)}`;
	const localIdentifier = process.env.BROWSERSTACK_LOCAL_IDENTIFIER;
	return browserStackSessions(
		options.cloud.map((name) => cloudDevice(name)!),
		readCredentials(),
		{
			build,
			...(localIdentifier && { localIdentifier }),
			...(options.networkLogs && { networkLogs: true }),
		},
	);
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const runners = runnersOf(options);
	if (runners.length === 0) throw new Error(USAGE);
	if (options.apps.length > 0) keepDisplayAwake();
	const launches = new Map(runners.map((runner) => [runner.name, runner.launch]));
	const cloud = cloudSessions(options);
	if (options.android.length > 0 || options.lan.length > 0) {
		const names = runners.map((runner) => runner.name);
		console.log(`${deviceChecklist(names, options.shields).join('\n')}\n`);
	}

	const items = planItems(options);
	// A plan that loads production builds makes them first, and each dev server serves them per load.
	// The scale search makes its items as it goes, each a page of three.js's renderers.
	const paths = (items ?? SCALE_RENDERERS.map(([page]) => scaleItem(page, 1))).map(
		(item) => item.path,
	);
	const builds = buildsForLoads(paths);
	for (const { build } of builds) build();
	const local = await startServer();
	const lan =
		options.lan.length > 0 || options.cloud.length > 0 ? await startServer(true) : undefined;
	const forgetCloud = cloud && onStopSignal(() => cloud.closeAll());
	if (cloud)
		console.log(`Cloud devices open ${cloudRunnerUrl('<name>')} through BrowserStack Local.`);
	if (lan && options.lan.length > 0) {
		console.log(
			`On each tablet or phone, open ${lan.url}/tests/pages/runner.html?listen&runner=<name>`,
		);
		console.log(
			`with <name> one of ${options.lan.map(slug).join(', ')}. A waiting page runs each new run when its turn comes.`,
		);
	}
	let failures: number;
	try {
		const names = builds.map(({ name }) => name);
		if (names.length > 0)
			for (const server of [local, lan]) if (server) await prepareLoads(server.selfUrl, names);
		if (items) {
			const outcome = await runPlan(options, items, runners, launches, local, cloud);
			failures = await rerunInNewTabs(outcome, options, runners, launches, local, cloud);
		} else failures = await runScale(options, runners, launches, local);
	} finally {
		await cloud?.closeAll();
		forgetCloud?.();
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
