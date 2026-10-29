// The physics guide's frame loop reads each body's transform into objects made once. Rapier's
// `translation(target?)` and `rotation(target?)` make a new object for each call without a target,
// so a loop that omits one allocates per body per frame. That read is the mistake this check
// witnesses: it reads the guide's own code, and a sample that lost a target fails here line by
// line. The sample itself cannot run in this repository, because it imports Rapier and cannon-es,
// two libraries that the workspace does not carry: guidance for a reader who installs them is not
// engine surface, so the check holds the code rather than executing it, and says so.
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './server.ts';

const GUIDE = join(REPO_ROOT, 'docs', 'guides', 'physics.md');

describe('the physics guide', () => {
	it('gives every transform read a target, so no frame allocates one', () => {
		const text = readFileSync(GUIDE, 'utf8');
		const reads = [...text.matchAll(/\.(translation|rotation)\(([^)]*)\)/g)];
		expect(reads.length, 'transform reads in the guide').toBeGreaterThan(0);
		const withoutTarget = reads
			.filter(([, , argument]) => (argument ?? '').trim() === '')
			.map(([call]) => call);
		expect(withoutTarget, 'reads that make a new object per call').toEqual([]);
		// The loop copies into objects that the setup makes once, so the same two names come back.
		expect(text).toContain('const readTranslation = { x: 0, y: 0, z: 0 };');
		expect(text).toContain('const readRotation = { x: 0, y: 0, z: 0, w: 1 };');
		expect(text).toMatch(/translation\(readTranslation\)/);
		expect(text).toMatch(/rotation\(readRotation\)/);
	});
});
