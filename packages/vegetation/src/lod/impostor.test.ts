import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { scaledBudget } from '../../../../tests/lib/run-budget.ts';

describe('the plant core', () => {
	it(
		'loads on a thread that reads no other package, the far baker being a lazy chunk',
		() => {
			// A runtime with no source condition resolves another package to its built files, which
			// a checkout does not hold. The generator's own modules must load there all the same.
			const generator = fileURLToPath(new URL('../generate.ts', import.meta.url));
			const run = Bun.spawnSync([
				process.execPath,
				'-e',
				`await import(${JSON.stringify(generator)});`,
			]);
			expect(run.exitCode, run.stderr.toString()).toBe(0);
		},
		scaledBudget(60_000),
	);
});
