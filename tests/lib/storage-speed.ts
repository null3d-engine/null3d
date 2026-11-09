// The storage speed plan: one load of the storage speed page, which reports the storage allowance
// that the browser gives the origin, whether it keeps the origin's storage as persistent, and the
// times of writes and reads of 1, 10 and 100 MiB blocks in each browser store from a worker. Its
// figures choose the store and the size budget of the engine's cache of derived data.
import type { ItemResult, PlanItem } from './runs.ts';

/** The one load of the storage speed page. */
export interface StorageSpeedCheck {
	kind: 'storage-speed';
}

/** One store's times, as the page reports them. */
export interface StorageSpeedStore {
	store: string;
	openMs?: number;
	sizes?: { mib: number; writeMs: number[]; readMs: number[]; ok: boolean }[];
	/** The batch of blocks written at once and read back at once. */
	batch?: { writeMs: number; readMs: number; ok: boolean };
	error?: string;
}

/** What the storage speed page reports. */
export interface StorageSpeedResult {
	estimate: { quota?: number; usage?: number; error?: string };
	persistedBefore?: boolean | string;
	persist?: boolean | string;
	persistedAfter?: boolean | string;
	stores: StorageSpeedStore[];
	hashes: { mib: number; sha256Ms: number[]; wordMs: number[] }[];
}

/** How long the page may take on a slow phone: about 1.3 GB of writes and reads. */
const TIMEOUT_SECONDS = 600;

export function storageSpeedPlan(): PlanItem<StorageSpeedCheck>[] {
	return [
		{
			id: 'storage-speed',
			path: '/tests/pages/storage-speed.html',
			timeoutSeconds: TIMEOUT_SECONDS,
			check: { kind: 'storage-speed' },
		},
	];
}

/**
 * What is wrong with the page's result: no allowance, or a store whose bytes read back changed. A
 * store that the browser lacks is a fact to record, not a fault.
 */
export function storageSpeedProblems(result: StorageSpeedResult): string[] {
	const problems: string[] = [];
	if (!(Number(result.estimate?.quota) > 0))
		problems.push(`the browser reported no storage allowance: ${result.estimate?.error ?? 'none'}`);
	for (const { store, sizes, batch } of result.stores ?? []) {
		for (const { mib, ok } of sizes ?? [])
			if (!ok) problems.push(`${store} read back other bytes than it wrote at ${mib} MiB`);
		if (batch && !batch.ok)
			problems.push(`${store} read back other bytes than it wrote in the batch`);
	}
	return problems;
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	if (sorted.length === 0) return Number.NaN;
	return sorted.length % 2
		? (sorted[middle] as number)
		: ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

const ms = (value: number) => (Number.isNaN(value) ? '-' : String(Math.round(value)));
const gib = (bytes: number | undefined) =>
	bytes === undefined ? '-' : `${(bytes / 2 ** 30).toFixed(bytes < 2 ** 30 ? 3 : 1)} GiB`;

/**
 * The storage speed report of one runner's result: the allowance and the persistent storage
 * answers, then each store's median write and read times at each size, then the hashes' times.
 */
export function storageSpeedSummary(
	items: readonly PlanItem<{ kind: string }>[],
	resultOf: (id: string) => ItemResult | undefined,
): string | undefined {
	const item = items.find(({ check }) => check.kind === 'storage-speed');
	if (!item) return undefined;
	const result = resultOf(item.id);
	if (!result?.ok) return 'The storage speed page gave no result.';
	const own = result as ItemResult & StorageSpeedResult;
	const { quota, usage } = own.estimate ?? {};
	const sizes = own.hashes.map(({ mib }) => mib);
	const header = [
		...sizes.flatMap((mib) => [`${mib} MiB write`, `${mib} MiB read`]),
		'Batch write',
		'Batch read',
	];
	return [
		`Allowance ${gib(quota)}, used ${gib(usage)}. Persistent: ${String(own.persistedBefore)} before, asked ${String(own.persist)}, ${String(own.persistedAfter)} after. Medians of each size's tries, in ms, from a worker. The batch writes 120 blocks of 1 MiB at once, then reads them at once.`,
		'',
		`| Store | Open | ${header.join(' | ')} |`,
		`| --- | --- | ${header.map(() => '---').join(' | ')} |`,
		...own.stores.map(({ store, openMs, sizes: times, batch, error }) =>
			error
				? `| ${store} | ${error} | ${header.map(() => '-').join(' | ')} |`
				: `| ${store} | ${ms(openMs ?? Number.NaN)} | ${[
						...(times ?? []).flatMap(({ writeMs, readMs }) => [
							ms(median(writeMs)),
							ms(median(readMs)),
						]),
						ms(batch?.writeMs ?? Number.NaN),
						ms(batch?.readMs ?? Number.NaN),
					].join(' | ')} |`,
		),
		'',
		`Hashes, ms: ${own.hashes
			.map(
				({ mib, sha256Ms, wordMs }) =>
					`${mib} MiB SHA-256 ${ms(median(sha256Ms))}, 32-bit ${ms(median(wordMs))}`,
			)
			.join('; ')}.`,
	].join('\n');
}
