// Runs of the runner page. A run is a plan of test pages that each browser works through, one page
// after another, with one result file per browser and page. The command-line tools write the plan,
// choose which browsers may run it now, and read the results; the runner page and the dev server
// move everything in between.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeviceFacts } from './device-record.ts';
import { CURRENT_RUN_FILE, RUNS_DIR } from './report-collector.ts';

export interface PlanItem<Check = unknown> {
	/** The item's name, which is also its result's file name. */
	id: string;
	/**
	 * The page to open: a path on the dev server, with its switches. The runner page puts its run and
	 * its own name where the path has `{run}` and `{runner}`.
	 */
	path: string;
	/** How long the page may take to publish its result. */
	timeoutSeconds: number;
	/**
	 * How long the runner page may send nothing on this page before it counts as stopped, for a page
	 * that posts its progress as it goes, so a dead tab shows sooner than at the page's timeout.
	 */
	quietSeconds?: number;
	/**
	 * The page may end its tab on purpose, as the tab memory page does. It posts its progress under
	 * its progress name, and a dead tab then counts as its result, not as a stopped runner page.
	 */
	endsTab?: true;
	/** What the command-line tool checks in the result. */
	check: Check;
}

export interface Plan<Check = unknown> {
	run: string;
	createdAt: string;
	items: PlanItem<Check>[];
	/**
	 * The runner page draws its report over each page's frame, which stays full size underneath, so
	 * the screen does not flash between pages. Only plans that check results set it: over a timed
	 * page, the report would add to what the browser composites.
	 */
	reportOnTop?: true;
}

/** The run that waiting runner pages start, and the runners that may start it now. */
export interface CurrentRun {
	run: string;
	turns: string[];
}

/** A result the runner page stored: the page's own report, or a timeout it recorded instead. */
export interface ItemResult {
	ok: boolean;
	error?: string;
	[key: string]: unknown;
}

/** Text as a name that is safe in files and URLs: lowercase words joined by dashes. */
export const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** How many of a page's last steps a failure's message quotes. */
const LAST_STEPS = 6;

/** The last steps of a page's trail, as a failure's message quotes them, or nothing without one. */
export function lastSteps(trail: unknown): string {
	const steps = Array.isArray(trail) ? trail.map(String) : [];
	return steps.length > 0 ? `; the page's last steps: ${steps.slice(-LAST_STEPS).join('; ')}` : '';
}

/** What a failed page's result says went wrong, with the last steps the page got through. */
export const failureText = (result: ItemResult) =>
	`${result.error ?? 'the page failed without a message'}${lastSteps(result.trail)}`;

/** A run name from its plan's name and the time: sortable, and safe as a folder name. */
export function runName(planName: string, now = new Date()): string {
	const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
	return `${stamp}-${planName}`.toLowerCase();
}

export function writePlan<Check>(
	run: string,
	items: PlanItem<Check>[],
	reportOnTop = false,
): Plan<Check> {
	const plan: Plan<Check> = {
		run,
		createdAt: new Date().toISOString(),
		items,
		...(reportOnTop && { reportOnTop }),
	};
	mkdirSync(join(RUNS_DIR, run), { recursive: true });
	writeFileSync(join(RUNS_DIR, run, 'plan.json'), JSON.stringify(plan, null, '\t'));
	return plan;
}

/** Lets these runners start the run; any other waiting runner page keeps waiting. */
export function setTurns(run: string, turns: string[]): void {
	mkdirSync(RUNS_DIR, { recursive: true });
	const current: CurrentRun = { run, turns };
	writeFileSync(CURRENT_RUN_FILE, JSON.stringify(current));
}

function readJson<T>(path: string): T | undefined {
	return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : undefined;
}

const resultPath = (run: string, runner: string, id: string) =>
	join(RUNS_DIR, run, runner, `${id}.json`);

export function readResult(run: string, runner: string, id: string): ItemResult | undefined {
	return readJson(resultPath(run, runner, id));
}

/** Writes a file of a runner's results, such as a result with facts added after the run. */
export function writeRunnerFile(run: string, runner: string, name: string, value: unknown): void {
	mkdirSync(join(RUNS_DIR, run, runner), { recursive: true });
	writeFileSync(join(RUNS_DIR, run, runner, `${name}.json`), JSON.stringify(value, null, '\t'));
}

/** Adds facts that the runner page could not record to one of a runner's results, if it has one. */
export function addToResult(
	run: string,
	runner: string,
	id: string,
	facts: Record<string, unknown>,
): void {
	const result = readResult(run, runner, id);
	if (result) writeRunnerFile(run, runner, id, { ...result, ...facts });
}

/** When the dev server received a result, in milliseconds since 1970, or undefined without one. */
export function receivedAt(
	result: ItemResult | Record<string, unknown> | undefined,
): number | undefined {
	const time = Date.parse(String(result?.receivedAt));
	return Number.isFinite(time) ? time : undefined;
}

/** What the runner page learned about its browser and device. */
export function readDevice(
	run: string,
	runner: string,
): (DeviceFacts & Record<string, unknown>) | undefined {
	return readJson(join(RUNS_DIR, run, runner, 'device.json'));
}

export function finished(run: string, runner: string): boolean {
	return existsSync(join(RUNS_DIR, run, runner, 'done.json'));
}

/** One shard of a plan: the index-th of `count` shards, counting from 1. */
export interface Shard {
	index: number;
	count: number;
}

/** What a tool's `--shard` option takes, for its error message. */
export const SHARD_FORMAT = '<i>/<n>, such as 1/2, with i from 1 to n';

/** Reads a shard written as `<i>/<n>`, or null when the text is not one. */
export function readShard(text: string | undefined): Shard | null {
	const [, index = 0, count = 0] = /^(\d+)\/(\d+)$/.exec(text ?? '')?.map(Number) ?? [];
	return index >= 1 && index <= count ? { index, count } : null;
}

/**
 * The items of one shard of a plan, in the plan's order. An item stays in the shard of the items
 * that `needs` names for it, so each group of items that need each other moves as one. The groups,
 * in the order of their first items, go each to the shard with the fewest items so far, the first
 * such shard on a tie. So the split depends only on the plan, and the shards' item counts differ
 * by at most the size of the largest group.
 */
export function shardItems<Check>(
	items: readonly PlanItem<Check>[],
	{ index, count }: Shard,
	needs: (item: PlanItem<Check>) => readonly string[],
): PlanItem<Check>[] {
	// Each item points to another item of its group, and the group's root points to itself.
	const parent = new Map(items.map((item) => [item.id, item.id]));
	const root = (id: string): string => {
		const up = parent.get(id) as string;
		return up === id ? id : root(up);
	};
	for (const item of items)
		for (const id of needs(item)) if (parent.has(id)) parent.set(root(item.id), root(id));
	const sizes = new Map<string, number>();
	for (const item of items) sizes.set(root(item.id), (sizes.get(root(item.id)) ?? 0) + 1);
	const counts = new Array<number>(count).fill(0);
	const shardOf = new Map<string, number>();
	for (const [group, size] of sizes) {
		const fewest = counts.indexOf(Math.min(...counts));
		shardOf.set(group, fewest);
		counts[fewest] = (counts[fewest] ?? 0) + size;
	}
	return items.filter((item) => shardOf.get(root(item.id)) === index - 1);
}

/**
 * The items of a plan that `ids` name, in the plan's order, with each item that `needs` names for
 * them, such as the first thread mode of an image test. Throws on an id that the plan lacks.
 */
export function pickItems<Check>(
	items: readonly PlanItem<Check>[],
	ids: readonly string[],
	needs: (item: PlanItem<Check>) => readonly string[],
): PlanItem<Check>[] {
	const byId = new Map(items.map((item) => [item.id, item]));
	const unknown = ids.filter((id) => !byId.has(id));
	if (unknown.length > 0) throw new Error(`the plan has no item ${unknown.join(', ')}`);
	const picked = new Set<string>();
	const pick = (id: string) => {
		const item = byId.get(id);
		if (!item || picked.has(id)) return;
		picked.add(id);
		for (const needed of needs(item)) pick(needed);
	};
	for (const id of ids) pick(id);
	return items.filter((item) => picked.has(item.id));
}

/**
 * The items `rounds` times over, one round after another, as when a fault comes only now and then.
 * Each later round's items get the round's number after their ids, so each keeps its own result.
 */
export function repeatItems<Check>(
	items: readonly PlanItem<Check>[],
	rounds: number,
): PlanItem<Check>[] {
	return Array.from({ length: rounds }, (_, round) =>
		items.map((item) => (round === 0 ? item : { ...item, id: `${item.id}-round-${round + 1}` })),
	).flat();
}

/** A runner page in one browser, and the physical device that browser runs on. */
export interface Runner {
	name: string;
	device: string;
}

/**
 * Batches of runners that may run at the same time: at most one per physical device, so two
 * browsers never compete for one device's processor and GPU. Batch k holds the k-th runner of each
 * device, in the order given.
 */
export function turnBatches(runners: readonly Runner[]): string[][] {
	const byDevice = new Map<string, string[]>();
	for (const { name, device } of runners)
		byDevice.set(device, [...(byDevice.get(device) ?? []), name]);
	const batches: string[][] = [];
	for (const list of byDevice.values()) {
		list.forEach((runner, k) => {
			if (!batches[k]) batches[k] = [];
			batches[k]?.push(runner);
		});
	}
	return batches;
}

/** Time a batch may take: every page's timeout, plus time to open the browser and pause between pages. */
export function batchTimeoutMs(plan: Plan): number {
	const PER_ITEM_SLACK_SECONDS = 5;
	const START_SECONDS = 120;
	return (
		(START_SECONDS +
			plan.items.reduce((sum, item) => sum + item.timeoutSeconds + PER_ITEM_SLACK_SECONDS, 0)) *
		1000
	);
}

/** Time to open the next page, on top of its timeout, before a quiet runner page counts as stopped. */
const LOAD_SECONDS = 30;

/**
 * How long a runner page may send nothing on a page before it counts as stopped, as when its tab
 * closes: the page's timeout, after which the runner page reports a timeout itself, or the page's
 * quiet time where it posts progress, and time to open the page.
 */
export const quietLimitMs = (item: PlanItem) =>
	((item.quietSeconds ?? item.timeoutSeconds) + LOAD_SECONDS) * 1000;

/** A plan item and its place in the plan. */
export interface PlanPlace<Check = unknown> {
	index: number;
	item: PlanItem<Check>;
}

/**
 * The page that a runner works on now: the first item of the plan without a result, since the
 * runner page works through the items in order. Undefined once every item has a result.
 */
export function currentItem<Check>(
	plan: Plan<Check>,
	runner: string,
): PlanPlace<Check> | undefined {
	const index = plan.items.findIndex((item) => !existsSync(resultPath(plan.run, runner, item.id)));
	return index < 0 ? undefined : { index, item: plan.items[index] as PlanItem<Check> };
}

/** When a runner last wrote a file of the run, or undefined before its runner page starts. */
function lastWrite(run: string, runner: string): number | undefined {
	const dir = join(RUNS_DIR, run, runner);
	if (!existsSync(dir)) return undefined;
	let last: number | undefined;
	for (const name of readdirSync(dir)) {
		const time = statSync(join(dir, name)).mtimeMs;
		if (last === undefined || time > last) last = time;
	}
	return last;
}

/** What a wait reports, and the quiet time after which a started runner counts as stopped. */
export interface WaitOptions<Check = unknown> {
	onFinish?: (runner: string) => void;
	/**
	 * Reports a runner page that went quiet on a page, or after its last page. Returns true when it
	 * opened a new runner page for the runner, which the wait then gives the page's time again.
	 */
	onQuiet?: (runner: string, quietSeconds: number, at: PlanPlace<Check> | undefined) => boolean;
	/** The quiet time for a page, by default the page's timeout and time to open it. */
	quietMs?: (item: PlanItem<Check>) => number;
}

/**
 * Waits until each runner has finished the run, or has gone quiet after it started, or the plan's
 * time runs out. A runner that never starts waits for the plan's time, as a page on a tablet may
 * need someone to open it. A runner page that `onQuiet` replaces adds its quiet time to the plan's
 * time. Returns the runners that finished.
 */
export async function waitForRunners<Check>(
	plan: Plan<Check>,
	runners: readonly string[],
	{ onFinish = () => {}, onQuiet = () => false, quietMs = quietLimitMs }: WaitOptions<Check> = {},
): Promise<string[]> {
	let deadline = Date.now() + batchTimeoutMs(plan);
	const done: string[] = [];
	const waiting = new Set(runners);
	/** When the runner tool last opened a new runner page for a runner that went quiet. */
	const reopenedAt = new Map<string, number>();
	while (waiting.size > 0 && Date.now() < deadline) {
		for (const runner of waiting) {
			const written = lastWrite(plan.run, runner);
			const last =
				written === undefined ? undefined : Math.max(written, reopenedAt.get(runner) ?? 0);
			if (finished(plan.run, runner)) {
				waiting.delete(runner);
				done.push(runner);
				onFinish(runner);
				continue;
			}
			if (last === undefined) continue;
			const at = currentItem(plan, runner);
			const limit = at ? quietMs(at.item) : LOAD_SECONDS * 1000;
			const quiet = Date.now() - last;
			if (quiet <= limit) continue;
			if (onQuiet(runner, Math.round(quiet / 1000), at)) {
				reopenedAt.set(runner, Date.now());
				deadline += quiet;
			} else waiting.delete(runner);
		}
		if (waiting.size > 0) await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return done;
}
