// The traced cloud and its dome are two shaders, and each literal compiles on its own, so each
// holds a copy of the cloud's light. The copies must stay the same, or the far sea that the dome
// draws would part from the cloud where the cloud's rays end.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

test("the cloud and the dome hold the same copy of the cloud's light", () => {
	const source = readFileSync(new URL('./clouds.ts', import.meta.url), 'utf8');
	const copies = [...source.matchAll(/\/\/ light \{\n([\s\S]*?)\/\/ \} light/g)].map((m) => m[1]);
	expect(copies).toHaveLength(2);
	expect(copies[0]).toBe(copies[1]);
});
