// A check that reads more of the generated set than one process may hold runs in parts, each in a
// process of its own, and the parts divide the builds between them. The list must name every part:
// a part that it leaves out reads its share never, so the check passes by testing less ([Test
// memory](../../.dev/tests.md)).
import { describe, expect, it } from 'bun:test';
import { HEAVY_CHECKS, PART_ENV } from './heavy-checks.ts';

/** The parts that a check's entries name, and the count of parts that each of them states. */
interface Parts {
	readonly of: number;
	readonly named: number[];
}

describe('the heavy checks', () => {
	it('name every part of a check that runs in parts', () => {
		const parts = new Map<string, Parts>();
		for (const { file, env } of HEAVY_CHECKS) {
			const value = env?.[PART_ENV];
			if (value === undefined) continue;
			const [index = Number.NaN, of = Number.NaN] = value.split('/').map(Number);
			const held = parts.get(file) ?? { of: Number.NaN, named: [] };
			// One count for all the entries of a check: two entries that disagree read overlapping
			// shares, and leave another share to no process.
			expect([file, of]).toEqual([file, Number.isInteger(held.of) ? held.of : of]);
			parts.set(file, { of, named: [...held.named, index] });
		}
		expect(parts.size).toBeGreaterThan(0);
		for (const [file, { of, named }] of parts) {
			const every = Array.from({ length: of }, (_, index) => index + 1);
			expect([file, [...named].sort((a, b) => a - b)]).toEqual([file, every]);
		}
	});
});
