// Browser tests that time pages must end on their own. A test with no time limit, or with a wait
// for a quiet computer of its own, waited for hours on a busy computer and held the queue.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HEAVY_SLOT_ENV } from '../../tools/lib/build-cache.ts';
import { waitForQuietLoad } from './cost-runs.ts';

const root = join(import.meta.dirname, '..', '..');
const specs = ['tests/image', 'bench/tests'].flatMap((folder) =>
	readdirSync(join(root, folder))
		.filter((name) => name.endsWith('.spec.ts'))
		.map((name) => ({
			path: `${folder}/${name}`,
			text: readFileSync(join(root, folder, name), 'utf8'),
		})),
);

describe('a browser test that times pages', () => {
	test('keeps a time limit', () => {
		expect(specs.length).toBeGreaterThan(0);
		expect(
			specs.filter((spec) => /setTimeout\(\s*0\s*\)/.test(spec.text)).map((spec) => spec.path),
		).toEqual([]);
	});

	test('waits for a quiet computer through the shared wait, which has a time limit', () => {
		expect(specs.filter((spec) => /\bloadavg\b/.test(spec.text)).map((spec) => spec.path)).toEqual(
			[],
		);
	});
});

describe('the wait for a quiet computer', () => {
	test("stops at once when the job queue has closed the run's timing window", async () => {
		const slot = mkdtempSync(join(tmpdir(), 'null3d-slot-'));
		const saved = { slot: process.env[HEAVY_SLOT_ENV], trial: process.env.NULL3D_COST_TRIAL };
		try {
			writeFileSync(join(slot, 'window-closed'), "the job queue closed this timing run's window\n");
			process.env[HEAVY_SLOT_ENV] = slot;
			delete process.env.NULL3D_COST_TRIAL;
			await expect(waitForQuietLoad()).rejects.toThrow(
				"the job queue closed this timing run's window",
			);
		} finally {
			if (saved.slot === undefined) delete process.env[HEAVY_SLOT_ENV];
			else process.env[HEAVY_SLOT_ENV] = saved.slot;
			if (saved.trial !== undefined) process.env.NULL3D_COST_TRIAL = saved.trial;
			rmSync(slot, { recursive: true, force: true });
		}
	});
});
