import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dir;
const HARNESS = readFileSync(join(DIR, 'harness.ts'), 'utf8');

/** The names in the harness's list of switches that reach the sketch's address as they are. */
function forwarded(): Set<string> {
	const list = /const SKETCH_SWITCHES = \[([^\]]*)\]/.exec(HARNESS)?.[1] ?? '';
	return new Set([...list.matchAll(/'(\w+)'/g)].map((match) => match[1] as string));
}

/** The names that the harness writes into the sketch's address itself. */
function written(): Set<string> {
	return new Set(
		[...HARNESS.matchAll(/sketchUrl\.searchParams\.set\('(\w+)'/g)].map((m) => m[1] as string),
	);
}

/** Each switch that a module the sketches run reads from its own address, with the module's name. */
function readBySketches(): [string, string][] {
	const reads: [string, string][] = [];
	for (const file of readdirSync(DIR)) {
		if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'harness.ts') continue;
		const source = readFileSync(join(DIR, file), 'utf8');
		for (const match of source.matchAll(/\.(?:get|has)\('(\w+)'\)/g))
			reads.push([file, match[1] as string]);
	}
	return reads;
}

describe('bench page switches', () => {
	it('passes every switch that a sketch reads on to the sketch', () => {
		const known = new Set([...forwarded(), ...written()]);
		const reads = readBySketches();
		expect(reads.length).toBeGreaterThan(20);
		expect(reads.filter(([, name]) => !known.has(name))).toEqual([]);
	});
});
