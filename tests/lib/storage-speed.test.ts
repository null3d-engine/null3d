import { describe, expect, test } from 'bun:test';
import { PLANS } from './plans.ts';
import type { ItemResult } from './runs.ts';
import {
	type StorageSpeedResult,
	storageSpeedPlan,
	storageSpeedProblems,
	storageSpeedSummary,
} from './storage-speed.ts';

const sizes = (ok = true) =>
	[1, 10, 100].map((mib) => ({ mib, writeMs: [3, 1, 2], readMs: [mib, mib, mib], ok }));

function result(overrides: Partial<StorageSpeedResult> = {}): StorageSpeedResult {
	return {
		estimate: { quota: 10 * 2 ** 30, usage: 0 },
		persistedBefore: false,
		persist: 'no answer',
		persistedAfter: false,
		stores: [
			{ store: 'cache', openMs: 2, sizes: sizes(), batch: { writeMs: 140, readMs: 60, ok: true } },
			{ store: 'opfs-sync', error: 'NotSupportedError: no sync handles' },
		],
		hashes: [1, 10, 100].map((mib) => ({ mib, sha256Ms: [mib], wordMs: [mib / 2] })),
		...overrides,
	};
}

describe('the storage speed plan', () => {
	test('loads the storage speed page once, with time for a slow phone', () => {
		const [item, ...rest] = storageSpeedPlan();
		expect(rest).toEqual([]);
		expect(item?.path).toBe('/tests/pages/storage-speed.html');
		expect(item?.check).toEqual({ kind: 'storage-speed' });
		expect(PLANS['storage-speed']).toBe(storageSpeedPlan);
	});

	test('passes a store that the browser lacks, and fails a read of other bytes or no allowance', () => {
		expect(storageSpeedProblems(result())).toEqual([]);
		const bad = result({
			estimate: { error: 'SecurityError' },
			stores: [
				{
					store: 'idb',
					openMs: 1,
					sizes: sizes(false),
					batch: { writeMs: 1, readMs: 1, ok: false },
				},
			],
		});
		expect(storageSpeedProblems(bad)).toEqual([
			'the browser reported no storage allowance: SecurityError',
			'idb read back other bytes than it wrote at 1 MiB',
			'idb read back other bytes than it wrote at 10 MiB',
			'idb read back other bytes than it wrote at 100 MiB',
			'idb read back other bytes than it wrote in the batch',
		]);
	});

	test("reports the allowance, the answers and each store's medians", () => {
		const items = storageSpeedPlan();
		const lines =
			storageSpeedSummary(items, () => ({ ok: true, ...result() }) as unknown as ItemResult)?.split(
				'\n',
			) ?? [];
		expect(lines[0]).toStartWith(
			'Allowance 10.0 GiB, used 0.000 GiB. Persistent: false before, asked no answer, false after.',
		);
		expect(lines).toContain('| cache | 2 | 2 | 1 | 2 | 10 | 2 | 100 | 140 | 60 |');
		expect(lines).toContain(
			'| opfs-sync | NotSupportedError: no sync handles | - | - | - | - | - | - | - | - |',
		);
		expect(lines.at(-1)).toBe(
			'Hashes, ms: 1 MiB SHA-256 1, 32-bit 1; 10 MiB SHA-256 10, 32-bit 5; 100 MiB SHA-256 100, 32-bit 50.',
		);
		expect(storageSpeedSummary(items, () => undefined)).toBe(
			'The storage speed page gave no result.',
		);
		expect(storageSpeedSummary(PLANS.checks?.() ?? [], () => undefined)).toBeUndefined();
	});
});
