// TEMPORARY measurement spec for M3-R20. Prints each mode's trap result and page trail, and
// asserts nothing. Delete before any commit.
import { test } from '@playwright/test';
import { ENGINE_MODES } from '../lib/engine-checks.ts';
import { pageResult } from '../lib/page-result.ts';
import type { TrapResult } from '../pages/lib/governor-trap.ts';

const TIERS = ['webgpu', 'webgl2'] as const;
const TRAP_MS = 240_000;

for (const tier of TIERS)
	for (const mode of ENGINE_MODES)
		test(`r20 latency ${tier}, ${mode.name}`, async ({ page }) => {
			test.setTimeout(TRAP_MS + 30_000);
			const consoleLines: string[] = [];
			page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
			page.on('worker', (worker) => worker.on('console', (m) => consoleLines.push(`w: ${m.text()}`)));
			await page.goto(`governor-trap.html?gpu=${tier}&${mode.query}`);
			const result = await pageResult<TrapResult & { error?: string }>(page, TRAP_MS);
			const trail = await page.evaluate(
				() => (globalThis as { __null3dProgress?: string[] }).__null3dProgress ?? [],
			);
			console.log(`RESULT ${tier} ${mode.name} ${JSON.stringify(result)}`);
			console.log(`TRAIL ${tier} ${mode.name} ${JSON.stringify(trail)}`);
			if (consoleLines.length > 0)
				console.log(`CONSOLE ${tier} ${mode.name} ${JSON.stringify(consoleLines.slice(-40))}`);
		});
