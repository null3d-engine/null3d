// Runs of the runner page. A run is a plan of test pages that each browser works through, one page
// after another, with one result file per browser and page. The command-line tools write the plan,
// choose which browsers may run it now, and read the results; the runner page and the dev server
// move everything in between.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CURRENT_RUN_FILE, RUNS_DIR } from './report-collector.ts';

export interface PlanItem<Check = unknown> {
	/** The item's name, which is also its result's file name. */
	id: string;
	/** The page to open: a path on the dev server, with its switches. */
	path: string;
	/** How long the page may take to publish its result. */
	timeoutSeconds: number;
	/** What the command-line tool checks in the result. */
	check: Check;
}

export interface Plan<Check = unknown> {
	run: string;
	createdAt: string;
	items: PlanItem<Check>[];
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

/** A run name from its plan's name and the time: sortable, and safe as a folder name. */
export function runName(planName: string, now = new Date()): string {
	const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
	return `${stamp}-${planName}`.toLowerCase();
}

export function writePlan<Check>(run: string, items: PlanItem<Check>[]): Plan<Check> {
	const plan: Plan<Check> = { run, createdAt: new Date().toISOString(), items };
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

export function readResult(run: string, runner: string, id: string): ItemResult | undefined {
	return readJson(join(RUNS_DIR, run, runner, `${id}.json`));
}

/** What the runner page learned about its browser and device. */
export function readDevice(run: string, runner: string): Record<string, unknown> | undefined {
	return readJson(join(RUNS_DIR, run, runner, 'device.json'));
}

export function finished(run: string, runner: string): boolean {
	return existsSync(join(RUNS_DIR, run, runner, 'done.json'));
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

/** Waits until every runner has finished the run, or the deadline passes; returns the finished ones. */
export async function waitForRunners(
	run: string,
	runners: readonly string[],
	timeoutMs: number,
	onFinish: (runner: string) => void = () => {},
): Promise<string[]> {
	const deadline = Date.now() + timeoutMs;
	const done = new Set<string>();
	while (done.size < runners.length && Date.now() < deadline) {
		for (const runner of runners) {
			if (!done.has(runner) && finished(run, runner)) {
				done.add(runner);
				onFinish(runner);
			}
		}
		if (done.size < runners.length) await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return [...done];
}
